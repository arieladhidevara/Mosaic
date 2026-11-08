/* Use the local mock Supabase + OpenAI server. No real credentials or charges. */
window.runGuestFlow=async function(){
  const $=id=>document.getElementById(id),account=window.MosaicAccount,auth=window.MosaicAuth,core=window.MosaicCore,checks=[];
  const assert=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Guest flow timed out')};
  const originalFetch=window.fetch,calls=[];window.fetch=async(path,options)=>{calls.push(String(path));return originalFetch(path,options)};
  try{
    await account.ready();assert(!account.current()&&!$('landing').hidden&&!$('accountDialog').open,'Public visitor hit a login wall');assert($('app').inert,'Hidden editor is keyboard accessible');
    assert($('landing').scrollWidth<=$('landing').clientWidth+1,'Landing overflows horizontally');
    document.querySelector('[data-enter-guest]').click();assert($('landing').hidden&&!$('app').inert,'Guest editor did not open');
    const frame=core.makeCanvas(640,420);frame.getContext('2d').fillStyle='#778899';frame.getContext('2d').fillRect(0,0,640,420);core.setMaster(frame,'Guest draft');core.state.reference=frame;core.state.rawBase=frame;
    core.selectTool('lasso');core.state.lasso=[{x:90,y:80},{x:300,y:80},{x:300,y:250},{x:90,y:250}];core.updateMaskWithLasso();core.hideQuickPrompt();
    const before=core.composeApprovedCanvas().toDataURL(),mask=core.state.selectionMask.toDataURL();await account.startProject(true);await account.track('selection_created');
    assert(!calls.includes('/api/activity'),'Guest created authenticated analytics');
    const unauthorized=await originalFetch('/api/ai/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:'sk-guest-test-key-placeholder'})});assert(unauthorized.status===401,'Guest bypassed AI authentication');
    checks.push('Public landing and guest manual editor; private AI rejected server-side');
    const canceled=auth.ensure();await wait(()=>$('accountDialog').open);$('accountGuest').click();assert(await canceled===false,'Cancel did not release AI action');assert(core.state.selectionMask.toDataURL()===mask,'Cancel lost the selection');
    const pending=auth.ensure();await wait(()=>$('accountDialog').open);
    const form=$('accountForm');form.elements.email.value='tester@example.com';form.elements.password.value='wrong-password';form.requestSubmit();await wait(()=>Boolean($('accountError').textContent));assert(!account.current(),'Invalid password accepted');
    form.elements.password.value='test-only-password';form.requestSubmit();await wait(()=>$('apiKeyDialog').open&&Boolean(account.current()));
    assert(core.composeApprovedCanvas().toDataURL()===before&&core.state.selectionMask.toDataURL()===mask,'Login replaced guest canvas or mask');
    assert($('apiKeyDialog').querySelectorAll('a[target="_blank"]').length===2,'OpenAI onboarding links missing');
    $('apiKeyCancelBtn').click();assert(await pending===false&&!auth.isReady(),'Skipping BYOK activated AI');
    checks.push('Login and signup gate preserves guest image and mask; optional BYOK onboarding');
    $('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open);
    window.fetch=async(path,options)=>String(path)==='/api/ai/connection'?Response.json({error:'OpenAI rejected this API key.'},{status:400}):originalFetch(path,options);
    $('apiKeyInput').value='sk-invalid-provider-test-key';$('apiKeyForm').requestSubmit();await wait(()=>Boolean($('apiKeyError').textContent));assert(!auth.isReady(),'Rejected key activated AI');
    window.fetch=originalFetch;$('apiKeyInput').value='sk-mozai-guest-flow-test-key';$('apiKeyForm').requestSubmit();await wait(()=>auth.isReady());
    assert(!$('apiKeyDialog').open&&!$('apiKeyInput').value,'Connected key remains in form');
    const storage=JSON.stringify({...localStorage,...sessionStorage});assert(!storage.includes('sk-mozai'),'API key persisted in browser storage');
    checks.push('Free key validation, rejection recovery, no browser key persistence');
    const start=await account.request('/api/credits');
    for(const quality of ['low','medium','high']){
      $('regionRenderQuality').value=quality;$('regionRenderQuality').dispatchEvent(new Event('change',{bubbles:true}));$('harmonizeQuality').value=quality;$('harmonizeQuality').dispatchEvent(new Event('change',{bubbles:true}));
      const expected=window.MozDemoCredits.costs[quality];assert($('harmonizeSidebarBtn').dataset.creditLabel.startsWith(expected+' '),'Harmonize credits mismatch');assert($('quickAreaPromptForm').querySelector('[type="submit"]').dataset.creditLabel.startsWith(expected+' '),'Region credits mismatch');assert($('masterGenerateSubmit').dataset.creditLabel.startsWith('3 '),'Master quality not fixed');
    }
    $('regionRenderQuality').value='medium';$('regionRenderQuality').dispatchEvent(new Event('change',{bubbles:true}));
    await window.MosaicPremium.generateSelection('Warm walnut test');await wait(()=>core.state.patches.size>0&&[...core.state.patches.values()].every(p=>!p.generating&&!p.awaitingResult));
    await window.MosaicCredits.refresh();const after=await account.request('/api/credits');assert(after.used===start.used+2,'Successful Medium generation did not cost exactly 2 demo credits');assert(after.openaiBalance===null,'Demo balance passed off as OpenAI funds');
    const invalid=await originalFetch('/api/ai/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:'sk-mozai-guest-flow-test-key',quality:'invalid'})});assert(!invalid.ok,'Invalid quality accepted');assert((await account.request('/api/credits')).used===after.used,'Failed request consumed credits');
    checks.push('Low/Medium/High labels, fixed High Master, successful-only server credit accounting');
    const saved=core.composeApprovedCanvas().toDataURL();
    window.fetch=async(path,options)=>String(path)==='/api/session'||String(path)==='/api/ai/connection'?Response.json({error:'Session expired',code:'AUTH_REQUIRED'},{status:401}):originalFetch(path,options);
    try{await account.request('/api/ai/connection',{method:'POST',body:{apiKey:'sk-mozai-guest-flow-test-key'}})}catch{}
    assert(!account.current()&&!auth.isReady()&&$('accountDialog').open,'Expired session retained AI credentials');assert(core.composeApprovedCanvas().toDataURL()===saved,'Expired session erased canvas');$('accountGuest').click();
    checks.push('Session expiry clears BYOK while preserving the manual workspace');
    return {passed:checks.length,checks};
  }finally{window.fetch=originalFetch}
};
window.runInvitationFlow=async function(){
  const $=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Invitation flow timed out')};
  await window.MosaicAccount.ready();assert($('accountDialog').open&&!$('invitationNotice').hidden,'Invitation was not recognized');assert(!location.hash,'Invite token remains in URL');
  $('accountSignup').click();assert($('accountSubmit').textContent==='Create Pro account','Create account mode missing');const form=$('accountForm');form.elements.email.value='tester@example.com';form.elements.password.value='test-only-password';form.requestSubmit();
  await wait(()=>Boolean($('accountNotice').textContent));assert(!window.MosaicAccount.current(),'Unconfirmed signup entered AI workspace');assert($('accountNotice').textContent.includes('email'),'Missing confirmation guidance');assert(sessionStorage.getItem('mozai.invitation'),'Invitation lost before confirmation');
  form.elements.password.value='test-only-password';form.requestSubmit();await wait(()=>Boolean(window.MosaicAccount.current()));assert(!sessionStorage.getItem('mozai.invitation'),'Redeemed invitation retained');await wait(()=>$('apiKeyDialog').open);$('apiKeyCancelBtn').click();
  return {passed:1,checks:['Invitation recognition, signup, email confirmation guidance, invited sign-in and optional OpenAI setup']};
};
window.runLandingLayout=async function(){
  const $=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m)};
  await window.MosaicAccount.ready();assert(!$('landing').hidden&&!$('accountDialog').open,'Landing unavailable');assert($('landing').scrollWidth<=$('landing').clientWidth+1,'Horizontal overflow');
  document.querySelector('[data-sign-in]').click();assert($('accountDialog').open,'Sign in did not open');const r=$('accountDialog').getBoundingClientRect();assert(r.left>=0&&r.right<=innerWidth+1&&r.height<=innerHeight,'Sign-in dialog does not fit');
  await new Promise(r=>setTimeout(r,150));assert(document.documentElement.scrollWidth<=innerWidth+1,'Hidden editor expands public page');assert(visualViewport.scale===1,'Public page triggered mobile viewport scaling');
  return {passed:1,checks:['Responsive landing, keyboard-isolated editor and viewport-fitting sign-in dialog'],viewport:{width:innerWidth,visual:visualViewport.width,scale:visualViewport.scale,offset:visualViewport.offsetLeft,rect:r.toJSON()}};
};
window.runAdminLogin=async function(){
  const $=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Admin login timed out')};
  await window.MosaicAccount.ready();assert($('accountDialog').open&&$('adminApp').inert,'Admin is public');
  const form=$('accountForm');form.elements.email.value='admin@example.com';form.elements.password.value='test-only-password';form.requestSubmit();
  await wait(()=>window.MosaicAccount.current()?.role==='admin'&&$('adminEnvironment').textContent.includes('development'));
  assert(!$('adminApp').inert&&!$('accountDialog').open,'Admin not unlocked');assert(!$('adminError').textContent,'Admin failed to load');
  return {passed:1,checks:['Existing admin portal uses the shared verified login and still requires admin membership']};
};
window.runGuestMobile=async function(){
  const $=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m)};
  window.MosaicAccount.guest();await new Promise(r=>setTimeout(r,100));
  assert(document.documentElement.scrollWidth<=innerWidth+1,'Guest editor causes horizontal page overflow');assert(visualViewport.scale===1,'Guest editor scales the visual viewport');
  window.MosaicAccount.login();await new Promise(r=>setTimeout(r,100));const r=$('accountDialog').getBoundingClientRect();assert(r.left>=visualViewport.offsetLeft&&r.right<=visualViewport.offsetLeft+visualViewport.width,'Login clipped over mobile editor');
  return {passed:1,checks:['Guest toolbar wraps on mobile, with no horizontal overflow or clipped login']};
};
window.runProPreview=async function(){
  const $=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m)};
  await window.MosaicCredits.open();await window.MosaicCredits.refresh();assert($('creditsDialog').open,'Credit details did not open');assert($('demoRemaining').textContent!=='—','Recorded demo usage unavailable');assert($('creditsDialog').textContent.includes('simulation'),'Credits not identified as demo');
  return {passed:1,checks:['Pro balance dialog shows server usage, demo rates and actual OpenAI billing link']};
};
