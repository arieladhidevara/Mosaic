// Run only against the local mock provider. No real keys or paid requests.
const polishWait=async predicate=>{for(let i=0;i<500;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20))}throw Error('Polish scenario timed out')};
const polishAssert=(v,m)=>{if(!v)throw Error(m)};
window.runCompactLanding=async function(){
  const landing=document.getElementById('landing');await window.MosaicAccount.ready();
  polishAssert(!landing.hidden,'Use the guest fixture server');
  polishAssert(landing.scrollHeight<=landing.clientHeight&&landing.scrollWidth<=landing.clientWidth,'Landing overflows');
  for(const selector of ['.landing-primary','.landing-secondary','.landing-footer']){
    const box=landing.querySelector(selector).getBoundingClientRect();polishAssert(box.top>=0&&box.bottom<=innerHeight&&box.left>=0&&box.right<=innerWidth,'Landing content is clipped: '+selector);
  }
  return {passed:1,checks:['One-screen landing, both entry actions visible, no scroll or clipped footer']};
};
window.runComposerPolish=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,$=id=>document.getElementById(id),checks=[];
  const frame=color=>{const c=core.makeCanvas(800,500);c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,800,500);return c};
  await window.MosaicAccount.ready();$('apiKeyStatusBtn').click();await polishWait(()=>$('apiKeyDialog').open);$('apiKeyRemember').checked=false;$('apiKeyInput').value='sk-polish-browser-only-test';$('apiKeyForm').requestSubmit();await polishWait(()=>window.MosaicAuth.isReady());
  core.setMaster(frame('#224488'),'Composer test');core.state.reference=frame('#228844');core.state.rawBase=core.state.reference;
  const select=()=>{core.setMode('new');core.selectTool('lasso');core.state.lasso=[{x:150,y:130},{x:430,y:130},{x:430,y:330},{x:150,y:330}];core.updateMaskWithLasso()};
  select();polishAssert($('quickAreaPromptForm').classList.contains('hidden'),'Drawing a mask opened the prompt before a canvas click');
  $('preserveOriginalGeometry').checked=true;$('preserveOriginalGeometry').dispatchEvent(new Event('change',{bubbles:true}));
  const native=window.fetch,requests=[];window.fetch=async(path,options)=>{if(path==='/api/ai/edit')requests.push(JSON.parse(options.body));return native(path,options)};
  const pixel=async(url,x=.5,y=.5)=>{const img=await createImageBitmap(await(await native(url)).blob()),c=core.makeCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);const p=c.getContext('2d').getImageData(Math.floor(img.width*x),Math.floor(img.height*y),1,1).data;img.close();return p};
  try{
    await ai.generateSelection('Warm walnut');await polishWait(()=>core.state.patches.size&&[...core.state.patches.values()].every(p=>!p.generating&&!p.awaitingResult));
    const first=requests[0];polishAssert(first.collage&&first.mask&&first.base&&!first.guide,'Region payload missing collage, mask or enabled Base');
    const a=await pixel(first.collage),b=await pixel(first.base);polishAssert(a[2]>100&&b[1]>100&&b[2]<100,'Collage and Base are not distinct current images');
    checks.push('Region API includes current collage crop + mask + enabled original Base; no Region Guide');
    const row=document.querySelector('.variant-row[data-patch]:not([data-patch="master"])');core.hideQuickPrompt();row.click();polishAssert($('quickAreaPromptForm').classList.contains('hidden')&&core.state.selectionMask,'Sidebar option opened the floating prompt');
    const bounds=core.exactMaskBoundingBox(core.state.selectionMask),r=core.overlay.getBoundingClientRect(),x=r.left+(bounds.x+bounds.w/2)/core.canvas.width*r.width,y=r.top+(bounds.y+bounds.h/2)/core.canvas.height*r.height;
    const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture;Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
    try{for(const type of ['pointerdown','pointerup'])core.overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',pointerId:55,button:0,clientX:x,clientY:y}))}finally{Element.prototype.setPointerCapture=capture;Element.prototype.releasePointerCapture=release}
    polishAssert(!$('quickAreaPromptForm').classList.contains('hidden'),'Actual canvas area click did not open the prompt');
    const text=$('quickAreaPromptInput').getBoundingClientRect(),add=$('quickAreaReferenceButton').getBoundingClientRect(),submit=$('quickAreaPromptForm').querySelector('[type=submit]').getBoundingClientRect();
    polishAssert(add.left>=text.right&&submit.top>=text.bottom,'Composer reference/Generate layout is incorrect');polishAssert($('quickAreaReferenceButton').textContent.trim()==='+','Reference control is not a simple +');
    checks.push('Sidebar selection stays quiet; canvas click opens composer with + beside text and Generate below');
    await ai.generateSelection('A second iteration');await polishWait(()=>[...core.state.patches.values()].every(p=>!p.generating&&!p.awaitingResult));
    const current=await pixel(requests[1].collage);polishAssert(current[0]>230&&current[1]<30,'Second edit sent stale Master instead of current collage');
    checks.push('Following edits send the latest generated composition, not a stale image');
    core.showQuickPrompt();$('projectMenu').open=true;polishAssert($('saveProjectBtn').getBoundingClientRect().height>0&&$('openProjectBtn').getBoundingClientRect().height>0,'Project menu lost Save/Open');$('projectMenu').open=false;
    return {passed:checks.length,checks};
  }finally{window.fetch=native}
};
window.runRememberKeySetup=async function(){
  const $=id=>document.getElementById(id);await window.MosaicAccount.ready();const vault=await import('/key-vault.js'),actor=window.MosaicAccount.current();await vault.forget(actor.id);window.MosaicAuth.clear();
  $('apiKeyStatusBtn').click();await polishWait(()=>$('apiKeyDialog').open);$('apiKeyInput').value='sk-remember-fixture-only-key';$('apiKeyRemember').checked=true;$('apiKeyForm').requestSubmit();await polishWait(()=>window.MosaicAuth.isReady());
  polishAssert(await vault.recall(actor.id)==='sk-remember-fixture-only-key','Remembered key could not be decrypted for its owner');
  polishAssert(await vault.recall('11111111-1111-4111-8111-111111111111')===null,'Key leaked to another account');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mozai-private-keys',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject});
  const row=await new Promise(resolve=>{const r=db.transaction('credentials').objectStore('credentials').get(actor.id);r.onsuccess=()=>resolve(r.result)});db.close();
  polishAssert(row.wrappingKey.extractable===false&&row.iv.length===12&&row.ciphertext instanceof ArrayBuffer,'Remembered key is not an encrypted browser envelope');
  polishAssert(!JSON.stringify({...localStorage,...sessionStorage}).includes('sk-remember'),'Plaintext key found in Web Storage');
  return {passed:1,checks:['Owner-scoped encrypted browser key, nonextractable CryptoKey, no plaintext in local/session storage']};
};
window.runRememberKeyRestore=async function(){
  const $=id=>document.getElementById(id);await window.MosaicAccount.ready();await polishWait(()=>window.MosaicAuth.isReady());
  polishAssert(await window.MosaicAuth.ensure()&&!$('apiKeyDialog').open,'Reload asked for an already remembered key');
  $('apiKeyStatusBtn').click();await polishWait(()=>$('apiKeyDialog').open);$('apiKeyRemoveBtn').click();await polishWait(()=>!window.MosaicAuth.isReady());
  const vault=await import('/key-vault.js');await polishWait(async()=>await vault.recall(window.MosaicAccount.current().id)===null);
  polishAssert(await vault.recall(window.MosaicAccount.current().id)===null,'Remove key left remembered credentials');
  return {passed:1,checks:['A full page reload reconnects without asking; Remove key deletes the remembered credential']};
};
window.runTemporaryKeySetup=async function(){
  const $=id=>document.getElementById(id);await window.MosaicAccount.ready();$('apiKeyStatusBtn').click();await polishWait(()=>$('apiKeyDialog').open);$('apiKeyRemember').checked=false;$('apiKeyInput').value='sk-temporary-fixture-only-key';$('apiKeyForm').requestSubmit();await polishWait(()=>window.MosaicAuth.isReady());
  const vault=await import('/key-vault.js');polishAssert(await vault.recall(window.MosaicAccount.current().id)===null,'Remember opt-out persisted a credential');
  return {passed:1,checks:['Remember opt-out connects AI for this tab without storing a credential']};
};
window.runTemporaryKeyReload=async function(){
  await window.MosaicAccount.ready();await window.MosaicAuth.restore();polishAssert(!window.MosaicAuth.isReady(),'Temporary key survived a full reload');
  return {passed:1,checks:['Temporary key clears on reload while remembered keys restore automatically']};
};
window.runBaseDraftUpscale=async function(){
  const $=id=>document.getElementById(id),core=window.MosaicCore;await window.MosaicAccount.ready();
  $('apiKeyStatusBtn').click();await polishWait(()=>$('apiKeyDialog').open);$('apiKeyInput').value='sk-upscale-fixture-only-key';$('apiKeyRemember').checked=false;$('apiKeyForm').requestSubmit();await polishWait(()=>window.MosaicAuth.isReady());
  const base=core.makeCanvas(400,300);base.getContext('2d').fillStyle='#446688';base.getContext('2d').fillRect(0,0,400,300);core.state.reference=base;core.state.rawBase=base;core.continueWithBase(false);
  core.selectTool('lasso');core.state.lasso=[{x:100,y:90},{x:250,y:90},{x:250,y:220}];core.updateMaskWithLasso();
  const before=core.state.selectionPoints.map(p=>({x:p.x/400,y:p.y/300}));
  $('welcomeBasePromptInput').value='Detailed architectural render';$('welcomeBasePromptForm').requestSubmit();await polishWait(()=>!core.state.masterIsBase&&window.MosaicPremium.getMasterVersions().length===1);
  polishAssert(core.canvas.width===2048&&core.canvas.height===1536,'Existing Base-only draft was not upgraded for the first AI Master');
  const after=core.state.selectionPoints.map(p=>({x:p.x/2048,y:p.y/1536}));polishAssert(before.every((p,i)=>Math.abs(p.x-after[i].x)<.001&&Math.abs(p.y-after[i].y)<.001),'Upgrading Base moved the mask');
  polishAssert(core.state.reference===base&&base.width===400,'Upscale modified the original Base');
  $('undoBtn').click();polishAssert(!core.exactMaskBoundingBox(core.state.selectionMask),'Selection undo failed after resolution upgrade');$('redoBtn').click();polishAssert(Boolean(core.exactMaskBoundingBox(core.state.selectionMask)),'Selection redo failed after resolution upgrade');
  return {passed:1,checks:['Small Base-only draft upgrades to a 2K AI Master; mask geometry, original Base and Undo/Redo remain intact']};
};
window.runRememberedProviderErrors=async function(){
  await window.runRememberKeySetup();const native=window.fetch;let status=429;
  window.fetch=async(path,options)=>path==='/api/ai/classify'?Response.json({error:status===429?'Rate limited':'Invalid API key'},{status}):native(path,options);
  try{
    try{await window.MosaicAuth.request('/api/ai/classify',{image:'fixture'})}catch{}
    polishAssert(window.MosaicAuth.isReady(),'Rate limits discarded a valid connected key');
    status=401;try{await window.MosaicAuth.request('/api/ai/classify',{image:'fixture'})}catch{}
    polishAssert(!window.MosaicAuth.isReady(),'Rejected key stayed active');const vault=await import('/key-vault.js');polishAssert(await vault.recall(window.MosaicAccount.current().id)===null,'Rejected key will be restored on the next visit');
    return {passed:1,checks:['Provider 429 keeps the key; provider 401 disconnects and forgets rejected credentials']};
  }finally{window.fetch=native}
};
