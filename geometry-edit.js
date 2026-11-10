/* Geometry editing builds a full-frame RGB candidate and applies only validated
   pixels. It deliberately never asks a generative model for an object-ID image.
   Materials keep using the existing cropped editing workflow. */
import './premium.js';
import './object-map.js';
import {calculateMaskDelta} from './geometry-mask.mjs';

const core=window.MosaicCore;
const {state,canvas,makeCanvas,toast,render,renderGroups}=core;
const $=id=>document.getElementById(id);
const clone=input=>{const out=makeCanvas(input.width,input.height);out.getContext('2d').drawImage(input,0,0);return out;};
let mode='material',processing=false,review=null;
const promptForm=$('quickAreaPromptForm'),input=$('quickAreaPromptInput');
const switcher=document.createElement('div');
switcher.className='geometry-mode-switcher';
switcher.setAttribute('role','group');
switcher.setAttribute('aria-label','Edit mode');
switcher.innerHTML='<button type="button" data-geometry-mode="material" aria-pressed="true">Material</button><button type="button" data-geometry-mode="shape" aria-pressed="false">Shape</button><button type="button" id="geometryRemoveBtn" title="Remove the selected object">Remove</button>';
promptForm.querySelector('.quick-area-title').after(switcher);
const modeHint=document.createElement('p');
modeHint.className='geometry-mode-hint';
switcher.after(modeHint);
function setMode(next){
  mode=next==='shape'?'shape':'material';
  for(const button of switcher.querySelectorAll('[data-geometry-mode]')){
    const active=button.dataset.geometryMode===mode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  }
  input.placeholder=mode==='shape'?'Describe the new object shape or size…':'Change material, finish or color…';
  modeHint.textContent=mode==='shape'?'Full image render · SAM finds the new outline · camera protected':'Material edit · keep original object geometry';
}
switcher.addEventListener('click',event=>{
  const button=event.target.closest('[data-geometry-mode]');
  if(button){setMode(button.dataset.geometryMode);input.focus({preventScroll:true});}
});
setMode('material');

function maskPixels(mask){
  return mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
}
function rasterFromBits(bits){
  const out=makeCanvas(canvas.width,canvas.height),ctx=out.getContext('2d'),frame=ctx.createImageData(canvas.width,canvas.height);
  for(let p=0;p<bits.length;p++)if(bits[p])frame.data.fill(255,p*4,p*4+4);
  ctx.putImageData(frame,0,0);return out;
}
function binary(mask){
  const pixels=maskPixels(mask),result=new Uint8Array(canvas.width*canvas.height);
  for(let p=0;p<result.length;p++)result[p]=pixels[p*4+3]>128?1:0;
  return result;
}
function operationMasks(oldMask,newMask,operation){
  const old=binary(oldMask),fresh=newMask?binary(newMask):new Uint8Array(old.length);
  const {union,revealed,unionCount:count,oldCount,newCount,revealedCount}=calculateMaskDelta(old,fresh);
  if(!count)throw Error('The selected object mask is empty.');
  if(operation!=='remove'&&(!newCount||newCount>old.length*.78||newCount<Math.max(20,oldCount*.015)))
    throw Error('SAM did not return a reliable new object outline. No changes were applied.');
  const region=rasterFromBits(union),reveal=rasterFromBits(revealed);
  // Small edge allowance includes antialiasing and nearby contact shadows.
  const padded=makeCanvas(canvas.width,canvas.height),ctx=padded.getContext('2d');
  ctx.filter='blur(4px)';ctx.drawImage(region,0,0);ctx.filter='none';
  ctx.globalCompositeOperation='source-over';ctx.drawImage(region,0,0);
  return {region,padded,reveal,oldCount,newCount,revealedCount};
}
function promptLabel(group){
  let label=(group?.objectLabel||group?.objectName||group?.name||group?.category||'').trim();
  label=label.replace(/\s*[·#]\s*\d+.*$/,'').replace(/\s+\d+$/,'').trim();
  if(!label||/^(region|other|object)$/i.test(label))return null;
  return label.slice(0,80);
}
function chooseGroup(mask){
  const parts=window.MosaicObjectMap?.partsForSelection(mask)||[];
  if(parts.length>1)throw Error('Shape/Remove currently supports one object. Use Material or merge the objects first.');
  const part=parts[0];
  return state.groups.find(g=>g.id===state.draftGroupId||g.patchIds.includes(state.selectionTargetPatchId))||
    (part&&state.groups.find(g=>g.objectMapObjectKey===part.objectKey&&g.objectMapKey===part.mapKey))||
    core.matchingGroup(mask,.55)||null;
}
async function samMask(image,label,oldMask){
  const max=896,scale=Math.min(1,max/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const frame=makeCanvas(w,h);frame.getContext('2d').drawImage(image,0,0,w,h);
  const oldBox=core.exactMaskBoundingBox(oldMask);
  if(!oldBox)throw Error('Select an object first.');
  // Broad guidance allows an object to grow beyond its previous silhouette.
  const margin=Math.max(48,Math.max(oldBox.w,oldBox.h)*.75);
  const x1=Math.max(0,(oldBox.x-margin)*scale),y1=Math.max(0,(oldBox.y-margin)*scale);
  const x2=Math.min(w,(oldBox.x+oldBox.w+margin)*scale),y2=Math.min(h,(oldBox.y+oldBox.h+margin)*scale);
  const reply=await window.MosaicAccount.request('/api/ai/sam3',{
    method:'POST',body:{mode:'object',image:frame.toDataURL('image/jpeg',.83),width:w,height:h,label,box:[x1,y1,Math.max(x1+1,x2),Math.max(y1+1,y2)]}
  });
  if(typeof reply.mask!=='string'||!reply.mask.startsWith('data:image/png;base64,'))throw Error('SAM returned no valid mask.');
  const img=await new Promise((resolve,reject)=>{
    const value=new Image();value.onload=()=>resolve(value);value.onerror=()=>reject(Error('Cannot decode SAM mask.'));value.src=reply.mask;
  });
  if(img.width!==w||img.height!==h)throw Error('SAM mask dimensions differ from the generated image.');
  const scaled=makeCanvas(canvas.width,canvas.height),ctx=scaled.getContext('2d');
  ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return scaled;
}

// Lightweight translation alignment, evaluated ONLY outside the selected object.
// The app always protects existing pixels outside the approved change region.
// A full perspective homography is a separate CV enhancement, not assumed here.
function alignTranslation(before,after,oldMask){
  const max=256,scale=Math.min(1,max/Math.max(canvas.width,canvas.height)),w=Math.max(32,Math.round(canvas.width*scale)),h=Math.max(32,Math.round(canvas.height*scale));
  const resize=source=>{const c=makeCanvas(w,h);c.getContext('2d').drawImage(source,0,0,w,h);return c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;};
  const a=resize(before),b=resize(after),m=resize(oldMask),grid=4,shifts=7;
  const luminance=(d,i)=>.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
  const grad=(d,x,y)=>{
    const i=(y*w+x)*4;
    return Math.abs(luminance(d,i+4)-luminance(d,i-4))+Math.abs(luminance(d,i+4*w)-luminance(d,i-4*w));
  };
  let best={dx:0,dy:0,error:Infinity,samples:0},baseline=Infinity;
  for(let dy=-shifts;dy<=shifts;dy++)for(let dx=-shifts;dx<=shifts;dx++){
    let error=0,n=0;
    for(let y=shifts+2;y<h-shifts-2;y+=grid)for(let x=shifts+2;x<w-shifts-2;x+=grid){
      if(m[(y*w+x)*4+3]>10)continue;
      if(m[((y+dy)*w+x+dx)*4+3]>10)continue;
      const ga=grad(a,x,y),gb=grad(b,x+dx,y+dy);
      if(ga+gb<24)continue;
      error+=Math.min(255,Math.abs(ga-gb));n++;
    }
    if(n<25)continue;
    const value=error/n;
    if(!dx&&!dy)baseline=value;
    if(value<best.error)best={dx,dy,error:value,samples:n};
  }
  const approved=Number.isFinite(best.error)&&best.samples>=25&&best.error<baseline*.82;
  if(!approved)return {image:after,offset:{x:0,y:0},status:'Protected composition · alignment not required or inconclusive'};
  const shiftX=-best.dx/scale,shiftY=-best.dy/scale;
  const shifted=makeCanvas(canvas.width,canvas.height),ctx=shifted.getContext('2d');
  ctx.drawImage(before,0,0);ctx.drawImage(after,shiftX,shiftY);
  return {image:shifted,offset:{x:shiftX,y:shiftY},status:'Automatic translation alignment'};
}
function compositedResult(before,generated,changeMask){
  const result=clone(before),clip=clone(generated),x=clip.getContext('2d');
  x.globalCompositeOperation='destination-in';x.drawImage(changeMask,0,0);
  result.getContext('2d').drawImage(clip,0,0);
  return result;
}
const previewLayer=document.createElement('canvas');
previewLayer.id='geometryPreviewLayer';previewLayer.className='geometry-preview-layer';previewLayer.hidden=true;
$('canvasWrap').append(previewLayer);
const reviewBar=document.createElement('div');
reviewBar.id='geometryReviewBar';reviewBar.className='geometry-review-bar';reviewBar.hidden=true;
reviewBar.innerHTML='<span id="geometryReviewStatus"></span><button type="button" id="geometryDiscard">Discard</button><button type="button" id="geometryApply">Apply shape edit</button>';
$('viewport').append(reviewBar);
function closeReview(){
  review=null;previewLayer.hidden=true;reviewBar.hidden=true;
  previewLayer.getContext('2d').clearRect(0,0,previewLayer.width,previewLayer.height);
}
function showReview(result,status,operation){
  previewLayer.width=canvas.width;previewLayer.height=canvas.height;
  previewLayer.getContext('2d').drawImage(result,0,0);
  previewLayer.hidden=false;reviewBar.hidden=false;
  $('geometryReviewStatus').textContent=status;
  $('geometryApply').textContent=operation==='remove'?'Apply removal':'Apply shape edit';
}
function commit(){
  if(!review)return;
  const item=review;
  if(state.selectionGeneration!==item.generation||state.master!==item.master){closeReview();toast('Project changed. Generate the shape again.');return;}
  const group=item.group||core.newGroup(item.oldMask,item.label||'Region');
  group.objectId=group.objectId||group.id;
  if(item.label&&!group.objectLabel)group.objectLabel=item.label;
  const sourceId=core.uid('geometry_source'),patchId=core.uid('geometry_patch'),mask=clone(item.masks.padded);
  state.sources.set(sourceId,{id:sourceId,name:(item.operation==='remove'?'Removed ':'Shape edited ')+(item.label||'object'),canvas:clone(item.aligned)});
  const paths=core.maskPathsFromRaster(mask);
  const patch={
    id:patchId,sourceId,groupId:group.id,mask,bbox:core.exactMaskBoundingBox(mask),
    maskPaths:paths,maskPoints:paths.flat(),prompt:item.prompt,
    name:item.operation==='remove'?'Removed '+(item.label||'object'):core.optionNameFromPrompt(item.prompt,'New shape'),
    manualName:true,editMode:item.operation,geometryObjectMask:item.newMask?clone(item.newMask):null,
    geometryPreviousMask:clone(item.oldMask),geometryRevealedMask:clone(item.masks.reveal),
    objectId:group.objectId,objectLabel:item.label,objectMaskUncertain:false
  };
  state.patches.set(patchId,patch);group.patchIds.push(patchId);group.active=patchId;
  group.objectRemoved=item.operation==='remove';group.geometryVersion=(group.geometryVersion||0)+1;
  core.refreshGroupFootprint(group);
  // Retain the RGB evidence, its source, and the portion of the previous object
  // that was uncovered. Ownership is deliberately unresolved until verified.
  state.objectReconstruction??={version:1,events:[]};
  state.objectReconstruction.events.push({
    id:core.uid('reconstruction'),groupId:group.id,patchId,sourceId,
    operation:item.operation,geometryVersion:group.geometryVersion,
    oldMask:clone(item.oldMask),newMask:item.newMask?clone(item.newMask):null,
    revealedMask:clone(item.masks.reveal),
    revealedRGB:(()=>{const c=clone(item.aligned),x=c.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(item.masks.reveal,0,0);return c;})(),
    cameraOffset:item.offset,ownership:'unassigned',createdAt:new Date().toISOString()
  });
  core.invalidateDisplayedMask(patch);
  closeReview();renderGroups();render();core.selectGroupMask(group,{showOutline:false});
  toast('Edit applied. Previous options and newly revealed pixels are retained in the .moz project.');
}
$('geometryDiscard').addEventListener('click',()=>{closeReview();toast('Shape preview discarded.');});
$('geometryApply').addEventListener('click',commit);
async function generate(prompt,files=[],operation='shape'){
  if(processing){toast('A shape edit is already generating.');return;}
  if(review){toast('Apply or discard the current preview first.');return;}
  if(!state.master||!state.selectionMask||!core.maskBoundingBox(state.selectionMask)){toast('Select one object first.');return;}
  if(state.pendingSourceId||state.editingPatchId){toast('Finish the pending import or mask edit first.');return;}
  const before=core.composeApprovedCanvas(),oldMask=clone(state.selectionMask),generation=state.selectionGeneration,master=state.master;
  let group,label;
  try{group=chooseGroup(oldMask);label=promptLabel(group);
    if(operation==='shape'&&!label)throw Error('Name or select a recognized object before Shape editing so SAM can identify it.');
  }catch(error){toast(error.message);return;}
  processing=true;const submit=promptForm.querySelector('[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    const task=operation==='remove'?'Remove the selected '+(label||'object')+' completely. Reconstruct all newly visible background surfaces naturally, matching existing material, structure, perspective and light.':
      prompt;
    const fullPrompt='OBJECT GEOMETRY EDIT: '+task+' Keep the camera, focal length, perspective, room structure, framing and ALL unselected objects unchanged. Render the ENTIRE image at the same viewpoint and resolve any background exposed by the edit. Do not create colored masks or labels.';
    toast(operation==='remove'?'Removing object in full image…':'Generating full-image shape edit…');
    const generated=await window.MosaicPremium.generateComposition(fullPrompt,files,before,null,{editIntent:operation});
    if(generation!==state.selectionGeneration||state.master!==master){toast('The project changed during generation; result discarded.');return;}
    const alignedResult=alignTranslation(before,generated,oldMask);
    let newMask=null;
    if(operation==='shape')newMask=await samMask(alignedResult.image,label,oldMask);
    if(generation!==state.selectionGeneration||state.master!==master){toast('The project changed during segmentation; result discarded.');return;}
    const masks=operationMasks(oldMask,newMask,operation);
    const result=compositedResult(before,alignedResult.image,masks.padded);
    review={generation,master,oldMask,newMask,group,label,prompt:task,operation,masks,aligned:alignedResult.image,offset:alignedResult.offset,result};
    showReview(result,alignedResult.status+' · '+(operation==='remove'?'Background recovered': 'SAM outline validated'),operation);
    toast('Review the new image, then Apply or Discard.');
  }catch(error){toast('Shape edit: '+(error?.message||'Unable to generate. Original image is unchanged.'));}
  finally{processing=false;if(submit)submit.disabled=false;}
}
$('geometryRemoveBtn').addEventListener('click',()=>void generate('',window.MosaicPremium.getReferenceFiles?.('quick')||[],'remove'));
window.addEventListener('mosaic:projectloaded',()=>{closeReview();setMode('material')});
window.MosaicGeometryEdit={generate,getMode:()=>mode,setMode,discard:closeReview};
