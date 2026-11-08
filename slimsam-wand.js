// mozAI AI Wand: local SlimSAM-77, purple object-preview on hover, commit on click.
// The inference worker caches model weights and the embedding for unchanged images.
// This never sends the user's image to a segmentation API.
const core = window.MosaicCore;
const $ = id => document.getElementById(id);
const viewport = $('viewport');
const wrap = $('canvasWrap');
const status = $('slimsamWandStatus');
const previewCanvas = document.createElement('canvas');
previewCanvas.className = 'slimsam-hover-overlay';
previewCanvas.id = 'slimsamHoverOverlay';
previewCanvas.setAttribute('aria-hidden', 'true');
wrap.append(previewCanvas);
const previewCtx = previewCanvas.getContext('2d');
const selectionPreview = document.createElement('canvas');
const selectionCtx = selectionPreview.getContext('2d');
let worker = null, active = false, ready = false, epoch = 0, requestSerial = 0;
let encodedWidth = 0, encodedHeight = 0, pendingHover = null;
let inFlightHover = false, lastHoverPoint = null, lastPreview = null, pendingClick = null;
let hoverTimer = null, stopped = false, modelPreloaded = false, preloadStarted = false;
const MIN_HOVER_DELTA = 14;

function updateStatus(text, isError = false) {
  if (status) {
    status.textContent = text;
    status.classList.toggle('error', isError);
    status.title = isError ? text : 'SlimSAM model runs on your device — no masking API credits';
  }
  const busy=!isError&&/download|loading|prepar|analyz|selecting|queued|initializ|generat|predict/i.test(text);
  if(active&&busy)window.MosaicMaskProgress?.show?.('wand','Wand · AI Mask',text);
  else if(!busy||isError)window.MosaicMaskProgress?.hide?.('wand');
}
function clearHover() {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = null;
  pendingHover = null;
  lastHoverPoint = null;
  lastPreview = null;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
}
function preload(){
  if(preloadStarted)return;
  preloadStarted=true;
  window.MosaicMaskProgress?.show?.('preload','Preparing Wand','Loading segmentation model and browser cache…');
  try{
    ensureWorker();
    worker.postMessage({type:'preload'});
  }catch(error){
    window.MosaicMaskProgress?.hide?.('preload');
    preloadStarted=false;
    console.warn('Wand preload failed:',error);
  }
}
function onToolChange(tool) {
  if (tool !== 'wand') {
    active = false; ready = false; pendingClick = null; inFlightHover = false;
    epoch++;clearHover();core.overlay.style.cursor = '';
    window.MosaicMaskProgress?.hide?.('wand');
    return;
  }
  window.MosaicAutoRegions?.reset?.();
  if (!core.state.master || active) return;
  active = true;ready = false;stopped = false;
  const version = ++epoch;
  pendingClick = null;inFlightHover = false;clearHover();
  updateStatus(modelPreloaded?'Preparing image for masking…':'Loading segmentation model…');
  ensureWorker();
  core.render();
  const scale = Math.min(1, 1024 / Math.max(core.canvas.width, core.canvas.height));
  encodedWidth = Math.max(1, Math.round(core.canvas.width * scale));
  encodedHeight = Math.max(1, Math.round(core.canvas.height * scale));
  const sample = core.makeCanvas(encodedWidth, encodedHeight);
  const ctx = sample.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(core.canvas,0,0,encodedWidth,encodedHeight);
  const pixels = ctx.getImageData(0,0,encodedWidth,encodedHeight).data;
  // A deterministic sampled fingerprint avoids re-encoding an unchanged image
  // when the user returns to Wand, without retaining the large RGBA buffer.
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 97) {
    hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
  }
  const fingerprint = [encodedWidth,encodedHeight,hash.toString(16)].join(':');
  worker.postMessage({
    type:'prepare',epoch:version,width:encodedWidth,height:encodedHeight,
    fingerprint,pixels
  }, [pixels.buffer]);
}
function reset() {
  epoch++;active=false;ready=false;stopped=false;pendingClick=null;inFlightHover=false;
  clearHover();core.overlay.style.cursor='';
  window.MosaicMaskProgress?.hide?.('wand');
  updateStatus('Hover to preview · click to select');
}
function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL('./slimsam-worker.mjs', import.meta.url), {type:'module'});
  worker.addEventListener('message', event => onWorkerMessage(event.data));
  worker.addEventListener('error', event => {
    if (!active) return;
    ready=false;stopped=true;pendingClick=null;
    clearHover();
    window.MosaicMaskProgress?.hide?.('preload');
    const error = 'Wand model could not load. Check your connection and browser storage.';
    updateStatus(error,true);core.toast(error);
  });
}
function scaledPoint(point) {
  return {x:point.x*encodedWidth/core.canvas.width,y:point.y*encodedHeight/core.canvas.height};
}
function inside(point) {
  return point && point.x>=0 && point.y>=0 &&
    point.x<core.canvas.width && point.y<core.canvas.height;
}
function distance(a,b) {
  return a && b ? Math.hypot(a.x-b.x, a.y-b.y) : Infinity;
}
function sendInfer(point, click=false) {
  if (!active || !ready || !inside(point) || stopped) return null;
  const source=scaledPoint(point), id=++requestSerial;
  worker.postMessage({type:'infer',epoch,id,click,x:source.x,y:source.y});
  if(!click){
    inFlightHover=true;
    lastHoverPoint={...point};
    if(!lastPreview){
      window.MosaicMaskProgress?.show?.('wand','Wand · AI Mask','Predicting object mask…');
      window.MosaicMaskProgress?.highlight?.('wand',{point});
    }
  }else{
    pendingClick={id,point:{...point}};
    updateStatus('Generating mask…');
    window.MosaicMaskProgress?.highlight?.('wand',lastPreview?{mask:previewCanvas}:{point});
  }
  return id;
}
function queueHover() {
  if(!ready||!active||stopped||inFlightHover||pendingClick||!inside(pendingHover))return;
  const point=pendingHover;
  if (distance(point,lastHoverPoint)<MIN_HOVER_DELTA && lastPreview) return;
  if(hoverTimer)clearTimeout(hoverTimer);
  hoverTimer=setTimeout(()=>{
    hoverTimer=null;
    if(!active||!ready||inFlightHover||pendingClick||!inside(pendingHover))return;
    sendInfer(pendingHover);
  },130);
}
function hoverAt(point) {
  if (!active || stopped) return;
  if (!inside(point)) {leave();return;}
  pendingHover={...point};
  if(lastPreview && distance(point,lastPreview.point)>24){
    lastPreview=null;
    previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  }
  queueHover();
}
function leave() {
  pendingHover=null;
  if(hoverTimer)clearTimeout(hoverTimer);
  hoverTimer=null;
  lastPreview=null;
  previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  core.overlay.style.cursor = active ? 'crosshair' : '';
}
function createMaskCanvas(result, ctx, canvas) {
  canvas.width = result.width;
  canvas.height = result.height;
  const pixels = ctx.createImageData(result.width,result.height);
  for(let i=0;i<result.mask.length;i++){
    if(!result.mask[i])continue;
    const o=i*4;
    pixels.data[o]=pixels.data[o+1]=pixels.data[o+2]=pixels.data[o+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  return canvas;
}
function preview(result, point) {
  const {width,height,mask}=result;
  previewCanvas.width=width;previewCanvas.height=height;
  const pixels=previewCtx.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(!mask[i])continue;
    const edge=x===0||y===0||x===width-1||y===height-1||
      !mask[i-1]||!mask[i+1]||!mask[i-width]||!mask[i+width];
    const o=i*4;
    pixels.data[o]=154;pixels.data[o+1]=104;pixels.data[o+2]=245;
    pixels.data[o+3]=edge?210:76;
  }
  previewCtx.putImageData(pixels,0,0);
  lastPreview={...result,point:{...point}};
  core.overlay.style.cursor='pointer';
}
function commit(result) {
  if(!active||!result?.mask)return;
  if(core.state.tool!=='wand')return;
  createMaskCanvas(result,selectionCtx,selectionPreview);
  core.applyWandMask(selectionPreview,result.coverage);
}
function selectAt(point) {
  if(!active||stopped||!inside(point))return;
  if(lastPreview && distance(point,lastPreview.point)<=24){
    commit(lastPreview);return;
  }
  if(ready)sendInfer(point,true);
  else{
    pendingClick={id:null,point:{...point}};
    updateStatus('Preparing Wand model · selection queued…');
    window.MosaicMaskProgress?.highlight?.('wand',{point});
  }
}
function onWorkerMessage(msg) {
  if(msg.type==='status'){
    if(msg.stage==='model'){
      const detail=String(msg.status||'Loading model…');
      if(!modelPreloaded){
        window.MosaicMaskProgress?.show?.('preload','Preparing Wand',detail,
          Number.isFinite(msg.percent)?msg.percent:null);
      }
      if(active)window.MosaicMaskProgress?.show?.('wand','Wand · AI Mask',detail,
        Number.isFinite(msg.percent)?msg.percent:null);
    }else if(active && msg.epoch===epoch)updateStatus(msg.status);
    return;
  }
  if(msg.type==='preloaded'){
    modelPreloaded=true;
    window.MosaicMaskProgress?.hide?.('preload');
    return;
  }
  if(msg.stage==='preload'&&msg.type==='error'){
    window.MosaicMaskProgress?.hide?.('preload');
    preloadStarted=false;
    if(active)updateStatus('Unable to download mask model.',true);
    return;
  }
  if(msg.epoch!==epoch || !active)return;
  if(msg.type==='ready'){
    ready=true;stopped=false;
    window.MosaicMaskProgress?.hide?.('preload');
    updateStatus('Hover object · click to select');
    if(pendingClick && pendingClick.id===null)sendInfer(pendingClick.point,true);
    else queueHover();
    return;
  }
  if(msg.type==='error'){
    if(msg.stage==='infer' && !msg.click)inFlightHover=false;
    if(msg.stage==='infer' && msg.click)pendingClick=null;
    if(msg.stage==='prepare'){ready=false;stopped=true;}
    clearHover();
    const text = msg.stage==='prepare'
      ? 'Could not prepare Wand model. Check connectivity or browser memory.'
      : 'Wand could not identify this object.';
    updateStatus(text,true);
    core.toast(text);
    return;
  }
  if(msg.type!=='mask')return;
  if(msg.click){
    const click = pendingClick;
    if(!click || click.id!==msg.id)return;
    pendingClick=null;
    if(!msg.mask){window.MosaicMaskProgress?.hide?.('wand');updateStatus('Object not found · try another spot');core.toast('Try clicking farther inside the object.');queueHover();return;}
    window.MosaicMaskProgress?.hide?.('wand');
    commit(msg);
    return;
  }
  inFlightHover=false;
  window.MosaicMaskProgress?.hide?.('wand');
  // Ignore stale predictions after the cursor has moved to another object.
  const point=lastHoverPoint;
  if(msg.mask && point && distance(point,pendingHover)<=30 && inside(pendingHover)){
    preview(msg,point);
    updateStatus('Preview on hover · click to select');
  } else if(!msg.mask){
    lastPreview=null;
    previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
    core.overlay.style.cursor='crosshair';
  }
  if(distance(point,pendingHover)>=MIN_HOVER_DELTA)queueHover();
}

window.MosaicSlimWand = {onToolChange,hoverAt,selectAt,reset,leave,preload};
// Start download/cache warming before a user uploads an image or selects Wand.
preload();
