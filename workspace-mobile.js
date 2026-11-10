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



/* Mobile v2: three fixed zones; contextual editor controls live in bottom dock.
   Preserve all existing desktop node handlers by moving, not cloning, elements. */
const mobileToolPane=document.createElement('section');
mobileToolPane.id='mobileToolPane';mobileToolPane.className='mobile-tool-pane';
mobileToolPane.setAttribute('aria-label','Editing tools');
const mobileToolModes=document.createElement('div');mobileToolModes.className='mobile-tool-modes';
const mobileToolActions=document.createElement('div');mobileToolActions.className='mobile-tool-actions';
const mobileViewActions=document.createElement('div');mobileViewActions.className='mobile-view-actions';
mobileToolPane.append(mobileViewActions,mobileToolModes,mobileToolActions);
const mobileSettingsPane=document.createElement('section');
mobileSettingsPane.id='mobileSettingsPane';mobileSettingsPane.className='mobile-settings-pane';
mobileSettingsPane.setAttribute('aria-label','Project and edit settings');
const mobileStatus=document.createElement('div');mobileStatus.className='mobile-status';mobileStatus.id='mobileStatus';
sidebar.append(mobileToolPane,mobileSettingsPane,mobileStatus);
const toolRow=$('tools'),rightControls=toolRow?.querySelector('.toolbar-right');
const selectionModes=toolRow?.querySelector('.selection-modes');
const brushContext=toolRow?.querySelector('.brush-context');
const viewportCanvas=$('viewport'),areaForm=$('quickAreaPromptForm');
const sourcePanel=$('sourceEditorPanel'),sources=$('inspectorPanel')?.querySelector('.sources-panel');
const settings=$('advancedSettings'),settingsFooter=$('harmonizeSidebarBtn')?.closest('.inspector-bottom');
const geometryReview=$('geometryReviewBar'),processing=$('processing'),toastMessage=$('toast');
const beforeButton=$('beforeBtn'),fitButton=$('zoomValue');
function restorePoint(node){return node?{node,parent:node.parentElement,next:node.nextSibling}:null;}
const restoreNodes=[toolRow,rightControls,selectionModes,brushContext,areaForm,
  sourcePanel,sources,settings,settingsFooter,geometryReview,processing,toastMessage,
  beforeButton,fitButton].map(restorePoint).filter(Boolean);
function restoreDesktopNodes(){
  for(const item of restoreNodes){
    const {node,parent,next}=item;
    if(!parent||node.parentElement===parent)continue;
    if(next?.parentElement===parent)parent.insertBefore(node,next);
    else parent.append(node);
  }
}
tabs.unshift('tools');
nav.innerHTML=[
  '<button type="button" data-mobile-tab="tools" aria-selected="false">✎ <span>Tools</span></button>',
  '<button type="button" data-mobile-tab="groups" aria-selected="false">▤ <span>Groups</span></button>',
  '<button type="button" data-mobile-tab="ai" aria-selected="false">✧ <span>AI Edit</span></button>',
  '<button type="button" data-mobile-tab="settings" aria-selected="false">⚙ <span>Settings</span></button>',
  '<button type="button" id="mobileExpandPane" aria-label="Expand bottom panel" aria-pressed="false">⌃</button>'
].join('');
const expandButton=$('mobileExpandPane');
function toggleExpand(force){
  const expanded=typeof force==='boolean'?force:!document.documentElement.classList.contains('moz-sheet-expanded');
  document.documentElement.classList.toggle('moz-sheet-expanded',expanded);
  expandButton.textContent=expanded?'⌄':'⌃';
  expandButton.setAttribute('aria-pressed',String(expanded));
  expandButton.setAttribute('aria-label',expanded?'Collapse bottom panel':'Expand bottom panel');
  if(mobile.matches&&window.MosaicCore?.state.master)
    requestAnimationFrame(()=>window.MosaicCore.updateZoomFit());
}
expandButton.addEventListener('click',()=>toggleExpand());
const aiChoices=document.createElement('div');
aiChoices.className='mobile-ai-choices';
aiChoices.innerHTML='<button type="button" data-ai-view="area">Selected area</button><button type="button" data-ai-view="full">Full image</button>';
editPane.prepend(aiChoices);
let selectedAiView='full';
function aiView(next,openArea=false){
  selectedAiView=next==='area'?'area':'full';
  editPane.dataset.aiView=selectedAiView;
  for(const button of aiChoices.querySelectorAll('[data-ai-view]')){
    button.setAttribute('aria-pressed',String(button.dataset.aiView===selectedAiView));
  }
  if(openArea&&selectedAiView==='area'&&areaForm.classList.contains('hidden')){
    window.MosaicCore?.showQuickPrompt?.(undefined,true);
    if(areaForm.classList.contains('hidden')){
      selectedAiView='full';editPane.dataset.aiView='full';
      aiChoices.querySelector('[data-ai-view="full"]').setAttribute('aria-pressed','true');
      aiChoices.querySelector('[data-ai-view="area"]').setAttribute('aria-pressed','false');
      window.MosaicCore?.toast?.('Select an object or draw an area first.');
    }
  }
  if(selectedAiView==='full'&&!areaForm.classList.contains('hidden'))
    window.MosaicCore?.hideQuickPrompt?.();
}
aiChoices.addEventListener('click',event=>{
  const target=event.target.closest('[data-ai-view]');
  if(target)aiView(target.dataset.aiView,true);
});
function mountMobileNodes(){
  if(!mobile.matches){
    restoreDesktopNodes();
    document.documentElement.classList.remove('moz-sheet-expanded');
    return;
  }
  if(toolRow)mobileToolPane.prepend(toolRow);
  if(rightControls)mobileToolActions.append(rightControls);
  if(selectionModes)mobileToolModes.append(selectionModes);
  if(brushContext)mobileToolModes.append(brushContext);
  if(beforeButton)mobileViewActions.append(beforeButton);
  if(fitButton)mobileViewActions.append(fitButton);
  if(areaForm)editPane.insertBefore(areaForm,chat);
  if(geometryReview)editPane.append(geometryReview);
  if(sources)mobileSettingsPane.append(sources);
  if(sourcePanel)mobileSettingsPane.append(sourcePanel);
  if(settings)mobileSettingsPane.append(settings);
  if(settingsFooter)mobileSettingsPane.append(settingsFooter);
  if(processing)mobileStatus.append(processing);
  if(toastMessage)mobileStatus.append(toastMessage);
}
mobile.addEventListener('change',mountMobileNodes);
mountMobileNodes();
activate('tools');
aiView('full');
const areaWatch=new MutationObserver(()=>{
  if(!mobile.matches)return;
  if(!areaForm.classList.contains('hidden')){
    aiView('area');activate('ai');
  }else if(selectedAiView==='area')aiView('full');
});
areaWatch.observe(areaForm,{attributes:true,attributeFilter:['class']});
const geometryWatch=geometryReview?new MutationObserver(()=>{
  if(mobile.matches&&!geometryReview.hidden){activate('ai');toggleExpand(true);}
}):null;
geometryWatch?.observe(geometryReview,{attributes:true,attributeFilter:['hidden']});
if(sourcePanel){
  const sourceWatch=new MutationObserver(()=>{
    if(mobile.matches&&!sourcePanel.classList.contains('hidden')){
      activate('settings');toggleExpand(true);
    }
  });
  sourceWatch.observe(sourcePanel,{attributes:true,attributeFilter:['class']});
}
viewportCanvas.addEventListener('pointerup',()=>{
  if(!mobile.matches)return;
  requestAnimationFrame(()=>{
    if(!areaForm.classList.contains('hidden')){activate('ai');return;}
    const s=window.MosaicCore?.state;
    if(s?.tool==='pan')return;
    if(s?.draftGroupId||s?.focusedGroupId||s?.selectedPatchId)activate('groups');
  });
});
const dockedDialogIds=['areaPromptDialog','harmonizeDialog','masterGenerateDialog',
  'projectPromptDialog','helpDialog','sourcePreviewDialog'];
const dialogOriginals=[];
for(const id of dockedDialogIds){
  const dialog=$(id);if(!dialog)continue;
  const originalShow=dialog.showModal.bind(dialog),parent=dialog.parentElement,next=dialog.nextSibling;
  dialogOriginals.push({dialog,parent,next});
  dialog.showModal=function(){
    if(!mobile.matches)return originalShow();
    const target=id==='helpDialog'||id==='sourcePreviewDialog'?mobileSettingsPane:editPane;
    target.append(dialog);
    dialog.classList.add('mobile-docked-dialog');
    dialog.setAttribute('open','');
    activate(target===editPane?'ai':'settings');
    toggleExpand(true);
    requestAnimationFrame(()=>dialog.querySelector('input,textarea,button')?.focus({preventScroll:true}));
  };
}
mobile.addEventListener('change',()=>{
  for(const item of dialogOriginals){
    if(item.dialog.open)item.dialog.close();
    if(!mobile.matches){
      item.dialog.classList.remove('mobile-docked-dialog');
      if(item.next?.parentElement===item.parent)item.parent.insertBefore(item.dialog,item.next);
      else item.parent.append(item.dialog);
    }
  }
});
function updateVisibleHeight(){
  const vv=window.visualViewport;
  document.documentElement.style.setProperty('--moz-mobile-screen-height',
    Math.round(mobile.matches&&vv?vv.height:window.innerHeight)+'px');
  if(mobile.matches&&window.MosaicCore?.state.master)
    requestAnimationFrame(()=>window.MosaicCore.updateZoomFit());
}
window.visualViewport?.addEventListener('resize',updateVisibleHeight);
window.addEventListener('orientationchange',updateVisibleHeight);
mobile.addEventListener('change',updateVisibleHeight);
updateVisibleHeight();
window.MosaicMobile={activate,active:()=>current,isMobile:()=>mobile.matches,
  openTools:()=>activate('tools'),openGroups:()=>activate('groups'),
  openAI:()=>activate('ai'),expand:toggleExpand};
