/* Mosaic Premium — authenticated masked editing and harmonization. */
const core = window.MosaicCore;
if (!core) throw new Error('Mosaic core must load before Premium');
const {state, canvas, makeCanvas, uid, render, renderGroups, resetSelection, assignGroup, maskBoundingBox, toast, message} = core;
const $ = id => document.getElementById(id);
const esc = core.escapeHTML;
const premium = {
  projectPrompt: '', root: null, serial: 0, expanded: new Set(),
  previewNode: null, uploadPatch: null, lastRequest: null,
  originalMaster: null, initialMaster: null, masterVersions: [], regenerateFrom: null, branchFrom: null, regionSerial: 0, showGuides: false, generationQueue: Promise.resolve()
};
const cloneCanvas = input => {
  const output = makeCanvas(input.width, input.height);
  output.getContext('2d').drawImage(input, 0, 0);
  return output;
};
function copyGraph(groups, patches, sources) {
  return {
    groups: groups.map(g => ({...g, patchIds: [...g.patchIds],footprint: g.footprint?cloneCanvas(g.footprint):null})),
    patches: new Map([...patches].map(([id,p]) => [id, {...p, mask: cloneCanvas(p.mask), corners: p.corners?.map(q=>({...q}))||null}])),
    sources: new Map([...sources].map(([id,s]) => [id, {...s, canvas: cloneCanvas(s.canvas)}]))
  };
}
function drawComposition(context, base, groups, patches, sources) {
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
  if(kind==='base')premium.originalMaster=cloneCanvas(raster);
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
        if(source){source.canvas=cloneCanvas(raster);updated.add(patch.sourceId)}
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
  return Boolean(state.master && !state.pendingSourceId && !state.editingPatchId && !premium.previewNode);
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
    if(!patch.awaitingResult&&!patch.generating)continue;
    const row=$('groupList').querySelector('.variant-row[data-action="choose"][data-patch="'+patch.id+'"]');
    row?.classList.add('awaiting-ai');
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
function workFromNode(node, useFlattened) {
  if (state.pendingSourceId || state.editingPatchId) {toast('Finish or discard your current mask first.');return;}
  if (state.groups.length && !window.confirm('Switch working version? Your current unharmonized patches will be replaced. Harmonized snapshots remain in history.')) return;
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
  $('projectName').textContent = 'Branch · Harmonized ' + node.number;
  $('masterTitle').textContent = useFlattened ? 'Harmonized ' + node.number : 'Restored edit composition';
  renderGroups();
  render();
  message(useFlattened ? 'Editing a previous harmonized result. Existing history is preserved.' :
    'Restored the archived editable collage. Change alternatives and harmonize again.');
  toast('Branch created. Earlier harmonizations are still available.');
}
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
  if (action === 'toggle') {
    premium.expanded.has(node.id) ? premium.expanded.delete(node.id) : premium.expanded.add(node.id);
  } else if (action === 'preview') {
    premium.previewNode = premium.previewNode === node.id ? null : node.id;
  } else if (action === 'option') {
    const group = node.groups.find(g => g.id === control.dataset.historyGroup);
    if (group) {
      const id = control.dataset.historyPatch;
      group.active = id === 'master' ? null : id;
      premium.previewNode = node.id;
    }
  } else if (action === 'restore') {
    workFromNode(node, false);
    return true;
  } else if (action === 'result') {
    workFromNode(node, true);
    return true;
  }
  renderGroups();
  render();
  return true;
}

const REGION_COLORS=['#f59e60','#4eb8eb','#cb86e8','#7dd1ab','#e4bc4f','#ff7d9f','#8d9bf4','#b1d278'];
const contourCache=new WeakMap();
function coloredContour(mask,color){
  const cached=contourCache.get(mask);
  if(cached&&cached.color===color)return cached.canvas;
  const w=Math.min(700,canvas.width),h=Math.max(1,Math.round(w*canvas.height/canvas.width));
  const small=makeCanvas(w,h),sc=small.getContext('2d',{willReadFrequently:true});
  sc.drawImage(mask,0,0,w,h);
  const px=sc.getImageData(0,0,w,h).data,out=makeCanvas(w,h),oc=out.getContext('2d'),image=oc.createImageData(w,h);
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(px[i*4+3]<110)continue;
    if(x>0&&px[(i-1)*4+3]>110&&x<w-1&&px[(i+1)*4+3]>110&&y>0&&px[(i-w)*4+3]>110&&y<h-1&&px[(i+w)*4+3]>110)continue;
    image.data.set([...rgb,242],i*4);
  }
  oc.putImageData(image,0,0);contourCache.set(mask,{color,canvas:out});return out;
}
function activeAIRegions(){return state.groups.map(g=>state.patches.get(g.active)).filter(p=>p?.color)}
function paintGuides(target){
  for(const p of activeAIRegions()){
    target.save();target.imageSmoothingEnabled=false;target.globalAlpha=.98;
    target.drawImage(coloredContour(p.mask,p.color),0,0,canvas.width,canvas.height);
    const x=Math.min(canvas.width-20,Math.max(15,p.bbox.x+12)),y=Math.max(17,p.bbox.y-7);
    target.fillStyle=p.color;target.beginPath();target.arc(x,y,13,0,Math.PI*2);target.fill();
    target.fillStyle='#11151c';target.font='bold 12px sans-serif';target.textAlign='center';
    target.fillText(String(p.regionNumber),x,y+4);target.restore();
  }
}
function drawRegionGuides(target){if(premium.showGuides)paintGuides(target)}
function resizedFrame(source,w,h){
  const out=makeCanvas(w,h),o=out.getContext('2d');
  o.fillStyle='#fff';o.fillRect(0,0,w,h);
  o.drawImage(source,0,0,w,h);
  return out.toDataURL('image/jpeg',.78);
}
function transparentEditMask(source,w,h){
  const out=makeCanvas(w,h),m=out.getContext('2d');
  m.fillStyle='#fff';m.fillRect(0,0,w,h);
  m.globalCompositeOperation='destination-out';m.drawImage(source,0,0,w,h);
  return out.toDataURL('image/png');
}
function annotationNotes(targetId){
  return activeAIRegions().map(p=>({color:p.color,prompt:p.prompt,active:p.id===targetId}));
}
function encodeRequest(prompt,patch=null,masterSource=null,extraReferences=[]){
  const collage=masterSource||currentComposite();
  for(const maxSize of [1350,1120,900]){
    const scale=Math.min(1,maxSize/Math.max(canvas.width,canvas.height));
    const w=Math.max(128,Math.round(canvas.width*scale)),h=Math.max(128,Math.round(canvas.height*scale));
    const payload={collage:resizedFrame(collage,w,h),base:resizedFrame(state.reference||premium.initialMaster||state.master,w,h),
      projectPrompt:premium.projectPrompt,prompt,regions:annotationNotes(patch?.id),references:patch?.referenceImages||extraReferences};
    if(patch){
      payload.mask=transparentEditMask(patch.mask,w,h);
      const guide=cloneCanvas(collage);paintGuides(guide.getContext('2d'));
      payload.guide=resizedFrame(guide,w,h);
    }
    if(JSON.stringify(payload).length<3550000)return payload;
  }
  throw Error('Image is too large for the server. Try a smaller Base image.');
}
function regionalCropWindow(mask){
  const bounds=maskBoundingBox(mask);
  if(!bounds)throw Error('Select a visible part of the image before generating.');
  const context=Math.max(72,Math.ceil(Math.max(bounds.w,bounds.h)*.30));
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
  return frame.toDataURL(mask?'image/png':'image/jpeg',mask?undefined:.78);
}
function encodeRegionalCrop(patch){
  const visualMask=core.displayedPatchMask(patch);
  const region=regionalCropWindow(visualMask);
  const collage=currentComposite(),base=state.reference||premium.initialMaster||state.master;
  const guide=cloneCanvas(collage);
  paintGuides(guide.getContext('2d'));
  for(const maxDimension of [1152,960,768]){
    const scale=Math.min(1,maxDimension/Math.max(region.w,region.h));
    const w=Math.max(128,Math.round(region.w*scale));
    const h=Math.max(128,Math.round(region.h*scale));
    const payload={
      collage:cropFrame(collage,region,w,h),
      base:cropFrame(base,region,w,h),
      mask:cropFrame(visualMask,region,w,h,true),
      guide:cropFrame(guide,region,w,h),
      projectPrompt:premium.projectPrompt,
      prompt:patch.prompt,
      regions:annotationNotes(patch.id),
      references:patch.referenceImages||[],
      cropSize: (() => {
        // GPT Image 2.5 supports custom sizes in multiples of 16.
        // Keep local output proportional to this crop, not to the full canvas.
        const factor=Math.max(1,512/Math.min(w,h));
        const rw=Math.round(Math.min(1536,w*factor)/16)*16;
        const rh=Math.round(Math.min(1536,h*factor)/16)*16;
        return rw/rh>3||rh/rw>3?'auto':rw+'x'+rh;
      })()
    };
    if(JSON.stringify(payload).length<3550000)return {payload,region,visibleMask:visualMask};
  }
  throw Error('Selection crop is too large. Try fewer reference images or a smaller Base.');
}
async function fromGeneratedJPEG(encoded,targetSize=null){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const input=await core.loadFileToCanvas(new Blob([bytes],{type:'image/jpeg'}));
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
  if(!window.MosaicAuth?.isReady())throw Error('Connect Premium and your OpenAI API key to identify objects.');
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
  patch.generating=true;renderGroups();
  // Freeze exactly the collage, crop and mask that were submitted. Subsequent
  // drawing/editing must not change a queued request's target or alignment.
  let capture;
  try{capture=encodeRegionalCrop(patch)}
  catch(error){patch.generating=false;renderGroups();toast('Local AI edit: '+error.message);return}
  const initialCorners=JSON.stringify(patch.corners||null);
  const generationId=patch.sourceId;
  const canvasSize={width:canvas.width,height:canvas.height};
  const run=async()=>{
    try{
      if(!await window.MosaicAuth.ensure())throw Error('Premium login canceled.');
      const {payload,region,visibleMask}=capture;
      message('Generating only the selected area with nearby architectural context…');
      const answer=await window.MosaicAuth.request('/api/ai/edit',payload);
      const image=await fromGeneratedJPEG(answer.image,{width:region.w,height:region.h});
      const existing=state.patches.get(patchId);
      if(!existing||!state.sources.has(generationId)||existing.sourceId!==generationId
        ||canvas.width!==canvasSize.width||canvas.height!==canvasSize.height)return;
      const result=makeCanvas(canvasSize.width,canvasSize.height);
      result.getContext('2d').drawImage(image,region.x,region.y,region.w,region.h);
      // Always fork on regeneration to preserve shared source images and older options.
      if(regenerate){
        const id=uid('ai_source');
        state.sources.set(id,{id,name:'Regenerated '+existing.name,canvas:result});
        existing.sourceId=id;
      }else{
        const source=state.sources.get(existing.sourceId);
        source.canvas=result;source.name='AI region '+patch.regionNumber;
      }
      if(existing.corners?.length
        && state.editingPatchId!==patchId
        && JSON.stringify(existing.corners)===initialCorners){
        existing.mask=cloneCanvas(visibleMask);
        existing.bbox=maskBoundingBox(existing.mask);
        existing.corners=null;
        core.invalidateDisplayedMask(existing);
      }
      existing.awaitingResult=false;
      if(!existing.manualName&&!existing.semanticNamed)existing.name=core.optionNameFromPrompt(existing.prompt,'AI edit '+(patch.regionNumber||''));
      existing.generating=false;
      const group=state.groups.find(g=>g.patchIds.includes(patchId));
      if(group)core.refreshGroupFootprint(group);
      // Async output updates the layer underneath whichever tool, mask or editor
      // the user is working with. Never steal focus or select another option.
      renderGroups();render();
      message('Local edit complete in the background. Your current mask is unchanged.');
      toast('Generated medium-quality crop; restored to its exact selected position.');
    }catch(error){
      patch.generating=false;renderGroups();
      toast('Local AI edit: '+error.message);
      message('The current approved image was preserved. Retry from its option.');
    }
  };
  const job=premium.generationQueue.catch(()=>{}).then(run);
  premium.generationQueue=job;
  return job;
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
function createRegionRequest(prompt,referenceImages=[],selectedMask=state.selectionMask,groupId=null) {
  const bbox = maskBoundingBox(selectedMask);
  if (!bbox) {toast('Selection has no pixels.');return;}
  const mask = cloneCanvas(selectedMask);
  const base = currentComposite();
  const sourceId = uid('ai_source');
  const text = prompt.trim();
  const source = {id: sourceId, name: 'AI request', canvas: base};
  const regionNumber=++premium.regionSerial,color=REGION_COLORS[(regionNumber-1)%REGION_COLORS.length];
  const patch = {id: uid('ai_patch'), sourceId, mask, bbox, regionNumber, color,
    name: core.optionNameFromPrompt(text,'AI edit '+regionNumber), manualName:false, prompt: text, referenceImages, awaitingResult: true,
    groupId:groupId||state.draftGroupId||null,
    projectPrompt: premium.projectPrompt,
    request: {baseImage: base, reference: state.reference, mask, prompt: text}};
  state.sources.set(sourceId, source);
  const selectedBefore=state.selectedPatchId;
  assignGroup(patch);
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
  if(!window.MosaicAuth?.isReady()){toast('Sign in to Premium to generate an AI edit.');return}
  if(!canSelectArea()){toast('Finish the current imported layer before generating.');return}
  if(state.lasso.length>2)core.updateMaskWithLasso();
  const bbox=maskBoundingBox(state.selectionMask);
  if(!bbox){toast('Select a region before generating.');return}
  const savedMask=cloneCanvas(state.selectionMask),generation=state.selectionGeneration;
  try{
    const referenceImages=await prepareReferenceImages(referenceFiles);
    if(generation!==state.selectionGeneration){toast('The project changed. Please select the region again.');return}
    const targetGroup=groupId&&state.groups.some(g=>g.id===groupId)?groupId:null;
    const patchId=createRegionRequest(prompt,referenceImages,savedMask,targetGroup);
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
    source.canvas = c;
    source.name = file.name;
    patch.awaitingResult = false;
    if(!patch.manualName&&!patch.semanticNamed)patch.name = core.optionNameFromPrompt(patch.prompt,file.name.replace(/\.[^.]+$/,''));
    const group = state.groups.find(g => g.patchIds.includes(patch.id));
    if (group) group.active = patch.id;
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
  const flattened = currentComposite();
  const baseAtRequest=state.master;
  const generationAtRequest=state.selectionGeneration;
  // Freeze the approved graph at submission time for accurate archive history.
  // Any painting after this point belongs to the active working session.
  const submittedGraph=copyGraph(state.groups,state.patches,state.sources);
  let finalImage;
  try{
    message(sourceVersion?'Regenerating from Master '+sourceVersion.number+'…':'Generating harmonized architecture image with OpenAI…');
    const references=await prepareReferenceImages(getReferenceFiles('harmonize'));
    const answer=await window.MosaicAuth.request('/api/ai/harmonize',encodeRequest(prompt,null,sourceVersion?.image,references));
    finalImage=await fromGeneratedJPEG(answer.image);
  }catch(error){toast('Harmonize failed: '+error.message);message('Your original collage is unchanged. Please retry.');return}
  finally{a.disabled=false;b.disabled=false}
  clearReferenceFiles('harmonize');
  if(state.selectionGeneration!==generationAtRequest||state.master!==baseAtRequest){
    // A different Master/project was loaded while the request was processing.
    // Never overwrite its layers, masks or history with a stale AI result.
    toast('Harmonize finished, but Master changed during generation. The current work was kept.');
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
  // Preserve region/material alternatives. Share a single image source per Master version,
  // rather than duplicating a large full-resolution canvas for every region.
  const original = premium.initialMaster || cloneCanvas(state.master);
  const savedRegionMasks = state.groups.map(g=>({group:g,mask:cloneCanvas(core.groupMask(g))}));
  state.master = finalImage;
  const needsOriginal=savedRegionMasks.some(({group})=>!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster));
  const originalSource=needsOriginal?uid('original_source'):null;
  if(originalSource)state.sources.set(originalSource,{id:originalSource,name:'Original Master',canvas:cloneCanvas(original)});
  const sourceId=savedRegionMasks.length?uid('master_source'):null;
  if(sourceId)state.sources.set(sourceId,{id:sourceId,name:'Master '+masterVersion,canvas:cloneCanvas(finalImage)});
  for(const {group,mask} of savedRegionMasks){
    if(!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster)){
      const initialId=uid('original_master');
      state.patches.set(initialId,{id:initialId,sourceId:originalSource,mask:cloneCanvas(mask),bbox:maskBoundingBox(mask),name:'Original Master',manualName:true,isOriginalMaster:true,groupId:group.id});
      group.patchIds.unshift(initialId);
    }
    const nextId=uid('master_version');
    state.patches.set(nextId,{id:nextId,sourceId,mask:cloneCanvas(mask),bbox:maskBoundingBox(mask),name:'Master '+masterVersion,manualName:true,isMasterVersion:true,masterVersion,groupId:group.id});
    group.patchIds.push(nextId);
    // A newly rendered Master is available as an option without replacing
    // the option whose mask the user is currently drawing or refining.
    if(!editingInProgress)group.active=nextId;
    group.hasHarmonizedMaster=true;
  }
  // Preserve pending imports, selection canvas, in-progress lasso, mask editor,
  // undo/redo stack, tool and keyboard focus across the background Master update.
  premium.branchFrom = node.id;
  $('masterTitle').textContent = 'Master ' + masterVersion + ' · AI';
  $('masterInfo').textContent = canvas.width + ' × ' + canvas.height + ' · working image';core.setSourcePreview('masterPreview',finalImage);
  $('projectName').textContent = 'Harmonized ' + number + ' · AI render';
  renderGroups();
  render();
  message(editingInProgress
    ?'Master '+masterVersion+' updated in the background. Your mask editing remains active.'
    :'Master '+masterVersion+' is active. Earlier Masters remain available in the expandable source list.');
  refreshMasterBrowser();toast('Master '+masterVersion+' saved. Current mask and earlier region options are preserved.');
}
function getMasterVersions(){return [...premium.masterVersions]}
function initialMasterImage(){return premium.masterVersions[0]?.image||premium.initialMaster}
async function regenerateMaster(number){
  const version=premium.masterVersions.find(item=>item.number===Number(number));
  if(!version){toast('This Master version is no longer available.');return}
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
  if(scope==='quick'){
    $('quickAreaReferenceButton').addEventListener('click',event=>{
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
    output.push(frame.toDataURL('image/jpeg',.72));
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
    const payload={base:encoded,collage:encoded,projectPrompt:prompt,prompt,references:referenceImages,regions:[]};
    if(JSON.stringify(payload).length<3550000)return payload;
  }
  throw Error('Base and references are too large. Try smaller images.');
}
async function openMasterGenerate(){
  if(!state.reference){toast('Upload a Base image to generate Master.');return}
  if(!await window.MosaicAuth.ensure())return;
  clearReferenceFiles('master');
  $('masterGeneratePromptInput').value=premium.projectPrompt;
  showDialog('masterGenerateDialog');
}
async function createMasterFromBase(prompt,files,button,afterSuccess){
  if(!state.reference||state.busy)return;
  prompt=String(prompt||'').trim();
  if(!prompt)return toast('Describe your desired Master image first.');
  if(state.groups.length&&!window.confirm('Replace the current working image and existing regions?'))return;
  if(button){button.disabled=true;button.dataset.originalLabel=button.textContent;button.textContent='Generating…'}
  try{
    if(!await window.MosaicAuth.ensure())return;
    const images=await prepareReferenceImages(files);
    const request=encodeMasterRequest(prompt,images);
    message('Generating Master from Base…');
    const reply=await window.MosaicAuth.request('/api/ai/master',request);
    const generated=await fromGeneratedJPEG(reply.image,state.reference);
    premium.projectPrompt=prompt;
    core.setMaster(generated,'Master · AI');
    premium.originalMaster=cloneCanvas(state.reference);
    updateIntent();
    afterSuccess?.();
    core.updateSourceActions();render();
    message('AI Master ready. Select regions to edit, or add another image.');
    toast('Generated Master from Base.');
  }catch(error){toast('Master generation: '+error.message);message('Base image preserved. Retry when ready.')}
  finally{if(button){button.disabled=false;button.textContent=button.dataset.originalLabel||'✦ Generate Master'}}
}
async function generateMaster(event){
  event.preventDefault();
  await createMasterFromBase($('masterGeneratePromptInput').value,getReferenceFiles('master'),$('masterGenerateSubmit'),()=>{
    $('masterGenerateDialog').close();clearReferenceFiles('master');
  });
}
$('welcomeBasePromptForm').addEventListener('submit',event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector('button[type="submit"]');
  void createMasterFromBase($('welcomeBasePromptInput').value,getReferenceFiles('welcome'),button,()=>clearReferenceFiles('welcome'));
});
$('generateMasterBtn').addEventListener('click',openMasterGenerate);
$('masterGenerateForm').addEventListener('submit',event=>void generateMaster(event));

function exportProjectState(){
  return {
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
  premium.generationQueue=Promise.resolve();
  $('regionGuidesBtn').setAttribute('aria-pressed',String(premium.showGuides));
  updateIntent();refreshMasterBrowser();
}
function onPatchApplied() {
  // A committed patch stays selected so its four corner handles are immediately available.
  if(state.selectedPatchId)core.selectTool('transform');
}
window.MosaicPremium = {
  projectPrompt: () => premium.projectPrompt,
  onReferenceLoaded, onMasterLoaded, onBaseContinue, onSourcesAligned, onSourceEdited, onMasterReset, canSelectArea, onPatchApplied, generateSelection, regenerateOption, bindInlineReferencePrompt, decorateActive: activePatchMarkup, getReferenceFiles, clearReferenceFiles, getMasterVersions, regenerateMaster, initialMasterImage, exportProjectState, restoreProjectState,
  drawArchivePreview, isPreviewing, renderHistory, handleGroupEvent,
  originalImage, exportPrompt, drawRegionGuides, classifyArea
};
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
$('promptAreaBtn').addEventListener('click', openAreaPrompt);
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
