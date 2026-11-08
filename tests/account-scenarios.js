/* Load in a fresh local auto-login browser tab. Uses only an isolated test store. */
window.runLocalAccountChecks=async function(){
  const account=window.MosaicAccount,assert=(v,m)=>{if(!v)throw Error(m)},checks=[];
  await account.ready();const user=account.current();
  assert(user.email==='dev@mosaic.local'&&user.role==='admin'&&user.environment==='development','Local developer identity was not seeded');
  assert(user.id==='00000000-0000-4000-8000-000000000001','Local user ID is unstable');
  assert(document.getElementById('accountGate').hidden&&!document.body.classList.contains('account-signed-out'),'Automatic login did not open the existing editor');
  assert(window.MosaicCore&&window.MosaicPremium,'The existing editor was not loaded');
  const again=await account.request('/api/session');assert(again.user.id===user.id,'Session identity changed');
  assert(!window.MosaicAuth.isReady(),'Automatic application login supplied a BYOK key');
  let missingKey=false;try{await account.request('/api/ai/edit',{method:'POST',body:{apiKey:'invalid'}})}catch(e){missingKey=e.status===400}
  assert(missingKey,'Local auto-login bypassed API key validation');
  checks.push('Automatic stable local admin account opens the existing editor; OpenAI BYOK remains required');
  const projectId=await account.startProject(true),id=crypto.randomUUID();
  assert(await account.startProject(true,projectId)===projectId,'Owned project metadata identity changed on resume');
  const foreign=crypto.randomUUID();assert(await account.startProject(true,foreign)!==foreign,'Unowned project identifier was trusted');
  await account.startProject(true,projectId);
  await account.request('/api/activity',{method:'POST',body:{id,type:'image_exported',projectId,userId:'attacker',role:'admin',environment:'production',apiKey:'DO_NOT_STORE',prompt:'PRIVATE',image:'base64'}});
  await account.request('/api/activity',{method:'POST',body:{id,type:'image_exported',projectId}});
  const events=(await account.request('/api/admin?view=events')).data.rows.filter(row=>row.id===id);
  assert(events.length===1&&events[0].user_id===user.id&&events[0].environment==='development','Activity attribution or deduplication failed');
  assert(!JSON.stringify(events).includes('PRIVATE')&&!JSON.stringify(events).includes('DO_NOT_STORE'),'Analytics stored confidential data');
  assert(document.querySelector('#accountControls a[href="/admin"]'),'Local developer cannot navigate to the existing admin portal');
  checks.push('Authenticated admin data uses the development user; events deduplicate; client IDs/roles/environment and private content are ignored');
  const response=await fetch('/api/session',{credentials:'omit',headers:{'X-Forwarded-For':'127.0.0.1'}});assert(response.status===401,'Proxy headers activated a local admin bypass');
  const privateFile=await fetch('/.mosaic-dev/data.json');assert(privateFile.status===404,'Local data file is publicly served');
  const devEndpoint=await fetch('/api/dev-auth');assert(devEndpoint.status===404,'A public development authentication endpoint exists');
  checks.push('Proxy-header spoofing rejected; test records are not served; no public dev-auth endpoint');
  return {passed:checks.length,checks};
};
window.runRealLoginChecks=async function(role='tester'){
  const account=window.MosaicAccount,assert=(v,m)=>{if(!v)throw Error(m)};
  await account.ready();assert(!account.current(),'Real-login mode silently authenticated a developer');
  assert(!document.getElementById('accountGate').hidden,'Real-login mode did not show the login form');
  const form=document.getElementById('accountForm');form.elements.email.value=role+'@example.com';form.elements.password.value='test-only-password';form.requestSubmit();
  for(let i=0;i<300&&!account.current();i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert(account.current()?.email===role+'@example.com','Supabase login did not open the same editor');
  assert(document.getElementById('accountGate').hidden&&window.MosaicCore,'Login did not preserve the editor');
  assert(!window.MosaicAuth.isReady(),'Application login supplied an OpenAI key');
  assert(!document.cookie.includes('mosaic_session'),'Authentication cookie is readable by JavaScript');
  const admin=await fetch('/api/admin');assert(admin.status===(role==='admin'?200:403),'Database admin permissions are not enforced');
  await account.request('/api/session',{method:'POST',body:{action:'logout'}});
  assert((await fetch('/api/session')).status===401,'Sign out did not clear the authenticated session');
  return {passed:1,checks:['Real login mode: login form, Supabase session, existing editor, HttpOnly cookies, independent BYOK, '+role+' admin permissions, and logout']};
};
