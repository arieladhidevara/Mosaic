/* Mosaic Premium — authenticated masked editing and harmonization. */
const core = window.MosaicCore;
if (!core) throw new Error('Mosaic core must load before Premium');
const {state, canvas, makeCanvas, uid, render, renderGroups, resetSelection, assignGroup, maskBoundingBox, toast, message} = core;
const $ = id => document.getElementById(id);
const esc = core.escapeHTML;
const premium = {
  projectPrompt: '', root: null, serial: 0, expanded: new Set(),
  previewNode: null, uploadPatch: null, lastRequest: null,
  originalMaster: null, initialMaster: null, branchFrom: null, regionSerial: 0, showGuides: false, generationQueue: Promise.resolve()
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
function currentComposite() {
  const output = makeCanvas(canvas.width, canvas.height);
  drawComposition(output.getContext('2d'), state.master, state.groups, state.patches, state.sources);
  return output;
}
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
function setReferenceAsBase() {
  if (state.master || !state.reference) return;
  const ref = state.reference;
  const scale = Math.min(1, 2400 / Math.max(ref.width, ref.height));
  const base = makeCanvas(Math.round(ref.width * scale), Math.round(ref.height * scale));
  base.getContext('2d').drawImage(ref, 0, 0, base.width, base.height);
  core.setMaster(base, 'Base · Original');
}
function onReferenceLoaded() {
  setReferenceAsBase();
  if (state.master && state.reference) {
    premium.originalMaster = makeCanvas(canvas.width, canvas.height);
    premium.originalMaster.getContext('2d').drawImage(state.reference, 0, 0, canvas.width, canvas.height);
  }
  $('projectPromptInput').value = premium.projectPrompt;
  if(window.MosaicAuth?.isReady())showDialog('projectPromptDialog');
}
function onMasterLoaded(image){premium.initialMaster=cloneCanvas(image)}

function onMasterReset() {
  premium.root = null;
  premium.serial = 0;
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
function activePatchMarkup() {
  // A result image is accepted as a full frame but immediately clipped by the saved original mask.
  for (const patch of state.patches.values()) {
    if (!patch.awaitingResult) continue;
    const row = $('groupList').querySelector('.variant-row[data-action="choose"][data-patch="' + patch.id + '"]');
    if (!row) continue;
    row.classList.add('awaiting-ai');
    const generate = document.createElement('button');
    generate.type='button';generate.className='small-action';generate.dataset.aiAction='generate';
    generate.dataset.patch=patch.id;generate.textContent=patch.generating?'Generating…':'↻ Generate';
    generate.disabled=Boolean(patch.generating);row.appendChild(generate);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'small-action add-ai-result';
    b.dataset.aiAction = 'upload';
    b.dataset.patch = patch.id;
    b.textContent = 'Add result';
    b.title = 'Attach a generated image; Mosaic will apply the saved lasso mask automatically';
    row.appendChild(b);
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
function encodeRequest(prompt,patch=null){
  const collage=currentComposite();
  for(const maxSize of [1350,1120,900]){
    const scale=Math.min(1,maxSize/Math.max(canvas.width,canvas.height));
    const w=Math.max(128,Math.round(canvas.width*scale)),h=Math.max(128,Math.round(canvas.height*scale));
    const payload={collage:resizedFrame(collage,w,h),base:resizedFrame(state.reference,w,h),
      projectPrompt:premium.projectPrompt,prompt,regions:annotationNotes(patch?.id)};
    if(patch){
      payload.mask=transparentEditMask(patch.mask,w,h);
      const guide=cloneCanvas(collage);paintGuides(guide.getContext('2d'));
      payload.guide=resizedFrame(guide,w,h);
    }
    if(JSON.stringify(payload).length<3550000)return payload;
  }
  throw Error('Image is too large for the server. Try a smaller Base image.');
}
async function fromGeneratedJPEG(encoded){
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const input=await core.loadFileToCanvas(new Blob([bytes],{type:'image/jpeg'}));
  const out=makeCanvas(canvas.width,canvas.height);
  out.getContext('2d').drawImage(input,0,0,canvas.width,canvas.height);
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

async function generateRegion(patchId){
  const patch=state.patches.get(patchId);
  if(!patch||!patch.awaitingResult||patch.generating)return;
  patch.generating=true;renderGroups();
  const run=async()=>{
    try{
      if(!await window.MosaicAuth.ensure())throw Error('Premium login canceled.');
      const request=encodeRequest(patch.prompt,patch);
      message('Generating AI edit for region '+patch.regionNumber+'…');
      const answer=await window.MosaicAuth.request('/api/ai/edit',request);
      const image=await fromGeneratedJPEG(answer.image);
      const existing=state.patches.get(patchId),source=state.sources.get(patch.sourceId);
      if(!existing||!source)return;
      source.canvas=image;source.name='AI region '+patch.regionNumber;
      existing.awaitingResult=false;if(!existing.manualName)existing.name=core.optionNameFromPrompt(existing.prompt,'AI edit '+patch.regionNumber);
      existing.generating=false;
      state.selectedPatchId=patchId;core.selectTool('transform');renderGroups();render();
      message('Region '+patch.regionNumber+' ready. All pixels outside the saved mask are untouched.');
      toast('AI result automatically clipped to the original mask.');
    }catch(error){
      patch.generating=false;renderGroups();
      toast('Region '+patch.regionNumber+': '+error.message);
      message('AI edit failed. Retry using Generate in the region list.');
    }
  };
  const job=premium.generationQueue.catch(()=>{}).then(run);
  premium.generationQueue=job;
  return job;
}

async function openAreaPrompt() {
  if (!canSelectArea()) {toast('Finish the current layer or restore an archived branch before prompting.');return;}
  if (state.lasso.length > 2) core.updateMaskWithLasso();
  const bbox = state.selectionMask && maskBoundingBox(state.selectionMask);
  if (!bbox) {toast('Draw a lasso selection first, then press Prompt area.');return;}
  if(!await window.MosaicAuth.ensure())return;
  $('areaPromptInput').value = '';
  showDialog('areaPromptDialog');
}
function createRegionRequest(prompt) {
  const bbox = maskBoundingBox(state.selectionMask);
  if (!bbox) {toast('Selection has no pixels.');return;}
  const mask = cloneCanvas(state.selectionMask);
  const base = currentComposite();
  const sourceId = uid('ai_source');
  const text = prompt.trim();
  const source = {id: sourceId, name: 'AI request', canvas: base};
  const regionNumber=++premium.regionSerial,color=REGION_COLORS[(regionNumber-1)%REGION_COLORS.length];
  const patch = {id: uid('ai_patch'), sourceId, mask, bbox, regionNumber, color,
    name: core.optionNameFromPrompt(text,'AI edit '+regionNumber), manualName:false, prompt: text, awaitingResult: true,
    projectPrompt: premium.projectPrompt,
    request: {baseImage: base, reference: state.reference, mask, prompt: text}};
  state.sources.set(sourceId, source);
  const group = assignGroup(patch);
  state.selectedPatchId = null;
  state.editingPatchId = null;
  resetSelection();
  renderGroups();
  render();
  message('Region '+regionNumber+' assigned '+color+'. Sending to AI.');
  toast('AI region '+regionNumber+' queued.');
  return patch.id;
}
function generateSelection(prompt,groupId=null){
  if(!window.MosaicAuth?.isReady()){toast('Sign in to Premium to generate an AI edit.');return}
  if(!canSelectArea()){toast('Finish the current imported layer before generating.');return}
  if(state.lasso.length>2)core.updateMaskWithLasso();
  const bbox=maskBoundingBox(state.selectionMask);
  if(!bbox){toast('Select a region before generating.');return}
  if(groupId){const g=state.groups.find(g=>g.id===groupId);if(g)state.draftGroupId=g.id}
  const patchId=createRegionRequest(prompt);
  if(patchId)void generateRegion(patchId);
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
    if(!patch.manualName)patch.name = core.optionNameFromPrompt(patch.prompt,file.name.replace(/\.[^.]+$/,''));
    const group = state.groups.find(g => g.patchIds.includes(patch.id));
    if (group) group.active = patch.id;
    state.selectedPatchId = patch.id;
    core.selectTool('transform');
    renderGroups();
    render();
    toast('Generated result masked automatically and added to its region group.');
  } catch (error) {toast('Could not attach result: ' + error.message);}
}
async function openHarmonize() {
  if (!state.master || !state.reference) {toast('Upload Base first.');return;}
  if (state.pendingSourceId || state.editingPatchId) {toast('Apply or discard the current mask first.');return;}
  if (premium.previewNode) {toast('Close the archive preview or branch from it before harmonizing.');return;}
  if (state.groups.some(g => g.active && state.patches.get(g.active)?.awaitingResult)) {
    toast('An active masked AI request is still waiting for its result image.');return;
  }
  if(!await window.MosaicAuth.ensure())return;
  $('harmonizePromptInput').value = core.promptText();
  showDialog('harmonizeDialog');
}
async function harmonizeWithAI(prompt) {
  if(!await window.MosaicAuth.ensure())return;
  if(state.groups.some(g=>state.patches.get(g.active)?.awaitingResult)){toast('Finish pending region edits first.');return}
  const a=$('harmonizeBtn'),b=$('harmonizeSidebarBtn');a.disabled=true;b.disabled=true;
  const flattened = currentComposite();
  let finalImage;
  try{
    message('Generating harmonized architecture image with OpenAI…');
    const answer=await window.MosaicAuth.request('/api/ai/harmonize',encodeRequest(prompt));
    finalImage=await fromGeneratedJPEG(answer.image);
  }catch(error){toast('Harmonize failed: '+error.message);message('Your original collage is unchanged. Please retry.');return}
  finally{a.disabled=false;b.disabled=false}
  const graph = copyGraph(state.groups, state.patches, state.sources);
  const number = ++premium.serial;
  const node = {
    id: uid('harmonized'), number, base: cloneCanvas(state.master),
    groups: graph.groups, patches: graph.patches, sources: graph.sources,
    output: cloneCanvas(finalImage), prompt, parent: premium.root,
    branchedFrom: premium.branchFrom, aiGenerated: true
  };
  premium.root = node;
  premium.expanded.add(node.id);
  premium.previewNode = null;
  premium.lastRequest = {
    originalBase: state.reference, collage: cloneCanvas(flattened),
    prompt, snapshotId: node.id
  };
  // Preserve all region groups and their material alternatives across Harmonize.
  const original = premium.initialMaster || cloneCanvas(state.master);
  const savedRegionMasks = state.groups.map(g=>({group:g,mask:cloneCanvas(core.groupMask(g))}));
  state.master = finalImage;
  for(const {group,mask} of savedRegionMasks){
    if(!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster)){
      const initialId=uid('original_master'),initialSource=uid('original_source');
      state.sources.set(initialSource,{id:initialSource,name:'Original Master',canvas:cloneCanvas(original)});
      state.patches.set(initialId,{id:initialId,sourceId:initialSource,mask:cloneCanvas(mask),bbox:maskBoundingBox(mask),name:'Original Master',manualName:true,isOriginalMaster:true,groupId:group.id});
      group.patchIds.unshift(initialId);
    }
    const nextId=uid('master_version'),sourceId=uid('master_source');
    state.sources.set(sourceId,{id:sourceId,name:'Master '+(number+1),canvas:cloneCanvas(finalImage)});
    state.patches.set(nextId,{id:nextId,sourceId,mask:cloneCanvas(mask),bbox:maskBoundingBox(mask),name:'Master '+(number+1),manualName:true,isMasterVersion:true,masterVersion:number+1,groupId:group.id});
    group.patchIds.push(nextId);group.active=nextId;group.hasHarmonizedMaster=true;
  }
  state.pendingSourceId = null;
  state.editingPatchId = null;
  state.selectedPatchId = null;
  state.undo = [];
  state.redo = [];
  premium.branchFrom = node.id;
  resetSelection();
  $('masterTitle').textContent = 'Master ' + (number+1) + ' · AI';
  $('masterInfo').textContent = canvas.width + ' × ' + canvas.height + ' · working image';document.getElementById('masterPreview').src=finalImage.toDataURL('image/jpeg',.78);
  $('projectName').textContent = 'Harmonized ' + number + ' · AI render';
  renderGroups();
  render();
  message('Master '+(number+1)+' is now active. Previous materials and Original Master stay inside each Region.');
  toast('Harmonization saved. All previous region options are preserved.');
}
function exportPrompt() {
  return premium.lastRequest?.prompt || null;
}
function originalImage() {
  return premium.originalMaster;
}
function onPatchApplied() {
  // A committed patch stays selected so its four corner handles are immediately available.
  if(state.selectedPatchId)core.selectTool('transform');
}
window.MosaicPremium = {
  projectPrompt: () => premium.projectPrompt,
  onReferenceLoaded, onMasterLoaded, onMasterReset, canSelectArea, onPatchApplied, generateSelection, decorateActive: activePatchMarkup,
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
  $('areaPromptDialog').close();
  generateSelection(text);
});
for (const id of ['harmonizeBtn', 'harmonizeSidebarBtn'])
  $(id).addEventListener('click', openHarmonize);
$('harmonizeForm').addEventListener('submit', e => {
  e.preventDefault();
  const prompt = $('harmonizePromptInput').value.trim() || core.promptText();
  $('harmonizeDialog').close();
  void harmonizeWithAI(prompt);
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
