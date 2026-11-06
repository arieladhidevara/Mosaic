/* Mosaic source alignment — non-destructive two-image registration before region edits. */
const core=window.MosaicCore;
if(!core)throw Error('Mosaic core is required for source alignment.');
const {state,canvas,makeCanvas,toast,render,resetSelection,setSourcePreview,updateSourceActions}=core;
const $=id=>document.getElementById(id);
const dialog=$('alignmentDialog'),preview=$('alignmentPreviewCanvas'),context=preview.getContext('2d');
const defaultTransform=()=>({x:0,y:0,scale:1,rotation:0});
let transforms={base:defaultTransform(),master:defaultTransform()},active='base',drag=null;
function inputCanvas(kind){return kind==='base'?state.rawBase:state.rawMaster}
function dimensions(){return {width:canvas.width,height:canvas.height}}
function drawSource(target,source,t,w,h){
  if(!source)return;
  const fit=Math.min(w/source.width,h/source.height)*t.scale;
  target.save();target.translate(w/2+t.x,h/2+t.y);
  target.rotate(t.rotation*Math.PI/180);
  target.scale(fit,fit);
  target.drawImage(source,-source.width/2,-source.height/2);
  target.restore();
}
function aligned(source,t){
  const {width,height}=dimensions(),output=makeCanvas(width,height);
  drawSource(output.getContext('2d'),source,t,width,height);
  return output;
}
function showPreview(){
  if(!state.rawBase||!state.rawMaster)return;
  const {width,height}=dimensions(),max=720;
  const factor=Math.min(1,max/Math.max(width,height));
  preview.width=Math.max(1,Math.round(width*factor));
  preview.height=Math.max(1,Math.round(height*factor));
  const ctx=context;
  ctx.clearRect(0,0,preview.width,preview.height);
  ctx.save();ctx.scale(preview.width/width,preview.height/height);
  const grid=32;ctx.fillStyle='#181b24';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#222634';
  for(let y=0;y<height;y+=grid)for(let x=(Math.round(y/grid)%2)*grid;x<width;x+=grid*2)ctx.fillRect(x,y,grid,grid);
  ctx.globalAlpha=active==='master'?.72:.85;drawSource(ctx,state.rawMaster,transforms.master,width,height);
  ctx.globalAlpha=active==='base'?.50:.40;drawSource(ctx,state.rawBase,transforms.base,width,height);
  ctx.restore();
  const t=transforms[active];
  $('alignmentScale').value=String(Math.round(t.scale*100));
  $('alignmentRotation').value=String(t.rotation);
  $('alignmentScaleValue').textContent=Math.round(t.scale*100)+'%';
  $('alignmentRotationValue').textContent=t.rotation+'°';
  $('alignmentX').value=String(Math.round(t.x));
  $('alignmentY').value=String(Math.round(t.y));
  $('alignEditBase').classList.toggle('active',active==='base');
  $('alignEditMaster').classList.toggle('active',active==='master');
}
function open(){
  if(!state.rawBase||!state.rawMaster||state.masterIsBase){toast('Upload both Base and Master to align.');return}
  if(state.groups.length||state.pendingSourceId||state.editingPatchId){toast('Finish masking before aligning; alignment is available before creating regions.');return}
  transforms=state.alignmentTransforms?structuredClone(state.alignmentTransforms):{base:defaultTransform(),master:defaultTransform()};
  active='base';drag=null;
  dialog.showModal();showPreview();
}
function close(){drag=null;if(dialog.open)dialog.close()}
function apply(){
  if(!state.rawBase||!state.rawMaster)return;
  if(state.groups.length||state.pendingSourceId){toast('Finish all region edits before aligning.');return}
  const base=aligned(state.rawBase,transforms.base),master=aligned(state.rawMaster,transforms.master);
  state.reference=base;state.master=master;
  state.alignmentTransforms=structuredClone(transforms);
  state.before=false;
  resetSelection();
  setSourcePreview('basePreview',base);setSourcePreview('masterPreview',master);
  window.MosaicPremium?.onSourcesAligned?.(base,master);
  updateSourceActions();render();close();
  toast('Base and Master aligned. New masks and AI prompts use this registered view.');
}
$('alignSourcesBtn').addEventListener('click',open);
$('alignEditBase').addEventListener('click',()=>{active='base';showPreview()});
$('alignEditMaster').addEventListener('click',()=>{active='master';showPreview()});
$('alignReset').addEventListener('click',()=>{transforms[active]=defaultTransform();showPreview()});
$('alignmentCancel').addEventListener('click',close);
$('alignmentApply').addEventListener('click',apply);
$('alignmentScale').addEventListener('input',e=>{transforms[active].scale=Number(e.target.value)/100;showPreview()});
$('alignmentRotation').addEventListener('input',e=>{transforms[active].rotation=Number(e.target.value);showPreview()});
for(const [id,field] of [['alignmentX','x'],['alignmentY','y']]){
  $(id).addEventListener('input',e=>{const n=Number(e.target.value);if(Number.isFinite(n)){transforms[active][field]=Math.max(-10000,Math.min(10000,n));showPreview()}});
}
preview.addEventListener('pointerdown',e=>{
  if(e.button!==0||!dialog.open)return;
  e.preventDefault();drag={id:e.pointerId,x:e.clientX,y:e.clientY,originX:transforms[active].x,originY:transforms[active].y,source:active};
  preview.setPointerCapture(e.pointerId);
});
preview.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const rect=preview.getBoundingClientRect(),{width,height}=dimensions();
  transforms[drag.source].x=drag.originX+(e.clientX-drag.x)*width/rect.width;
  transforms[drag.source].y=drag.originY+(e.clientY-drag.y)*height/rect.height;
  showPreview();
});
for(const name of ['pointerup','pointercancel'])preview.addEventListener(name,()=>{drag=null});
dialog.addEventListener('close',()=>{drag=null});
window.MosaicAlignment={open,aligned,drawSource};
