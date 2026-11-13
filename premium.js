/* Mosaic BYOK — masked AI editing and harmonization with an OpenAI API key. */
import './generation-pool.js';
import './object-aware.js';
import {assertGeneratedImage,assertGeneratedRegion} from './generated-image.mjs';
import {alignGeneratedToLockedMask} from './geometry-mask.mjs';
const core = window.MosaicCore;
if (!core) throw new Error('Mosaic core must load before Premium');
const {state, canvas, makeCanvas, uid, render, renderGroups, resetSelection, assignGroup, maskBoundingBox, toast, message} = core;
const $ = id => document.getElementById(id);
const esc = core.escapeHTML;
const DEFAULT_SETTINGS={preserveOriginalGeometry:true,regionQuality:'medium',harmonizeQuality:'high'};
function generationSettings(value={}){
  const quality=(value,fallback)=>['low','medium','high'].includes(value)?value:fallback;
  return {preserveOriginalGeometry:true,
    regionQuality:quality(value?.regionQuality,'medium'),harmonizeQuality:quality(value?.harmonizeQuality,'high')};
}
const premium = {
  settings:{...DEFAULT_SETTINGS},
  projectPrompt: '', root: null, serial: 0, expanded: new Set(),
  previewNode: null, uploadPatch: null, lastRequest: null,
  originalMaster: null, initialMaster: null, masterVersions: [], regenerateFrom: null, branchFrom: null, regionSerial: 0, showGuides: false
};
const regionalPool=window.MozGenerationPool.createPool(3),lastAppliedGenerations=new WeakMap();
let regionalRequestSerial=0;
const cloneCanvas = input => {
  const output = makeCanvas(input.width, input.height);
  output.getContext('2d').drawImage(input, 0, 0);
  return output;
};
function copyGraph(groups, patches, sources) {
  return {
    groups: groups.map(g => ({...g, objectBehind:g.objectBehind?[...g.objectBehind]:undefined,objectOriginal:g.objectOriginal?{...g.objectOriginal,repairs:[...g.objectOriginal.repairs]}:undefined,patchIds: [...g.patchIds],footprint: g.footprint?cloneCanvas(g.footprint):null})),
    patches: new Map([...patches].map(([id,p]) => [id, {...p, objectRepairs:p.objectRepairs?[...p.objectRepairs]:undefined,mask: cloneCanvas(p.mask), corners: p.corners?.map(q=>({...q}))||null}])),
    // Archived branches may reference lossless images already stored on disk.
    // Keep their disk pointers rather than decoding all inactive options here.
    sources: new Map([...sources].map(([id,s]) => [id, {...s, canvas: s.canvas?cloneCanvas(s.canvas):null}]))
  };
}
function drawComposition(context, base, groups, patches, sources) {
  if(window.MosaicObjects){window.MosaicObjects.drawComposition(context,base,groups,patches,sources);return}
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(base, 0, 0, canvas.width, canvas.height);
  for (const group of groups) {
    if (!group.active) continue;
    const patch = patches.get(group.active);
    const source = patch && sources.get(patch.sourceId);
    if (!patch || !source) continue;
    core.drawPatch(context, patch, source);
  }
}
function currentComposite(){return core.composeApprovedCanvas()}
function findHistory(id, node = premium.root) {
  for (let n = node; n; n = n.parent) if (n.id === id) return n;
  return null;
}
function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}
function updateIntent() {
  $('projectPromptSummary').textContent = premium.projectPrompt || 'No project prompt yet. Edit to set design intent.';
  core.promptText();
}
let aiProgressSerial=0;
function masterProgressHost(){
  let host=$('masterProgressList');
  if(host)return host;
  host=document.createElement('div');host.id='masterProgressList';host.className='master-progress-list';
  host.setAttribute('aria-live','polite');host.setAttribute('aria-label','Master generation progress');
  $('masterVersionsPanel').before(host);return host;
}
function canvasProgressHost(){
  let host=$('canvasGenerationProgress');
  if(!host){host=document.createElement('div');host.id='canvasGenerationProgress';host.className='canvas-generation-progress';host.setAttribute('aria-live','polite');$('viewport').append(host)}
  return host;
}
function positionCanvasProgress(){
  const host=$('canvasGenerationProgress');if(!host?.children.length)return;
  const viewport=$('viewport').getBoundingClientRect();
  host.style.left=viewport.left+viewport.width/2+'px';host.style.top=viewport.top+viewport.height/2+'px';host.style.width=Math.max(160,Math.min(330,viewport.width-32))+'px';
}
function revealMaster(previous){
  $('canvasWrap').querySelector('.master-image-transition')?.remove();
  const layer=cloneCanvas(previous);layer.className='master-image-transition';layer.setAttribute('aria-hidden','true');
  $('canvasWrap').append(layer);
  layer.addEventListener('animationend',()=>layer.remove(),{once:true});
  setTimeout(()=>layer.remove(),1200);
}
function beginAIProgress(label,detail='Preparing request…',target={scope:'master'}){
  const id=String(++aiProgressSerial),patch=target.patchId?state.patches.get(target.patchId):null;
  const owner='generation:'+id;
  let item,percent,track,fill,description;
  if(!patch){
    item=document.createElement('section');const title=document.createElement('strong');percent=document.createElement('span');
    const heading=document.createElement('div');track=document.createElement('div');fill=document.createElement('div');description=document.createElement('small');
    item.className='ai-progress-item master-progress-item';item.dataset.progressId=id;
    heading.className='ai-progress-heading';title.textContent=label;percent.className='ai-progress-percent';
    track.className='ai-progress-track';track.setAttribute('role','progressbar');track.setAttribute('aria-label',label);
    track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
    fill.className='ai-progress-fill';description.className='ai-progress-detail';
    heading.append(title,percent);track.append(fill);item.append(heading,track,description);
    (target.scope==='canvas'?canvasProgressHost():masterProgressHost()).append(item);
    if(target.scope==='canvas')positionCanvasProgress();
  }
  let value=6,settled=false,currentDetail=detail;
  const set=(next,nextDetail,status='')=>{
    value=Math.max(value,Math.min(100,Math.round(next)));if(nextDetail)currentDetail=nextDetail;
    if(patch){
      patch.aiProgress={id,label,detail:currentDetail,value,status};
      if(status)window.MosaicMaskProgress?.hide(owner);
      else window.MosaicMaskProgress?.show(owner,label,currentDetail);
      renderGroups();return;
    }
    item.classList.toggle('success',status==='success');item.classList.toggle('error',status==='error');
    fill.style.width=value+'%';percent.textContent=value+'%';description.textContent=currentDetail;track.setAttribute('aria-valuenow',String(value));
  };
  set(value,detail);
  const timer=setInterval(()=>{if(value<88)set(value+Math.max(1,Math.round((90-value)*.07)))},1100);
  const finish=(kind,nextDetail)=>{
    if(settled)return;settled=true;clearInterval(timer);set(100,nextDetail,kind);
    setTimeout(()=>{
      if(patch){if(patch.aiProgress?.id===id){delete patch.aiProgress;renderGroups()}}
      else item.remove();
    },target.scope==='canvas'&&kind==='success'?500:2600);
  };
  return {highlight:mask=>window.MosaicMaskProgress?.highlight(owner,{mask}),update:(next,nextDetail)=>{if(!settled)set(next,nextDetail)},done:nextDetail=>finish('success',nextDetail||'Done.'),fail:nextDetail=>finish('error',nextDetail||'Failed.')};
}
const welcomeGenerateButton=$('welcomeBaseGenerateSubmit');
welcomeGenerateButton.classList.remove('sr-only');welcomeGenerateButton.classList.add('welcome-prompt-generate-button');
welcomeGenerateButton.removeAttribute('tabindex');welcomeGenerateButton.removeAttribute('aria-hidden');welcomeGenerateButton.textContent='✦ Generate';
// Keep the submit action below the prompt; references stay beside its text field.
$('welcomeBasePromptForm').append(welcomeGenerateButton);
function onReferenceLoaded() {
  // A Base upload is only a reference. Never silently promote it to Master.
  if(state.reference&&state.master){
    premium.originalMaster=cloneCanvas(state.reference);
  }else{
    premium.projectPrompt='';
    premium.originalMaster=null;
    updateIntent();
    message('Base uploaded. Enter a prompt beneath Base to generate Master, or upload Master on the right.');
  }
}
function refreshMasterBrowser(){window.MosaicSources?.refresh?.()}
function addMasterVersion(image,kind='Harmonized',prompt='',from=null){
  const number=(premium.masterVersions.at(-1)?.number||0)+1;
  premium.masterVersions.push({number,image:cloneCanvas(image),kind,prompt,from});
  refreshMasterBrowser();
  return number;
}
function onMasterLoaded(image,name='Master'){
  premium.initialMaster=cloneCanvas(image);
  if(state.reference)premium.originalMaster=cloneCanvas(state.reference);
  addMasterVersion(image,name.includes('AI')?'AI generated':name.includes('Base')?'Base placeholder':'Uploaded');
}
function onBaseContinue(working){
  // Continue is a deliberate manual draft, not a Master upload or generation.
  premium.masterVersions=[];
  premium.initialMaster=cloneCanvas(working);
  premium.originalMaster=state.reference?cloneCanvas(state.reference):cloneCanvas(working);
  refreshMasterBrowser();
}
function onSourceEdited(kind,raster){
  if(kind==='base'){premium.originalMaster=cloneCanvas(raster);window.MosaicObjectMap?.invalidateBase()}
  if(kind==='master'){
    // Editing Master 3 must not overwrite the immutable Original Master / Master 1 snapshot.
    if(premium.masterVersions.length<=1)premium.initialMaster=cloneCanvas(raster);
    const latest=premium.masterVersions.at(-1);
    if(latest){
      latest.image=cloneCanvas(raster);
      // The active Master may also appear as shared per-region Master N options.
      // Update only the matching latest version, not older Masters/material alternatives.
      const updated=new Set();
      for(const patch of state.patches.values()){
        if(!patch.isMasterVersion||patch.masterVersion!==latest.number||updated.has(patch.sourceId))continue;
        const source=state.sources.get(patch.sourceId);
        if(source){source.canvas=cloneCanvas(raster);source.crop=null;updated.add(patch.sourceId)}
      }
    }
    refreshMasterBrowser();
  }
  core.promptText();
}
function onSourcesAligned(base,master){
  premium.initialMaster=cloneCanvas(master);
  premium.originalMaster=cloneCanvas(base);
  if(premium.masterVersions.length===1)premium.masterVersions[0].image=cloneCanvas(master);
  refreshMasterBrowser();
  core.promptText();
}

function onMasterReset() {
  $('canvasGenerationProgress')?.replaceChildren();
  $('canvasWrap').querySelector('.master-image-transition')?.remove();
  premium.root = null;
  premium.serial = 0;
  premium.masterVersions=[];
  premium.regenerateFrom=null;
  refreshMasterBrowser();
  premium.expanded.clear();
  premium.previewNode = null;
  premium.uploadPatch = null;
  premium.lastRequest = null;
  premium.originalMaster = null;
  premium.initialMaster = null;
  premium.branchFrom = null;
  premium.regionSerial = 0;
}
function canSelectArea() {
  return core.canCreateSelection();
}
function isPreviewing() { return Boolean(premium.previewNode); }
function drawArchivePreview(context) {
  if (!premium.previewNode) return false;
  const node = findHistory(premium.previewNode);
  if (!node) {premium.previewNode = null; return false;}
  drawComposition(context, node.base, node.groups, node.patches, node.sources);
  return true;
}
function activePatchMarkup(){
  // Keep the four option controls stable even when a generation is pending.
  for(const patch of state.patches.values()){
    if(!patch.awaitingResult&&!patch.generating&&!patch.aiProgress)continue;
    const row=$('groupList').querySelector('.variant-row[data-action="choose"][data-patch="'+patch.id+'"]');
    if(!row)continue;row.classList.add('awaiting-ai');
    const progress=patch.aiProgress;if(!progress)continue;
    row.classList.add('has-ai-progress');
    const box=document.createElement('div');box.className='option-ai-progress '+(progress.status||'');
    const meta=document.createElement('div');meta.className='option-ai-progress-meta';
    const label=document.createElement('span');label.textContent=progress.detail;
    const percent=document.createElement('span');percent.textContent=progress.value+'%';meta.append(label,percent);
    const bar=document.createElement('div');bar.className='ai-progress-track';bar.setAttribute('role','progressbar');
    bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(progress.value));
    const progressFill=document.createElement('div');progressFill.className='ai-progress-fill';progressFill.style.width=progress.value+'%';
    bar.append(progressFill);box.append(meta,bar);row.append(box);
  }
}
function groupMarkup(group, node) {
  let html = '<div class="archived-region"><div class="archived-region-name">▧ ' + esc(group.name) +
    ' <span>' + group.patchIds.length + ' options</span></div>';
  const option = (pid, label) => '<button type="button" class="archived-option ' +
    (group.active === pid ? 'selected' : '') + '" data-history-action="option" data-node="' +
    node.id + '" data-history-group="' + group.id + '" data-history-patch="' + (pid || 'master') +
    '"><span class="variant-dot"></span><span>' + esc(label) + '</span></button>';
  html += option(null, 'Original / off');
  for (const pid of group.patchIds) {
    const p = node.patches.get(pid);
    if (p) html += option(pid, p.name + (p.awaitingResult ? ' · awaiting image' : ''));
  }
  return html + '</div>';
}
function nodeMarkup(node, depth = 0) {
  const open = premium.expanded.has(node.id);
  const preview = premium.previewNode === node.id;
  const safeTitle = 'Harmonized ' + node.number;
  let html = '<section class="archive-node ' + (preview ? 'archive-previewing' : '') +
    '" style="--history-depth:' + Math.min(depth, 6) + '"><button class="archive-head" type="button" data-history-action="toggle" data-node="' +
    node.id + '"><span>' + (open ? '▾' : '▸') + '</span><span class="archive-icon">▣</span><span class="archive-title">' +
    safeTitle + '<small>Archived · ' + (node.aiGenerated?'AI output':'Local snapshot') + ' · ' + node.groups.length +
    ' groups</small></span><span class="archive-lock">◎</span></button>';
  if (open) {
    html += '<div class="archive-body"><div class="archive-actions">' +
      '<button type="button" class="small-action ' + (preview ? 'active-action' : '') +
      '" data-history-action="preview" data-node="' + node.id + '">' +
      (preview ? 'Close preview' : 'Preview collage') + '</button>' +
      '<button type="button" class="small-action" data-history-action="restore" data-node="' + node.id +
      '">Branch from edits</button><button type="button" class="small-action" data-history-action="result" data-node="' +
      node.id + '">Use flattened</button></div>';
    html += '<p class="archive-note">Snapshot keeps masks, options and prompts. Select an old option to preview it, then branch to edit.</p>';
    html += node.groups.map(g => groupMarkup(g, node)).join('');
    if (node.parent) html += nodeMarkup(node.parent, depth + 1);
    html += '</div>';
  }
  return html + '</section>';
}
function renderHistory(list) { activePatchMarkup(); /* Versions now live inside their Regions. */ }
async function workFromNode(node, useFlattened) {
  if (state.pendingSourceId || state.editingPatchId) {toast('Finish or discard your current mask first.');return;}
  if (state.groups.length && !window.confirm('Switch working version? Your current unharmonized patches will be replaced. Harmonized snapshots remain in history.')) return;
  const masterAtStart=state.master,projectAtStart=state.selectionGeneration;
  try {
    await window.MosaicDiskCache?.hydrateArchive?.(node,{all:!useFlattened,flattened:useFlattened});
  }catch(error){
    toast('Archived images unavailable: '+error.message);
    return;
  }
  if(masterAtStart!==state.master || projectAtStart!==state.selectionGeneration)return;
  premium.previewNode = null;
  state.pendingSourceId = null;
  state.queue = [];
  state.selectedPatchId = null;
  state.editingPatchId = null;
  state.undo = [];
  state.redo = [];
  if (useFlattened) {
    state.master = cloneCanvas(node.output);
    state.groups = [];
    state.patches = new Map();
    state.sources = new Map();
  } else {
    const graph = copyGraph(node.groups, node.patches, node.sources);
    state.master = cloneCanvas(node.base);
    state.groups = graph.groups;
    state.patches = graph.patches;
    state.sources = graph.sources;
  }
  premium.branchFrom = node.id;
  state.before = false;
  resetSelection();
  core.setProjectTitle('Branch · Harmonized ' + node.number);
  $('masterTitle').textContent = useFlattened ? 'Harmonized ' + node.number : 'Restored edit composition';
  renderGroups();
  render();
  message(useFlattened ? 'Editing a previous harmonized result. Existing history is preserved.' :
    'Restored the archived editable collage. Change alternatives and harmonize again.');
  toast('Branch created. Earlier harmonizations are still available.');
  window.MosaicDiskCache?.schedule?.();
}
let archiveLoadToken=0;
function handleGroupEvent(event) {
  const ai = event.target.closest('[data-ai-action]');
  if (ai) {
    if(ai.dataset.aiAction === 'generate')void generateRegion(ai.dataset.patch);
    if (ai.dataset.aiAction === 'upload') {
      premium.uploadPatch = ai.dataset.patch;
      $('aiResultInput').click();
    }
    return true;
  }
  const control = event.target.closest('[data-history-action]');
  if (!control) return false;
  const node = findHistory(control.dataset.node);
  if (!node) return true;
  if (state.pendingSourceId) {toast('Finish the imported variation first.');return true;}
  const action = control.dataset.historyAction;
  if(action==='toggle'){
    premium.expanded.has(node.id) ? premium.expanded.delete(node.id) : premium.expanded.add(node.id);
  }else if(action==='preview'||action==='option'){
    const ticket=++archiveLoadToken;
    const group=action==='option'?node.groups.find(g=>g.id===control.dataset.historyGroup):null;
    const id=action==='option'?control.dataset.historyPatch:null;
    if(action==='preview'&&premium.previewNode===node.id){
      premium.previewNode=null;renderGroups();render();
      window.MosaicDiskCache?.schedule?.();return true;
    }
    void (async()=>{
      try{
        if(group)group.active=id==='master'?null:id;
        await window.MosaicDiskCache?.hydrateArchive?.(node);
        if(ticket!==archiveLoadToken)return;
        premium.previewNode=node.id;
        renderGroups();render();
      }catch(error){toast('Cannot open archived image: '+error.message);}
    })();
    return true;
  }else if(action==='restore'||action==='result'){
    ++archiveLoadToken;
    void workFromNode(node,action==='result');
    return true;
  }
  renderGroups();
  render();
  return true;
}

const REGION_COLORS=['#f59e60','#4eb8eb','#cb86e8','#7dd1ab','#e4bc4f','#ff7d9f','#8d9bf4','#b1d278'];
function activeAIRegions(){return state.groups.map(g=>state.patches.get(g.active)).filter(p=>p?.color)}
function drawRegionGuides(){
  const layer=core.vectorLayer('regionGuideVectors');if(!premium.showGuides)return;
  for(const patch of activeAIRegions()){
    const paths=core.patchSelectionPaths(patch);core.drawVectorPaths(layer,paths,{color:patch.color});
    const box=core.exactMaskBoundingBox(core.displayedPatchMask(patch));if(!box)continue;
    const x=Math.min(canvas.width-20/state.zoom,Math.max(15/state.zoom,box.x+12/state.zoom)),y=Math.max(17/state.zoom,box.y-7/state.zoom);
    layer.append(core.svgNode('circle',{cx:x,cy:y,r:11/state.zoom,fill:patch.color}));
    const label=core.svgNode('text',{x,y:y+4/state.zoom,fill:'#11151c','font-size':12/state.zoom,'font-family':'sans-serif','font-weight':'bold','text-anchor':'middle'});
    label.textContent=patch.regionNumber;layer.append(label);
  }
}
function resizedFrame(source,w,h){
  const out=makeCanvas(w,h),o=out.getContext('2d');
  o.fillStyle='#fff';o.fillRect(0,0,w,h);
  o.drawImage(source,0,0,w,h);
  return out.toDataURL('image/jpeg',.94);
}
function transparentEditMask(source,w,h){
  const out=makeCanvas(w,h),m=out.getContext('2d');
  m.fillStyle='#fff';m.fillRect(0,0,w,h);
  m.globalCompositeOperation='destination-out';m.drawImage(source,0,0,w,h);
  return out.toDataURL('image/png');
}
function annotationNotes(targetId){
  const regions=activeAIRegions();
  const target=state.patches.get(targetId);
  if(target?.color&&!regions.includes(target))regions.push(target);
  return regions.map(p=>({color:p.color,prompt:p.prompt,active:p.id===targetId}));
}
function encodeRequest(prompt,patch=null,masterSource=null,extraReferences=[],markupSource=null){
  const collage=masterSource||currentComposite();
  for(const maxSize of [1350,1120,900]){
    const scale=Math.min(1,maxSize/Math.max(canvas.width,canvas.height));
    const w=Math.max(128,Math.round(canvas.width*scale)),h=Math.max(128,Math.round(canvas.height*scale));
    const payload={collage:resizedFrame(collage,w,h),quality:patch?premium.settings.regionQuality:premium.settings.harmonizeQuality,
      projectPrompt:premium.projectPrompt,prompt,regions:annotationNotes(patch?.id),references:patch?.referenceImages||extraReferences};
    payload.base=resizedFrame(state.reference||premium.initialMaster||state.master,w,h);
    if(markupSource)payload.markup=resizedFrame(markupSource,w,h);
    if(patch){
      payload.mask=transparentEditMask(patch.mask,w,h);
    }
    if(JSON.stringify(payload).length<3550000)return payload;
  }
  throw Error('Image is too large for the server. Try a smaller Base image.');
}
function regionalCropWindow(mask){
  const bounds=core.exactMaskBoundingBox(mask);
  if(!bounds)throw Error('Select a visible part of the image before generating.');
  const context=Math.max(48,Math.ceil(Math.max(bounds.w,bounds.h)*.15));
  const x=Math.max(0,Math.floor(bounds.x-context));
  const y=Math.max(0,Math.floor(bounds.y-context));
  const right=Math.min(canvas.width,Math.ceil(bounds.x+bounds.w+context));
  const bottom=Math.min(canvas.height,Math.ceil(bounds.y+bounds.h+context));
  return {x,y,w:Math.max(1,right-x),h:Math.max(1,bottom-y)};
}
function cropFrame(source,window,w,h,mask=false){
  const frame=makeCanvas(w,h),context=frame.getContext('2d');
  if(mask){
    context.fillStyle='#fff';context.fillRect(0,0,w,h);
    context.globalCompositeOperation='destination-out';
  }else{
    context.fillStyle='#fff';context.fillRect(0,0,w,h);
  }
  // Base may be imported at 4K while Master is 2.4K: translate crop
  // coordinates through the full canvas to keep camera geometry aligned.
  const sx=window.x/canvas.width*source.width;
  const sy=window.y/canvas.height*source.height;
  const sw=window.w/canvas.width*source.width;
  const sh=window.h/canvas.height*source.height;
  context.drawImage(source,sx,sy,sw,sh,0,0,w,h);
  return frame.toDataURL(mask?'image/png':'image/jpeg',mask?undefined:.94);
}
function encodeRegionalCrop(patch){
  const visualMask=cloneCanvas(core.displayedPatchMask(patch));
  const editMask=window.MosaicObjects?.generationMask(patch)||visualMask;
  const region=regionalCropWindow(editMask);
  const collage=currentComposite(),base=state.reference||premium.initialMaster||state.master;
  const group=state.groups.find(group=>group.patchIds.includes(patch.id));
  for(const maxDimension of [1152,960,768]){
    const contextScale=Math.min(1,maxDimension/Math.max(canvas.width,canvas.height));
    const scale=Math.max(128/Math.min(region.w,region.h),Math.min(1,maxDimension/Math.max(region.w,region.h)));
    const w=Math.max(128,Math.round(region.w*scale));
    const h=Math.max(128,Math.round(region.h*scale));
    const payload={
      collage:cropFrame(collage,region,w,h),
      mask:cropFrame(editMask,region,w,h,true),
      quality:premium.settings.regionQuality,
      projectPrompt:premium.projectPrompt,
      prompt:patch.prompt,
      targetObject:patch.objectMapParts?.map(part=>part.label).join(', ').slice(0,120)||patch.objectLabel||group?.objectName||group?.objectLabel||(group?.manualName?group.name:(group?.category&&group.category!=='Region'?group.category:'')),
      crop:{x:region.x,y:region.y,width:region.w,height:region.h,imageWidth:canvas.width,imageHeight:canvas.height},
      context:resizedFrame(collage,Math.max(128,Math.round(canvas.width*contextScale)),Math.max(128,Math.round(canvas.height*contextScale))),
      regions:annotationNotes(patch.id),
      references:patch.referenceImages||[]
    };
    {
      const baseScale=Math.min(1,maxDimension/Math.max(base.width,base.height));
      payload.base=resizedFrame(base,Math.max(128,Math.round(base.width*baseScale)),Math.max(128,Math.round(base.height*baseScale)));
    }
    if(JSON.stringify(payload).length<3550000)return {payload,region,visibleMask:visualMask,collage,
      contextImage:editContextPreview(collage,visualMask,region),
      selectedObjects:patch.objectMapParts?.map(part=>part.label).slice(0,64)||[payload.targetObject].filter(Boolean)};
  }
  throw Error('Selection crop is too large. Try fewer reference images or a smaller Base.');
}
function editContextPreview(image,mask,region){
  const scale=Math.min(1,640/Math.max(region.w,region.h)),w=Math.max(1,Math.round(region.w*scale)),h=Math.max(1,Math.round(region.h*scale));
  const preview=makeCanvas(w,h),x=preview.getContext('2d'),tint=makeCanvas(w,h),t=tint.getContext('2d');
  x.drawImage(image,region.x,region.y,region.w,region.h,0,0,w,h);
  t.fillStyle='rgba(170,70,255,.30)';t.fillRect(0,0,w,h);t.globalCompositeOperation='destination-in';
  t.drawImage(mask,region.x,region.y,region.w,region.h,0,0,w,h);x.drawImage(tint,0,0);
  return preview.toDataURL('image/jpeg',.8);
}
async function fromGeneratedJPEG(encoded,targetSize=null){
  if(typeof encoded!=='string'||!encoded.length||encoded.length>24000000)throw Error('Invalid generated image response. Your previous image was preserved.');
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const mime=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===82&&bytes[1]===73?'image/webp':'image/jpeg';
  const input=await core.loadFileToCanvas(new Blob([bytes],{type:mime}));
  assertGeneratedImage(input,makeCanvas);
  const ref=targetSize||state.master||state.reference||canvas;
  const maxDimension=2400,scale=Math.min(1,maxDimension/Math.max(ref.width,ref.height));
  const width=Math.max(1,Math.round(ref.width*scale)),height=Math.max(1,Math.round(ref.height*scale));
  const out=makeCanvas(width,height);
  out.getContext('2d').drawImage(input,0,0,width,height);
  return out;
}
/* Lightweight category classification; image understanding is separate from rendering. */
async function classifyArea(mask){
  if(!maskBoundingBox(mask))return 'Region';
  if(!window.MosaicAuth?.isReady())throw Error('Add an OpenAI API key to identify objects.');
  const bounds=maskBoundingBox(mask);
  const margin=Math.max(18,Math.min(bounds.w,bounds.h)*.22);
  const x=Math.max(0,Math.floor(bounds.x-margin)),y=Math.max(0,Math.floor(bounds.y-margin));
  const x2=Math.min(canvas.width,Math.ceil(bounds.x+bounds.w+margin)),y2=Math.min(canvas.height,Math.ceil(bounds.y+bounds.h+margin));
  const w=Math.max(1,x2-x),h=Math.max(1,y2-y),scale=Math.min(1,560/Math.max(w,h));
  const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
  const src=currentComposite();
  if(state.pendingSourceId){const pending=state.sources.get(state.pendingSourceId);if(pending)src.getContext('2d').drawImage(pending.canvas,0,0)}
  const crop=makeCanvas(width,height),c=crop.getContext('2d');
  c.drawImage(src,x,y,w,h,0,0,width,height);
  const tint=makeCanvas(width,height),t=tint.getContext('2d');
  t.fillStyle='rgba(255,50,130,0.55)';t.fillRect(0,0,width,height);
  t.globalCompositeOperation='destination-in';
  t.drawImage(mask,x,y,w,h,0,0,width,height);
  c.drawImage(tint,0,0);
  const answer=await window.MosaicAuth.request('/api/ai/classify',{image:crop.toDataURL('image/jpeg',.7)});
  return core.CATEGORIES.includes(answer.category)?answer.category:'Other';
}

async function generateRegion(patchId,regenerate=false){
  const patch=state.patches.get(patchId);
  if(!patch||patch.generating||(!regenerate&&!patch.awaitingResult))return;
  const groupAtStart=state.groups.find(group=>group.patchIds.includes(patchId));
  const activeAtStart=groupAtStart?.active??null;
  const choiceAtStart=core.groupChoiceVersion(groupAtStart),requestOrder=++regionalRequestSerial,projectAtStart=state.selectionGeneration;
  const progress=beginAIProgress(
    regenerate?'Regenerate · '+patch.name:'AI Edit · Region '+(patch.regionNumber||''),
    'Preparing selected area…',
    {patchId}
  );
  patch.generating=true;renderGroups();
  // Freeze exactly the collage, crop and mask that were submitted. Subsequent
  // drawing/editing must not change a queued request's target or alignment.
  let capture;
  try{capture=encodeRegionalCrop(patch)}
  catch(error){
    patch.generating=false;
    if(patch.objectMapParts?.length){state.groups=state.groups.filter(group=>group.id!==patch.groupId);state.patches.delete(patch.id);state.sources.delete(patch.sourceId)}
    renderGroups();progress.fail('Could not prepare the selected area.');toast('Local AI edit: '+error.message);return;
  }
  const submittedPatch={bbox:{...patch.bbox},corners:patch.corners?.map(point=>({...point}))||null};
  const maskAtStart=window.MosaicObjects?.maskKey(patch.mask);
  const overlapChoices=new Map(state.groups.map(g=>[g.id,core.groupChoiceVersion(g)]));
  const generationId=patch.sourceId;
  const canvasSize={width:canvas.width,height:canvas.height};
  progress.update(14,'Queued for generation…');
  const run=async()=>{
    try{
      if(state.patches.get(patchId)!==patch||state.selectionGeneration!==projectAtStart){patch.generating=false;progress.done('Project changed; queued edit skipped.');return}
      progress.update(20,'Checking OpenAI connection…');
      if(!await window.MosaicAuth.ensure())throw Error('OpenAI API key entry canceled.');
      const {payload,region,visibleMask}=capture;
      progress.highlight(visibleMask);
      progress.update(24,'Understanding the selected object…');
      try{
        const context=await window.MosaicAuth.request('/api/ai/edit-context',{
          image:capture.contextImage,prompt:payload.prompt,selectedObjects:capture.selectedObjects
        });
        if(context.confidence>=.8&&typeof context.targetObject==='string'&&context.targetObject.trim()){
          payload.targetObject=context.targetObject.trim().slice(0,120);
        }
      }catch{progress.update(28,'Using the original prompt and selection…')}
      if(state.patches.get(patchId)!==patch||state.selectionGeneration!==projectAtStart){patch.generating=false;progress.done('Project changed; edit skipped.');return}
      message('Generating only the selected area with nearby architectural context…');
      progress.update(30,'OpenAI is generating the selected area…');
      const answer=await window.MosaicAuth.request('/api/ai/edit',payload);
      progress.update(82,'Image received. Decoding result…');
      let image;
      try{image=await fromGeneratedJPEG(answer.image,{width:region.w,height:region.h})}
      catch(error){state.lastGenerationIssue={stage:'provider-output',generationId:answer.generationId||null,code:error.code||'IMAGE_DECODE_FAILED',stats:error.imageStats||null};console.warn('[mozAI:image-result]',state.lastGenerationIssue);throw error}
      const existing=state.patches.get(patchId);
      if(existing!==patch||state.selectionGeneration!==projectAtStart||!state.sources.has(generationId)||existing.sourceId!==generationId
        ||canvas.width!==canvasSize.width||canvas.height!==canvasSize.height){
        if(existing)existing.generating=false;renderGroups();
        progress.done('Finished, but the project changed; current work was kept.');return;
      }
      const rawPlaced=makeCanvas(canvasSize.width,canvasSize.height);
      rawPlaced.getContext('2d').drawImage(image,region.x,region.y,region.w,region.h);
      const resultMasks=existing.objectMapParts?.map(part=>part.mask)||[visibleMask];
      for(const mask of resultMasks)validateRegionalResult(rawPlaced,capture.collage,mask,payload.prompt,'provider-region',answer.generationId);
      progress.update(92,'Checking key edges for gentle perspective alignment…');
      const placed=makeCanvas(canvasSize.width,canvasSize.height),placedContext=placed.getContext('2d');
      placedContext.drawImage(capture.collage,0,0);
      placedContext.drawImage(image,region.x,region.y,region.w,region.h);
      // Only a small, single perspective correction from matching long image
      // lines is allowed. No silhouette fitting or per-row contour stretch.
      let aligned={image:placed,status:'locked-mask',aligned:false};
      // Compound selections are aligned separately within their original IDs.
      if(!existing.objectMapParts?.length){
        try{
          aligned=alignGeneratedToLockedMask({
            before:capture.collage,generated:placed,lockedMask:visibleMask,makeCanvas
          });
        }catch(error){console.warn('[mozAI:mask-registration]',error);}
      }
      if(state.patches.get(patchId)!==patch||state.selectionGeneration!==projectAtStart||existing.sourceId!==generationId){existing.generating=false;return}
      if(!existing.objectMapParts?.length)validateRegionalResult(aligned.image,capture.collage,visibleMask,payload.prompt,'mask-alignment',answer.generationId);
      const currentMaskUnchanged=maskAtStart===window.MosaicObjects?.maskKey(existing.mask);
      // Preserve the complete unmasked RGB source for Reveal/Add.
      // Restore source coordinates before the existing option warp; this does
      // NOT alter the saved selection or its immutable Object ID.
      const result=core.unwarpPatchSelection(aligned.image,submittedPatch);
      existing.maskAlignmentStatus=aligned.status;
      existing.maskAlignmentSegmentation=aligned.segmentation||null;
      existing.maskAlignmentIoU=Number.isFinite(aligned.iou)?aligned.iou:null;
      if(existing.objectMapParts?.length){
        // A combined Line/Rectangle/Oval selection is one temporary generation.
        // After the image arrives, split it across every touched original ID.
        // All final masks remain the original user-approved geometry.
        try{
          const separated=await window.MosaicSceneVersions?.splitCreatedOverlap?.(
            placed,existing.objectMapParts,{
              choiceVersions:overlapChoices,
              onStatus:status=>progress.update(94,status)
            });
          if(Array.isArray(separated)&&separated.length)existing.objectMapParts=separated;
        }catch(error){
          console.warn('[mozAI:compound-split]',error?.message||error);
          // Original masks still provide a safe deterministic fallback.
        }
        if(state.patches.get(patchId)!==patch||state.selectionGeneration!==projectAtStart||
          existing.sourceId!==generationId){existing.generating=false;return;}
        const count=commitObjectMapParts(existing,result,capture.collage,requestOrder);
        renderGroups();render();progress.done('Edit saved for '+count+' '+(count===1?'object.':'objects.'));
        message('Generated image clipped to each original object mask.');toast('Saved edits for '+count+' '+(count===1?'object.':'objects.'));return;
      }
      // Commit only after all validation. Full-frame alignment output is
      // temporary; persist just the returned region, including Reveal context.
      // A skewed Option is unwarped back into its original mask coordinates.
      // Crop in that coordinate system, not its transformed on-screen region.
      const originalBounds=submittedPatch.corners?.length?submittedPatch.bbox:region;
      const originalPadding=submittedPatch.corners?.length?
        Math.max(48,Math.ceil(Math.max(originalBounds.w,originalBounds.h)*.15)):0;
      const compact=core.compactOptionSource(result,originalBounds,originalPadding);
      if(regenerate){
        const id=uid('ai_source');
        state.sources.set(id,{id,name:'Regenerated '+existing.name,...compact,revealComplete:true});
        existing.sourceId=id;
      }else{
        const source=state.sources.get(existing.sourceId);
        Object.assign(source,compact);
        source.name='AI region '+patch.regionNumber;source.revealComplete=true;
      }
      window.MosaicObjects?.generated(existing,existing.mask,currentMaskUnchanged);
      // Previously every completed Option still referenced a full RGB
      // pre-edit collage through request.baseImage and request.reference.
      // Reveal uses this Option's saved contextual crop instead.
      if(existing.request){delete existing.request.baseImage;delete existing.request.reference;}
      core.invalidateDisplayedMask(existing);
      existing.awaitingResult=false;
      // New options enter the right sidebar only after a real image is ready.
      existing.hideUntilReady=false;
      if(!existing.manualName&&!existing.semanticNamed)existing.name=core.optionNameFromPrompt(existing.prompt,'AI edit '+(patch.regionNumber||''));
      existing.generating=false;
      const group=state.groups.find(g=>g.patchIds.includes(patchId));
      const previous=group&&lastAppliedGenerations.get(group);
      const activateResult=Boolean(group&&core.groupChoiceVersion(group)===choiceAtStart&&requestOrder>(previous?.order||0)&&
        (group.active===activeAtStart||group.active===previous?.patchId));
      if(group){
        if(activateResult){group.active=patchId;lastAppliedGenerations.set(group,{order:requestOrder,patchId})}
        core.refreshGroupFootprint(group);
        if(activateResult)core.attachGeneratedSelection(existing,group);
      }
      // Async output updates the layer underneath whichever tool, mask or editor
      // the user is working with. Never steal focus or select another option.
      renderGroups();render();
      const alignmentMessage=aligned.aligned
        ?' Key edges aligned with a gentle perspective adjustment; original mask kept.'
        :' Original mask kept; no perspective correction needed or confidently supported.';
      message((activateResult
        ?'Material edit applied to the existing Group and mask.'
        :'Material edit saved as an Option in the existing Group.')+alignmentMessage);
      toast(activateResult
        ?'Generated result is now visible inside the selected mask.'
        :'Generated result is ready in its Group options.');
      progress.done(activateResult?'AI edit applied to the mask.':'AI edit saved as an option.');
    }catch(error){
      patch.generating=false;
      // A failed first generation must not leave a phantom option in Groups.
      // Existing options being regenerated remain intact and retryable.
      if (patch.hideUntilReady && state.patches.get(patchId) === patch) {
        const group=state.groups.find(g=>g.patchIds.includes(patchId));
        if (group) {
          group.patchIds=group.patchIds.filter(id=>id!==patchId);
          if (group.active===patchId) group.active=null;
          core.refreshGroupFootprint(group);
          if (!group.patchIds.length && !group.mapPrepared && state.draftGroupId!==group.id)
            state.groups=state.groups.filter(g=>g!==group);
        }
        state.patches.delete(patchId);
        state.sources.delete(patch.sourceId);
      }
      renderGroups();
      progress.fail(error.message||'AI edit failed.');
      toast('Local AI edit: '+error.message);
      message('The current approved image was preserved. Retry from its option.');
    }
  };
  return regionalPool.run(run);
}
function validateRegionalResult(image,before,mask,prompt,stage,generationId=null){
  try{return assertGeneratedRegion({image,before,mask,prompt,makeCanvas,bounds:core.exactMaskBoundingBox(mask)})}
  catch(error){state.lastGenerationIssue={stage,generationId,code:error.code||'REGION_VALIDATION_FAILED',stats:error.imageStats||null};console.warn('[mozAI:image-result]',state.lastGenerationIssue);throw error}
}
function commitObjectMapParts(batch,result,underlay,requestOrder){
  const selectedBefore=state.selectedPatchId;
  // Validate every object before writing any option, including small objects
  // whose failed pixels would be hidden by the rest of a compound selection.
  const alignments=batch.objectMapParts.map(part=>{
    let aligned={image:result,aligned:false,status:'locked-mask'};
    try{aligned=alignGeneratedToLockedMask({before:underlay,generated:result,
      lockedMask:part.mask,makeCanvas})}
    catch(error){console.warn('[mozAI:compound-mask-registration]',error)}
    validateRegionalResult(aligned.image,underlay,part.mask,batch.prompt,'mask-alignment');
    return aligned;
  });
  // Keep one shared full-image source for all selected objects. Every Option
  // retains its independent mask, but we don't duplicate 2K/4K RGB per object.
  // Only an object needing a perspective correction receives its own source.
  const combined=cloneCanvas(underlay),union=makeCanvas(canvas.width,canvas.height);
  const unionContext=union.getContext('2d');
  for(const part of batch.objectMapParts)unionContext.drawImage(part.mask,0,0);
  const changed=cloneCanvas(result),changedContext=changed.getContext('2d');
  changedContext.globalCompositeOperation='destination-in';
  changedContext.drawImage(union,0,0);
  combined.getContext('2d').drawImage(changed,0,0);
  // One temporary composite drives validation; completed parts are saved
  // separately as small, independently positioned image crops.
  for(const [partIndex,part] of batch.objectMapParts.entries()){
    let group=state.groups.find(g=>g.objectMapKey===part.mapKey&&g.objectMapObjectKey===part.objectKey);
    const mask=cloneCanvas(part.mask);if(part.previousMask)mask.getContext('2d').drawImage(part.previousMask,0,0);
    if(!group)group=core.newGroup(mask,part.category);
    group.objectMapKey=part.mapKey;group.objectMapCategory=part.category;group.objectMapObjectKey=part.objectKey;group.objectMapInstanceId=part.instanceId;
    group.objectName=part.label.charAt(0).toUpperCase()+part.label.slice(1);
    if(!group.manualName)group.name=group.objectName;
    // Alignment changes RGB only. Every Option keeps its original mask.
    const aligned=alignments[partIndex];
    let sourceImage=combined;
    if(aligned.aligned&&aligned.image!==result){
      sourceImage=cloneCanvas(combined);
      const layer=cloneCanvas(aligned.image),lx=layer.getContext('2d');
      lx.globalCompositeOperation='destination-in';lx.drawImage(part.mask,0,0);
      sourceImage.getContext('2d').drawImage(layer,0,0);
    }
    const bounds=core.exactMaskBoundingBox(mask);
    const padding=Math.max(48,Math.ceil(Math.max(bounds.w,bounds.h)*.15));
    const sourceId=uid('object_part_source');
    state.sources.set(sourceId,{id:sourceId,name:group.objectName+' · crop',
      ...core.compactOptionSource(sourceImage,bounds,padding),revealComplete:true});
    const {objectMapParts,aiProgress,...template}=batch;
    const patch={...template,id:uid('object_patch'),sourceId,mask,bbox:core.exactMaskBoundingBox(mask),maskPaths:core.maskPathsFromRaster(mask),maskPoints:[],groupId:group.id,
      objectMapKey:part.mapKey,objectMapCategory:part.category,objectMapObjectKey:part.objectKey,objectMapInstanceId:part.instanceId,objectLabel:part.label,generating:false,awaitingResult:false,hideUntilReady:false,
      request:{prompt:batch.prompt,mask},maskAlignmentStatus:aligned.status,
      name:core.optionNameFromPrompt(batch.prompt,part.category+' edit')};
    patch.maskPoints=patch.maskPaths.flat();
    const activeBefore=group.active,choice=core.groupChoiceVersion(group),previous=lastAppliedGenerations.get(group);
    assignGroup(patch,group.id);core.updateGroupCategory(group,part.category,'object-map');
    if(choice===part.choiceAtStart&&requestOrder>(previous?.order||0)){group.active=patch.id;lastAppliedGenerations.set(group,{order:requestOrder,patchId:patch.id})}
    else group.active=activeBefore;
    core.refreshGroupFootprint(group);
  }
  // Never shrink, replace, or archive an older manual Create mask to
  // accommodate newly generated compound Options. Source options are history.
  // The temporary batch is the only Group removed after splitting.
  const temporary=state.groups.find(g=>g.id===batch.groupId);
  state.groups=state.groups.filter(g=>g!==temporary);state.patches.delete(batch.id);state.sources.delete(batch.sourceId);
  state.selectedPatchId=selectedBefore===batch.id?null:selectedBefore;
  return batch.objectMapParts.length;
}
async function regenerateOption(patchId){
  const patch=state.patches.get(patchId);
  if(!patch||patch.generating||state.pendingSourceId){
    toast('Finish the imported image or running request first.');return;
  }
  if(!await window.MosaicAuth.ensure())return;
  if(!patch.prompt){
    const instruction=window.prompt('Describe the change to regenerate '+patch.name+':',patch.name||'Photorealistic architectural edit');
    if(!instruction?.trim())return;
    patch.prompt=instruction.trim();
  }
  void generateRegion(patchId,true);
}

async function openAreaPrompt() {
  if (!canSelectArea()) {toast('Finish the current layer or restore an archived branch before prompting.');return;}
  if (state.lasso.length > 2) core.updateMaskWithLasso();
  const bbox = state.selectionMask && maskBoundingBox(state.selectionMask);
  if (!bbox) {toast('Draw a lasso selection first, then press Prompt area.');return;}
  if(!await window.MosaicAuth.ensure())return;
  $('areaPromptInput').value = '';clearReferenceFiles('area');
  showDialog('areaPromptDialog');
}
async function suggestSemanticName(patchId,prompt){
  if(!window.MosaicAuth?.isReady())return;
  try{
    const result=await window.MosaicAuth.request('/api/ai/option-name',{
      prompt,category:core.categoryFromText(prompt)||'Region'
    });
    const patch=state.patches.get(patchId);
    if(!patch||patch.manualName||!result.name)return;
    const label=String(result.name).trim().slice(0,50);
    if(label&&label.split(/\s+/).length<=5&&!/^(?:make it|change it|apply it)\b/i.test(label)){
      patch.name=label;patch.semanticNamed=true;renderGroups();
    }
  }catch(error){/* Local semantic naming remains active if the optional model is offline. */}
}
function createRegionRequest(prompt,referenceImages=[],selectedMask=state.selectionMask,groupId=null,selectedPoints=state.selectionPoints,selectedPaths=state.selectionPaths,objectSelection=null) {
  const bbox = maskBoundingBox(selectedMask);
  if (!bbox) {toast('Selection has no pixels.');return;}
  const mask = cloneCanvas(selectedMask);
  const base = currentComposite();
  const sourceId = uid('ai_source');
  const text = prompt.trim();
  const source = {id: sourceId, name: 'AI request', canvas: base};
  const regionNumber=++premium.regionSerial,color=REGION_COLORS[(regionNumber-1)%REGION_COLORS.length];
  const patch = {id: uid('ai_patch'), sourceId, mask, bbox, maskPaths:window.MozMaskGeometry.copyPaths(selectedPaths),maskPoints:selectedPoints?.map(point=>({...point}))||[],regionNumber, color,
    name: core.optionNameFromPrompt(text,'AI edit '+regionNumber), manualName:false, prompt: text, referenceImages, awaitingResult: true, hideUntilReady: true,
    groupId:groupId||null,
    projectPrompt: premium.projectPrompt,
    request: {baseImage: base, reference: state.reference, mask, prompt: text}};
  state.sources.set(sourceId, source);
  const selectedBefore=state.selectedPatchId;
  const activeBefore=new Map(state.groups.map(group=>[group.id,group.active]));
  let group;
  if(objectSelection?.parts?.length){
    patch.objectMapParts=objectSelection.parts.map(part=>{
      const existing=state.groups.find(g=>g.objectMapKey===part.mapKey&&g.objectMapObjectKey===part.objectKey);
      return {...part,choiceAtStart:core.groupChoiceVersion(existing),previousMask:existing?cloneCanvas(core.groupMask(existing)):null};
    });
    group=core.newGroup(mask);group.objectMapBatch=true;patch.groupId=group.id;state.patches.set(patch.id,patch);group.patchIds.push(patch.id);
  }else group=assignGroup(patch,groupId);
  // Keep the approved option visible while OpenAI works. generateRegion will
  // activate this new option when its pixels are ready, unless the user makes
  // another option choice in the meantime.
  group.active=activeBefore.has(group.id)?activeBefore.get(group.id):null;
  window.MosaicObjects?.capture(patch,group,objectSelection);
  void suggestSemanticName(patch.id,text);
  // The submitted mask is already an independent snapshot on patch.mask.
  // Keep the live selection and mask editor intact so another area can be
  // painted while this background AI request runs.
  state.selectedPatchId=selectedBefore;
  renderGroups();
  render();
  message('Region '+regionNumber+' queued in background. Keep editing your mask.');
  toast('AI region '+regionNumber+' queued.');
  return patch.id;
}
async function generateSelection(prompt,groupId=null,referenceFiles=[]){
  if(!await window.MosaicAuth.ensure())return;
  if(!canSelectArea()){toast('Finish the current imported layer before generating.');return}
  if(state.lasso.length>2)core.updateMaskWithLasso();
  const bbox=maskBoundingBox(state.selectionMask);
  if(!bbox){toast('Select a region before generating.');return}
  const initialMask=cloneCanvas(state.selectionMask),generation=state.selectionGeneration;
  const initialPoints=state.selectionPoints?.map(point=>({...point}))||[];
  const initialPaths=window.MozMaskGeometry.copyPaths(state.selectionPaths);
  const initialGroup=groupId||state.draftGroupId||null;
  try{
    const parts=!groupId?window.MosaicObjectMap?.partsForSelection(initialMask):null;
    // Resolve the ORIGINAL persistent Group for each selected Object ID.
    // A single existing object must never pass through a temporary batch
    // or derive a replacement mask from an approximate Object Map raster.
    const persistent=part=>{
      const group=state.groups.find(g=>!g.objectMapBatch&&!g.mergedInto&&!g.objectRemoved&&
        g.objectMapKey===part.mapKey&&g.objectMapObjectKey===part.objectKey);
      return group?{...window.MosaicObjectManager.partForObject(group),groupId:group.id}:part;
    };
    const originalParts=(parts||[]).map(persistent);
    const activeGroup=state.groups.find(g=>g.id===initialGroup&&!g.objectMapBatch&&!g.mergedInto&&
      (g.patchIds.length||g.mapPrepared));
    const targetFromPart=originalParts.length===1&&state.groups.find(g=>
      g.id===originalParts[0].groupId||g.objectMapKey===originalParts[0].mapKey&&
      g.objectMapObjectKey===originalParts[0].objectKey);
    const selectedGroup=activeGroup||targetFromPart||null;
    let savedMask=initialMask,objectSelection=null,requestedGroupId=initialGroup;
    if(originalParts.length>1){
      // One OpenAI generation for a compound selection. Reuse whole EXISTING
      // object masks as the temporary union; split into the same Group IDs.
      const combined=makeCanvas(canvas.width,canvas.height),ctx=combined.getContext('2d');
      for(const part of originalParts)ctx.drawImage(part.mask,0,0);
      savedMask=combined;
      objectSelection={mask:savedMask,paths:[],groupId:null,parts:originalParts};
      requestedGroupId=null;
    }else if(selectedGroup){
      // Ordinary Material Edit: original selection and original Group, no
      // Object Map resegmentation or extra Group/Option identity.
      savedMask=cloneCanvas(core.groupMask(selectedGroup));
      requestedGroupId=selectedGroup.id;
    }
    const referenceImages=await prepareReferenceImages(referenceFiles);
    if(generation!==state.selectionGeneration){toast('The project changed. Please select the region again.');return}
    const targetGroup=requestedGroupId&&state.groups.some(g=>g.id===requestedGroupId)?requestedGroupId:null;
    const savedPaths=selectedGroup&&!objectSelection?
      core.maskPathsFromRaster(savedMask):objectSelection?[]:initialPaths;
    const savedPoints=savedPaths.flat();
    const patchId=createRegionRequest(prompt,referenceImages,savedMask,targetGroup,savedPoints,savedPaths,objectSelection);
    if(patchId)void generateRegion(patchId);
  }catch(error){toast('Reference upload: '+error.message)}
}
async function attachAIResult(file) {
  const patch = state.patches.get(premium.uploadPatch);
  premium.uploadPatch = null;
  if (!file || !patch) return;
  try {
    const img = await core.loadFileToCanvas(file);
    const c = makeCanvas(canvas.width, canvas.height);
    c.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const source = state.sources.get(patch.sourceId);
    if (!source) throw new Error('Original request was not found');
    const bounds=core.exactMaskBoundingBox(patch.mask);
    const padding=bounds?Math.max(48,Math.ceil(Math.max(bounds.w,bounds.h)*.15)):0;
    Object.assign(source,core.compactOptionSource(c,bounds,padding));
    source.name = file.name;
    source.revealComplete=true;
    patch.awaitingResult = false;
    if(patch.request){delete patch.request.baseImage;delete patch.request.reference;}
    if(!patch.manualName&&!patch.semanticNamed)patch.name = core.optionNameFromPrompt(patch.prompt,file.name.replace(/\.[^.]+$/,''));
    const group = state.groups.find(g => g.patchIds.includes(patch.id));
    // Keep the user's currently selected Group option as-is. The generated
    // layer is updated in place; an import must never steal the active option.
    // Uploading a replacement result must not interrupt a live mask edit.
    renderGroups();
    render();
    toast('Generated result updated in the background. Current mask stays editable.');
  } catch (error) {toast('Could not attach result: ' + error.message);}
}
async function openHarmonize() {
  premium.regenerateFrom=null;
  if (!state.master) {toast('Upload Base or Master first.');return;}
  if (state.pendingSourceId || state.editingPatchId) {toast('Apply or discard the current mask first.');return;}
  if (premium.previewNode) {toast('Close the archive preview or branch from it before harmonizing.');return;}
  if (state.groups.some(g => g.active && state.patches.get(g.active)?.awaitingResult)) {
    toast('An active masked AI request is still waiting for its result image.');return;
  }
  if(!await window.MosaicAuth.ensure())return;
  clearReferenceFiles('harmonize');
  $('harmonizePromptInput').value = core.promptText();
  $('harmonizeDialog').querySelector('h2').textContent='Flatten & harmonize';
  showDialog('harmonizeDialog');
}
async function harmonizeWithAI(prompt,sourceVersion=null) {
  if(!await window.MosaicAuth.ensure())return;
  if(state.pendingSourceId||state.editingPatchId){toast('Apply or discard your unfinished patch before generating.');return}
  if(state.groups.some(g=>state.patches.get(g.active)?.awaitingResult)){toast('Finish pending region edits first.');return}
  const a=$('harmonizeBtn'),b=$('harmonizeSidebarBtn');a.disabled=true;b.disabled=true;
  const progress=beginAIProgress(
    sourceVersion?'Regenerate Master '+sourceVersion.number:'Harmonize Master',
    'Preparing the approved composition…'
  );
  const flattened = currentComposite();
  const baseAtRequest=state.master;
  const generationAtRequest=state.selectionGeneration;
  // Freeze the approved graph at submission time for accurate archive history.
  // Any painting after this point belongs to the active working session.
  const submittedGraph=copyGraph(state.groups,state.patches,state.sources);
  let finalImage;
  try{
    message(sourceVersion?'Regenerating from Master '+sourceVersion.number+'…':'Generating harmonized architecture image with OpenAI…');
    progress.update(16,'Preparing reference images…');
    const references=await prepareReferenceImages(getReferenceFiles('harmonize'));
    progress.update(30,'OpenAI is generating the full image…');
    const answer=await window.MosaicAuth.request('/api/ai/harmonize',encodeRequest(prompt,null,sourceVersion?.image,references));
    progress.update(82,'Image received. Decoding result…');
    finalImage=await fromGeneratedJPEG(answer.image);
    progress.update(92,'Applying the new Master…');
  }catch(error){progress.fail(error.message||'Harmonize failed.');toast('Harmonize failed: '+error.message);message('Your original collage is unchanged. Please retry.');return}
  finally{a.disabled=false;b.disabled=false}
  clearReferenceFiles('harmonize');
  if(state.selectionGeneration!==generationAtRequest||state.master!==baseAtRequest){
    // A different Master/project was loaded while the request was processing.
    // Never overwrite its layers, masks or history with a stale AI result.
    toast('Harmonize finished, but Master changed during generation. The current work was kept.');
    progress.done('Finished; current Master was kept.');
    return;
  }
  const editingInProgress=Boolean(state.pendingSourceId||state.editingPatchId
    ||state.drawing||state.lasso.length
    ||(state.selectionMask&&maskBoundingBox(state.selectionMask)));
  const graph = submittedGraph;
  const number = ++premium.serial;
  const masterVersion=addMasterVersion(finalImage,sourceVersion?'Regenerated':'Harmonized',prompt,sourceVersion?.number||null);
  const node = {
    id: uid('harmonized'), number, base: cloneCanvas(baseAtRequest),
    groups: graph.groups, patches: graph.patches, sources: graph.sources,
    output: cloneCanvas(finalImage), prompt, parent: premium.root,
    branchedFrom: premium.branchFrom, aiGenerated: true
  };
  premium.root = node;
  premium.expanded.add(node.id);
  if(!editingInProgress)premium.previewNode = null;
  premium.lastRequest = {
    originalBase: state.reference||premium.initialMaster||state.master, collage: cloneCanvas(sourceVersion?.image||flattened),
    prompt, snapshotId: node.id
  };
  // Every Harmonize result becomes its own named option on EACH persistent object.
  // SAM 3 resegments the full generated scene and spatially matches candidates
  // to the existing Object IDs. Unmatched objects retain their previous masks.
  let versionResult;
  try{
    versionResult=await window.MosaicSceneVersions.apply(finalImage,{
      type:'harmonize',prompt,preserveEditing:editingInProgress,
      onStatus:detail=>progress.update(94,detail)
    });
  }catch(error){progress.fail(error.message);toast('Harmonize versioning failed: '+error.message);return}
  // Preserve pending imports, selection canvas, in-progress lasso, mask editor,
  // undo/redo stack, tool and keyboard focus across the background Master update.
  premium.branchFrom = node.id;
  $('masterTitle').textContent = 'Master ' + masterVersion + ' · AI';
  $('masterInfo').textContent = canvas.width + ' × ' + canvas.height + ' · working image';core.setSourcePreview('masterPreview',finalImage);
  core.setProjectTitle('Harmonized ' + number + ' · AI render');
  renderGroups();
  render();
  message(editingInProgress
    ?'Master '+masterVersion+' updated in the background. Your mask editing remains active.'
    :'Master '+masterVersion+' is active. Earlier Masters remain available in the expandable source list.');
  refreshMasterBrowser();toast('Master '+masterVersion+' saved. Current mask and earlier region options are preserved.');
  progress.done('Master '+masterVersion+' is ready.');
}
function getMasterVersions(){return [...premium.masterVersions]}
function initialMasterImage(){return premium.masterVersions[0]?.image||premium.initialMaster}
async function regenerateMaster(number){
  const version=premium.masterVersions.find(item=>item.number===Number(number));
  if(!version){toast('This Master version is no longer available.');return}
  try{await window.MosaicDiskCache?.ensure?.(version,'image');}
  catch(error){toast('Cannot load Master version: '+error.message);return}
  if(state.pendingSourceId||state.editingPatchId){toast('Apply or discard the unfinished patch first.');return}
  if(state.groups.some(g=>g.active&&state.patches.get(g.active)?.awaitingResult)){toast('Complete the pending AI region first.');return}
  if(!await window.MosaicAuth.ensure())return;
  premium.regenerateFrom=version;
  clearReferenceFiles('harmonize');
  $('harmonizePromptInput').value=version.prompt||'Regenerate Master '+version.number+' into a refined architectural rendering. Preserve the camera, geometry, approved design, and material intent.';
  $('harmonizeDialog').querySelector('h2').textContent='Regenerate Master '+version.number+' → new Master';
  showDialog('harmonizeDialog');
}
function exportPrompt() {
  return premium.lastRequest?.prompt || null;
}
function originalImage() {
  return premium.originalMaster||premium.initialMaster;
}
/* Per-request visual references: optional, capped, compressed, and never persisted in browser storage. */
/* Every AI prompt accepts images from file picker, clipboard or drag/drop. */
const referenceState={master:[],area:[],quick:[],welcome:[],harmonize:[]};
const referenceInputIds={
  master:['masterReferenceInput','masterReferencePreviews'],
  area:['areaReferenceInput','areaReferencePreviews'],
  quick:['quickAreaReferenceInput','quickAreaReferencePreviews'],
  welcome:['welcomeBaseReferenceInput','welcomeBaseReferencePreviews'],
  harmonize:['harmonizeReferenceInput','harmonizeReferencePreviews']
};
function getReferenceFiles(scope){return [...(referenceState[scope]||[])]}
function validReference(file){
  return file&&/^image\/(jpeg|png|webp)$/.test(file.type)&&file.size<=10000000&&file.size>0;
}
function incomingImageFiles(event){
  const transfer=event.clipboardData||event.dataTransfer;
  if(!transfer)return [];
  const result=[];
  if(transfer.items?.length){
    for(const item of transfer.items){
      if(item.kind!=='file'||!item.type.startsWith('image/'))continue;
      const image=item.getAsFile?.();
      if(image)result.push(image);
    }
  }
  if(!result.length&&transfer.files?.length)
    result.push(...[...transfer.files].filter(file=>file.type.startsWith('image/')));
  return result;
}
function ingestReferences(files,bucket,render){
  let added=0;
  for(const file of files){
    if(bucket.length>=3){toast('Maximum 3 reference images per prompt.');break}
    if(!validReference(file)){toast('Reference must be JPG, PNG or WEBP under 10 MB.');continue}
    bucket.push(file);added++;
  }
  if(added)render();
  return added;
}
function renderThumbnails(container,files,onRemove){
  if(!container)return;
  for(const element of container.querySelectorAll('[data-preview-url]'))
    URL.revokeObjectURL(element.dataset.previewUrl);
  container.replaceChildren();
  files.forEach((file,index)=>{
    const item=document.createElement('span');item.className='reference-thumb';
    const image=document.createElement('img'),url=URL.createObjectURL(file);
    image.src=url;image.alt=file.name||'Reference image';item.dataset.previewUrl=url;
    const remove=document.createElement('button');
    remove.type='button';remove.textContent='×';remove.title='Remove reference';
    remove.setAttribute('aria-label','Remove reference '+(index+1));
    remove.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onRemove(index)});
    item.append(image,remove);container.append(item);
  });
}
function renderReferenceFiles(scope){
  const pair=referenceInputIds[scope];
  if(!pair)return;
  renderThumbnails($(pair[1]),referenceState[scope],index=>{
    referenceState[scope].splice(index,1);renderReferenceFiles(scope);
  });
}
function clearReferenceFiles(scope){
  if(!referenceInputIds[scope])return;
  referenceState[scope]=[];$(referenceInputIds[scope][0]).value='';
  renderReferenceFiles(scope);
}
function wireReferencePasteDrop(form,addFiles){
  if(!form)return;
  form.classList.add('reference-prompt-target');
  // The floating prompt lives inside #viewport. A bubbling pointerdown there
  // used to trigger canvas selection, which closed the form before a file
  // picker could open. Keep the entire prompt interactive in place.
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','dblclick'])
    form.addEventListener(name,event=>event.stopPropagation());
  form.addEventListener('paste',event=>{
    const images=incomingImageFiles(event);
    if(!images.length)return; // Ordinary text pasting remains unchanged.
    event.preventDefault();event.stopPropagation();
    addFiles(images);
  });
  form.addEventListener('dragover',event=>{
    const transfer=event.dataTransfer;
    const hasFile=Boolean(transfer?.types&&[...transfer.types].includes('Files'));
    if(!hasFile)return; // Do not interfere with text dragging.
    event.preventDefault();event.stopPropagation();
    transfer.dropEffect='copy';form.classList.add('reference-drag-over');
  });
  form.addEventListener('dragleave',event=>{
    if(event.relatedTarget&&form.contains(event.relatedTarget))return;
    form.classList.remove('reference-drag-over');
  });
  form.addEventListener('drop',event=>{
    form.classList.remove('reference-drag-over');
    const transfer=event.dataTransfer;
    const hasFile=Boolean(transfer?.types&&[...transfer.types].includes('Files'));
    if(!hasFile)return;
    event.preventDefault();event.stopPropagation();
    const images=incomingImageFiles(event);
    if(images.length)addFiles(images);
    else toast('Drop a JPG, PNG or WEBP image into the prompt.');
  });
}
for(const [scope,[inputId]] of Object.entries(referenceInputIds)){
  const pickerButton={quick:'quickAreaReferenceButton',welcome:'welcomeBaseReferenceButton'}[scope];
  if(pickerButton){
    $(pickerButton).addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();$(inputId).click();
    });
  }
  $(inputId).addEventListener('change',event=>{
    ingestReferences([...event.target.files],referenceState[scope],()=>renderReferenceFiles(scope));
    event.target.value='';
  });
  const form={
    master:'masterGenerateForm',area:'areaPromptForm',
    quick:'quickAreaPromptForm',welcome:'welcomeBasePromptForm',
    harmonize:'harmonizeForm'
  }[scope];
  wireReferencePasteDrop($(form),files=>ingestReferences(files,referenceState[scope],()=>renderReferenceFiles(scope)));
}
function bindInlineReferencePrompt(form){
  const input=form.querySelector('.region-reference-input');
  const button=form.querySelector('.region-reference-button');
  const previews=form.querySelector('.region-inline-previews');
  button?.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();input.click();
  });
  const refs=[];
  const render=()=>renderThumbnails(previews,refs,index=>{refs.splice(index,1);render()});
  input.addEventListener('change',event=>{
    ingestReferences([...event.target.files],refs,render);
    event.target.value='';
  });
  wireReferencePasteDrop(form,files=>ingestReferences(files,refs,render));
  return {getFiles:()=>[...refs],clear:()=>{
    for(const element of previews.querySelectorAll('[data-preview-url]'))
      URL.revokeObjectURL(element.dataset.previewUrl);
    refs.length=0;previews.replaceChildren();
  }};
}
async function prepareReferenceImages(files){
  const list=[...(files||[])];
  if(list.length>3)throw Error('Maximum 3 reference images.');
  const output=[];
  for(const file of list){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>10000000)throw Error('Choose a JPG, PNG or WEBP image under 10 MB.');
    const frame=await core.loadFileToCanvas(file,1000);
    let encoded=frame.toDataURL('image/jpeg',.90);
    // Keep attached references within the server's per-image and combined caps.
    if(encoded.length>720000)encoded=frame.toDataURL('image/jpeg',.78);
    if(encoded.length>720000){const smaller=makeCanvas(Math.round(frame.width*.75),Math.round(frame.height*.75));smaller.getContext('2d').drawImage(frame,0,0,smaller.width,smaller.height);encoded=smaller.toDataURL('image/jpeg',.85)}
    output.push(encoded);
  }
  return output;
}
function encodeMasterRequest(prompt,referenceImages){
  const base=state.reference;
  if(!base)throw Error('Upload Base before generating Master.');
  for(const maxSize of [1280,1080,900]){
    const factor=Math.min(1,maxSize/Math.max(base.width,base.height));
    const w=Math.max(128,Math.round(base.width*factor)),h=Math.max(128,Math.round(base.height*factor));
    const encoded=resizedFrame(base,w,h);
    const payload={base:encoded,collage:encoded,quality:'high',projectPrompt:prompt,prompt,references:referenceImages,regions:[]};
    if(JSON.stringify(payload).length<3550000)return payload;
  }
  throw Error('Base and references are too large. Try smaller images.');
}
async function openMasterGenerate(){
  if(!state.reference){toast('Upload a Base image to generate Master.');return}
  if(premium.masterJob?.generation===state.selectionGeneration){toast('Master is generating. You can keep editing the canvas.');return}
  if(!await window.MosaicAuth.ensure())return;
  clearReferenceFiles('master');
  $('masterGeneratePromptInput').value=premium.projectPrompt;
  showDialog('masterGenerateDialog');
}
async function createMasterFromBase(prompt,files,button,afterSuccess){
  if(!state.reference||state.busy)return;
  if(premium.masterJob?.generation===state.selectionGeneration)return;
  prompt=String(prompt||'').trim();
  if(!prompt)return toast('Describe your desired Master image first.');
  const job={generation:state.selectionGeneration};premium.masterJob=job;
  // Generating a replacement Master must never delete the existing region work.
  // The new Master is composited behind the user's live Groups and mask.
  const baseAtRequest=state.reference;
  const masterAtRequest=state.master;
  const firstMaster=!state.master||state.masterIsBase;
  let progress;
  if(button){button.disabled=true;button.dataset.originalLabel=button.textContent;button.textContent='Generating…'}
  try{
    if(!await window.MosaicAuth.ensure())return;
    // Enter the editor immediately. Base is a working draft until the first
    // generated Master arrives, so its preview never creates a Master version.
    const masterTarget=window.MozMasterResolution.target(state.reference.width,state.reference.height);
    if(!state.master)core.continueWithBase(false,masterTarget);else core.upgradeBaseDraft(masterTarget);
    job.generation=state.selectionGeneration;
    if(firstMaster)core.setProjectTitle('Base');
    core.updateSourceActions();
    if($('masterGenerateDialog').open)$('masterGenerateDialog').close();
    if(firstMaster)canvasProgressHost().replaceChildren();
    progress=beginAIProgress('Generating Master','Preparing Base and references…',{scope:firstMaster?'canvas':'master'});
    progress.update(16,'Preparing reference images…');
    const images=await prepareReferenceImages(files);
    const request=encodeMasterRequest(prompt,images);
    // Never keep a modal blocking canvas tools while a full Master generates.
    if($('masterGenerateDialog').open)$('masterGenerateDialog').close();
    message('Generating Master in the background. You can keep editing masks.');
    progress.update(30,'OpenAI is generating the Master image…');
    const reply=await window.MosaicAuth.request('/api/ai/master',request);
    progress.update(82,'Image received. Decoding result…');
    if(state.reference!==baseAtRequest
      ||(state.master!==masterAtRequest&&!state.masterIsBase)){
      toast('The working project changed during generation; the current work was preserved.');
      progress.done('Finished; current project was kept.');
      return;
    }
    const working=state.master;
    const sameAspect=working
      && Math.abs(working.width/working.height-baseAtRequest.width/baseAtRequest.height)<.02;
    const generated=await fromGeneratedJPEG(reply.image,sameAspect?working:baseAtRequest);
    progress.update(92,'Applying the generated Master…');
    premium.projectPrompt=prompt;
    if(working){
      if(generated.width!==canvas.width||generated.height!==canvas.height){
        addMasterVersion(generated,'AI generated · not applied',prompt);
        toast('New Master saved in versions, but aspect ratio differs. Current mask is preserved.');
      }else{
        const isFirstMaster=state.masterIsBase||!premium.masterVersions.length;
        if(firstMaster)revealMaster(currentComposite());
        state.master=generated;state.rawMaster=generated;state.masterIsBase=false;
        if(!state.objectMap?.raster)window.MosaicObjectMap?.imageReady?.(generated);
        const version=addMasterVersion(generated,'AI generated',prompt);
        if(isFirstMaster)premium.initialMaster=cloneCanvas(generated);
        premium.originalMaster=cloneCanvas(baseAtRequest);
        core.setSourcePreview('masterPreview',generated);
        $('masterTitle').textContent='Master '+version+' · AI';
        $('masterInfo').textContent=generated.width+' × '+generated.height+' · AI generated';
        $('masterStatus').textContent='✓';
        $('masterZone').classList.add('ready');
        core.setProjectTitle('Master '+version+' · AI');
        renderGroups();render();
        message('Master '+version+' updated behind your existing Groups and active mask.');
        toast('Generated Master in the background; masking stays available.');
      }
    }else{
      core.setMaster(generated,'Master · AI');
      premium.originalMaster=cloneCanvas(baseAtRequest);
      message('AI Master ready. Select regions to edit, or add another image.');
      toast('Generated Master from Base.');
    }
    updateIntent();
    afterSuccess?.();
    core.updateSourceActions();render();
    progress.done('Master is ready.');
  }catch(error){progress?.fail(error.message||'Master generation failed.');toast('Master generation: '+error.message);message('Base image preserved. Retry when ready.')}
  finally{if(premium.masterJob===job)premium.masterJob=null;if(button){button.disabled=false;button.textContent=button.dataset.originalLabel||'✦ Generate Master'}core.updateSourceActions()}
}
async function generateMaster(event){
  event.preventDefault();
  await createMasterFromBase($('masterGeneratePromptInput').value,getReferenceFiles('master'),$('masterGenerateSubmit'),()=>{
    $('masterGenerateDialog').close();clearReferenceFiles('master');
  });
}
// Compact Base prompt: Enter submits. The icon only opens the reference picker.
$('welcomeBasePromptInput').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.isComposing){
    event.preventDefault();
    const button=$('welcomeBaseGenerateSubmit');
    if(!button.disabled)$('welcomeBasePromptForm').requestSubmit();
  }
});
$('welcomeBasePromptForm').addEventListener('submit',event=>{
  event.preventDefault();
  const button=$('welcomeBaseGenerateSubmit');
  if(button.disabled)return; // Ignore repeated Enter while a Master is generating.
  void createMasterFromBase($('welcomeBasePromptInput').value,getReferenceFiles('welcome'),button,()=>clearReferenceFiles('welcome'));
});
$('generateMasterBtn').addEventListener('click',openMasterGenerate);
$('masterGenerateForm').addEventListener('submit',event=>void generateMaster(event));

function exportProjectState(){
  return {
    settings:{...premium.settings},
    projectPrompt:premium.projectPrompt,
    root:premium.root,
    serial:premium.serial,
    expanded:premium.expanded,
    previewNode:premium.previewNode,
    lastRequest:premium.lastRequest,
    originalMaster:premium.originalMaster,
    initialMaster:premium.initialMaster,
    masterVersions:premium.masterVersions,
    branchFrom:premium.branchFrom,
    regionSerial:premium.regionSerial,
    showGuides:premium.showGuides
  };
}
function restoreProjectState(snapshot){
  const data=snapshot||{};
  premium.masterJob=null;
  $('canvasGenerationProgress')?.replaceChildren();
  $('canvasWrap').querySelector('.master-image-transition')?.remove();
  premium.settings=generationSettings(data.settings);
  syncGenerationSettings();
  premium.projectPrompt=String(data.projectPrompt||'');
  premium.root=data.root||null;
  premium.serial=Number(data.serial)||0;
  premium.expanded=data.expanded instanceof Set?data.expanded:new Set();
  premium.previewNode=data.previewNode||null;
  premium.lastRequest=data.lastRequest||null;
  premium.originalMaster=data.originalMaster||null;
  premium.initialMaster=data.initialMaster||null;
  premium.masterVersions=Array.isArray(data.masterVersions)?data.masterVersions:[];
  premium.branchFrom=data.branchFrom||null;
  premium.regionSerial=Number(data.regionSerial)||0;
  premium.showGuides=Boolean(data.showGuides);
  premium.regenerateFrom=null;premium.uploadPatch=null;
  $('regionGuidesBtn').setAttribute('aria-pressed',String(premium.showGuides));
  updateIntent();refreshMasterBrowser();
}
function onPatchApplied() {
  // A committed patch stays selected so its four corner handles are immediately available.
  if(state.selectedPatchId){const group=state.groups.find(g=>g.active===state.selectedPatchId);if(group)core.selectGroupMask(group);else core.selectTool('select')}
}
async function generateComposition(prompt,files,source,markup=null,options={}){
  const master=state.master,generation=state.selectionGeneration;
  const size={width:canvas.width,height:canvas.height};
  if(!master)throw Error('Upload an image first.');
  if(!await window.MosaicAuth.ensure())throw Error('Sign in to generate.');
  if(state.master!==master||state.selectionGeneration!==generation)throw Error('The project changed. Submit again.');
  const references=await prepareReferenceImages(files);
  if(state.master!==master||state.selectionGeneration!==generation)throw Error('The project changed. Submit again.');
  const payload=encodeRequest(prompt,null,source,references,markup);
  payload.mode='chat';
  if(options?.quality&&['low','medium','high'].includes(options.quality))payload.quality=options.quality;
  if(['shape','remove'].includes(options?.editIntent))payload.editIntent=options.editIntent;
  if(options?.targetLabel)payload.targetObject=String(options.targetLabel).slice(0,80);
  const result=await window.MosaicAuth.request('/api/ai/harmonize',payload);
  const image=await fromGeneratedJPEG(result.image,size);
  if(state.master!==master||state.selectionGeneration!==generation)throw Error('The project changed during generation. Your current work was kept.');
  return image;
}
window.MosaicPremium = {
  generateComposition,
  positionCanvasProgress,
  isMasterGenerating:()=>premium.masterJob?.generation===state.selectionGeneration,
  projectPrompt: () => premium.projectPrompt,
  onReferenceLoaded, onMasterLoaded, onBaseContinue, onSourcesAligned, onSourceEdited, onMasterReset, canSelectArea, onPatchApplied, generateSelection, regenerateOption, bindInlineReferencePrompt, decorateActive: activePatchMarkup, getReferenceFiles, clearReferenceFiles, getMasterVersions, regenerateMaster, initialMasterImage, exportProjectState, restoreProjectState,
  drawArchivePreview, isPreviewing, renderHistory, handleGroupEvent,
  originalImage, exportPrompt, drawRegionGuides, classifyArea
};
function syncGenerationSettings(){
  $('preserveOriginalGeometry').checked=true;
  $('preserveOriginalGeometry').disabled=true;
  $('regionRenderQuality').value=premium.settings.regionQuality;
  $('harmonizeQuality').value=premium.settings.harmonizeQuality;
}
for(const id of ['regionRenderQuality','harmonizeQuality'])$(id).addEventListener('change',()=>{
  premium.settings=generationSettings({preserveOriginalGeometry:true,
    regionQuality:$('regionRenderQuality').value,harmonizeQuality:$('harmonizeQuality').value});
});
syncGenerationSettings();
for (const id of ['editProjectPromptBtn', 'projectPromptToolbarBtn']) $(id).addEventListener('click', () => {
  $('projectPromptInput').value = premium.projectPrompt;
  showDialog('projectPromptDialog');
});
$('projectPromptForm').addEventListener('submit', e => {
  e.preventDefault();
  premium.projectPrompt = $('projectPromptInput').value.trim();
  $('projectPromptDialog').close();
  updateIntent();
  toast('Project design prompt saved locally.');
});
$('promptAreaBtn')?.addEventListener('click', openAreaPrompt);
$('areaPromptForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('areaPromptInput').value.trim();
  if (!text) return;
  const references=getReferenceFiles('area');$('areaPromptDialog').close();
  void generateSelection(text,null,references);
});
for (const id of ['harmonizeBtn', 'harmonizeSidebarBtn'])
  $(id).addEventListener('click', openHarmonize);
$('harmonizeForm').addEventListener('submit', e => {
  e.preventDefault();
  const prompt = $('harmonizePromptInput').value.trim() || core.promptText();
  const source=premium.regenerateFrom;premium.regenerateFrom=null;
  $('harmonizeDialog').close();
  void harmonizeWithAI(prompt,source);
});
$('aiResultInput').addEventListener('change', async e => {
  await attachAIResult(e.target.files[0]);
  e.target.value = '';
});
document.querySelectorAll('[data-close-dialog]').forEach(button =>
  button.addEventListener('click', () => $(button.dataset.closeDialog).close()));
updateIntent();

$('regionGuidesBtn').addEventListener('click',()=>{
  premium.showGuides=!premium.showGuides;
  $('regionGuidesBtn').setAttribute('aria-pressed',String(premium.showGuides));
  render();
});
