/* Mosaic identity is separate from the editor and from the in-memory OpenAI key. */
const $=id=>document.getElementById(id),adminPage=Boolean($('adminApp'));
const fragment=new URLSearchParams(location.hash.slice(1));
const readSession=key=>{try{return sessionStorage.getItem(key)}catch{return null}};
const writeSession=(key,value)=>{try{value===null?sessionStorage.removeItem(key):sessionStorage.setItem(key,value)}catch{}};
let invitation=fragment.get('invite')||readSession('mozai.invitation')||'';
if(!/^[\w-]{40,100}$/.test(invitation))invitation='';
if(invitation)writeSession('mozai.invitation',invitation);
const returnedAccess=fragment.get('access_token'),returnedRefresh=fragment.get('refresh_token');
if(invitation||returnedAccess||fragment.has('error'))history.replaceState(null,'',location.pathname+location.search);
let user=null,lastUserId=null,projectPromise=null,bootPromise,projectInitialized=false,requestedProjectId=null;
let loginPromise=null,finishLogin=null,signup=false,popup=null,popupTimer=null;
let workspaceOpen=!adminPage&&readSession('mozai.guest')==='true';
const gate=$('accountGate');
gate.hidden=true;
gate.innerHTML=`<dialog id="accountDialog" class="account-dialog" aria-labelledby="accountHeading">
  <div class="account-card"><button id="accountClose" type="button" class="account-close" aria-label="Close sign in">&times;</button>
  <div class="account-brand"><img src="/assets/mosaic-logo.svg" alt="" width="28" height="28">mozAI <span class="pro-badge">PRO</span></div>
  <p class="account-eyebrow">YOUR NEXT CHAPTER</p><h1 id="accountHeading">Welcome back.</h1><p id="accountDescription">Sign in to unlock your AI workspace. Your composition stays right here.</p>
  <div id="invitationNotice" class="invitation-notice" hidden>Your invitation unlocks mozAI Pro &middot; 100 demo credits</div>
  <button id="accountGoogle" type="button" class="account-google"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#ea4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"/></svg>Continue with Google</button>
  <div class="account-divider"><span>or continue with email</span></div>
  <form id="accountForm"><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@studio.com" required></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="200" placeholder="At least 8 characters" required></label>
  <button id="accountSubmit" class="btn btn-premium" type="submit">Sign in</button></form>
  <p id="accountError" role="alert"></p><p id="accountNotice" role="status"></p>
  <button id="accountSignup" class="account-text-button" type="button" hidden>Create an invited account</button>
  <details id="inviteEntry" class="invite-entry"><summary>Have an invitation link?</summary><label>Paste your invitation link<input id="invitationInput" type="text" autocomplete="off" placeholder="https://mozai.cc/#invite=…"></label><button id="invitationApply" type="button" class="btn btn-outline">Use invitation</button></details>
  <button id="accountGuest" type="button" class="account-text-button">Continue as guest &rarr;</button>
  <small>AI access is by invitation. Bring your own OpenAI key; API charges are billed by OpenAI. Demo credits are for the Pro preview only. By using mozAI, you acknowledge our <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</small>
  </div></dialog>`;
const dialog=$('accountDialog');
function renderWorkspace(){
  document.body.classList.remove('account-pending');
  document.body.classList.toggle('account-signed-out',adminPage&&!user);
  document.body.classList.toggle('workspace-open',adminPage?Boolean(user):workspaceOpen);
  if($('landing'))$('landing').hidden=workspaceOpen;
  if($('app'))$('app').inert=!workspaceOpen;
  if($('adminApp'))$('adminApp').inert=!user;
  window.dispatchEvent(new Event('resize'));
}
function controls(){
  let account=$('accountControls');
  if(!account){account=document.createElement('div');account.id='accountControls';account.className='account-controls';(document.querySelector('.topbar-actions')||$('adminAccount')).append(account)}
  account.replaceChildren();
  if(!adminPage){
    if(!user){const signIn=document.createElement('button');signIn.type='button';signIn.className='header-control';signIn.textContent='Sign in';signIn.onclick=()=>showLogin();account.append(signIn);return}
    const menu=document.createElement('details');menu.className='header-menu header-profile';
    const summary=document.createElement('summary');summary.setAttribute('aria-label','Account settings');summary.title=user.email;
    const avatar=document.createElement('span');avatar.className='header-avatar';avatar.textContent=user.email.slice(0,2).toUpperCase();summary.append(avatar);
    const panel=document.createElement('div');panel.className='header-menu-panel';
    const email=document.createElement('span');email.className='header-account-email';email.textContent=user.email;panel.append(email);
    const tier=document.createElement('small');tier.className='header-account-tier';tier.textContent=user.auth==='development'?'Development · Pro':'mozAI Pro';panel.append(tier);
    const aiSettings=document.createElement('button');aiSettings.type='button';aiSettings.textContent='OpenAI API key';aiSettings.onclick=()=>{menu.open=false;window.dispatchEvent(new Event('mosaic:managekey'))};panel.append(aiSettings);
    if(user.role==='admin'){const link=document.createElement('a');link.href='/admin';link.textContent='Admin portal';panel.append(link)}
    if(user.auth!=='development'){
      const signOut=document.createElement('button');signOut.type='button';signOut.textContent='Sign out';signOut.onclick=async()=>{signOut.disabled=true;try{await request('/api/session',{method:'POST',body:{action:'logout'}},false);window.MosaicAuth?.clear?.();writeSession('mozai.guest',null);location.assign('/')}catch(error){signOut.disabled=false;signOut.textContent='Retry sign out';signOut.title=error.message}};panel.append(signOut);
    }
    menu.append(summary,panel);account.append(menu);return;
  }
  const label=document.createElement('span');label.textContent=user?(user.auth==='development'?'Dev · Pro':user.email):'Guest workspace';label.title=user?.email||'Manual editing, local projects and exports';account.append(label);
  const button=document.createElement('button');button.className='btn btn-quiet compact';button.type='button';
  if(user){
    if(user.role==='admin'&&!adminPage){const link=document.createElement('a');link.href='/admin';link.textContent='Admin';link.className='btn btn-quiet compact';account.append(link)}
    if(user.auth!=='development'){
      button.textContent='Sign out';button.onclick=async()=>{button.disabled=true;try{await request('/api/session',{method:'POST',body:{action:'logout'}},false);window.MosaicAuth?.clear?.();writeSession('mozai.guest',null);location.assign('/')}catch(error){button.disabled=false;button.textContent='Retry sign out';button.title=error.message}};account.append(button);
    }
  }else{button.textContent='Sign in';button.onclick=()=>showLogin();account.append(button)}
}
function enterGuest(){
  if(adminPage){location.assign('/');return}
  workspaceOpen=true;writeSession('mozai.guest','true');closeLogin(false);renderWorkspace();controls();
}
function closeLogin(value){
  if(finishLogin){finishLogin(value);finishLogin=null;loginPromise=null}
  if(dialog.open)dialog.close();gate.hidden=true;
  if(adminPage&&!user&&value===false)location.assign('/');
}
function mode(){
  $('accountHeading').textContent=signup?'Make room for your ideas.':'Welcome back.';
  $('accountDescription').textContent=invitation?'Your invitation is ready. Join mozAI Pro with Google or email.':'Sign in to unlock AI. Your composition stays right here.';
  $('accountSubmit').textContent=signup?'Create Pro account':'Sign in';
  $('accountForm').elements.password.autocomplete=signup?'new-password':'current-password';
  $('accountSignup').hidden=!invitation;$('accountSignup').textContent=signup?'Already have an account? Sign in':'New here? Create an invited account';
  $('invitationNotice').hidden=!invitation;$('inviteEntry').hidden=Boolean(invitation);
  $('accountGuest').textContent=adminPage?'Back to mozAI':workspaceOpen?'Back to editor':'Continue as guest →';
}
function showLogin(message=''){
  mode();$('accountError').textContent=message;$('accountNotice').textContent='';gate.hidden=false;
  if(!dialog.open)dialog.showModal();
}
async function ensure(){
  await bootPromise;if(user)return true;
  if(loginPromise)return loginPromise;
  loginPromise=new Promise(resolve=>{finishLogin=resolve});showLogin();return loginPromise;
}
function applySession(result,{interactive=false}={}){
  if(!result.authenticated||!result.user)throw Error('Could not verify your account. Please sign in again.');
  if(lastUserId&&lastUserId!==result.user.id){window.MosaicAuth?.clear?.();projectPromise=null;location.reload();throw Error('Account changed. Reloading your workspace.')}
  user=result.user;lastUserId=user.id;workspaceOpen=true;invitation='';writeSession('mozai.invitation',null);
  closeLogin(true);renderWorkspace();controls();
  window.dispatchEvent(new CustomEvent('mosaic:account',{detail:{user,interactive}}));
}
async function request(path,{method='GET',body}={},retry=true){
  if(!/^\/api\/(?:session|activity|admin|credits|ai\/(?:master|edit|harmonize|classify|option-name|connection))(?:\?|$)/.test(path))throw Error('Unsupported application request.');
  const headers={...(body?{'Content-Type':'application/json'}:{}),...(user?{'X-Mosaic-Account-Id':user.id}:{})};
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({error:'Unexpected server response. Please retry.'}));
  if(!response.ok){
    if(result.code==='ACCOUNT_CHANGED'){window.MosaicAuth?.clear?.();location.reload();throw Error(result.error)}
    if(retry&&user&&result.code==='AUTH_REQUIRED'&&path!=='/api/session'){
      try{applySession(await request('/api/session',{method:'POST',body:{action:'refresh'}},false));return request(path,{method,body},false)}
      catch{user=null;window.MosaicAuth?.clear?.();projectPromise=null;controls();renderWorkspace();window.dispatchEvent(new CustomEvent('mosaic:account',{detail:{user:null}}));if(adminPage||path.startsWith('/api/ai/'))showLogin('Your session expired. Sign in to continue. Your canvas is preserved.')}
    }
    const error=Error(result.error||'Request failed.');error.status=response.status;error.code=result.code;throw error;
  }
  return result;
}
function startProject(force=false,existingId=null){
  if(projectPromise&&!force)return projectPromise;
  projectInitialized=true;requestedProjectId=existingId;
  const pending=(async()=>{await bootPromise;if(!user)return null;return (await request('/api/activity',{method:'POST',body:{action:'project',projectId:existingId}})).project.id})();
  projectPromise=pending;
  pending.then(id=>{if(!id&&projectPromise===pending)projectPromise=null},()=>{if(projectPromise===pending)projectPromise=null});return pending;
}
async function projectId(){return projectPromise||(projectInitialized?startProject(false,requestedProjectId):null)}
async function track(type){
  const selectedProject=projectPromise;
  try{await bootPromise;if(!user)return;await request('/api/activity',{method:'POST',body:{id:crypto.randomUUID(),type,projectId:selectedProject?await selectedProject:null}})}catch{/* Local edits must survive unavailable analytics. */}
}
async function boot(){
  renderWorkspace();controls();
  try{
    let result;
    if(returnedAccess)result=await request('/api/session',{method:'POST',body:{action:'exchange',accessToken:returnedAccess,refreshToken:returnedRefresh,invitation}},false);
    else{try{result=await request('/api/session',{},false)}catch(error){if(error.code!=='AUTH_REQUIRED')throw error;result=await request('/api/session',{method:'POST',body:{action:'refresh'}},false)}}
    applySession(result,{interactive:Boolean(returnedAccess)});return user;
  }catch(error){
    renderWorkspace();
    if(adminPage||invitation||returnedAccess||fragment.has('error'))showLogin(error.code==='AUTH_REQUIRED'?'':error.message);
    return null;
  }
}
async function submit(){
  const form=$('accountForm');if(!form.reportValidity())return;
  const buttons=[...dialog.querySelectorAll('button:not(#accountClose):not(#accountGuest)')];buttons.forEach(b=>b.disabled=true);$('accountError').textContent='';$('accountNotice').textContent='';
  try{
    const data=new FormData(form),result=await request('/api/session',{method:'POST',body:{action:signup?'signup':'login',email:data.get('email'),password:data.get('password'),invitation}},false);
    form.elements.password.value='';
    if(result.confirmationRequired){signup=false;mode();$('accountNotice').textContent=result.message;return}
    applySession(result,{interactive:true});void track('session_started');
  }catch(error){$('accountError').textContent=error.message}
  finally{buttons.forEach(b=>b.disabled=false)}
}
function stopPopup(){clearInterval(popupTimer);popupTimer=null;popup=null;$('accountGoogle').disabled=false}
async function google(){
  if(popup&&!popup.closed){popup.focus();return}
  popup=window.open('about:blank','mozai-google','popup,width=500,height=680');
  if(!popup){$('accountError').textContent='Allow this sign-in popup, then try again. Your canvas will stay open.';return}
  $('accountGoogle').disabled=true;$('accountError').textContent='';
  try{
    const result=await request('/api/session',{method:'POST',body:{action:'oauth_start',invitation}},false);
    if(!popup||popup.closed){stopPopup();return}
    popup.location.replace(result.url);
    popupTimer=setInterval(()=>{if(!popup||popup.closed){stopPopup();$('accountNotice').textContent='Google sign-in closed. You can try again.'}},500);
  }catch(error){popup?.close();stopPopup();$('accountError').textContent=error.message}
}
window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||!popup||event.source!==popup||event.data?.type!=='mozai:oauth')return;
  stopPopup();
  if(!event.data.ok){$('accountError').textContent=typeof event.data.error==='string'?event.data.error:'Google sign-in failed. Try again.';return}
  try{applySession(await request('/api/session',{},false),{interactive:true});void track('session_started')}catch(error){$('accountError').textContent=error.message}
});
$('accountForm').addEventListener('submit',event=>{event.preventDefault();void submit()});
$('accountSignup').onclick=()=>{signup=!signup;mode()};
$('accountGoogle').onclick=()=>void google();
$('accountClose').onclick=()=>closeLogin(false);$('accountGuest').onclick=enterGuest;
dialog.addEventListener('close',()=>{if(dialog.open)return;closeLogin(false);if(popup){popup.close();stopPopup()}});
$('invitationApply').onclick=()=>{
  const raw=$('invitationInput').value.trim();let token=raw;
  try{token=new URLSearchParams(new URL(raw).hash.slice(1)).get('invite')||''}catch{}
  if(!/^[\w-]{40,100}$/.test(token)){$('accountError').textContent='Paste the complete invitation link from your administrator.';return}
  invitation=token;writeSession('mozai.invitation',token);signup=true;mode();$('accountError').textContent='';
};
document.querySelectorAll('[data-enter-guest]').forEach(button=>button.addEventListener('click',enterGuest));
document.querySelectorAll('[data-sign-in]').forEach(button=>button.addEventListener('click',()=>showLogin()));
window.MosaicAccount={request,startProject,projectId,track,ensure,login:showLogin,guest:enterGuest,ready:()=>bootPromise,current:()=>user};
bootPromise=boot();void bootPromise.then(actor=>{if(actor)void track('session_started')});
