/* AI Edit preflight: understand a full-scene prompt, verify object instances with SAM 3,
   and align semantic targets with the existing stable Object Map identities. */
import './app.js';
const core=window.MosaicCore,{state,canvas,makeCanvas}=core;
const clone=image=>{const c=makeCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);return c;};
const validObjects=()=>state.groups.filter(g=>!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved&&
  (g.objectMapObjectKey||g.objectId||g.mapPrepared));
function known(){return validObjects().map(g=>({id:g.id,label:g.objectLabel||g.objectName||g.name,category:g.category}));}
function boundsFor(mask){return core.exactMaskBoundingBox(mask);}
function maskOverlap(reference,candidate){
  const w=reference.width,h=reference.height,a=reference.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const b=makeCanvas(w,h),ctx=b.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
  ctx.drawImage(candidate,0,0,w,h);
  const z=ctx.getImageData(0,0,w,h).data;
  let intersect=0,old=0,next=0;
  for(let i=3;i<a.length;i+=4){const x=a[i]>=128,y=z[i]>=128;old+=+x;next+=+y;intersect+=+(x&&y);}
  return {iou:intersect/Math.max(1,old+next-intersect),oldCoverage:intersect/Math.max(1,old),
    newCoverage:intersect/Math.max(1,next),intersection:intersect};
}
async function segmentCandidate(image,label,group){
  const scale=Math.min(1,896/Math.max(canvas.width,canvas.height)),w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const small=makeCanvas(w,h);small.getContext('2d').drawImage(image,0,0,w,h);
  const mask=core.groupMask(group),b=boundsFor(mask);
  if(!b)return null;
  const expand=Math.max(12,Math.min(b.w,b.h)*.15);
  const box=[Math.max(0,(b.x-expand)*scale),Math.max(0,(b.y-expand)*scale),
    Math.min(w,(b.x+b.w+expand)*scale),Math.min(h,(b.y+b.h+expand)*scale)];
  if(box[2]<=box[0]||box[3]<=box[1])return null;
  const response=await window.MosaicAccount.request('/api/ai/sam3',{
    method:'POST',body:{mode:'object',image:small.toDataURL('image/jpeg',.83),width:w,height:h,label,box}
  });
  if(!/^data:image\/png;base64,/.test(response?.mask||''))return null;
  const img=new Image();img.src=response.mask;await img.decode();
  if(img.width!==w||img.height!==h)return null;
  const full=makeCanvas(canvas.width,canvas.height),c=full.getContext('2d');
  c.imageSmoothingEnabled=false;c.drawImage(img,0,0,canvas.width,canvas.height);
  return full;
}
function semanticGroupName(label){
  const word=String(label||'Objects').trim().replace(/[^a-zA-Z -]/g,'').slice(0,42);
  if(!word)return 'Objects';
  return word[0].toUpperCase()+word.slice(1)+(word.endsWith('s')?'':'s');
}
function selectVerifiedGroups(groups){
  const selected=makeCanvas(canvas.width,canvas.height),ctx=selected.getContext('2d');
  const parts=[];
  for(const group of groups){
    const part=window.MosaicObjectManager?.partForObject?.(group);
    if(!part)continue;ctx.drawImage(part.mask,0,0);parts.push(part);
  }
  if(!parts.length)return;
  // Preserve the visually separate instance masks when selecting multiple objects.
  core.resetSelection();
  state.selectionMask=selected;
  state.selectionPaths=parts.flatMap(part=>core.maskPathsFromRaster(part.mask));
  state.selectionPoints=state.selectionPaths.flat();
  window.MosaicObjectMap?.adoptSelection(parts);
  core.updateSelectionOutline();core.render();
}
async function analyzeAndGroup(prompt,image,onStatus=()=>{}){
  const all=known();
  onStatus('Understanding your edit…');
  const intent=await window.MosaicAuth.request('/api/ai/scene-intent',{prompt,objects:all});
  if(!['all','one','global'].includes(intent.scope))throw Error('Unable to determine what the prompt targets.');
  if(intent.scope==='global')return {...intent,verifiedIds:[]};
  if(!intent.label||!Array.isArray(intent.targetIds)||!intent.targetIds.length)
    throw Error('No matching objects in the Object Map. Try describing an existing object more specifically.');
  const candidates=intent.targetIds.map(id=>state.groups.find(g=>g.id===id)).filter(Boolean).slice(0,16);
  if(!candidates.length)throw Error('Object Map is not ready. Retry object preparation before AI Edit.');
  const verified=[];
  for(let i=0;i<candidates.length;i++){
    const group=candidates[i];
    onStatus('SAM 3: verifying '+(i+1)+'/'+candidates.length+' '+intent.label+'…');
    const candidate=await segmentCandidate(image,intent.label,group);
    if(!candidate)continue;
    const overlap=maskOverlap(core.groupMask(group),candidate);
    // A semantic match and spatial evidence must both agree. Contact with a
    // wall or floor alone is not sufficient to classify it as a table.
    if(overlap.intersection>=20&&overlap.oldCoverage>=.32&&overlap.newCoverage>=.26)verified.push(group);
  }
  if(!verified.length)throw Error('SAM 3 could not confirm the '+intent.label+' objects. No edit was generated.');
  if(intent.scope==='one')verified.splice(1);
  const name=semanticGroupName(intent.label),manager=window.MosaicObjectManager;
  let collection=state.objectCollections?.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if(!collection)collection=manager.createCollection(name);
  manager.moveObjects(verified.map(g=>g.id),collection.id);
  selectVerifiedGroups(verified);
  const record={scope:intent.scope,label:intent.label,verifiedIds:verified.map(g=>g.id),
    collectionId:collection.id,prompt,createdAt:new Date().toISOString()};
  (state.sceneTargetSelections??=[]).push(record);
  onStatus(verified.length+' '+name.toLowerCase()+' matched and grouped. Generating…');
  return record;
}
window.MosaicSceneTargeting={known,maskOverlap,analyzeAndGroup};
