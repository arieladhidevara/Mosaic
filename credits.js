const $=id=>document.getElementById(id),policy=window.MozDemoCredits;
const button=document.createElement('button');button.id='demoCreditsBtn';button.type='button';button.className='btn btn-quiet compact demo-credits-button';button.textContent='Pro preview';
document.querySelector('.topbar-actions').insertBefore(button,$('apiKeyStatusBtn'));
let balance=null,sequence=0;
function paint(){
  const signed=Boolean(window.MosaicAccount.current());
  button.textContent=signed?(balance?'Pro · '+balance.remaining+' demo credits':'Pro · demo credits'):'Pro preview';
  button.title='mozAI Pro demo credits. Separate from OpenAI billing.';
  $('demoRemaining').textContent=balance?String(balance.remaining):'—';
}
async function refresh(){
  const own=++sequence,actor=window.MosaicAccount.current();if(!actor){balance=null;paint();return}
  try{
    const result=await window.MosaicAccount.request('/api/credits');
    if(sequence!==own||window.MosaicAccount.current()?.id!==actor.id)return;
    balance=result;$('creditsError').textContent=result.remaining===0?'Your demo balance is used up. You can keep generating with your own OpenAI key.':'';
  }catch(error){if(sequence!==own)return;balance=null;$('creditsError').textContent=error.message}
  paint();
}
async function open(){
  if(!await window.MosaicAccount.ensure())return;
  if(!$('creditsDialog').open)$('creditsDialog').showModal();void refresh();
}
const operations={master:['#welcomeBaseGenerateSubmit','#generateMasterBtn','#masterGenerateSubmit'],edit:['#quickAreaPromptForm button[type="submit"]','#areaPromptForm button[type="submit"]','.region-option-prompt button[type="submit"]','[data-region-action="regen-option"]'],harmonize:['#harmonizeBtn','#harmonizeSidebarBtn','#harmonizeForm button[type="submit"]','[data-master-action="regen"]']};
function labels(){
  for(const [operation,selectors] of Object.entries(operations)){
    const quality=operation==='master'?'high':$(operation==='edit'?'regionRenderQuality':'harmonizeQuality')?.value||'high';
    const amount=policy.costs[quality],label=amount+' demo credit'+(amount===1?'':'s');
    document.querySelectorAll(selectors.join(',')).forEach(target=>{
      if(target.dataset.creditLabel!==label)target.dataset.creditLabel=label;
      target.dataset.creditOperation=operation;
    });
  }
}
button.onclick=()=>void open();$('creditsClose').onclick=()=>$('creditsDialog').close();$('creditsRefresh').onclick=()=>void refresh();
window.addEventListener('mosaic:account',()=>{balance=null;paint();void refresh()});
window.addEventListener('mosaic:generation',event=>{if(event.detail.recorded===false){balance=null;paint();$('creditsError').textContent='Your image is ready, but its usage could not be recorded. Demo balance may be incomplete.'}else void refresh()});
// Onboarding finishes on the canvas; the balance remains available in the toolbar.
window.addEventListener('mosaic:keyconnected',()=>{void refresh();window.MosaicCore?.toast('OpenAI connected. Pro demo credits are separate from OpenAI billing.')});
document.addEventListener('change',event=>{if(['regionRenderQuality','harmonizeQuality'].includes(event.target.id))labels()});
new MutationObserver(labels).observe($('app'),{childList:true,subtree:true});
window.MosaicCredits={refresh,open,labels};
paint();labels();void window.MosaicAccount.ready().then(()=>refresh());
