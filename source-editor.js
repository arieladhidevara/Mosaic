/* Mosaic inline source editor: align any image on the working canvas with a 20% ghost and bounding box. */
const core=window.MosaicCore;
if(!core)throw Error('Mosaic core is required');
const {state,canvas,overlay,ctx,makeCanvas,toast,render,updateZoomFit,setSourcePreview,updateSourceActions}=core;
const $=id=>document.getElementById(id);
const stage=$('sourceEditOverlay'),paint=stage.getContext('2d');
const panel=$('sourceEditorPanel'),inspector=$('inspectorPanel');
let editing=null,drag=null;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function inspectorTitle(text){
  const heading=$('inspectorHeading'),count=$('groupCount');
  heading.replaceChildren(document.createTextNode(text));
  if(count)heading.append(document.createTextNode(' '),count);
}
function syncControls(){
  if(!editing)return;
  const t=editing.transform;
  $('sourceEditScale').value=Math.round(t.scale*100);
  $('sourceEditScaleValue').textContent=Math.round(t.scale*100)+'%';
  $('sourceEditRotation').value=Math.round(t.rotation);
  $('sourceEditRotationValue').textContent=Math.round(t.rotation)+'°';
  $('sourceEditX').value=Math.round(t.x);$('sourceEditY').value=Math.round(t.y);
  $('sourceEditOpacity').value=Math.round(t.opacity*100);
  $('sourceEditOpacityValue').textContent=Math.round(t.opacity*100)+'%';
}
function fittedDimensions(image){
  const fit=Math.min(1,canvas.width/image.width,canvas.height/image.height);
  return {w:image.width*fit,h:image.height*fit};
}
function transformedPoint(point,image,t){
  const fit=fittedDimensions(image),r=t.rotation*Math.PI/180;
  const x=(point.x-image.width/2)*fit.w/image.width*t.scale,y=(point.y-image.height/2)*fit.h/image.height*t.scale;
  return {x:canvas.width/2+t.x+Math.cos(r)*x-Math.sin(r)*y,y:canvas.height/2+t.y+Math.sin(r)*x+Math.cos(r)*y};
}
function drawTransformed(target,image,t,opacity=1){
  const {w,h}=fittedDimensions(image);
  target.save();target.translate(canvas.width/2+t.x,canvas.height/2+t.y);
  target.rotate(t.rotation*Math.PI/180);target.scale(t.scale,t.scale);
  target.globalAlpha=opacity;
  target.drawImage(image,-w/2,-h/2,w,h);
  target.restore();
}
function corners(){
  const t=editing.transform,fit=fittedDimensions(editing.image),w=fit.w/2*t.scale,h=fit.h/2*t.scale;
  const radians=t.rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const center={x:canvas.width/2+t.x,y:canvas.height/2+t.y};
  return [[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>({x:center.x+c*x-s*y,y:center.y+s*x+c*y}));
}
function imageAt(point){
  const t=editing.transform,cx=canvas.width/2+t.x,cy=canvas.height/2+t.y;
  const dx=point.x-cx,dy=point.y-cy,r=-t.rotation*Math.PI/180;
  const x=(dx*Math.cos(r)-dy*Math.sin(r))/t.scale;
  const y=(dx*Math.sin(r)+dy*Math.cos(r))/t.scale;
  const fit=fittedDimensions(editing.image);
  return Math.abs(x)<=fit.w/2&&Math.abs(y)<=fit.h/2;
}
function baseBackground(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(editing.kind==='base'&&state.master){
    ctx.drawImage(state.master,0,0,canvas.width,canvas.height);return;
  }
  if(editing.kind==='master'&&state.reference){
    drawTransformed(ctx,state.reference,{x:0,y:0,scale:1,rotation:0},1);return;
  }
  if(editing.kind==='source'){
    if(state.master)ctx.drawImage(state.master,0,0);
    for(const group of state.groups){
      const patch=state.patches.get(group.active);
      if(!patch||patch.id===editing.patchId)continue;
      const source=state.sources.get(patch.sourceId);
      if(source)core.drawPatch(ctx,patch,source);
    }
    return;
  }
  if(state.master&&editing.kind!=='master')ctx.drawImage(state.master,0,0);
  else if(state.reference&&editing.kind!=='base')ctx.drawImage(state.reference,0,0,canvas.width,canvas.height);
}
function redraw(){
  if(!editing)return;
  stage.width=canvas.width;stage.height=canvas.height;
  baseBackground();
  paint.clearRect(0,0,stage.width,stage.height);
  drawTransformed(paint,editing.image,editing.transform,editing.transform.opacity);
  const points=corners();
  paint.save();paint.strokeStyle='#b49bff';paint.lineWidth=2/Math.max(.25,state.zoom);
  paint.setLineDash([7/Math.max(.25,state.zoom),5/Math.max(.25,state.zoom)]);
  paint.beginPath();points.forEach((p,i)=>i?paint.lineTo(p.x,p.y):paint.moveTo(p.x,p.y));
  paint.closePath();paint.stroke();paint.setLineDash([]);
  const radius=3/Math.max(.25,state.zoom);
  for(const p of points){
    paint.fillStyle='#faf7ff';paint.strokeStyle='#8067cf';
    paint.fillRect(p.x-radius,p.y-radius,radius*2,radius*2);
    paint.strokeRect(p.x-radius,p.y-radius,radius*2,radius*2);
  }
  paint.font='bold '+Math.round(12/Math.max(.25,state.zoom))+'px sans-serif';
  paint.fillStyle='#d1c2ff';
  paint.fillText(editing.label,Math.max(6,points[0].x),Math.max(14,points[0].y-12));
  paint.restore();
}
function start(kind,patchId=null){
  if(state.busy||state.editingPatchId){toast('Finish the current mask edit first.');return}
  if(editing)cancel();
  let original,sourceId=null,label='',optionMask=null,optionPoints=[],optionPaths=[],startingTransform=null;
  if(kind==='base'){original=state.reference;label='BASE'}
  else if(kind==='master'){original=state.master;label='MASTER'}
  else if(kind==='source'){
    const patch=patchId?state.patches.get(patchId):null;
    sourceId=patch?.sourceId||state.pendingSourceId;
    original=state.sources.get(sourceId)?.canvas;
    label=patch?.name||state.sources.get(sourceId)?.name||'NEW IMAGE';
    if(patch&&original){
      // Edit a selected option as ONE object: its visible pixels and its
      // four-corner-warped mask share the same local bounding rectangle.
      const visible=core.renderedPatchLayer(patch),mask=core.displayedPatchMask(patch);
      const bounds=core.maskBoundingBox(mask);
      if(bounds){
        const x=Math.floor(bounds.x),y=Math.floor(bounds.y);
        const w=Math.max(1,Math.min(canvas.width-x,Math.ceil(bounds.x+bounds.w)-x));
        const h=Math.max(1,Math.min(canvas.height-y,Math.ceil(bounds.y+bounds.h)-y));
        original=makeCanvas(w,h);original.getContext('2d').drawImage(visible,-x,-y);
        optionPaths=core.patchSelectionPaths(patch).map(path=>path.map(point=>({x:point.x-x,y:point.y-y})));
        optionPoints=core.patchControlPoints(patch).map(point=>({x:point.x-x,y:point.y-y}));
        optionMask=makeCanvas(w,h);optionMask.getContext('2d').drawImage(mask,-x,-y);
        startingTransform={x:x+w/2-canvas.width/2,y:y+h/2-canvas.height/2,scale:1,rotation:0,opacity:.20};
      }
    }
  }
  if(!original){toast('Upload an image before editing it.');return}
  const wasBaseOnly=Boolean(!state.master);
  if(wasBaseOnly){
    canvas.width=overlay.width=original.width;
    canvas.height=overlay.height=original.height;
    $('selectionDraft').setAttribute('viewBox','0 0 '+canvas.width+' '+canvas.height);
    $('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden');
    // The ordinary Fit tool requires a Master; fit a Base-only editing preview manually.
    const viewport=$('viewport'),margin=window.innerWidth<=730?72:124;
    const z=clamp(Math.min((viewport.clientWidth-margin)/canvas.width,(viewport.clientHeight-margin)/canvas.height,1),.08,4);
    state.zoom=z;
    $('canvasWrap').style.width=Math.round(canvas.width*z)+'px';
    $('canvasWrap').style.height=Math.round(canvas.height*z)+'px';
    canvas.style.width=overlay.style.width='100%';canvas.style.height=overlay.style.height='100%';
    $('zoomValue').textContent='Fit';
  }
  const guideWasCollapsed=inspector.classList.contains('is-collapsed');
  if(guideWasCollapsed){$('inspectorToggle').click()}
  editing={kind,patchId,sourceId,image:original,label,optionMask,optionPoints,optionPaths,
    wasBaseOnly,initialTransform:startingTransform||{x:0,y:0,scale:1,rotation:0,opacity:.20},
    transform:{...(startingTransform||{x:0,y:0,scale:1,rotation:0,opacity:.20})}};
  inspector.classList.add('source-editor-active');
  document.querySelector('.workspace').classList.add('source-editor-in-progress');
  inspectorTitle('IMAGE EDIT');
  panel.classList.remove('hidden');
  $('sourceEditTitle').textContent='Edit '+label;
  stage.classList.add('active');
  core.hideQuickPrompt();core.message('Drag the 20% ghost image or resize its corner handles. Apply saves this image position.');
  syncControls();redraw();
}
async function openOption(id){
  const patch=state.patches.get(id);
  if(!patch){toast('Option not found.');return}
  const source=state.sources.get(patch.sourceId);
  if(source&&!source.canvas){
    try{await window.MosaicDiskCache?.ensure?.(source,'canvas');}
    catch(error){toast('Cannot load Option for editing: '+error.message);return}
  }
  start('source',id);
}
function reset(){if(!editing)return;editing.transform={...editing.initialTransform};syncControls();redraw()}
function finish(){
  stage.classList.remove('active');paint.clearRect(0,0,stage.width,stage.height);
  panel.classList.add('hidden');inspector.classList.remove('source-editor-active');
  document.querySelector('.workspace').classList.remove('source-editor-in-progress');
  inspectorTitle('GROUPS');editing=null;drag=null;
  if(!state.master){$('welcome').classList.remove('hidden');$('canvasWrap').classList.add('hidden');ctx.clearRect(0,0,canvas.width,canvas.height)}
  else{render();updateSourceActions()}
}
function cancel(){if(!editing)return;finish();core.message('Image edit cancelled.')}
function apply(){
  if(!editing)return;
  const current=editing;
  const raster=makeCanvas(canvas.width,canvas.height),rc=raster.getContext('2d');
  drawTransformed(rc,current.image,current.transform,1);
  if(current.kind==='base'){
    state.reference=raster;setSourcePreview('basePreview',raster);setSourcePreview('welcomeBaseThumb',raster);
    window.MosaicPremium?.onSourceEdited?.('base',raster);
  }else if(current.kind==='master'){
    state.master=raster;setSourcePreview('masterPreview',raster);
    window.MosaicPremium?.onSourceEdited?.('master',raster);
  }else if(current.kind==='source'){
    const patch=current.patchId?state.patches.get(current.patchId):null;
    const source=state.sources.get(current.sourceId);
    if(patch&&source){
      // Bake this option's pixels AND its displayed mask through the same
      // transform. Never move the pixels while leaving the selection behind.
      const transformedMask=makeCanvas(canvas.width,canvas.height);
      drawTransformed(transformedMask.getContext('2d'),current.optionMask||core.displayedPatchMask(patch),current.transform,1);
      const id=core.uid('source_edit');
      state.sources.set(id,{id,name:source.name+' edited',canvas:raster});
      patch.sourceId=id;patch.mask=transformedMask;
      patch.bbox=core.maskBoundingBox(transformedMask)||patch.bbox;
      patch.maskPaths=current.optionPaths.map(path=>path.map(point=>transformedPoint(point,current.image,current.transform)));
      patch.maskPoints=current.optionPoints.map(point=>transformedPoint(point,current.image,current.transform));
      patch.corners=null; // Previous warp is now included in the raster and mask.
      core.invalidateDisplayedMask(patch);
      const group=state.groups.find(g=>g.patchIds.includes(patch.id));
      if(group)core.refreshGroupFootprint(group);
      core.renderGroups();
    }else if(source){
      source.canvas=raster;
      if(state.pendingSourceId&&state.selectionMask&&core.maskBoundingBox(state.selectionMask)){
        const movedSelection=makeCanvas(canvas.width,canvas.height);
        drawTransformed(movedSelection.getContext('2d'),state.selectionMask,current.transform,1);
        state.selectionMask=movedSelection;
        state.selectionPaths=(state.selectionPaths||[]).map(path=>path.map(point=>transformedPoint(point,current.image,current.transform)));
        state.selectionPoints=(state.selectionPoints||[]).map(point=>transformedPoint(point,current.image,current.transform));
        core.updateSelectionOutline();
      }
    }
  }
  finish();updateSourceActions();
  if(current.kind==='source'&&current.patchId===state.selectionTargetPatchId){
    const group=state.groups.find(g=>g.active===current.patchId);if(group)core.selectGroupMask(group);
  }
  toast(current.label+' image position updated.');
}
function point(e){
  const bounds=stage.getBoundingClientRect();
  return {x:(e.clientX-bounds.left)*canvas.width/bounds.width,y:(e.clientY-bounds.top)*canvas.height/bounds.height};
}
stage.addEventListener('pointerdown',e=>{
  if(!editing)return;
  e.stopPropagation();
  if(e.button!==0&&e.pointerType==='mouse')return;
  e.stopPropagation();
  const p=point(e),q=corners(),radius=13/Math.max(.25,state.zoom);
  const index=q.findIndex(c=>Math.hypot(p.x-c.x,p.y-c.y)<=radius);
  if(index<0&&!imageAt(p))return;
  const t=editing.transform;
  drag={id:e.pointerId,type:index>=0?'scale':'move',start:p,
    original:{...t},distance:Math.hypot(p.x-canvas.width/2-t.x,p.y-canvas.height/2-t.y)};
  e.preventDefault();e.stopPropagation();stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove',e=>{
  if(!editing)return;
  e.stopPropagation();
  const p=point(e),q=corners();
  if(!drag){
    const near=q.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<13/Math.max(.25,state.zoom));
    stage.style.cursor=near?'nwse-resize':imageAt(p)?'move':'default';return;
  }
  if(drag.id!==e.pointerId)return;
  if(drag.type==='move'){
    editing.transform.x=drag.original.x+p.x-drag.start.x;
    editing.transform.y=drag.original.y+p.y-drag.start.y;
  }else{
    const d=Math.hypot(p.x-canvas.width/2-drag.original.x,p.y-canvas.height/2-drag.original.y);
    editing.transform.scale=clamp(drag.original.scale*(d/Math.max(1,drag.distance)),.2,3);
  }
  syncControls();redraw();e.preventDefault();e.stopPropagation();
});
for(const name of ['pointerup','pointercancel'])stage.addEventListener(name,e=>{if(editing){e.stopPropagation();if(drag&&drag.id===e.pointerId)drag=null}});
$('editBaseBtn').addEventListener('click',()=>start('base'));
$('editMasterBtn').addEventListener('click',()=>start('master'));
$('editPendingBtn').addEventListener('click',()=>start('source'));
$('sourceEditApply').addEventListener('click',apply);
$('sourceEditCancel').addEventListener('click',cancel);
$('sourceEditReset').addEventListener('click',reset);
for(const [id,key,transform] of [
  ['sourceEditOpacity','opacity',n=>n/100],['sourceEditScale','scale',n=>n/100],
  ['sourceEditRotation','rotation',n=>n],['sourceEditX','x',n=>n],['sourceEditY','y',n=>n]]){
  $(id).addEventListener('input',e=>{
    if(!editing)return;const value=Number(e.target.value);
    if(!Number.isFinite(value))return;
    editing.transform[key]=transform(value);
    syncControls();redraw();
  });
}
window.addEventListener('keydown',e=>{
  if(!editing)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel()}
  else if(e.key==='Enter'&&!e.target.matches('input,textarea')){e.preventDefault();e.stopImmediatePropagation();apply()}
},true);
window.addEventListener('resize',()=>editing&&redraw());
function visibleImage(){
  if(!editing)return null;
  const out=makeCanvas(canvas.width,canvas.height),target=out.getContext('2d');target.drawImage(canvas,0,0);
  drawTransformed(target,editing.image,editing.transform,editing.transform.opacity);return out;
}
window.MosaicSourceEditor={open:start,openOption,cancel,apply,visibleImage,isEditing:()=>Boolean(editing)};
