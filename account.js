/* Application authentication. OpenAI BYOK remains exclusively in auth.js memory. */
const $=id=>document.getElementById(id);
const fragment=new URLSearchParams(location.hash.slice(1));
let invitation=fragment.get('invite')||'',user=null,lastUserId=null,projectPromise=null,bootPromise;
let projectInitialized=false,requestedProjectId=null;
const returnedAccess=fragment.get('access_token'),returnedRefresh=fragment.get('refresh_token');
if(invitation||returnedAccess||fragment.has('error'))history.replaceState(null,'',location.pathname+location.search);
const gate=$('accountGate');
gate.innerHTML='<div class="account-card"><a class="account-brand" href="/">mozAI</a><h1 id="accountHeading">Opening your workspace</h1><p id="accountDescription">Checking your account...</p><form id="accountForm" hidden><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="200" required></label><button id="accountSubmit" class="btn btn-premium" type="submit">Sign in</button><button id="accountSignup" class="btn btn-outline" type="button" hidden>Create invited account</button></form><p id="accountError" role="alert"></p><button id="accountRetry" class="btn btn-outline" type="button" hidden>Try again</button><small>Private access by invitation. Your OpenAI API key is requested separately in the editor.</small></div>';
function showLogin(message=''){
  user=null;document.body.classList.remove('account-pending');document.body.classList.add('account-signed-out');gate.hidden=false;
  $('accountHeading').textContent='Sign in to mozAI';$('accountDescription').textContent=invitation?'Your invitation is ready. Sign in or create your account.':'Use your invited account to open the editor.';
  $('accountForm').hidden=false;$('accountSignup').hidden=!invitation;$('accountRetry').hidden=true;$('accountError').textContent=message;
}
function applySession(result){
  if(!result.authenticated||!result.user){showLogin();return}
  if(lastUserId&&lastUserId!==result.user.id){
    window.MosaicAuth?.clear?.();projectPromise=null;document.body.classList.add('account-pending');
    location.reload();throw Error('Account changed. Reloading your workspace.');
  }
  user=result.user;lastUserId=user.id;
  gate.hidden=true;document.body.classList.remove('account-pending','account-signed-out');
  let account=$('accountControls');
  if(!account){account=document.createElement('div');account.id='accountControls';account.className='account-controls';(document.querySelector('.topbar-actions')||$('adminAccount')).append(account)}
  account.replaceChildren();const label=document.createElement('span');label.textContent=user.auth==='development'?'Development':user.email;label.title=user.email;account.append(label);
  if(user.role==='admin'&&!location.pathname.startsWith('/admin')){const link=document.createElement('a');link.href='/admin';link.textContent='Admin';link.className='btn btn-quiet compact';account.append(link)}
  if(user.auth!=='development'){
    const button=document.createElement('button');button.className='btn btn-quiet compact';button.textContent='Sign out';button.type='button';
    button.onclick=async()=>{await request('/api/session',{method:'POST',body:{action:'logout'}},false);window.MosaicAuth?.clear?.();location.assign('/')};account.append(button);
  }
  window.dispatchEvent(new CustomEvent('mosaic:account',{detail:{user}}));
}
async function request(path,{method='GET',body}={},retry=true){
  if(!/^\/api\/(?:session|activity|admin|ai\/(?:master|edit|harmonize|classify|option-name))(?:\?|$)/.test(path))throw Error('Unsupported application request.');
  const headers={...(body?{'Content-Type':'application/json'}:{}),...(user?{'X-Mosaic-Account-Id':user.id}:{})};
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({error:'Unexpected server response.'}));
  if(!response.ok){
    if(result.code==='ACCOUNT_CHANGED'){
      window.MosaicAuth?.clear?.();document.body.classList.add('account-pending');location.reload();throw Error(result.error);
    }
    if(retry&&result.code==='AUTH_REQUIRED'&&path!=='/api/session'){
      try{applySession(await request('/api/session',{method:'POST',body:{action:'refresh'}},false));return request(path,{method,body},false)}catch{showLogin('Your session expired. Sign in to continue.');window.MosaicAuth?.clear?.()}
    }
    const error=Error(result.error||'Request failed.');error.status=response.status;error.code=result.code;throw error;
  }
  return result;
}
function startProject(force=false,existingId=null){
  if(projectPromise&&!force)return projectPromise;
  projectInitialized=true;requestedProjectId=existingId;
  const pending=(async()=>{await bootPromise;if(!user)throw Error('Sign in first.');return (await request('/api/activity',{method:'POST',body:{action:'project',projectId:existingId}})).project.id})();
  projectPromise=pending;
  // Tracking must never interrupt local canvas editing.
  pending.catch(()=>{if(projectPromise===pending)projectPromise=null});return pending;
}
async function projectId(){return projectPromise||(projectInitialized?startProject(false,requestedProjectId):null)}
async function track(type){
  const selectedProject=projectPromise;
  try{await bootPromise;if(!user)return;await request('/api/activity',{method:'POST',body:{id:crypto.randomUUID(),type,projectId:selectedProject?await selectedProject:null}})}catch{/* Account/API errors remain visible on the action that requires them. */}
}
async function boot(){
  try{
    let result;
    if(returnedAccess)result=await request('/api/session',{method:'POST',body:{action:'exchange',accessToken:returnedAccess,refreshToken:returnedRefresh,invitation}},false);
    else{
      try{result=await request('/api/session',{},false)}
      catch(error){if(error.code!=='AUTH_REQUIRED')throw error;result=await request('/api/session',{method:'POST',body:{action:'refresh'}},false)}
    }
    applySession(result);return user;
  }catch(error){showLogin(error.code==='AUTH_REQUIRED'?'':error.message);return null}
}
async function submit(action){
  const form=$('accountForm');if(!form.reportValidity())return;
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('accountError').textContent='';
  try{
    const data=new FormData(form),result=await request('/api/session',{method:'POST',body:{action,email:data.get('email'),password:data.get('password'),invitation}},false);
    form.elements.password.value='';
    if(result.confirmationRequired){$('accountError').textContent=result.message;return}
    applySession(result);invitation='';void track('session_started');
  }catch(error){$('accountError').textContent=error.message}
  finally{buttons.forEach(b=>b.disabled=false)}
}
$('accountForm').addEventListener('submit',event=>{event.preventDefault();void submit('login')});
$('accountSignup').addEventListener('click',()=>void submit('signup'));
$('accountRetry').addEventListener('click',()=>{bootPromise=boot()});
window.MosaicAccount={request,startProject,projectId,track,ready:()=>bootPromise,current:()=>user};
bootPromise=boot();void bootPromise.then(actor=>{if(actor)void track('session_started')});
