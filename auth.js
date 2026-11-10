/* OpenAI keys are stored encrypted on mozAI's server and never returned to the browser. */
import * as legacyVault from './key-vault.js';
const $=id=>document.getElementById(id);
const dialog=$('apiKeyDialog'),form=$('apiKeyForm'),button=$('apiKeyStatusBtn');
let connected=false,owner=null,checked=false,loading=null,epoch=0,validation=0,initialPromptFor=null;
const validKey=value=>/^sk-[\w-]{15,300}$/.test(value);
function updateButton(){
  button.textContent=connected?'AI connected':'Connect AI';
  button.title=connected?'Manage saved OpenAI API key':'Connect OpenAI API key';
  button.setAttribute('aria-label',button.title);
  button.classList.toggle('premium-active',connected);
  document.body.classList.toggle('premium-ready',connected);
}
function clear(){
  epoch++;validation++;connected=false;owner=null;checked=false;loading=null;initialPromptFor=null;
  if(dialog.open)dialog.close();
  form.reset();updateButton();
}
function openKeyDialog(){
  validation++;$('apiKeyInput').value='';$('apiKeyError').textContent='';
  $('apiKeyRemoveBtn').classList.toggle('hidden',!connected);
  if(!dialog.open)dialog.showModal();
  $('apiKeyInput').focus({preventScroll:true});
}
async function restore(force=false){
  const actor=window.MosaicAccount.current();
  if(!actor){clear();return false}
  if(checked&&owner===actor.id&&!force)return connected;
  if(loading&&!force)return loading;
  const ticket=epoch;
  const task=(async()=>{
    try{
      const status=await window.MosaicAccount.request('/api/ai/connection');
      if(ticket!==epoch||window.MosaicAccount.current()?.id!==actor.id)return false;
      connected=Boolean(status.connected);owner=actor.id;checked=true;updateButton();
      return connected;
    }catch(error){
      if(ticket===epoch){checked=false;window.MosaicCore?.toast(error.message)}
      return false;
    }
  })();
  loading=task;
  try{return await task}finally{if(loading===task)loading=null}
}
async function promptForKeyAtEntry(){
  const actor=window.MosaicAccount.current();
  if(!actor||initialPromptFor===actor.id)return;
  initialPromptFor=actor.id;
  if(await restore()){
    await legacyVault.forget(actor.id).catch(()=>{});
    return;
  }
  if(!checked)return; // A network error must not be mistaken for a missing key.
  const old=await legacyVault.recall(actor.id).catch(()=>null);
  if(validKey(old||'')){
    try{
      const saved=await window.MosaicAccount.request('/api/ai/connection',{method:'POST',body:{apiKey:old}});
      if(window.MosaicAccount.current()?.id===actor.id){
        connected=Boolean(saved.connected);owner=actor.id;checked=true;updateButton();
        window.dispatchEvent(new CustomEvent('mosaic:keyconnected'));
      }
      await legacyVault.forget(actor.id).catch(()=>{});
      return;
    }catch{/* A failed migration should not block reconnecting manually. */}
  }
  if(window.MosaicAccount.current()?.id===actor.id&&!connected&&!dialog.open)openKeyDialog();
}
async function ensure(){
  if(!await window.MosaicAccount.ensure())return false;
  if(await restore())return true;
  window.MosaicCore?.toast('Connect your OpenAI key in your profile or the top bar.');
  return false;
}
async function request(path,body={}){
  if(!/^\/api\/ai\/(?:master|edit|harmonize|classify|option-name|object-map)$/.test(path))throw Error('Unsupported AI request.');
  if(!await ensure())throw Error('Connect your OpenAI API key in your profile.');
  // Only the verified account/session and image data are sent. No secret is in browser requests.
  const result=await window.MosaicAccount.request(path,{method:'POST',body:{...body,projectId:await window.MosaicAccount.projectId()}});
  if(result.generationId)window.dispatchEvent(new CustomEvent('mosaic:generation',{detail:{recorded:result.usageRecorded}}));
  return result;
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const key=$('apiKeyInput').value.trim();
  if(!validKey(key)){$('apiKeyError').textContent='Enter a valid OpenAI API key starting with sk-.';return}
  const actor=window.MosaicAccount.current();if(!actor)return;
  const attempt=++validation,submit=$('apiKeySubmitBtn');
  submit.disabled=true;submit.textContent='Saving securely…';$('apiKeyError').textContent='';
  try{
    const result=await window.MosaicAccount.request('/api/ai/connection',{method:'POST',body:{apiKey:key}});
    if(attempt!==validation||window.MosaicAccount.current()?.id!==actor.id)return;
    connected=Boolean(result.connected);owner=actor.id;checked=true;
    await legacyVault.forget(actor.id).catch(()=>{});
    form.reset();if(dialog.open)dialog.close();updateButton();
    window.dispatchEvent(new CustomEvent('mosaic:keyconnected'));
  }catch(error){if(attempt===validation)$('apiKeyError').textContent=error.message}
  finally{submit.disabled=false;submit.textContent='Connect securely'}
});
$('apiKeyCancelBtn').addEventListener('click',()=>dialog.close());
$('apiKeyRemoveBtn').addEventListener('click',async()=>{
  const actor=window.MosaicAccount.current();if(!actor)return;
  const remove=$('apiKeyRemoveBtn');remove.disabled=true;$('apiKeyError').textContent='';
  try{
    await window.MosaicAccount.request('/api/ai/connection',{method:'DELETE'});
    await legacyVault.forget(actor.id).catch(()=>{});
    connected=false;owner=actor.id;checked=true;updateButton();
    remove.classList.add('hidden');$('apiKeyInput').focus();
  }catch(error){$('apiKeyError').textContent=error.message}
  finally{remove.disabled=false}
});
button.addEventListener('click',async()=>{if(await window.MosaicAccount.ensure())openKeyDialog()});
window.addEventListener('mosaic:managekey',async()=>{if(await window.MosaicAccount.ensure())openKeyDialog()});
window.addEventListener('mosaic:account',event=>{if(event.detail.user)void promptForKeyAtEntry();else clear()});
window.MosaicAuth={clear,restore,ensure,request,status:()=>restore(),isReady:()=>connected};
updateButton();
void window.MosaicAccount.ready().then(()=>promptForKeyAtEntry());
