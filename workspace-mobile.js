/* iPhone-first three-zone workspace.
   The bottom sheet has swipeable Groups, AI Edit and Settings views.
   Reactivity is managed with a single matchMedia listener; editor state is untouched. */
import './app.js';
const $=id=>document.getElementById(id);
const sidebar=$('inspectorPanel'),chat=$('compositionChat'),dock=chat?.parentElement;
if(!sidebar||!chat||!dock)throw Error('Mobile workspace requires Groups and AI Edit.');
const mobile=window.matchMedia('(max-width:850px)');
const tabs=['groups','ai','settings'];
const nav=document.createElement('nav');
nav.id='mobileBottomTabs';nav.className='mobile-bottom-tabs';
nav.setAttribute('aria-label','Mobile workspace views');
nav.innerHTML=[
  '<button type="button" data-mobile-tab="groups" aria-selected="true">▤ <span>Groups</span></button>',
  '<button type="button" data-mobile-tab="ai" aria-selected="false">✧ <span>AI Edit</span></button>',
  '<button type="button" data-mobile-tab="settings" aria-selected="false">⚙ <span>Settings</span></button>'
].join('');
const editPane=document.createElement('section');
editPane.id='mobileEditPane';editPane.setAttribute('aria-label','AI Edit composer');
sidebar.prepend(nav);
sidebar.append(editPane);
let current='groups';
function activate(next){
  if(!tabs.includes(next))return;
  current=next;sidebar.dataset.mobileTab=current;
  for(const button of nav.querySelectorAll('[data-mobile-tab]')){
    const selected=button.dataset.mobileTab===current;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
  }
  if(current==='groups'&&mobile.matches){
    const focused=$('groupList')?.querySelector('.region-group.selected');
    focused?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
}
nav.addEventListener('click',event=>{
  const button=event.target.closest('[data-mobile-tab]');
  if(button)activate(button.dataset.mobileTab);
});
nav.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();
  const index=tabs.indexOf(current),step=event.key==='ArrowRight'?1:-1;
  const next=tabs[(index+step+tabs.length)%tabs.length];
  activate(next);nav.querySelector('[data-mobile-tab="'+next+'"]').focus();
});
function updateLayout(){
  if(mobile.matches){
    if(chat.parentElement!==editPane)editPane.append(chat);
    activate(current);
  }else{
    if(chat.parentElement!==dock)dock.append(chat);
    sidebar.removeAttribute('data-mobile-tab');
  }
}
mobile.addEventListener('change',updateLayout);updateLayout();
let touch=null;
sidebar.addEventListener('touchstart',event=>{
  if(!mobile.matches||event.touches.length!==1||
    event.target.closest('input,textarea,select,.group-list,.region-group,.group-options,.object-category-items'))return;
  const t=event.touches[0];touch={x:t.clientX,y:t.clientY};
},{passive:true});
sidebar.addEventListener('touchend',event=>{
  if(!touch||!mobile.matches||!event.changedTouches.length)return;
  const t=event.changedTouches[0],dx=t.clientX-touch.x,dy=t.clientY-touch.y;touch=null;
  if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.3)return;
  const i=tabs.indexOf(current)+(dx<0?1:-1);
  if(i>=0&&i<tabs.length)activate(tabs[i]);
},{passive:true});
sidebar.addEventListener('touchcancel',()=>{touch=null},{passive:true});
const viewport=window.visualViewport;
function keyboard(){
  if(!mobile.matches){document.documentElement.classList.remove('moz-keyboard-open');return;}
  const open=Boolean(viewport&&window.innerHeight-viewport.height>180&&
    document.activeElement?.matches?.('input,textarea,[contenteditable=true]'));
  document.documentElement.classList.toggle('moz-keyboard-open',open);
}
viewport?.addEventListener('resize',keyboard);
window.addEventListener('orientationchange',()=>{
  requestAnimationFrame(()=>{updateLayout();keyboard();if(window.MosaicCore.state.master)window.MosaicCore.updateZoomFit();});
});
window.MosaicMobile={activate,active:()=>current,isMobile:()=>mobile.matches};
