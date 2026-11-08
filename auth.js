/* BYOK is account-scoped; optional browser remembering is explicit in the form. */
import * as vault from './key-vault.js';
const $=id=>document.getElementById(id);
const dialog=$('apiKeyDialog'),form=$('apiKeyForm'),button=$('apiKeyStatusBtn');
let key='',keyOwner=null,pending=null,finishPending=null,ensuring=null,validation=0,epoch=0,restoration=null,restoredFor=null,remembered=false;
const validKey=value=>/^sk-[\w-]{15,300}$/.test(value);
function updateButton(){
  const ready=Boolean(key);
  button.textContent=ready?'AI connected':'Connect AI';
  button.title=ready?'Manage your OpenAI API key':'Connect OpenAI API key';
  button.setAttribute('aria-label',button.title);
  button.classList.toggle('premium-active',ready);
  document.body.classList.toggle('premium-ready',ready);
}
function openKeyDialog(){
  validation++;
  $('apiKeyInput').value='';
  $('apiKeyRemoveBtn').classList.toggle('hidden',!key);
  $('apiKeyError').textContent='';
  $('apiKeyRemember').checked=key?remembered:true;
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
    await restore();
    if(key)return true;
    if(pending)return pending;
    pending=new Promise(resolve=>{finishPending=resolve});openKeyDialog();return pending;
  })().finally(()=>{ensuring=null});
  return ensuring;
}
async function restore(){
  const actor=window.MosaicAccount.current();if(!actor)return false;
  if(key&&keyOwner===actor.id)return true;
  if(restoredFor===actor.id)return restoration;
  restoredFor=actor.id;const ticket=epoch;
  restoration=(async()=>{
    try{
      const saved=await vault.recall(actor.id);
      if(ticket!==epoch||window.MosaicAccount.current()?.id!==actor.id)return false;
      if(validKey(saved||'')){key=saved;keyOwner=actor.id;remembered=true;updateButton();return true}
    }catch{/* Storage-disabled browsers can still connect for this tab. */}
    return false;
  })();return restoration;
}
async function request(path,body){
  if(!key)throw Error('Add your OpenAI API key to generate images.');
  if(!/^\/api\/ai\/(?:master|edit|harmonize|classify|option-name)$/.test(path))
    throw Error('Unsupported AI request.');
  // HTTPS to mozAI's same-origin function, which forwards this key to OpenAI.
  // Do not place keys in URLs, cookies, localStorage or project files.
  await window.MosaicAccount.ready();
  if(!keyOwner||window.MosaicAccount.current()?.id!==keyOwner)throw Error('Sign in to the account connected to this OpenAI key.');
  let result;
  try{result=await window.MosaicAccount.request(path,{method:'POST',body:{...body,apiKey:key,projectId:await window.MosaicAccount.projectId()}})}
  catch(error){
    if(error.status===401&&!error.code){const owner=keyOwner;clear();if(owner)await vault.forget(owner).catch(()=>{})}
    throw error;
  }
  if(result.generationId)window.dispatchEvent(new CustomEvent('mosaic:generation',{detail:{recorded:result.usageRecorded}}));
  return result;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const nextKey=$('apiKeyInput').value.trim();
  if(!validKey(nextKey)){$('apiKeyError').textContent='Enter a valid OpenAI API key starting with sk-.';return}
  const actor=window.MosaicAccount.current();if(!actor)return;
  const attempt=++validation,submit=$('apiKeySubmitBtn');submit.disabled=true;submit.textContent='Checking connection…';$('apiKeyError').textContent='';
  try{
    await window.MosaicAccount.request('/api/ai/connection',{method:'POST',body:{apiKey:nextKey}});
    if(attempt!==validation||!dialog.open||window.MosaicAccount.current()?.id!==actor.id)return;
    const shouldRemember=$('apiKeyRemember').checked;let saved=false;
    try{if(shouldRemember){await vault.remember(actor.id,nextKey);saved=true}else await vault.forget(actor.id)}catch{}
    if(attempt!==validation||!dialog.open||window.MosaicAccount.current()?.id!==actor.id)return;
    key=nextKey;keyOwner=actor.id;remembered=saved;restoredFor=actor.id;form.reset();complete(true);dialog.close();updateButton();
    if(shouldRemember&&!saved)window.MosaicCore?.toast('Connected for this tab. This browser could not remember the key.');
    window.dispatchEvent(new CustomEvent('mosaic:keyconnected'));
  }catch(error){if(attempt===validation)$('apiKeyError').textContent=error.message}
  finally{submit.disabled=false;submit.textContent='Connect securely'}
});
dialog.addEventListener('close',()=>{if(dialog.open)return;validation++;form.reset();complete(false)});
$('apiKeyCancelBtn').addEventListener('click',()=>dialog.close());
$('apiKeyRemoveBtn').addEventListener('click',async()=>{
  const owner=keyOwner||window.MosaicAccount.current()?.id;clear();if(owner)await vault.forget(owner).catch(()=>{});
});
button.addEventListener('click',async()=>{if(await window.MosaicAccount.ensure())openKeyDialog()});
window.addEventListener('mosaic:account',async event=>{if(event.detail.user){await restore();if(event.detail.interactive&&!ensuring&&!key)void ensure()}});
function clear(){epoch++;validation++;key='';keyOwner=null;remembered=false;restoredFor=null;restoration=null;form.reset();complete(false);if(dialog.open)dialog.close();updateButton()}
window.MosaicAuth={clear,restore,ensure,request,status:async()=>Boolean(key),isReady:()=>Boolean(key)};
updateButton();
void window.MosaicAccount.ready().then(()=>restore());
