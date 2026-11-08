/* OpenAI BYOK is independent of the application account and stays in tab memory. */
const $=id=>document.getElementById(id);
const dialog=$('apiKeyDialog'),form=$('apiKeyForm'),button=$('apiKeyStatusBtn');
let key='',pending=null,finishPending=null;
const validKey=value=>/^sk-[\w-]{15,300}$/.test(value);
function updateButton(){
  const ready=Boolean(key);
  button.textContent=ready?'API ✓':'API';
  button.title=ready?'OpenAI API key connected':'Connect OpenAI API key';
  button.setAttribute('aria-label',button.title);
  button.classList.toggle('premium-active',ready);
  document.body.classList.toggle('premium-ready',ready);
}
function openKeyDialog(){
  $('apiKeyInput').value='';
  $('apiKeyRemoveBtn').classList.toggle('hidden',!key);
  $('apiKeyError').textContent='';
  if(!dialog.open)dialog.showModal();
  $('apiKeyInput').focus({preventScroll:true});
}
function complete(value){
  if(finishPending){finishPending(value);finishPending=null;pending=null}
}
async function ensure(){
  if(key)return true;
  if(pending)return pending;
  pending=new Promise(resolve=>{finishPending=resolve});
  openKeyDialog();
  return pending;
}
async function request(path,body){
  if(!key)throw Error('Add your OpenAI API key to generate images.');
  if(!/^\/api\/ai\/(?:master|edit|harmonize|classify|option-name)$/.test(path))
    throw Error('Unsupported AI request.');
  // HTTPS to mozAI's same-origin function, which forwards this key to OpenAI.
  // Do not place keys in URLs, cookies, localStorage or project files.
  await window.MosaicAccount.ready();
  const result=await window.MosaicAccount.request(path,{method:'POST',body:{...body,apiKey:key,projectId:await window.MosaicAccount.projectId()}});
  return result;
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const nextKey=$('apiKeyInput').value.trim();
  if(!validKey(nextKey)){$('apiKeyError').textContent='Enter a valid OpenAI API key starting with sk-.';return}
  key=nextKey;
  form.reset();complete(true);dialog.close();updateButton();
});
dialog.addEventListener('close',()=>complete(false));
$('apiKeyCancelBtn').addEventListener('click',()=>dialog.close());
$('apiKeyRemoveBtn').addEventListener('click',()=>{
  key='';form.reset();complete(false);dialog.close();updateButton();
});
button.addEventListener('click',openKeyDialog);
window.MosaicAuth={clear:()=>{key='';form.reset();complete(false);updateButton()},ensure,request,status:async()=>Boolean(key),isReady:()=>Boolean(key)};
updateButton();
