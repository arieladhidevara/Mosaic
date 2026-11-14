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
function isFreshCreate(){
  const group=state.groups.find(g=>g.id===state.draftGroupId||g.patchIds.includes(state.selectionTargetPatchId));
  return Boolean(group?.createdLocally&&!group.createdViaAI);
}
function syncPromptMode(){
  const create=isFreshCreate();
  if(create)mode='material';
  switcher.hidden=create;
  modeHint.hidden=create;
  if(create){
    input.placeholder='Describe the new object…';
    for(const button of switcher.querySelectorAll('[data-geometry-mode]')){
      const active=button.dataset.geometryMode==='material';
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    }
  }else setMode(mode);
}
function setMode(next){
  mode=next==='shape'?'shape':'material';
  for(const button of switcher.querySelectorAll('[data-geometry-mode]')){
    const active=button.dataset.geometryMode===mode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  }
  input.placeholder=mode==='shape'?'Describe the new object shape or size…':'Change material, finish or color…';
  modeHint.textContent=mode==='shape'?'Shape edit · SAM detects changed geometry':'Material edit · original mask kept';
  modeHint.hidden=false;
}
switcher.addEventListener('click',event=>{
  if(isFreshCreate())return;
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
// SAM assigns only well-supported newly revealed pixels to existing objects.
// Ambiguous pixels stay unassigned instead of corrupting a permanent texture.
async function matchRevealedOwners(image,revealedMask,excludedGroup){
  const exposed=binary(revealedMask),revealCount=exposed.reduce((a,b)=>a+b,0);
  if(revealCount<64)return [];
  const oldBox=core.exactMaskBoundingBox(revealedMask);
  const center=b=>({x:b.x+b.w/2,y:b.y+b.h/2});
  const candidates=state.groups.filter(g=>g!==excludedGroup&&!g.mergedInto&&!g.objectRemoved)
    .map(g=>({group:g,label:promptLabel(g),mask:core.groupMask(g)}))
    .filter(o=>o.label&&o.mask&&core.exactMaskBoundingBox(o.mask))
    .map(o=>{
      const b=core.exactMaskBoundingBox(o.mask),a=center(oldBox),c=center(b);
      const distance=Math.hypot(a.x-c.x,a.y-c.y);
      const surface=/floor|wall|ceiling|ground|pavement|carpet|tile/i.test(o.label)?1:0;
      return {...o,distance,priority:surface*10000-distance};
    })
    .sort((a,b)=>b.priority-a.priority).slice(0,3);
  const collected=[],claimed=new Uint8Array(exposed.length);
  for(const entry of candidates){
    try{
      const next=await samMask(image,entry.label,entry.mask);
      const old=binary(entry.mask),fresh=binary(next);
      let original=0,retained=0,newlyVisible=0;
      for(let i=0;i<old.length;i++){
        if(old[i]){original++;if(fresh[i]&&!exposed[i])retained++;}
        if(exposed[i]&&fresh[i]&&!claimed[i])newlyVisible++;
      }
      // Both shape continuity AND ownership of exposed pixels are necessary.
      if(original<20||retained/original<.4||newlyVisible<Math.max(16,revealCount*.04))continue;
      const bits=new Uint8Array(exposed.length);
      for(let i=0;i<bits.length;i++)if(exposed[i]&&fresh[i]&&!claimed[i]){bits[i]=1;claimed[i]=1;}
      collected.push({groupId:entry.group.id,mask:rasterFromBits(bits),confidence:Math.min(1,retained/original)});
    }catch(error){console.warn('[mozAI:revealed-owner]',entry.label,error?.message||error);}
  }
  return collected;
}
function accumulateRevealedPixels(event,before,aligned){
  state.objectReconstruction??={version:1,events:[]};
  state.objectReconstruction.objects??={};
  state.objectReconstruction.occlusions??=[];
  for(const match of event.assignments||[]){
    const group=state.groups.find(g=>g.id===match.groupId);
    if(!group)continue;
    const key=group.id+':'+(group.geometryVersion||0);
    let record=state.objectReconstruction.objects[key];
    if(!record){
      const originalMask=clone(core.groupMask(group));
      const texture=clone(before),x=texture.getContext('2d');
      x.globalCompositeOperation='destination-in';x.drawImage(originalMask,0,0);
      record={groupId:group.id,geometryVersion:group.geometryVersion||0,texture,coverage:originalMask,patches:0};
      state.objectReconstruction.objects[key]=record;
    }
    const patch=clone(aligned),ctx=patch.getContext('2d');
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(match.mask,0,0);
    record.texture.getContext('2d').drawImage(patch,0,0);
    record.coverage.getContext('2d').drawImage(match.mask,0,0);
    record.patches++;
    state.objectReconstruction.occlusions.push({
      frontId:event.groupId,backId:group.id,sourceEvent:event.id,
      region:clone(match.mask),confidence:match.confidence
    });
  }
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
  const reconstructionEvent={
    id:core.uid('reconstruction'),groupId:group.id,patchId,sourceId,
    operation:item.operation,geometryVersion:group.geometryVersion,
    oldMask:clone(item.oldMask),newMask:item.newMask?clone(item.newMask):null,
    revealedMask:clone(item.masks.reveal),
    revealedRGB:(()=>{const c=clone(item.aligned),x=c.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(item.masks.reveal,0,0);return c;})(),
    cameraOffset:item.offset,ownership:item.assignments.length?'partially-matched':'unassigned',
    assignments:item.assignments.map(a=>({groupId:a.groupId,mask:clone(a.mask),confidence:a.confidence})),
    createdAt:new Date().toISOString()
  };
  state.objectReconstruction.events.push(reconstructionEvent);
  accumulateRevealedPixels(reconstructionEvent,item.before,item.aligned);
  core.invalidateDisplayedMask(patch);
  closeReview();renderGroups();render();
  if(item.operation==='remove')core.resetSelection();
  else core.selectGroupMask(group,{showOutline:false});
  toast('Edit applied. Previous options and newly revealed pixels are retained in the .moz project.');
}
// A Create result is an independent RGBA foreground layer. Removing it
// needs no background reconstruction: the accepted scene already exists
// underneath. Keep the earlier cutout Options intact for one-click restore.
function removeCreatedCutout(){
  const group=state.groups.find(g=>g.id===state.draftGroupId||
    g.patchIds.includes(state.selectionTargetPatchId));
  if(!group?.createdLocally)return false;
  if(state.busy||state.pendingSourceId||state.editingPatchId){
    toast('Finish the current edit before removing this cutout.');return true;
  }
  if(processing||review){
    toast('Finish the current preview first.');return true;
  }
  const current=state.patches.get(group.active);
  if(!current||current.generating||current.awaitingResult){
    toast('Finish generating the cutout first.');return true;
  }
  if(current.localCutoutRemoval){
    toast('This cutout is already removed. Choose another Option to restore it.');return true;
  }
  let removed=group.patchIds.map(id=>state.patches.get(id)).find(p=>p?.localCutoutRemoval);
  if(!removed){
    const id=core.uid('remove_cutout');
    // Empty alpha; no new RGB source, image generation, SAM, or ownership work.
    // Reuse the existing source reference only for Option bookkeeping.
    removed={
      id,groupId:group.id,sourceId:current.sourceId,
      mask:makeCanvas(1,1),bbox:{...current.bbox},
      maskPaths:[],maskPoints:[],name:'Removed',manualName:true,
      editMode:'remove',localCutoutRemoval:true,objectId:group.objectId||group.id,
      createdAt:new Date().toISOString()
    };
    state.patches.set(id,removed);group.patchIds.push(id);
  }
  group.active=removed.id;
  group.objectRemoved=true;
  // Geometry, pixels and masks beneath this foreground never changed.
  // Just invalidate click picking; do NOT recalculate a Group footprint.
  window.MosaicObjectMap?.invalidateHitIndex?.();
  core.resetSelection();
  renderGroups();render();
  window.MosaicDiskCache?.schedule?.();
  toast('Cutout removed. Choose an earlier Option to restore it.');
  return true;
}
$('geometryDiscard').addEventListener('click',()=>{closeReview();toast('Shape preview discarded.');});
$('geometryApply').addEventListener('click',commit);
async function generate(prompt,files=[],operation='shape'){
  if(operation==='remove'&&removeCreatedCutout())return;
  if(processing){toast('A shape edit is already generating.');return;}
  if(review){toast('Apply or discard the current preview first.');return;}
  if(!state.master||!core.selectionBounds()){toast('Select one object first.');return;}
  core.ensureSelectionMask();
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
    const assignments=await matchRevealedOwners(alignedResult.image,masks.reveal,group);
    if(generation!==state.selectionGeneration||state.master!==master){toast('Project changed while matching surfaces.');return;}
    const result=compositedResult(before,alignedResult.image,masks.padded);
    review={generation,master,oldMask,newMask,group,label,prompt:task,operation,masks,aligned:alignedResult.image,offset:alignedResult.offset,result,assignments,before};
    showReview(result,alignedResult.status+' · '+(operation==='remove'?'Background recovered': 'SAM outline validated'),operation);
    toast('Review the new image, then Apply or Discard.');
  }catch(error){toast('Shape edit: '+(error?.message||'Unable to generate. Original image is unchanged.'));}
  finally{processing=false;if(submit)submit.disabled=false;}
}
$('geometryRemoveBtn').addEventListener('click',()=>void generate('',window.MosaicPremium.getReferenceFiles?.('quick')||[],'remove'));
window.addEventListener('mosaic:projectloaded',()=>{closeReview();setMode('material')});
window.MosaicGeometryEdit={generate,syncPromptMode,getMode:()=>isFreshCreate()?'material':mode,setMode,discard:closeReview};
