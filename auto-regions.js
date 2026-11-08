/* mozAI Auto Create: detect candidate objects, preview only on the image,
   creates reusable Group drafts immediately; Options still appear only on Generate. */
import {cleanAutoMask} from './mask-cleanup.mjs';
const core = window.MosaicCore;
const $ = id => document.getElementById(id);
const button = $('autoCreateGroupsBtn');
const sourceCanvas = core.canvas;
const sourceOverlay = core.overlay;
const imageWrap = $('canvasWrap');
const preview = document.createElement('canvas');
preview.id = 'autoRegionsOverlay';
preview.className = 'auto-regions-overlay';
preview.setAttribute('aria-hidden', 'true');
imageWrap.append(preview);
const previewCtx = preview.getContext('2d', {willReadFrequently: true});
const hint = document.createElement('div');
hint.className = 'auto-regions-hint hidden';
hint.setAttribute('aria-hidden', 'true');
imageWrap.append(hint);
let active = false, fetching = false, serial = 0;
let labels = null, labelWidth = 0, labelHeight = 0, labelCount = 0, hovered = 0;
let detectedFor = null;
const regionGroups = new Map();

function updateButton() {
  button.disabled = fetching;
  button.setAttribute('aria-pressed', String(active));
  button.textContent = fetching ? '✦ Detecting…' : active ? '✕ Stop AI' : '✦ Auto Create';
}
function clearPreview() {
  previewCtx.clearRect(0, 0, preview.width, preview.height);
  hint.classList.add('hidden');
  hovered = 0;
}
function reset() {
  serial++;
  active = false;
  fetching = false;
  labels = null;
  regionGroups.clear();
  window.MosaicMaskProgress?.hide?.('auto');
  detectedFor = null;
  labelWidth = labelHeight = labelCount = 0;
  clearPreview();
  updateButton();
}
function paintPreview() {
  if (!active || !labels) return clearPreview();
  const frame = previewCtx.createImageData(labelWidth, labelHeight);
  const rgba = frame.data;
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (!id) continue;
    const o = i * 4;
    rgba[o] = 150; rgba[o+1] = 118; rgba[o+2] = 240;
    rgba[o+3] = id === hovered ? 100 : 20;
    if (id === hovered) {
      const x = i % labelWidth;
      const y = (i - x) / labelWidth;
      if (x === 0 || y === 0 || x === labelWidth - 1 || y === labelHeight - 1 ||
          labels[i-1] !== id || labels[i+1] !== id ||
          labels[i-labelWidth] !== id || labels[i+labelWidth] !== id) rgba[o+3] = 190;
    }
  }
  previewCtx.putImageData(frame, 0, 0);
}
function imagePoint(event) {
  const rect = sourceOverlay.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const nx = (event.clientX - rect.left) / rect.width;
  const ny = (event.clientY - rect.top) / rect.height;
  if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return null;
  return {
    sx: Math.min(labelWidth-1, Math.floor(nx*labelWidth)),
    sy: Math.min(labelHeight-1, Math.floor(ny*labelHeight)),
    cx: Math.floor(nx*sourceCanvas.width),
    cy: Math.floor(ny*sourceCanvas.height)
  };
}
function regionAt(point) {return point && labels ? labels[point.sy*labelWidth+point.sx] || 0 : 0}
function hover(event) {
  if (!active || !labels) return;
  const point = imagePoint(event);
  const next = regionAt(point);
  if (next !== hovered) {hovered = next;paintPreview()}
  sourceOverlay.style.cursor = next ? 'pointer' : 'crosshair';
  if (!next || !point) {hint.classList.add('hidden');return}
  const rect = sourceOverlay.getBoundingClientRect();
  hint.textContent = 'Object ' + next + ' · click to select';
  hint.style.left = Math.min(rect.width-120, Math.max(8, event.clientX-rect.left+12)) + 'px';
  hint.style.top = Math.max(8, event.clientY-rect.top-30) + 'px';
  hint.classList.remove('hidden');
}
function createMask(id) {
  if(!labels||!labelWidth||!labelHeight)return null;
  const total=labelWidth*labelHeight,binary=new Uint8Array(total);
  let original=0;
  for(let i=0;i<total;i++)if(labels[i]===id){binary[i]=1;original++}
  if(original<50||original>=total*.92)return null;
  const clean=cleanAutoMask(binary,labelWidth,labelHeight);
  const candidate=core.makeCanvas(labelWidth,labelHeight);
  const context=candidate.getContext('2d');
  const pixels=context.createImageData(labelWidth,labelHeight);
  let area=0;
  for(let i=0;i<total;i++){
    if(labels[i]===id&&!clean[i])labels[i]=0;
    if(!clean[i]||(labels[i]&&labels[i]!==id))continue;
    if(!labels[i])labels[i]=id;
    const j=i*4;
    pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=pixels.data[j+3]=255;
    area++;
  }
  if(area<50||area>=total*.92)return null;
  context.putImageData(pixels,0,0);
  return candidate;
}
function selectRegion(event,id){
  const groupId=regionGroups.get(id);
  const group=core.state.groups.find(g=>g.id===groupId);
  if(!group){core.toast('This object is not available as a Group. Try another area.');return}
  const state=core.state;
  if(!state.master||state.pendingSourceId||state.editingPatchId||state.busy){
    core.toast('Finish the current edit before selecting another region.');return;
  }
  const append=event.ctrlKey||event.metaKey;
  reset();
  if(append)core.appendGroupSelection(group);
  else core.selectGroupMask(group,{showOutline:true});
  state.lastCanvasPointer={clientX:event.clientX,clientY:event.clientY};
  core.showQuickPrompt(state.lastCanvasPointer);
  core.message('Object selected. Describe the change and Generate. Ctrl+click additional objects to combine them.');
}
async function start() {
  if (fetching) return;
  if (active) {reset();core.message('Auto Create closed. AI Wand and manual tools are available.');return}
  const state = core.state;
  if (!state.master) {core.toast('Upload or generate an image first.');return}
  if (state.busy || state.pendingSourceId || state.editingPatchId || window.MosaicPremium?.isPreviewing?.()) {
    core.toast('Finish the current image edit before Auto Create.');
    return;
  }
  // Account login is required before sending the image for AI segmentation.
  if (!await window.MosaicAccount?.ensure?.()) return;
  const revision = ++serial;
  const master = state.master;
  const generation = state.selectionGeneration;
  const activeOptions = state.groups.map(g => g.id + ':' + g.active).join('|');
  fetching = true;
  updateButton();
  core.message('Auto Create is detecting candidate objects in your image…');
  window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create','Preparing image for segmentation…');
  window.MosaicMaskProgress?.highlight?.('auto',{whole:true});
  try {
    core.render();
    const scale = Math.min(1, 768/Math.max(sourceCanvas.width, sourceCanvas.height));
    const width = Math.max(1, Math.round(sourceCanvas.width*scale));
    const height = Math.max(1, Math.round(sourceCanvas.height*scale));
    const sample = core.makeCanvas(width, height);
    sample.getContext('2d').drawImage(sourceCanvas, 0, 0, width, height);
    window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create','Analyzing objects on Hugging Face ZeroGPU…');
    const response = await window.MosaicAccount.request('/api/ai/sam3', {
      method:'POST', body:{
        mode:'auto', image:sample.toDataURL('image/jpeg', 0.80), width, height
      }
    });
    if (serial !== revision || master !== state.master || generation !== state.selectionGeneration ||
        activeOptions !== state.groups.map(g => g.id + ':' + g.active).join('|')) return;
    window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create','Decoding object masks…');
    if (!response?.labels || !/^data:image\/png;base64,/.test(response.labels)) throw Error('Invalid region map from SAM 3.');
    const image = new Image();
    image.src = response.labels;
    await image.decode();
    if (image.width !== width || image.height !== height) throw Error('Auto Create mask dimensions do not match the image.');
    if (serial !== revision) return;
    const decode = core.makeCanvas(width, height);
    const ctx = decode.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0);
    const data = ctx.getImageData(0,0,width,height).data;
    const selected = new Uint8Array(width*height);
    let detected = 0;
    for(let i=0;i<selected.length;i++){selected[i]=data[i*4];if(selected[i]>detected)detected=selected[i]}
    if (!detected || detected > 64) throw Error('Auto Create could not identify distinct objects.');
    labels = selected;
    labelWidth = width;
    labelHeight = height;
    labelCount = detected;
    window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create','Creating Groups from detected objects…');
    regionGroups.clear();
    let created=0,reused=0;
    for(let id=1;id<=detected;id++){
      if(serial!==revision)return;
      window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create',
        'Cleaning masks and organizing Groups…',Math.round(id/detected*100));
      if(id%3===0)await new Promise(resolve=>setTimeout(resolve,0));
      if(serial!==revision||master!==state.master)return;
      const smallMask=createMask(id);
      if(!smallMask)continue;
      const fullMask=core.makeCanvas(sourceCanvas.width,sourceCanvas.height);
      const ctx=fullMask.getContext('2d');
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(smallMask,0,0,sourceCanvas.width,sourceCanvas.height);
      let group=core.matchingGroup(fullMask,.70);
      if(group)reused++;
      else{
        group=core.newGroup(fullMask);
        group.autoCreated=true;
        created++;
      }
      regionGroups.set(id,group.id);
    }
    if(!regionGroups.size)throw Error('All detected masks were too small or too broad.');
    core.renderGroups();
    window.MosaicMaskProgress?.show?.('auto','SAM 3 · Auto Create','Groups ready.',100);
    preview.width = width;
    preview.height = height;
    active = true;
    detectedFor = master;
    hovered = 0;
    paintPreview();
    core.message('Auto Create created '+created+' Groups and reused '+reused+' existing Groups. Click a mask or a Group to generate an option.');
    core.toast('Created '+created+' Groups · reused '+reused+'. Hover and click an object.');
  } catch(error) {
    if (revision === serial) {
      reset();
      core.toast('Auto Create: ' + (error.message || 'Could not segment image.'));
      core.message('Auto Create unavailable. You can still use AI Wand or Line.');
    }
  } finally {
    if (serial === revision) {
      fetching = false;
      window.MosaicMaskProgress?.hide?.('auto');
      updateButton();
    }
  }
}
button.addEventListener('click',()=>void start());
sourceOverlay.addEventListener('pointermove',event=>{
  if (!active) return;
  if (core.state.master !== detectedFor) {reset();return}
  hover(event);
  event.stopImmediatePropagation();
},true);
sourceOverlay.addEventListener('pointerdown',event=>{
  if (!active || event.button!==0 || core.state.master!==detectedFor) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const id = regionAt(imagePoint(event));
  if (id) selectRegion(event, id);
  else core.toast('Click a highlighted object. Use AI Wand for unrecognized surfaces.');
},true);
sourceOverlay.addEventListener('pointerleave',()=>{if(active){hovered=0;hint.classList.add('hidden');paintPreview()}},true);
document.addEventListener('keydown',event=>{
  if (!active || event.key !== 'Escape') return;
  event.stopImmediatePropagation();
  reset();
  core.message('Auto Create cancelled.');
},true);
window.MosaicAutoRegions = {start,reset,isActive:()=>active};
