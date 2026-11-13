/* Full-image results become named options on every persistent Object ID.
   Appearance edits preserve masks and optionally align long image lines with
   one limited perspective transform. SAM is reserved for geometry workflows. */
import './app.js';
import {alignGeneratedToLockedMask} from './geometry-mask.mjs';
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
  let groups=state.groups.filter(isVisible);
  if(!groups.length&&state.objectMap?.raster){
    window.MosaicObjectMap?.hydrate?.();
    groups=state.groups.filter(isVisible);
  }
  if(!groups.length){
    // Without Object Map preparation, keep a reversible scene Option.
    const mask=makeCanvas(canvas.width,canvas.height),ctx=mask.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    const scene=core.newGroup(mask,'Scene');
    scene.name='Entire image';scene.objectName='Entire image';
    groups=[scene];
  }
  const snapshots=groups.map(group=>({group,mask:originalMask(group),choice:group.active}));
  // The original Object Map is immutable during ordinary AI Edit and
  // Harmonize. No SAM 3 calls here: every Option keeps its original mask.
  onStatus('Checking key edges while keeping the original masks…');
  if(generation!==state.selectionGeneration||previous!==state.master)
    throw Error('The working project changed while the image was generated.');
  const kind=type==='harmonize'?'harmonize':'ai-edit';
  const number=(state.sceneVersionCounters?.[kind]||0)+1;
  const category=(kind==='harmonize'?'Harmonize ':'AI Edit ')+number;
  state.sceneVersionCounters??={harmonize:0,'ai-edit':0};
  state.sceneVersionCounters[kind]=number;
  const sourceId=core.uid('full_scene_source');
  const fullImage=image;
  state.sources.set(sourceId,{id:sourceId,name:category,canvas:fullImage});
  const records=[];
  for(const {group,mask,choice} of snapshots){
    // Old Options already preserve previous looks; avoid synthetic full-scene
    // rollback sources or a cloned 'Before' image.
    // Apply at most one small perspective correction from long matching image
    // lines. Uncertain correspondence leaves RGB and the original mask alone.
    let aligned={image:fullImage,aligned:false,status:'locked-mask'};
    try{
      // Complex scenes can have many objects. Reduce sampling resolution
      // rather than silently disabling alignment when the map is dense.
      aligned=alignGeneratedToLockedMask({before,generated:fullImage,lockedMask:mask,makeCanvas,
        maxDimension:snapshots.length>100?160:320});
    }catch(error){console.warn('[mozAI:mask-fit]',error);}
    let optionSourceId=sourceId;
    if(aligned.aligned&&aligned.image!==fullImage){
      optionSourceId=core.uid('aligned_scene_source');
      state.sources.set(optionSourceId,{id:optionSourceId,name:category+' · aligned',canvas:aligned.image,
        maskAlignment:aligned.status});
    }
    const paths=core.maskPathsFromRaster(mask),patchId=core.uid('scene_option');
    state.patches.set(patchId,{id:patchId,groupId:group.id,sourceId:optionSourceId,mask:clone(mask),
      bbox:core.exactMaskBoundingBox(mask),maskPaths:paths,maskPoints:paths.flat(),
      name:category,versionCategory:category,sceneVersion:category,sceneType:kind,
      manualName:true,createdFromFullImage:true,isMasterVersion:kind==='harmonize',
      objectId:group.objectId||group.id,objectLabel:group.objectLabel||group.objectName||group.name,
      segmentationStatus:'locked-original',maskAlignmentStatus:aligned.status,
      segmentationConfidence:0,prompt});
    group.patchIds.push(patchId);
    core.shareMaterialOptionMask(state.patches.get(patchId),group);
    group.hasHarmonizedMaster=true;
    if(!preserveEditing||!state.selectionTargetPatchId)group.active=patchId;
    core.refreshGroupFootprint(group);
    records.push({groupId:group.id,patchId,matched:Boolean(aligned.aligned),alignment:aligned.status});
  }
  // The original Base stays beneath active Options after every generation.
  state.objectMapLocked=Boolean(groups.length)||state.objectMapLocked;
  (state.sceneVersionHistory??=[]).push({type:kind,number,category,sourceId,
    prompt,createdAt:new Date().toISOString(),segmentationStatus:'locked-original',
    records});
  // Original Base and Object IDs remain unchanged; no scene archive.
  renderGroups();render();
  return {category,objectCount:records.length,matched:records.filter(v=>v.matched).length,
    segmentationStatus:'locked-original'};
}
// A manually Created selection may cover parts of several independently selected
// objects. Split those intersections with the existing masks and keep separate
// options on their original object identities.
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
  let finalParts=parts.map(p=>({...p}));
  const manual=finalParts.find(part=>state.groups.some(g=>
    g.createdLocally&&g.objectMapKey===part.mapKey&&g.objectMapObjectKey===part.objectKey&&
    !g.mergedInto&&!g.objectRemoved));
  if(manual){
    const own=state.groups.find(g=>g.objectMapKey===manual.mapKey&&g.objectMapObjectKey===manual.objectKey);
    const existingKeys=new Set(finalParts.map(p=>p.mapKey+':'+p.objectKey));
    // Use the ORIGINAL independent Object IDs to split a temporary combined
    // Create mask. These stable masks are seeds, not replaceable geometry.
    const neighbors=state.groups.filter(g=>g!==own&&!g.objectMapBatch&&!g.mergedInto&&!g.objectRemoved&&
      !existingKeys.has((g.objectMapKey||'manual')+':'+(g.objectMapObjectKey||g.id)))
      .map(group=>({group,mask:core.groupMask(group)}))
      .map(item=>({...item,overlap:overlapSample(manual.mask,item.mask)}))
      .filter(item=>item.overlap>=4).sort((a,b)=>b.overlap-a.overlap).slice(0,24);
    const allocated=[],split=[];
    for(const {group,mask} of neighbors){
      const stablePiece=intersectMask(manual.mask,mask);
      // Avoid duplicated ownership where overlapping groups have depth order.
      const piece=allocated.length?subtractMask(stablePiece,allocated):stablePiece;
      if(!core.exactMaskBoundingBox(piece))continue;
      const seed=window.MosaicObjectManager?.partForObject?.(group);
      if(!seed)continue;
      allocated.push(piece);
      split.push({...seed,mask:piece,paths:core.maskPathsFromRaster(piece),
        previousMask:clone(mask),choiceAtStart:choiceVersions.get(group.id)??core.groupChoiceVersion(group)});
    }
    const remaining=allocated.length?subtractMask(manual.mask,allocated):manual.mask;
    finalParts=finalParts.filter(p=>p!==manual);
    if(core.exactMaskBoundingBox(remaining))
      finalParts.push({...manual,mask:remaining,paths:core.maskPathsFromRaster(remaining),
        previousMask:null});
    finalParts.push(...split);
    if(split.length)onStatus('Selection separated into '+finalParts.length+' original object masks…');
  }
  // Compound appearance edits also keep the original masks. Perspective
  // alignment uses RGB structural lines, so no SAM silhouette is needed.
  return finalParts;
}
window.MosaicSceneVersions={apply,segmentFullFrame,splitCreatedOverlap};
