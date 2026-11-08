/* OpenAI BYOK is independent of the application account and stays in tab memory. */
const $=id=>document.getElementById(id);
const dialog=$('apiKeyDialog'),form=$('apiKeyForm'),button=$('apiKeyStatusBtn');
let key='',pending=null,finishPending=null,ensuring=null,validation=0;
const validKey=value=>/^sk-[\w-]{15,300}$/.test(value);
function updateButton(){
  const ready=Boolean(key);
  button.textContent=ready?'OpenAI ✓':'Connect AI';
  button.title=ready?'OpenAI API key connected':'Connect OpenAI API key';
  button.setAttribute('aria-label',button.title);
  button.classList.toggle('premium-active',ready);
  document.body.classList.toggle('premium-ready',ready);
}
function openKeyDialog(){
  validation++;
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
  if(ensuring)return ensuring;
  ensuring=(async()=>{
    if(!await window.MosaicAccount.ensure())return false;
    if(key)return true;
    if(pending)return pending;
    pending=new Promise(resolve=>{finishPending=resolve});openKeyDialog();return pending;
  })().finally(()=>{ensuring=null});
  return ensuring;
}
async function request(path,body){
  if(!key)throw Error('Add your OpenAI API key to generate images.');
  if(!/^\/api\/ai\/(?:master|edit|harmonize|classify|option-name)$/.test(path))
    throw Error('Unsupported AI request.');
  // HTTPS to mozAI's same-origin function, which forwards this key to OpenAI.
  // Do not place keys in URLs, cookies, localStorage or project files.
  await window.MosaicAccount.ready();
  const result=await window.MosaicAccount.request(path,{method:'POST',body:{...body,apiKey:key,projectId:await window.MosaicAccount.projectId()}});
  if(result.generationId)window.dispatchEvent(new CustomEvent('mosaic:generation',{detail:{recorded:result.usageRecorded}}));
  return result;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const nextKey=$('apiKeyInput').value.trim();
  if(!validKey(nextKey)){$('apiKeyError').textContent='Enter a valid OpenAI API key starting with sk-.';return}
  const attempt=++validation,submit=$('apiKeySubmitBtn');submit.disabled=true;submit.textContent='Checking connection…';$('apiKeyError').textContent='';
  try{
    await window.MosaicAccount.request('/api/ai/connection',{method:'POST',body:{apiKey:nextKey}});
    if(attempt!==validation||!dialog.open)return;
    key=nextKey;form.reset();complete(true);dialog.close();updateButton();
    window.dispatchEvent(new CustomEvent('mosaic:keyconnected'));
  }catch(error){if(attempt===validation)$('apiKeyError').textContent=error.message}
  finally{submit.disabled=false;submit.textContent='Connect securely'}
});
dialog.addEventListener('close',()=>{if(dialog.open)return;validation++;form.reset();complete(false)});
$('apiKeyCancelBtn').addEventListener('click',()=>dialog.close());
$('apiKeyRemoveBtn').addEventListener('click',()=>{
  key='';form.reset();complete(false);dialog.close();updateButton();
});
button.addEventListener('click',async()=>{if(await window.MosaicAccount.ensure())openKeyDialog()});
window.addEventListener('mosaic:account',event=>{if(event.detail.user&&event.detail.interactive&&!ensuring&&!key)void ensure()});
window.MosaicAuth={clear:()=>{validation++;key='';form.reset();complete(false);if(dialog.open)dialog.close();updateButton()},ensure,request,status:async()=>Boolean(key),isReady:()=>Boolean(key)};
updateButton();
