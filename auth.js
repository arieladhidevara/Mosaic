/* Single-user Premium BYOK. OpenAI key lives only in tab memory. */
const $=id=>document.getElementById(id);
const dialog=$('premiumLoginDialog'),form=$('premiumLoginForm'),button=$('premiumStatusBtn');
let signedIn=false,key='',pending=null,finishPending=null;
function updateButton(){button.textContent=signedIn?'✦ Premium account':'✦ Premium login';button.classList.toggle('premium-active',signedIn)}
async function status(){
  try {const res=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});const data=await res.json();signedIn=Boolean(data.authenticated)}
  catch{signedIn=false}
  updateButton();return signedIn;
}
function openLogin(){
  $('premiumUsernameInput').value='arieladhidevara';
  $('premiumPasswordInput').value='';$('premiumKeyInput').value='';
  $('premiumPasswordRow').classList.toggle('hidden',signedIn);
  $('premiumPasswordInput').required=!signedIn;
  $('premiumLoginTitle').textContent=signedIn?'Connect your OpenAI API key':'Sign in to Mosaic Premium';
  $('premiumLogoutBtn').classList.toggle('hidden',!signedIn);
  $('premiumLoginError').textContent='';
  if(!dialog.open)dialog.showModal();
}
function complete(value){if(finishPending){finishPending(value);finishPending=null;pending=null}}
async function ensure(){
  if(signedIn&&key)return true;
  await status();
  if(signedIn&&key)return true;
  if(pending)return pending;
  pending=new Promise(resolve=>{finishPending=resolve});
  openLogin();
  return pending;
}
async function request(path,body){
  if(!signedIn||!key)throw Error('Premium login and an OpenAI API key are required.');
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,apiKey:key})});
  const result=await response.json().catch(()=>({error:'Unexpected API response'}));
  if(!response.ok)throw Error(result.error||'AI request failed');
  return result;
}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('premiumLoginSubmit');btn.disabled=true;$('premiumLoginError').textContent='';
  try{
    const nextKey=$('premiumKeyInput').value.trim();
    if(!/^sk-[\w-]{15,300}$/.test(nextKey))throw Error('Enter a valid OpenAI API key.');
    if(!signedIn){
      const response=await fetch('/api/login',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('premiumUsernameInput').value.trim(),password:$('premiumPasswordInput').value})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(result.error||'Login failed');
      signedIn=true;
    }
    key=nextKey;
    $('premiumPasswordInput').value='';$('premiumKeyInput').value='';
    dialog.close();updateButton();complete(true);
  }catch(error){$('premiumLoginError').textContent=error.message}
  finally{btn.disabled=false}
});
dialog.addEventListener('close',()=>complete(false));
$('premiumLoginCancel').addEventListener('click',()=>dialog.close());
$('premiumLogoutBtn').addEventListener('click',async()=>{
  try{await fetch('/api/logout',{method:'POST',credentials:'same-origin'})}catch{}
  signedIn=false;key='';dialog.close();complete(false);updateButton();
});
button.addEventListener('click',async()=>{await status();openLogin()});
window.MosaicAuth={ensure,request,status,isReady:()=>signedIn&&Boolean(key)};
void status();
