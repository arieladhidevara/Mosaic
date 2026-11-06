/* Mosaic — manual-first, local-only image compositor.
   Each uploaded variation is a temporary top layer until its mask is applied.
   Masks remain editable; only approved patches are combined with the master. */
const $ = id => document.getElementById(id);
const canvas = $('compositeCanvas'), overlay = $('overlayCanvas');
const ctx = canvas.getContext('2d'), ox = overlay.getContext('2d');
const state = {
  reference: null, master: null, sources: new Map(), groups: [], patches: new Map(),
  pendingSourceId: null, queue: [], editingPatchId: null, selectedPatchId: null,
  selectionMask: null, boundaryCanvas: null, selectionMode: 'new', lasso: [], drawing: false,
  pointerStart: null, dragFreehand: false, hoverPoint: null, shapeStart: null, shapeEnd: null,
  tool: 'lasso', lastPoint: null, before: false, zoom: 1, fitZoom: 1, busy: false,
  undo: [], redo: [], serial: 1, panAnchor: null, transformDrag: null
};
const uid = name => `${name}_${state.serial++}`;
const makeCanvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const clamp = (v,a,b) => Math.min(b, Math.max(a,v));
const center = b => ({x:b.x+b.w/2,y:b.y+b.h/2});
let toastTimer;
function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3400)}
function message(s){$('canvasMessage').textContent=s}
function fileName(f){return (f?.name||'Image').replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ').slice(0,32)}
function labelFromPosition(b){let x=(b.x+b.w/2)/canvas.width,y=(b.y+b.h/2)/canvas.height;return `${y<.35?'Upper':y>.68?'Lower':'Middle'} ${x<.37?'left':x>.65?'right':'center'}`}
function promptText(){const p=`Create one seamless photorealistic architectural rendering using the two attached images.\n\nIMAGE 1 — BASE. Preserve its camera perspective, architectural geometry, spatial proportions and original structure where no deliberate change has been made.\n\nIMAGE 2 — MOSAIC COLLAGE. This is the primary source for approved material finishes, furniture, ornaments, lighting fixtures, and intentional geometry changes.\n\nINSTRUCTIONS:\n- Preserve the appearance and deliberate object changes selected in Image 2, even if they differ from Image 1.\n- Preserve Image 1's geometry in unchanged regions.\n- Harmonize collage seams, material transitions, shadows, reflections and color grading.\n- Do not add unrequested objects, change the camera, alter mullion spacing, or reinterpret approved design elements.\n- Prioritize design fidelity and architectural accuracy over artistic reinterpretation.\n\nOUTPUT: One cohesive professional architectural visualization. These images are references, not pixel-locked constraints.\n\nPROJECT DESIGN INTENT:\n${window.MosaicPremium?.projectPrompt() || 'Preserve the approved original design.'}`;$('promptPreview').textContent=p;return p}
async function loadFileToCanvas(file,maxDimension=2400){if(!file||!file.type.startsWith('image/'))throw Error('Choose an image file.');let image;try{image=await createImageBitmap(file)}catch{image=await new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Cannot open this image'))};img.src=url})}
  const scale=Math.min(1,maxDimension/Math.max(image.width,image.height)),c=makeCanvas(Math.round(image.width*scale),Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close?.();return c}
async function importMaster(file){if(!file)return;try{const c=await loadFileToCanvas(file);setMaster(c,fileName(file));toast('Master ready. Add an AI variation and lasso your favorite region.')}catch(e){toast(e.message)}}
function setMaster(c,name){window.MosaicPremium?.onMasterReset();state.master=c;state.sources.clear();state.groups=[];state.patches.clear();state.pendingSourceId=null;state.queue=[];state.editingPatchId=null;state.selectedPatchId=null;state.undo=[];state.redo=[];
  canvas.width=overlay.width=c.width;canvas.height=overlay.height=c.height;resetSelection();
  $('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden');$('projectName').textContent=name;$('projectSize').textContent=`${c.width} × ${c.height}`;
  $('masterTitle').textContent='Master';$('masterInfo').textContent=`${name} · ${c.width} × ${c.height}`;$('masterStatus').textContent='✓';$('masterZone').classList.add('ready');updateZoomFit();renderGroups();render();message('Upload a new image, draw a lasso and press Enter to keep the selection.')}
async function importReference(file){if(!file)return;try{state.reference=await loadFileToCanvas(file,4000);$('referenceTitle').textContent='Base';$('referenceInfo').textContent=`${fileName(file)} · ${state.reference.width} × ${state.reference.height}`;$('referenceStatus').textContent='✓';$('referenceZone').classList.add('ready');toast('Base image saved locally.');window.MosaicPremium?.onReferenceLoaded(file)}catch(e){toast(e.message)}}
function showProcessing(on){state.busy=on;$('processing').classList.toggle('hidden',!on)}
function clearDraft(){state.lasso=[];state.hoverPoint=null;state.pointerStart=null;state.dragFreehand=false;state.shapeStart=null;state.shapeEnd=null;state.drawing=false}
function resetSelection(){state.selectionMask=state.master?makeCanvas(canvas.width,canvas.height):null;state.boundaryCanvas=null;clearDraft();updateApplyButton()}
function updateApplyButton(){const pending=Boolean(state.pendingSourceId),editing=Boolean(state.editingPatchId),btn=$('commitBtn');btn.disabled=!(pending||editing);btn.innerHTML=`✓ ${editing?'Update':'Apply'} <kbd>Enter</kbd>`}
function setMode(mode){if(state.selectionMode!==mode)clearDraft();state.selectionMode=mode;document.querySelectorAll('.mode').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode))});drawOverlay();message(`${mode==='new'?'Replace':mode==='add'?'Add to':'Subtract from'} selection. Use Lasso, Rectangle or Ellipse, then press Enter to apply.`)}
async function importVariants(files){if(!state.master){toast('Upload a master image first.');return}const arr=Array.from(files||[]).filter(f=>f.type.startsWith('image/'));state.queue.push(...arr);if(arr.length>0&&state.pendingSourceId)toast(`${arr.length} variation${arr.length>1?'s':''} queued. Apply the current selection first.`);await loadNextVariant()}
async function loadNextVariant(){if(state.pendingSourceId||state.busy||!state.queue.length||!state.master)return;showProcessing(true);try{const file=state.queue.shift(),img=await loadFileToCanvas(file),c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(img,0,0,c.width,c.height);if(Math.abs(img.width/img.height-c.width/c.height)>.012)toast('Aspect ratios differ. Check image alignment before masking.');const id=uid('source');state.sources.set(id,{id,name:fileName(file),canvas:c});state.pendingSourceId=id;state.editingPatchId=null;state.selectedPatchId=null;state.before=false;resetSelection();setMode('new');selectTool('lasso');message(`Select the area to keep from ${fileName(file)}. Use Add/Subtract, then Enter.`)}catch(e){toast('Import failed: '+e.message)}finally{showProcessing(false);renderGroups();render()}}
function discardPending(){if(!state.pendingSourceId)return;state.sources.delete(state.pendingSourceId);state.pendingSourceId=null;resetSelection();renderGroups();render();toast('Unapplied image discarded.');loadNextVariant()}
function bboxIoU(a,b){const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)),area=w*h,union=a.w*a.h+b.w*b.h-area;return union>0?area/union:0}
function assignGroup(patch){let best=null,bestScore=0;
  for(const group of state.groups){for(const pid of group.patchIds){const other=state.patches.get(pid);if(!other)continue;const a=patchDisplayBounds(patch),b=patchDisplayBounds(other),ca=center(a),cb=center(b),iou=bboxIoU(a,b),dist=Math.hypot((ca.x-cb.x)/canvas.width,(ca.y-cb.y)/canvas.height),aArea=a.w*a.h,bArea=b.w*b.h,areaRatio=Math.min(aArea,bArea)/Math.max(aArea,bArea);
    // Similar region, not merely any touching overlap. Different objects remain separate.
    const score=iou+.10*Math.max(0,1-dist/.17);if((iou>.24||(iou>.13&&dist<.07&&areaRatio>.35))&&score>bestScore){best=group;bestScore=score}
  }}
  if(!best){best={id:uid('group'),name:`Region ${String(state.groups.length+1).padStart(2,'0')} · ${labelFromPosition(patch.bbox)}`,patchIds:[],active:null};state.groups.push(best)}
  state.patches.set(patch.id,patch);best.patchIds.push(patch.id);best.active=patch.id;state.selectedPatchId=patch.id;return best}

// Non-destructive four-corner warp. The source pixels and original mask stay intact.
const patchTextures = new WeakMap();
const copyCorners = points => points?.map(p => ({x:p.x,y:p.y})) || null;
function patchDisplayBounds(patch){
  const q=patchCorners(patch),xs=q.map(p=>p.x),ys=q.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
function patchCorners(patch) {
  if(patch.corners?.length===4)return patch.corners;
  const {x,y,w,h}=patch.bbox;
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}
function patchTexture(patch, source) {
  const b=patch.bbox, key=[b.x,b.y,b.w,b.h].join('/');
  const cached=patchTextures.get(patch);
  if(cached && cached.source===source.canvas && cached.mask===patch.mask && cached.key===key)return cached;
  const pad=Math.max(4,Math.ceil(canvas.width/250)+2);
  const x=Math.max(0,Math.floor(b.x)-pad),y=Math.max(0,Math.floor(b.y)-pad);
  const right=Math.min(canvas.width,Math.ceil(b.x+b.w)+pad),bottom=Math.min(canvas.height,Math.ceil(b.y+b.h)+pad);
  const image=makeCanvas(Math.max(1,right-x),Math.max(1,bottom-y)),tc=image.getContext('2d');
  tc.drawImage(source.canvas,-x,-y);
  tc.globalCompositeOperation='destination-in';
  tc.drawImage(patch.mask,-x,-y);
  const out={image,x,y,key,mask:patch.mask,source:source.canvas};
  patchTextures.set(patch,out);return out;
}
function bilinear(quad,u,v){
  const [tl,tr,br,bl]=quad;
  return {x:tl.x*(1-u)*(1-v)+tr.x*u*(1-v)+br.x*u*v+bl.x*(1-u)*v,
    y:tl.y*(1-u)*(1-v)+tr.y*u*(1-v)+br.y*u*v+bl.y*(1-u)*v};
}
function affineTriangle(target,texture,s0,s1,s2,d0,d1,d2){
  const sx1=s1.x-s0.x,sy1=s1.y-s0.y,sx2=s2.x-s0.x,sy2=s2.y-s0.y;
  const det=sx1*sy2-sx2*sy1;if(Math.abs(det)<1e-8)return;
  const dx1=d1.x-d0.x,dy1=d1.y-d0.y,dx2=d2.x-d0.x,dy2=d2.y-d0.y;
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
  const c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  target.save();target.beginPath();target.moveTo(d0.x,d0.y);target.lineTo(d1.x,d1.y);target.lineTo(d2.x,d2.y);target.closePath();target.clip();
  target.setTransform(a,b,c,d,d0.x-a*s0.x-c*s0.y,d0.y-b*s0.x-d*s0.y);
  target.drawImage(texture,0,0);target.restore();
}
function drawPatch(target,patch,source){
  if(!patch || !source || patch.awaitingResult)return;
  const t=patchTexture(patch,source);
  if(!patch.corners){target.drawImage(t.image,t.x,t.y);return}
  const q=patchCorners(patch),b=patch.bbox;
  // Parallelograms need just one draw; arbitrary 4-point skew gets a piecewise affine mesh.
  const affine=Math.hypot(q[0].x+q[2].x-q[1].x-q[3].x,q[0].y+q[2].y-q[1].y-q[3].y)<.05;
  if(affine){
    const a=(q[1].x-q[0].x)/b.w,bb=(q[1].y-q[0].y)/b.w;
    const c=(q[3].x-q[0].x)/b.h,d=(q[3].y-q[0].y)/b.h;
    const sx=b.x-t.x,sy=b.y-t.y;
    target.save();target.transform(a,bb,c,d,q[0].x-a*sx-c*sy,q[0].y-bb*sx-d*sy);
    target.drawImage(t.image,0,0);target.restore();return;
  }
  const uvSource=(u,v)=>({x:b.x+u*b.w-t.x,y:b.y+v*b.h-t.y});
  const steps=8;
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const u=x/steps,v=y/steps,un=(x+1)/steps,vn=(y+1)/steps;
    const A=uvSource(u,v),B=uvSource(un,v),C=uvSource(un,vn),D=uvSource(u,vn);
    const a=bilinear(q,u,v),bb=bilinear(q,un,v),c=bilinear(q,un,vn),d=bilinear(q,u,vn);
    affineTriangle(target,t.image,A,B,C,a,bb,c);
    affineTriangle(target,t.image,A,C,D,a,c,d);
  }
}
function convexCorners(q){
  let sign=0;
  for(let i=0;i<4;i++){
    const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)<1)return false;
    if(sign && cross*sign<0)return false;
    sign=Math.sign(cross);
  }
  return true;
}
function inQuad(p,q){let inside=false;for(let i=0,j=3;i<4;j=i++){
  const a=q[i],b=q[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside}
function quadCenter(q){return {x:q.reduce((s,p)=>s+p.x,0)/4,y:q.reduce((s,p)=>s+p.y,0)/4}}
function transformHit(p,patch,handlesOnly=false){
  const q=patchCorners(patch),radius=(18/state.zoom),middle=quadCenter(q);
  for(let i=0;i<4;i++)if(Math.hypot(p.x-q[i].x,p.y-q[i].y)<radius)return {kind:'corner',index:i};
  if(Math.hypot(p.x-middle.x,p.y-middle.y)<radius)return {kind:'move'};
  return !handlesOnly&&inQuad(p,q)?{kind:'move'}:null;
}
function activeTransformPatch(){
  const patch=state.patches.get(state.selectedPatchId);
  return patch&&state.groups.some(g=>g.active===patch.id)?patch:null;
}
function beginTransform(e,p){
  if(state.pendingSourceId||state.editingPatchId||window.MosaicPremium?.isPreviewing())return false;
  let patch=activeTransformPatch(),hit=patch&&transformHit(p,patch);
  if(!hit){
    for(const group of [...state.groups].reverse()){
      const other=state.patches.get(group.active);if(!other)continue;
      const found=transformHit(p,other);if(!found)continue;
      patch=other;hit=found;state.selectedPatchId=patch.id;renderGroups();break;
    }
  }
  if(!patch||!hit)return false;
  const initial=copyCorners(patchCorners(patch));
  state.transformDrag={patchId:patch.id,hit,start:p,initial,moved:false};
  overlay.setPointerCapture(e.pointerId);
  overlay.style.cursor=hit.kind==='corner'?'crosshair':'grabbing';
  drawOverlay();return true;
}
function moveTransform(p){
  const drag=state.transformDrag;if(!drag)return;
  const patch=state.patches.get(drag.patchId);if(!patch)return;
  const dx=p.x-drag.start.x,dy=p.y-drag.start.y,arr=copyCorners(drag.initial);
  if(drag.hit.kind==='corner'){
    const index=drag.hit.index;
    arr[index]={x:clamp(drag.initial[index].x+dx,0,canvas.width),y:clamp(drag.initial[index].y+dy,0,canvas.height)};
    if(!convexCorners(arr))return;
  }else{
    const xs=arr.map(q=>q.x),ys=arr.map(q=>q.y);
    const tx=clamp(dx,-Math.min(...xs),canvas.width-Math.max(...xs));
    const ty=clamp(dy,-Math.min(...ys),canvas.height-Math.max(...ys));
    for(const q of arr){q.x+=tx;q.y+=ty}
  }
  if(!drag.moved && Math.hypot(dx,dy)<=.25)return;
  if(!drag.moved){
    state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
    if(state.undo.length>12)state.undo.shift();state.redo=[];drag.moved=true;
  }
  patch.corners=arr;render();
}
function endTransform(){
  const drag=state.transformDrag;state.transformDrag=null;overlay.style.cursor='';
  if(drag?.moved){message('Layer moved. Drag corners to skew; Undo to revert.');}
  drawOverlay();
}
function resetPatchTransform(){
  const patch=activeTransformPatch();if(!patch||!patch.corners||window.MosaicPremium?.isPreviewing())return;
  state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
  if(state.undo.length>12)state.undo.shift();state.redo=[];
  patch.corners=null;render();toast('Layer transform reset.');
}

function render(){if(!state.master)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(state.before?(window.MosaicPremium?.originalImage()||state.master):state.master,0,0);
  if(!state.before){if(window.MosaicPremium?.drawArchivePreview(ctx)){drawOverlay();return}for(const group of state.groups){if(!group.active)continue;const patch=state.patches.get(group.active),source=patch&&state.sources.get(patch.sourceId);if(!patch||!source)continue;drawPatch(ctx,patch,source)}
    const pending=state.sources.get(state.pendingSourceId);if(pending)ctx.drawImage(pending.canvas,0,0)}
  drawOverlay()}
function boundaryFromMask(){if(!state.selectionMask)return null;const w=Math.min(540,canvas.width),h=Math.max(1,Math.round(canvas.height/canvas.width*w)),t=makeCanvas(w,h),tc=t.getContext('2d',{willReadFrequently:true});tc.drawImage(state.selectionMask,0,0,w,h);const px=tc.getImageData(0,0,w,h).data;const outline=makeCanvas(w,h),oc=outline.getContext('2d',{willReadFrequently:true}),out=oc.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,filled=px[i*4+3]>110;if(!filled)continue;const left=x===0||px[(i-1)*4+3]<110,right=x===w-1||px[(i+1)*4+3]<110,up=y===0||px[(i-w)*4+3]<110,down=y===h-1||px[(i+w)*4+3]<110;if(!(left||right||up||down))continue;const j=i*4,light=(Math.floor((x+y)/3)%2)===0;out.data[j]=light?255:22;out.data[j+1]=light?255:22;out.data[j+2]=light?255:24;out.data[j+3]=255}oc.putImageData(out,0,0);return outline}
function updateSelectionOutline(){state.boundaryCanvas=boundaryFromMask();drawOverlay()}
function drawOverlay(){ox.clearRect(0,0,overlay.width,overlay.height);if(state.before||window.MosaicPremium?.isPreviewing())return;
  if(state.selectionMask){ox.save();ox.globalAlpha=.16;ox.drawImage(state.selectionMask,0,0);ox.restore();if(state.boundaryCanvas){ox.save();ox.imageSmoothingEnabled=false;ox.drawImage(state.boundaryCanvas,0,0,overlay.width,overlay.height);ox.restore()}}
  const chosen=state.tool==='transform' && !state.pendingSourceId && !state.editingPatchId && activeTransformPatch();
  if(chosen){
    const q=patchCorners(chosen),m=quadCenter(q);
    ox.save();ox.beginPath();q.forEach((p,i)=>i?ox.lineTo(p.x,p.y):ox.moveTo(p.x,p.y));ox.closePath();
    ox.strokeStyle='#c1b3ff';ox.lineWidth=2/state.zoom;ox.setLineDash([8/state.zoom,5/state.zoom]);ox.stroke();ox.setLineDash([]);
    for(let i=0;i<4;i++){const p=q[i],r=7/state.zoom;ox.fillStyle='#f5f0ff';ox.strokeStyle='#6555bd';ox.lineWidth=2/state.zoom;ox.fillRect(p.x-r,p.y-r,r*2,r*2);ox.strokeRect(p.x-r,p.y-r,r*2,r*2)}
    ox.beginPath();ox.arc(m.x,m.y,9/state.zoom,0,Math.PI*2);ox.fillStyle='#6153b8';ox.fill();ox.strokeStyle='#fff';ox.stroke();
    ox.beginPath();ox.moveTo(m.x-4/state.zoom,m.y);ox.lineTo(m.x+4/state.zoom,m.y);ox.moveTo(m.x,m.y-4/state.zoom);ox.lineTo(m.x,m.y+4/state.zoom);ox.lineWidth=1.6/state.zoom;ox.stroke();
    ox.restore();
  }
  const stroke=state.selectionMode==='subtract'?'#ff968e':'#e4e2ff';
  if(state.lasso.length){ox.save();ox.beginPath();state.lasso.forEach((p,i)=>i?ox.lineTo(p.x,p.y):ox.moveTo(p.x,p.y));
    if(state.hoverPoint&&!state.dragFreehand)ox.lineTo(state.hoverPoint.x,state.hoverPoint.y);
    ox.lineWidth=Math.max(1.5,2/state.zoom);ox.strokeStyle=stroke;ox.setLineDash([5/state.zoom,4/state.zoom]);ox.stroke();ox.setLineDash([]);
    if(!state.dragFreehand){const radius=3.5/state.zoom;for(const p of state.lasso){ox.beginPath();ox.arc(p.x,p.y,radius,0,Math.PI*2);ox.fillStyle='#17191f';ox.fill();ox.strokeStyle=stroke;ox.lineWidth=1.5/state.zoom;ox.stroke()}}
    ox.restore()}
  if(state.shapeStart&&state.shapeEnd){const b=shapeBounds(state.shapeStart,state.shapeEnd,state.constrainShape);if(b.w>0&&b.h>0){ox.save();traceShape(ox,b,state.tool);ox.fillStyle=state.selectionMode==='subtract'?'#ff968e24':'#b1aaff27';ox.fill();ox.lineWidth=Math.max(1.5,2/state.zoom);ox.strokeStyle=stroke;ox.setLineDash([5/state.zoom,4/state.zoom]);ox.stroke();ox.restore()}}
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function renderGroups(){const list=$('groupList');$('groupCount').textContent=state.groups.length;
  $('pendingBanner').classList.toggle('hidden',!state.pendingSourceId);if(state.pendingSourceId){const source=state.sources.get(state.pendingSourceId);$('pendingName').textContent=`● Editing: ${source?.name||'New variation'}`}
  if(!state.groups.length){list.innerHTML='<div class="empty-groups"><span>◌</span><strong>No active patches</strong><p>Lasso an area to prompt an AI edit, or import a variation.</p></div>';window.MosaicPremium?.renderHistory(list);return}
  list.innerHTML=state.groups.map(g=>`<div class="region-group" data-group="${g.id}"><div class="group-head" data-action="focus" data-group="${g.id}"><span class="group-icon">▧</span><span class="group-name">${g.name}</span><span class="group-count">${g.patchIds.length} options</span></div><div class="group-options"><div class="variant-row ${g.active===null?'selected':''}" data-action="choose" data-group="${g.id}" data-patch="master"><span class="variant-dot"></span><span class="variant-text">Original master</span></div>${g.patchIds.map((pid,i)=>{const p=state.patches.get(pid);return p?`<div class="variant-row ${g.active===pid?'selected':''}" data-action="choose" data-group="${g.id}" data-patch="${pid}"><span class="variant-dot"></span><span class="variant-text">${escapeHTML(p.name)} <span style="color:#757a88">#${i+1}</span></span><button class="variant-action" title="Edit mask" data-action="edit" data-group="${g.id}" data-patch="${pid}">✎</button><button class="variant-action" title="Delete variant" data-action="delete" data-group="${g.id}" data-patch="${pid}">×</button></div>`:''}).join('')}</div></div>`).join('');window.MosaicPremium?.renderHistory(list)}
function editExisting(pid){if(state.pendingSourceId){toast('Apply or discard your new image before editing saved variants.');return}const patch=state.patches.get(pid);if(!patch)return;state.editingPatchId=pid;state.selectedPatchId=pid;resetSelection();state.selectionMask.getContext('2d').drawImage(patch.mask,0,0);setMode('add');selectTool('lasso');updateSelectionOutline();updateApplyButton();message('Editing a saved mask. Draw New, Add or Subtract, then Enter to update.')}
function groupEvent(e){if(window.MosaicPremium?.handleGroupEvent(e))return;const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,group=state.groups.find(g=>g.id===target.dataset.group),pid=target.dataset.patch;
  if(action==='focus'&&group){if(group.active){state.editingPatchId=null;state.selectedPatchId=group.active;resetSelection();selectTool('transform');renderGroups();render()}return}
  if(action==='edit'){editExisting(pid);return}
  if(action==='choose'&&group){if(state.pendingSourceId){toast('Apply or discard the new image first.');return}state.editingPatchId=null;resetSelection();group.active=pid==='master'?null:pid;state.selectedPatchId=group.active;if(group.active)selectTool('transform');renderGroups();render();return}
  if(action==='delete'&&group){if(state.pendingSourceId){toast('Finish the new image before removing variants.');return}group.patchIds=group.patchIds.filter(x=>x!==pid);state.patches.delete(pid);if(group.active===pid)group.active=group.patchIds.at(-1)||null;if(state.editingPatchId===pid)state.editingPatchId=null;if(state.selectedPatchId===pid)state.selectedPatchId=null;if(!group.patchIds.length)state.groups=state.groups.filter(g=>g.id!==group.id);resetSelection();renderGroups();render();toast('Variant removed.')}}
function selectTool(tool){clearDraft();state.tool=tool;$('resetTransformBtn').classList.toggle('hidden',tool!=='transform');document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool))});$('canvasWrap').className=`canvas-wrap ${tool==='pan'?'pan':tool==='transform'?'transform':tool==='brush'?'brush':tool==='eraser'?'eraser':''}`;drawOverlay()}
function canvasPoint(e){const rect=overlay.getBoundingClientRect();return {x:clamp((e.clientX-rect.left)/rect.width*canvas.width,0,canvas.width),y:clamp((e.clientY-rect.top)/rect.height*canvas.height,0,canvas.height)}}
function snapshotSelection(){if(!state.selectionMask)return;state.undo.push({type:'selection',image:state.selectionMask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});if(state.undo.length>12)state.undo.shift();state.redo=[]}
function snapshotPatch(p){state.undo.push({type:'patch',patchId:p.id,image:p.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});if(state.undo.length>12)state.undo.shift();state.redo=[]}
function commitMaskPath(trace){if(!state.selectionMask)return;const m=state.selectionMask.getContext('2d');snapshotSelection();m.save();
  if(state.selectionMode==='new')m.clearRect(0,0,canvas.width,canvas.height);
  m.globalCompositeOperation=state.selectionMode==='subtract'?'destination-out':'source-over';m.fillStyle='#ffffff';m.beginPath();trace(m);m.closePath();m.fill();m.restore();
  updateSelectionOutline();message('Selection updated. Draw another region with New/Add/Subtract, or press Enter to apply.')}
function updateMaskWithLasso(){const points=state.lasso.filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>.01);
  if(points.length<3||!state.selectionMask)return false;
  commitMaskPath(m=>points.forEach((p,i)=>i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y)));
  clearDraft();drawOverlay();return true}
function shapeBounds(start,end,constrain){let dx=end.x-start.x,dy=end.y-start.y;
  if(constrain){const side=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx)*side;dy=Math.sign(dy)*side}
  return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),w:Math.abs(dx),h:Math.abs(dy)}}
function traceShape(target,b,tool){target.beginPath();if(tool==='rect')target.rect(b.x,b.y,b.w,b.h);
  else target.ellipse(b.x+b.w/2,b.y+b.h/2,b.w/2,b.h/2,0,0,Math.PI*2);target.closePath()}
function updateMaskWithShape(start,end,tool,constrain){const bounds=shapeBounds(start,end,constrain);if(bounds.w<2/state.zoom||bounds.h<2/state.zoom)return;
  commitMaskPath(m=>traceShape(m,bounds,tool))}
function maskBoundingBox(mask){const w=Math.min(250,mask.width),h=Math.max(1,Math.round(w*mask.height/mask.width)),t=makeCanvas(w,h),tx=t.getContext('2d',{willReadFrequently:true});tx.drawImage(mask,0,0,w,h);const d=tx.getImageData(0,0,w,h).data;let minX=w,minY=h,maxX=-1,maxY=-1;for(let i=0;i<w*h;i++)if(d[i*4+3]>80){const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}return maxX<0?null:{x:minX/w*canvas.width,y:minY/h*canvas.height,w:(maxX-minX+1)/w*canvas.width,h:(maxY-minY+1)/h*canvas.height}}
function applySelection(){if(state.lasso.length){if(!updateMaskWithLasso()){toast('Add at least three lasso points, then click the first point or double-click to close.');return}}if(!state.selectionMask)return;const bbox=maskBoundingBox(state.selectionMask);if(!bbox){toast('Draw or brush a selection first.');return}
  if(state.pendingSourceId){const src=state.sources.get(state.pendingSourceId),mask=makeCanvas(canvas.width,canvas.height);mask.getContext('2d').drawImage(state.selectionMask,0,0);const patch={id:uid('patch'),sourceId:src.id,mask,bbox,name:src.name},group=assignGroup(patch);state.pendingSourceId=null;state.editingPatchId=null;resetSelection();state.undo=[];state.redo=[];toast(`Saved as ${group.name}. Similar masks become alternatives.`);message('Selection saved. Upload another image or switch variants on the left.');renderGroups();render();window.MosaicPremium?.onPatchApplied();loadNextVariant();return}
  if(state.editingPatchId){const patch=state.patches.get(state.editingPatchId);if(!patch)return;snapshotPatch(patch);const t=patch.mask.getContext('2d');t.clearRect(0,0,canvas.width,canvas.height);t.drawImage(state.selectionMask,0,0);patch.bbox=bbox;patchTextures.delete(patch);state.editingPatchId=null;state.selectedPatchId=patch.id;resetSelection();toast('Mask updated. Other layers were not changed.');renderGroups();render()}}
function paint(e,first){const point=canvasPoint(e),r=+$('brushSize').value;
  const mask=state.pendingSourceId||state.editingPatchId?state.selectionMask:state.patches.get(state.selectedPatchId)?.mask;if(!mask){toast('Add an image or choose a saved variant to edit.');return}
  const mc=mask.getContext('2d');mc.save();mc.globalCompositeOperation=state.tool==='eraser'?'destination-out':'source-over';mc.fillStyle='#fff';mc.strokeStyle='#fff';mc.lineWidth=r;mc.lineCap='round';mc.lineJoin='round';if(first||!state.lastPoint){mc.beginPath();mc.arc(point.x,point.y,r/2,0,Math.PI*2);mc.fill()}else{mc.beginPath();mc.moveTo(state.lastPoint.x,state.lastPoint.y);mc.lineTo(point.x,point.y);mc.stroke()}mc.restore();state.lastPoint=point;
  if(mask===state.selectionMask){state.boundaryCanvas=null;drawOverlay()}else{const patch=state.patches.get(state.selectedPatchId);patch.bbox=maskBoundingBox(mask)||patch.bbox;patchTextures.delete(patch);render()}}
function historyStep(from,to){const entry=from.pop();if(!entry)return;if(entry.type==='transform'){const p=state.patches.get(entry.patchId);if(!p)return;to.push({type:'transform',patchId:p.id,corners:copyCorners(p.corners)});p.corners=copyCorners(entry.corners);render();return}const mask=entry.type==='selection'?state.selectionMask:state.patches.get(entry.patchId)?.mask;if(!mask)return;to.push({...entry,image:mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});mask.getContext('2d').putImageData(entry.image,0,0);if(entry.type==='selection')updateSelectionOutline();else{const p=state.patches.get(entry.patchId);p.bbox=maskBoundingBox(mask)||p.bbox;patchTextures.delete(p);render()}}
function updateZoomFit(){if(!state.master)return;const v=$('viewport');state.fitZoom=Math.max(.08,Math.min((v.clientWidth-40)/canvas.width,(v.clientHeight-40)/canvas.height,1));setZoom(state.fitZoom)}
function setZoom(z){state.zoom=clamp(z,.08,4);$('canvasWrap').style.width=Math.round(canvas.width*state.zoom)+'px';$('canvasWrap').style.height=Math.round(canvas.height*state.zoom)+'px';canvas.style.width=overlay.style.width='100%';canvas.style.height=overlay.style.height='100%';$('zoomValue').textContent=Math.round(state.zoom*100)+'%'}
function canMask(){return Boolean(state.pendingSourceId||state.editingPatchId||(['lasso','rect','ellipse'].includes(state.tool)&&window.MosaicPremium?.canSelectArea()))}
function pointerDown(e){if(!state.master||state.busy||state.before||e.button!==0&&e.pointerType==='mouse')return;
  if(state.tool==='transform'){const p=canvasPoint(e);beginTransform(e,p);return}
  if(state.tool==='pan'){state.panAnchor={x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};overlay.setPointerCapture(e.pointerId);return}
  if(!state.pendingSourceId&&!state.editingPatchId&&['lasso','rect','ellipse','brush','eraser'].includes(state.tool)){
    if(window.MosaicPremium?.canSelectArea()&&['lasso','rect','ellipse'].includes(state.tool)){state.selectedPatchId=null}
    else if(state.selectedPatchId){const originalTool=state.tool;editExisting(state.selectedPatchId);selectTool(originalTool)}
    else{toast('Upload a variation to begin masking.');return}}
  const p=canvasPoint(e);state.drawing=true;overlay.setPointerCapture(e.pointerId);
  if(state.tool==='lasso'){state.pointerStart=p;state.dragFreehand=false;state.hoverPoint=p;if(!state.lasso.length)state.lasso=[p];drawOverlay()}
  else if(state.tool==='rect'||state.tool==='ellipse'){state.shapeStart=p;state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='brush'||state.tool==='eraser'){snapshotSelection();state.lastPoint=null;paint(e,true)}
}
function pointerMove(e){if(state.tool==='transform'){if(state.transformDrag){moveTransform(canvasPoint(e))}else{const patch=activeTransformPatch(),hit=patch&&transformHit(canvasPoint(e),patch);overlay.style.cursor=hit?(hit.kind==='corner'?'crosshair':'move'):'default'}return}if(state.tool==='pan'&&state.panAnchor){$('viewport').scrollLeft=state.panAnchor.left-(e.clientX-state.panAnchor.x);$('viewport').scrollTop=state.panAnchor.top-(e.clientY-state.panAnchor.y);return}
  const p=canvasPoint(e);
  if(state.tool==='lasso'){if(!state.drawing){if(state.lasso.length){state.hoverPoint=p;drawOverlay()}return}
    const threshold=5/state.zoom;
    if(!state.dragFreehand&&state.pointerStart&&Math.hypot(p.x-state.pointerStart.x,p.y-state.pointerStart.y)>threshold){
      state.dragFreehand=true;const last=state.lasso.at(-1);if(Math.hypot(state.pointerStart.x-last.x,state.pointerStart.y-last.y)>0.5/state.zoom)state.lasso.push(state.pointerStart)}
    if(state.dragFreehand){const last=state.lasso.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>2/state.zoom)state.lasso.push(p)}
    state.hoverPoint=p;drawOverlay();return}
  if(!state.drawing)return;
  if(state.tool==='rect'||state.tool==='ellipse'){state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='brush'||state.tool==='eraser')paint(e,false)}
function pointerUp(e){if(state.tool==='transform'){endTransform();return}if(state.tool==='pan'){state.panAnchor=null;return}if(!state.drawing)return;
  const p=canvasPoint(e),tool=state.tool;state.drawing=false;state.lastPoint=null;
  if(tool==='lasso'){if(state.dragFreehand){const last=state.lasso.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>0.1/state.zoom)state.lasso.push(p);updateMaskWithLasso()}
    else if(state.pointerStart){const first=state.lasso[0],nearFirst=state.lasso.length>=3&&Math.hypot(p.x-first.x,p.y-first.y)<=10/state.zoom;
      if(nearFirst)updateMaskWithLasso();
      else if(Math.hypot(p.x-state.lasso.at(-1).x,p.y-state.lasso.at(-1).y)>0.5/state.zoom){state.lasso.push(p);state.hoverPoint=p;drawOverlay()}}
    state.pointerStart=null;state.dragFreehand=false}
  else if(tool==='rect'||tool==='ellipse'){if(state.shapeStart)updateMaskWithShape(state.shapeStart,p,tool,e.shiftKey);state.shapeStart=null;state.shapeEnd=null;drawOverlay()}
  else if(tool==='brush'||tool==='eraser'){if(state.selectionMask)updateSelectionOutline();render()}
  renderGroups()}
function pointerCancel(){if(state.tool==='transform'){endTransform();return}if(state.tool==='pan')state.panAnchor=null;
  if(state.drawing){state.drawing=false;state.lastPoint=null;state.pointerStart=null;state.shapeStart=null;state.shapeEnd=null;if(state.dragFreehand)state.lasso=[];state.dragFreehand=false;drawOverlay()}}
function onKeys(e){if(e.target.matches('input,textarea')||e.repeat&&e.key==='Enter')return;
  if(e.key==='Enter'){if(window.MosaicPremium?.canSelectArea()){if(state.lasso.length>=3){e.preventDefault();updateMaskWithLasso()}}
    else if(state.pendingSourceId||state.editingPatchId){e.preventDefault();applySelection()}}
  else if(e.key==='Escape'){e.preventDefault();if(state.lasso.length||state.shapeStart){clearDraft();drawOverlay();message('Unfinished shape canceled.')}else{resetSelection();render();message('Selection cleared.')}}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyStep(state.undo,state.redo)}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyStep(state.redo,state.undo)}
  else if(e.key==='['){setMode('subtract')}else if(e.key===']'){setMode('add')}}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return(crc^0xffffffff)>>>0}
const u16=(d,v,o)=>d.setUint16(o,v,true),u32=(d,v,o)=>d.setUint32(o,v>>>0,true);
function makeZip(files){const enc=new TextEncoder(),locals=[],dirs=[];let offset=0;for(const file of files){const name=enc.encode(file.name),data=file.bytes,crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);u32(v,0x04034b50,0);u16(v,20,4);u16(v,0,6);u16(v,0,8);u16(v,0,10);u16(v,0,12);u32(v,crc,14);u32(v,data.length,18);u32(v,data.length,22);u16(v,name.length,26);u16(v,0,28);local.set(name,30);locals.push(local,data);
 const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);u32(d,0x02014b50,0);u16(d,20,4);u16(d,20,6);u16(d,0,8);u16(d,0,10);u16(d,0,12);u16(d,0,14);u32(d,crc,16);u32(d,data.length,20);u32(d,data.length,24);u16(d,name.length,28);u16(d,0,30);u16(d,0,32);u16(d,0,34);u16(d,0,36);u32(d,0,38);u32(d,offset,42);dir.set(name,46);dirs.push(dir);offset+=local.length+data.length}const dirLen=dirs.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);u32(e,0x06054b50,0);u16(e,0,4);u16(e,0,6);u16(e,files.length,8);u16(e,files.length,10);u32(e,dirLen,12);u32(e,offset,16);return new Blob([...locals,...dirs,end],{type:'application/zip'})}
const asBlob=c=>new Promise((res,rej)=>c.toBlob(blob=>blob?res(blob):rej(Error('PNG export failed')),'image/png'));
async function exportZip(){if(!state.master){toast('Upload a master image first.');return}if(!state.reference){toast('Add Base before exporting.');return}if(state.pendingSourceId||state.editingPatchId){toast('Apply or discard the current selection before exporting.');return}
 const btn=$('exportBtn');btn.disabled=true;btn.textContent='Preparing ZIP…';try{const ref=await asBlob(state.reference),wasBefore=state.before;state.before=false;render();const comp=await asBlob(canvas);state.before=wasBefore;render();const files=[{name:'01_Base.png',bytes:new Uint8Array(await ref.arrayBuffer())},{name:'02_Final_Collage.png',bytes:new Uint8Array(await comp.arrayBuffer())},{name:'03_Harmonization_Prompt.txt',bytes:new TextEncoder().encode(window.MosaicPremium?.exportPrompt() || promptText())}],blob=makeZip(files),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Mosaic_Harmonization_Package.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Exported Base + collage + prompt.')}catch(e){toast('Export failed: '+e.message)}finally{btn.disabled=false;btn.innerHTML='<span class="icon">↧</span> Export package'}}
// File inputs and editing controls.
$('referenceInput').addEventListener('change',async e=>{await importReference(e.target.files[0]);e.target.value=''});
$('masterInput').addEventListener('change',async e=>{await importMaster(e.target.files[0]);e.target.value=''});
$('variantInput').addEventListener('change',async e=>{await importVariants(e.target.files);e.target.value=''});
for(const id of ['addImagesBtn','newVariantBtn'])$(id).addEventListener('click',()=>state.master?$('variantInput').click():toast('Upload a master first.'));
$('quickMasterBtn').addEventListener('click',()=>$('masterInput').click());$('quickRevitBtn').addEventListener('click',()=>$('referenceInput').click());
$('welcomeStart').addEventListener('click',()=>$('referenceInput').click());$('welcomeRevit').addEventListener('click',()=>$('masterInput').click());
$('discardPendingBtn').addEventListener('click',discardPending);$('exportBtn').addEventListener('click',exportZip);
$('groupList').addEventListener('click',groupEvent);
$('tools').addEventListener('click',e=>{const tool=e.target.closest('[data-tool]'),mode=e.target.closest('[data-mode]');if(tool)selectTool(tool.dataset.tool);if(mode)setMode(mode.dataset.mode)});
$('brushSize').addEventListener('input',e=>$('brushValue').textContent=e.target.value);
$('commitBtn').addEventListener('click',applySelection);
$('undoBtn').addEventListener('click',()=>historyStep(state.undo,state.redo));$('redoBtn').addEventListener('click',()=>historyStep(state.redo,state.undo));
$('clearSelectionBtn').addEventListener('click',()=>{resetSelection();render();message('Selection cleared.')});
$('resetTransformBtn').addEventListener('click',resetPatchTransform);
$('inspectorToggle').addEventListener('click',()=>{
  const panel=$('inspectorPanel'),collapsed=panel.classList.toggle('is-collapsed'),toggle=$('inspectorToggle');
  document.querySelector('.workspace').classList.toggle('inspector-collapsed',collapsed);
  toggle.textContent=collapsed?'›':'−';
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Expand guide':'Minimize guide');
  toggle.title=collapsed?'Expand guide':'Minimize guide';
  const wasFit=state.master&&Math.abs(state.zoom-state.fitZoom)<.001;
  if(wasFit)requestAnimationFrame(updateZoomFit);
});
$('zoomIn').addEventListener('click',()=>setZoom(state.zoom*1.25));$('zoomOut').addEventListener('click',()=>setZoom(state.zoom/1.25));$('zoomFit').addEventListener('click',updateZoomFit);
const compare=$('beforeBtn');let compareTap=false;
compare.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||window.matchMedia('(hover: none)').matches){compareTap=true;return}compareTap=false;state.before=true;compare.classList.add('comparing');render()});
compare.addEventListener('click',()=>{if(compareTap){state.before=!state.before;compare.classList.toggle('comparing',state.before);render();compareTap=false}});
for(const type of ['pointerup','pointercancel','pointerleave'])compare.addEventListener(type,()=>{if(!compareTap){state.before=false;compare.classList.remove('comparing');render()}});
window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse'&&!compareTap&&state.before){state.before=false;compare.classList.remove('comparing');render()}});
// Touch and mouse drawing both use Pointer Events.
for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])$('overlayCanvas').addEventListener(type,{pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerCancel}[type]);
overlay.addEventListener('dblclick',e=>{if(state.tool==='lasso'&&state.lasso.length>=3){e.preventDefault();updateMaskWithLasso()}});
window.addEventListener('keydown',onKeys);window.addEventListener('resize',()=>state.master&&updateZoomFit());
for(const id of ['copyPromptBtn','copyPromptSecondary'])$(id).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(promptText());toast('Prompt copied.')}catch{toast('Clipboard unavailable. Select prompt from the panel.')}});
const viewport=$('viewport');viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('dropping')});viewport.addEventListener('dragleave',()=>viewport.classList.remove('dropping'));viewport.addEventListener('drop',async e=>{e.preventDefault();viewport.classList.remove('dropping');const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));if(!state.master){if(files[0])await importReference(files[0]);if(files.length>1)await importVariants(files.slice(1))}else await importVariants(files)});
window.MosaicCore = {state,canvas,overlay,ctx,makeCanvas,uid,toast,message,promptText,loadFileToCanvas,setMaster,render,renderGroups,drawPatch,selectTool,maskBoundingBox,assignGroup,resetSelection,updateMaskWithLasso,updateZoomFit,selectTool,escapeHTML};
promptText();