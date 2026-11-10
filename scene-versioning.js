/* Full-image results become named options on every persistent Object ID.
   SAM 3 proposes fresh silhouettes; spatial matching keeps object identities stable.
   Uncertain matches fall back to the prior visible masks (never silently inventing IDs). */
import './app.js';
const core=window.MosaicCore,{state,canvas,makeCanvas,render,renderGroups}=core;
const clone=input=>{const out=makeCanvas(input.width,input.height);out.getContext('2d').drawImage(input,0,0);return out;};
const isVisible=g=>!g.objectMapBatch&&!g.mergedInto;
const originalMask=g=>clone(core.groupMask(g));
async function segmentFullFrame(image,oldGroups,onStatus=()=>{}){
  if(!oldGroups.length)return {masks:new Map(),status:'no-objects'};
  const scale=Math.min(1,768/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const frame=makeCanvas(w,h);frame.getContext('2d').drawImage(image,0,0,w,h);
  onStatus('SAM 3: segmenting the generated scene…');
  const result=await window.MosaicAccount.request('/api/ai/sam3',{method:'POST',
    body:{mode:'auto',image:frame.toDataURL('image/jpeg',.82),width:w,height:h}});
  if(!/^data:image\/png;base64,/.test(result?.labels||''))throw Error('SAM 3 returned no valid object labels.');
  const maskImage=new Image();maskImage.src=result.labels;await maskImage.decode();
  if(maskImage.width!==w||maskImage.height!==h)throw Error('SAM scene segmentation dimensions changed.');
  const decoder=makeCanvas(w,h),dc=decoder.getContext('2d',{willReadFrequently:true});dc.drawImage(maskImage,0,0);
  const pixels=dc.getImageData(0,0,w,h).data,labels=new Uint8Array(w*h),totals=new Uint32Array(65);
  for(let i=0;i<labels.length;i++){labels[i]=pixels[i*4];if(labels[i]<=64)totals[labels[i]]++;}
  const pairs=[];
  for(const item of oldGroups){
    const reference=makeCanvas(w,h),rc=reference.getContext('2d',{willReadFrequently:true});
    rc.imageSmoothingEnabled=false;rc.drawImage(item.mask,0,0,w,h);
    const before=rc.getImageData(0,0,w,h).data,intersections=new Uint32Array(65);let oldCount=0;
    for(let i=0;i<labels.length;i++)if(before[i*4+3]>=128){oldCount++;if(labels[i]&&labels[i]<=64)intersections[labels[i]]++;}
    if(oldCount<4)continue;
    for(let id=1;id<=64;id++){
      const both=intersections[id],newCount=totals[id];
      if(both<12||!newCount)continue;
      const coverage=both/oldCount,purity=both/newCount,iou=both/(oldCount+newCount-both);
      if(coverage>=.28&&purity>=.22)pairs.push({groupId:item.group.id,id,coverage,purity,iou,score:iou+.1*Math.min(coverage,purity)});
    }
  }
  pairs.sort((a,b)=>b.score-a.score);
  const winners=new Map(),used=new Set();
  for(const pair of pairs){
    if(winners.has(pair.groupId)||used.has(pair.id))continue;
    winners.set(pair.groupId,pair);used.add(pair.id);
  }
  const masks=new Map();
  for(const [groupId,match] of winners){
    const small=makeCanvas(w,h),ctx=small.getContext('2d'),rgba=ctx.createImageData(w,h);
    for(let i=0;i<labels.length;i++)if(labels[i]===match.id)rgba.data.fill(255,i*4,i*4+4);
    ctx.putImageData(rgba,0,0);
    const full=makeCanvas(canvas.width,canvas.height),f=full.getContext('2d');
    f.imageSmoothingEnabled=false;f.drawImage(small,0,0,canvas.width,canvas.height);
    masks.set(groupId,{mask:full,confidence:match.iou,segmentId:match.id});
  }
  return {masks,status:'sam3',segments:used.size};
}
async function apply(image,{type='ai-edit',prompt='',onStatus=()=>{},preserveEditing=false}={}){
  if(!state.master)throw Error('Open a Base first.');
  if(image.width!==canvas.width||image.height!==canvas.height)throw Error('Full image must match the current canvas dimensions.');
  const generation=state.selectionGeneration,previous=state.master;
  const before=core.composeApprovedCanvas();
  const groups=state.groups.filter(isVisible);
  const snapshots=groups.map(group=>({group,mask:originalMask(group),choice:group.active}));
  let segmentation;
  try{segmentation=await segmentFullFrame(image,snapshots,onStatus);}
  catch(error){segmentation={masks:new Map(),status:'fallback'};
    onStatus('SAM 3 unavailable · preserving existing masks. '+(error?.message||''));}
  if(generation!==state.selectionGeneration||previous!==state.master)
    throw Error('The working project changed while the new scene was being segmented.');
  const kind=type==='harmonize'?'harmonize':'ai-edit';
  const number=(state.sceneVersionCounters?.[kind]||0)+1;
  const category=(kind==='harmonize'?'Harmonize ':'AI Edit ')+number;
  state.sceneVersionCounters??={harmonize:0,'ai-edit':0};
  state.sceneVersionCounters[kind]=number;
  const sourceId=core.uid('full_scene_source'),oldSourceId=core.uid('previous_scene_source');
  const fullImage=clone(image);
  state.sources.set(sourceId,{id:sourceId,name:category,canvas:fullImage});
  // Keep the previous visible image once, shared by original options.
  const needPrevious=snapshots.some(({group})=>!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster));
  if(needPrevious)state.sources.set(oldSourceId,{id:oldSourceId,name:'Previous scene',canvas:clone(before)});
  const records=[];
  for(const {group,mask,choice} of snapshots){
    if(needPrevious&&!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster)){
      const oldId=core.uid('scene_before');
      const paths=core.maskPathsFromRaster(mask);
      state.patches.set(oldId,{id:oldId,groupId:group.id,sourceId:oldSourceId,mask:clone(mask),
        bbox:core.exactMaskBoundingBox(mask),maskPaths:paths,maskPoints:paths.flat(),
        name:'Before full image',manualName:true,isOriginalMaster:true,versionCategory:'Original'});
      group.patchIds.unshift(oldId);
    }
    const proposed=segmentation.masks.get(group.id);
    const fresh=proposed?.mask||mask,paths=core.maskPathsFromRaster(fresh);
    const patchId=core.uid('scene_option');
    state.patches.set(patchId,{id:patchId,groupId:group.id,sourceId,mask:clone(fresh),
      bbox:core.exactMaskBoundingBox(fresh),maskPaths:paths,maskPoints:paths.flat(),
      name:category,versionCategory:category,sceneVersion:category,sceneType:kind,
      manualName:true,createdFromFullImage:true,isMasterVersion:kind==='harmonize',
      objectId:group.objectId||group.id,objectLabel:group.objectLabel||group.objectName||group.name,
      segmentationStatus:proposed?'sam3':'previous-mask-fallback',
      segmentationConfidence:proposed?.confidence||0,prompt});
    group.patchIds.push(patchId);
    group.hasHarmonizedMaster=true;
    if(!preserveEditing||!state.selectionTargetPatchId)group.active=patchId;
    core.refreshGroupFootprint(group);
    records.push({groupId:group.id,patchId,matched:Boolean(proposed),confidence:proposed?.confidence||0});
  }
  state.master=fullImage;state.masterIsBase=false;state.objectMapLocked=true;
  (state.sceneVersionHistory??=[]).push({type:kind,number,category,sourceId,
    prompt,createdAt:new Date().toISOString(),segmentationStatus:segmentation.status,
    records});
  // If no original Object Map exists, at least keep the generated options usable.
  if(!groups.length)window.MosaicObjectMap?.imageReady?.(fullImage);
  renderGroups();render();
  return {category,objectCount:records.length,matched:records.filter(v=>v.matched).length,
    segmentationStatus:segmentation.status};
}
// A manually Created selection may cover parts of several independently selected
// objects. On the generated RGB result, re-segment those intersections and store
// independent options rather than flattening all pixels into the manual object.
// SAM is optional: when it fails or cannot match an object, never reassign pixels.
function overlapSample(a,b){
  const scale=Math.min(1,224/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const sample=mask=>{
    const c=makeCanvas(w,h),x=c.getContext('2d',{willReadFrequently:true});
    x.imageSmoothingEnabled=false;x.drawImage(mask,0,0,w,h);
    return x.getImageData(0,0,w,h).data;
  };
  const x=sample(a),y=sample(b);let both=0;
  for(let i=3;i<x.length;i+=4)if(x[i]>=128&&y[i]>=128)both++;
  return both;
}
function intersectMask(...masks){
  if(!masks.length)return null;
  const out=clone(masks[0]),x=out.getContext('2d');
  for(const mask of masks.slice(1)){
    x.globalCompositeOperation='destination-in';x.drawImage(mask,0,0);
  }
  x.globalCompositeOperation='source-over';
  return out;
}
function subtractMask(mask,others){
  const out=clone(mask),x=out.getContext('2d');
  x.globalCompositeOperation='destination-out';
  for(const other of others)x.drawImage(other,0,0);
  x.globalCompositeOperation='source-over';
  return out;
}
async function splitCreatedOverlap(image,parts,{onStatus=()=>{},choiceVersions=new Map()}={}){
  if(!Array.isArray(parts)||!parts.length)return parts;
  const manual=parts.find(part=>state.groups.some(g=>
    g.createdLocally&&g.objectMapKey===part.mapKey&&g.objectMapObjectKey===part.objectKey&&
    !g.mergedInto&&!g.objectRemoved));
  if(!manual)return parts;
  const own=state.groups.find(g=>g.objectMapKey===manual.mapKey&&g.objectMapObjectKey===manual.objectKey);
  const otherKeys=new Set(parts.filter(p=>p!==manual).map(p=>p.mapKey+':'+p.objectKey));
  const candidates=state.groups.filter(g=>g!==own&&!g.objectMapBatch&&!g.mergedInto&&!g.objectRemoved&&
    !otherKeys.has((g.objectMapKey||'manual')+':'+(g.objectMapObjectKey||g.id)))
    .map(group=>({group,mask:core.groupMask(group)}))
    .map(item=>({...item,overlap:overlapSample(manual.mask,item.mask)}))
    .filter(item=>item.overlap>=5).sort((a,b)=>b.overlap-a.overlap).slice(0,8);
  if(!candidates.length)return parts;
  onStatus('SAM 3: resegmenting Created area across '+candidates.length+' overlapping objects…');
  let segmented;
  try{segmented=await segmentFullFrame(image,
    [{group:own,mask:core.groupMask(own)},...candidates],onStatus);}
  catch(error){
    onStatus('Created area kept intact; segmentation unavailable.');
    return parts;
  }
  const assigned=[],extra=[];
  for(const {group,mask} of candidates){
    const proposal=segmented.masks.get(group.id);
    if(!proposal)continue;
    // Both existing object ownership AND the newly observed SAM silhouette
    // must agree; merely touching an adjacent floor/wall is insufficient.
    const portion=intersectMask(manual.mask,proposal.mask,mask);
    if(overlapSample(portion,portion)<4)continue;
    const part=window.MosaicObjectManager?.partForObject?.(group);
    if(!part)continue;
    assigned.push(portion);
    extra.push({...part,mask:portion,paths:core.maskPathsFromRaster(portion),
      previousMask:clone(mask),choiceAtStart:choiceVersions.get(group.id)??core.groupChoiceVersion(group)});
  }
  if(!extra.length)return parts;
  const remaining=subtractMask(manual.mask,assigned);
  const preserved=parts.filter(part=>part!==manual);
  if(core.exactMaskBoundingBox(remaining))
    preserved.unshift({...manual,mask:remaining,paths:core.maskPathsFromRaster(remaining),
      previousMask:null});
  onStatus('Resegmented '+extra.length+' overlapping object'+(extra.length===1?'':'s')+'.');
  return preserved.concat(extra);
}
window.MosaicSceneVersions={apply,segmentFullFrame,splitCreatedOverlap};
