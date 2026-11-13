/* Full-image results become named options on every persistent Object ID.
   Appearance edits preserve masks and optionally align long image lines with
   one limited perspective transform. SAM is reserved for geometry workflows. */
import './app.js';
import {alignGeneratedToLockedMask} from './geometry-mask.mjs';
import {decodeColors,objectMapSize,CATEGORIES} from './object-map-utils.mjs';
import {prepareInstanceMap,readInstanceLabels} from './object-map-geometry.mjs';
const core=window.MosaicCore,{state,canvas,makeCanvas,render,renderGroups}=core;
const clone=input=>{const out=makeCanvas(input.width,input.height);out.getContext('2d').drawImage(input,0,0);return out;};
const isVisible=g=>!g.objectMapBatch&&!g.mergedInto;
const originalMask=g=>clone(core.groupMask(g));

/* Re-segment each finished full-scene image, not just the initial Base.
   The output is a set of compact masks (plus background) with stable matches
   to prior Object IDs. Nothing in the original Base/Object Map is replaced. */
async function segmentFullFrame(image,oldGroups,onStatus=()=>{}){
  let labels,w,h,legend=new Map(),method='object-map';
  try{
    onStatus('Segmenting the new image into physical objects…');
    const target=objectMapSize(canvas.width,canvas.height);
    w=target.width;h=target.height;
    const frame=makeCanvas(w,h);frame.getContext('2d').drawImage(image,0,0,w,h);
    const response=await window.MosaicAuth.request('/api/ai/object-map',{
      image:frame.toDataURL('image/jpeg',.92)});
    if(!response?.image)throw Error('Object Map returned no image.');
    const output=new Image();output.src='data:image/png;base64,'+response.image;await output.decode();
    if(output.width!==w||output.height!==h)throw Error('Generated Object Map dimensions changed.');
    const surface=makeCanvas(w,h),context=surface.getContext('2d',{willReadFrequently:true});
    context.drawImage(output,0,0);
    const decoded=decodeColors(context.getImageData(0,0,w,h).data,w,h);
    if(!decoded.ids.length)throw Error('Object Map found no selectable objects.');
    const pixels=context.createImageData(w,h);
    for(let i=0;i<decoded.labels.length;i++){
      pixels.data[i*4]=decoded.labels[i];pixels.data[i*4+3]=255;
    }
    context.putImageData(pixels,0,0);
    const names=new Map((response.legend||[]).map(entry=>[entry.id,entry]));
    const indexed=prepareInstanceMap({raster:surface,sourceKey:'generated-preview',
      entries:decoded.ids.map(id=>{const item=names.get(id);return {
        id,label:item?.label||'Object '+id,
        category:CATEGORIES.includes(item?.category)?item.category:'Other',
        group:item?.group||''};
      })},makeCanvas,window.MozMaskGeometry);
    labels=readInstanceLabels(indexed);
    legend=new Map(indexed.entries.map(entry=>[entry.id,{
      label:entry.label,category:entry.category
    }]));
    if(legend.size<2)throw Error('Object Map did not separate the scene.');
  }catch(mapError){
    // SAM 3 is an independent fallback when the image-model map is unavailable.
    // Its masks have numeric IDs; they can still be edited individually.
    onStatus('Trying SAM 3 object segmentation…');
    method='sam3';
    const scale=Math.min(1,768/Math.max(canvas.width,canvas.height));
    w=Math.max(1,Math.round(canvas.width*scale));
    h=Math.max(1,Math.round(canvas.height*scale));
    const frame=makeCanvas(w,h);frame.getContext('2d').drawImage(image,0,0,w,h);
    let result;
    try{
      result=await window.MosaicAccount.request('/api/ai/sam3',{method:'POST',
        body:{mode:'auto',image:frame.toDataURL('image/jpeg',.82),width:w,height:h}});
    }catch(error){
      throw Error('Object segmentation failed: '+(mapError.message||'Object Map unavailable')+
        '; SAM 3: '+(error.message||'unavailable'));
    }
    if(!/^data:image\/png;base64,/.test(result?.labels||''))
      throw Error('SAM 3 did not return an object-index image.');
    const output=new Image();output.src=result.labels;await output.decode();
    if(output.width!==w||output.height!==h)throw Error('SAM 3 segmentation dimensions changed.');
    const surface=makeCanvas(w,h),context=surface.getContext('2d',{willReadFrequently:true});
    context.drawImage(output,0,0);
    const pixels=context.getImageData(0,0,w,h).data;
    labels=new Uint32Array(w*h);
    for(let i=0;i<labels.length;i++)labels[i]=pixels[i*4];
  }
  const counts=new Map(),boxes=new Map();
  for(let i=0;i<labels.length;i++){
    const id=labels[i];counts.set(id,(counts.get(id)||0)+1);
    const x=i%w,y=(i-x)/w;
    let box=boxes.get(id);
    if(!box){box={left:x,top:y,right:x,bottom:y};boxes.set(id,box);}
    else{box.left=Math.min(box.left,x);box.top=Math.min(box.top,y);
      box.right=Math.max(box.right,x);box.bottom=Math.max(box.bottom,y);}
  }
  const minimum=Math.max(16,Math.round(w*h*.00004));
  const ids=[...counts.keys()].filter(id=>id>0&&counts.get(id)>=minimum);
  if(!ids.length)throw Error('The generated image contains no separately detected objects.');
  const accepted=new Set(ids);
  // All ignored proposals and uncovered pixels go into a real Background
  // option so the generated scene never has transparent holes.
  const backgroundId=0;
  for(let i=0;i<labels.length;i++)if(!accepted.has(labels[i]))labels[i]=backgroundId;
  if(counts.size!==ids.length+Number(counts.has(0))){
    counts.clear();boxes.clear();
    for(let i=0;i<labels.length;i++){
      const id=labels[i];counts.set(id,(counts.get(id)||0)+1);
      const x=i%w,y=(i-x)/w;let b=boxes.get(id);
      if(!b){b={left:x,top:y,right:x,bottom:y};boxes.set(id,b);}
      else{b.left=Math.min(b.left,x);b.top=Math.min(b.top,y);
        b.right=Math.max(b.right,x);b.bottom=Math.max(b.bottom,y);}
    }
  }
  onStatus('Matching segmented objects to existing Groups…');
  const existing=typeof oldGroups==='function'?oldGroups():oldGroups;
  const pairs=[];
  for(const item of existing){
    if(item.group.objectName==='Entire image'||item.group.name==='Entire image')continue;
    const reference=makeCanvas(w,h),ctx=reference.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;ctx.drawImage(item.mask,0,0,w,h);
    const alpha=ctx.getImageData(0,0,w,h).data,intersections=new Map();
    let oldCount=0;
    for(let i=0;i<labels.length;i++)if(alpha[i*4+3]>=128){
      oldCount++;
      const id=labels[i];if(accepted.has(id))intersections.set(id,(intersections.get(id)||0)+1);
    }
    if(oldCount<4)continue;
    for(const [id,both] of intersections){
      const next=counts.get(id)||0,coverage=both/oldCount,purity=both/next;
      const iou=both/(oldCount+next-both);
      if(both>=12&&coverage>=.25&&purity>=.24)
        pairs.push({groupId:item.group.id,id,iou,score:iou+.1*Math.min(coverage,purity)});
    }
  }
  pairs.sort((a,b)=>b.score-a.score);
  const matches=new Map(),taken=new Set();
  for(const item of pairs){
    if(matches.has(item.groupId)||taken.has(item.id))continue;
    matches.set(item.groupId,item);taken.add(item.id);
  }
  function cropFor(id){
    const b=boxes.get(id);if(!b)return null;
    const x=Math.max(0,Math.floor(b.left*canvas.width/w));
    const y=Math.max(0,Math.floor(b.top*canvas.height/h));
    const right=Math.min(canvas.width,Math.ceil((b.right+1)*canvas.width/w));
    const bottom=Math.min(canvas.height,Math.ceil((b.bottom+1)*canvas.height/h));
    const local=makeCanvas(b.right-b.left+1,b.bottom-b.top+1);
    const ctx=local.getContext('2d'),pixels=ctx.createImageData(local.width,local.height);
    for(let yy=b.top;yy<=b.bottom;yy++)for(let xx=b.left;xx<=b.right;xx++)
      if(labels[yy*w+xx]===id){
        const p=((yy-b.top)*local.width+xx-b.left)*4;pixels.data.fill(255,p,p+4);
      }
    ctx.putImageData(pixels,0,0);
    const mask=makeCanvas(right-x,bottom-y),dst=mask.getContext('2d');
    dst.imageSmoothingEnabled=false;dst.drawImage(local,0,0,mask.width,mask.height);
    return {mask,x,y};
  }
  const masks=new Map();
  for(const [groupId,match] of matches)masks.set(groupId,{
    crop:cropFor(match.id),confidence:match.iou,segmentId:match.id});
  const unmatched=ids.filter(id=>!taken.has(id)).map(id=>({
    crop:cropFor(id),segmentId:id,
    label:legend.get(id)?.label||'Object '+id,
    category:legend.get(id)?.category||'Other'
  }));
  const background=counts.get(0)?{crop:cropFor(0),label:'Background',
    category:'Other',segmentId:0}:null;
  return {masks,unmatched,background,status:method,segments:ids.length};
}


async function apply(image,{type='ai-edit',prompt='',onStatus=()=>{},preserveEditing=false}={}){
  if(!state.master)throw Error('Open a Base first.');
  if(image.width!==canvas.width||image.height!==canvas.height)
    throw Error('Full image must match the current canvas dimensions.');
  const generation=state.selectionGeneration,previous=state.master;
  const before=core.composeApprovedCanvas();
  let segmented=null,segmentationError=null;
  const progress=window.MosaicMaskProgress;
  if(window.MosaicAccount?.request){
    progress?.show('scene-segmentation','Splitting generated image','Detecting individual objects…');
    try{
      segmented=await segmentFullFrame(image,()=>state.groups.filter(isVisible).map(group=>({
        group,mask:core.groupMask(group)})),detail=>{
          onStatus(detail);
          progress?.show('scene-segmentation','Splitting generated image',detail);
        });
    }catch(error){
      segmentationError=error;
      console.warn('[mozAI:scene-segmentation]',error);
      onStatus('Segmentation unavailable; keeping existing Object masks.');
    }finally{
      progress?.hide('scene-segmentation');
    }
  }
  if(generation!==state.selectionGeneration||previous!==state.master)
    throw Error('The working project changed while the image was generated.');
  let groups=state.groups.filter(isVisible);
  if(!groups.length&&state.objectMap?.raster){
    window.MosaicObjectMap?.hydrate?.();
    groups=state.groups.filter(isVisible);
  }
  if(!groups.length&&!segmented?.unmatched.length){
    // Reversible fallback if both segmentation providers are unavailable.
    const mask=makeCanvas(canvas.width,canvas.height),ctx=mask.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    const scene=core.newGroup(mask,'Scene');
    scene.name='Entire image';scene.objectName='Entire image';
    groups=[scene];
  }
  // Preserve each prior Option (and its original geometry) unchanged.
  const snapshots=groups.map(group=>({
    group,mask:originalMask(group),choice:group.active,
    segment:segmented?.masks.get(group.id)||null
  }));
  const kind=type==='harmonize'?'harmonize':'ai-edit';
  const number=(state.sceneVersionCounters?.[kind]||0)+1;
  const category=(kind==='harmonize'?'Harmonize ':'AI Edit ')+number;
  state.sceneVersionCounters??={harmonize:0,'ai-edit':0};
  state.sceneVersionCounters[kind]=number;
  if(segmented){
    // A Base mapping started before full-image generation may still be pending.
    // Do not let its older result insert duplicate Groups after this split.
    window.MosaicObjectMap?.cancelPending?.();
  }
  const records=[];
  function register(group,crop,original=null,confidence=0,segmentId=null){
    const mask=crop?.mask||original;
    if(!mask)return;
    const offset=crop?{x:crop.x,y:crop.y}:null;
    const bounds=crop?{x:crop.x,y:crop.y,w:mask.width,h:mask.height}
      :core.exactMaskBoundingBox(mask);
    if(!bounds)return;
    const paths=core.maskPathsFromRaster(mask).map(path=>path.map(point=>
      offset?{x:point.x+offset.x,y:point.y+offset.y}:point));
    let aligned={image,aligned:false,status:crop?'new-segmentation':'locked-mask'};
    if(!crop&&original){
      try{
        aligned=alignGeneratedToLockedMask({before,generated:image,
          lockedMask:original,makeCanvas,maxDimension:snapshots.length>100?160:320});
      }catch(error){console.warn('[mozAI:mask-fit]',error);}
    }
    const sourceId=core.uid('scene_option_source');
    state.sources.set(sourceId,{id:sourceId,name:category+' · '+group.name,
      ...core.compactOptionSource(aligned.image,bounds,24),revealComplete:true,
      maskAlignment:aligned.status});
    const patchId=core.uid('scene_option');
    state.patches.set(patchId,{id:patchId,groupId:group.id,sourceId,
      mask, ...(offset?{maskOffset:offset}:{}),
      bbox:bounds,maskPaths:paths,maskPoints:paths.flat(),
      name:category,versionCategory:category,sceneVersion:category,sceneType:kind,
      manualName:true,createdFromFullImage:true,isMasterVersion:kind==='harmonize',
      objectId:group.objectId||group.id,
      objectLabel:group.objectLabel||group.objectName||group.name,
      segmentationStatus:crop?'resegmented':'locked-original',
      segmentationConfidence:confidence,segmentId,prompt,
      maskAlignmentStatus:aligned.status});
    group.patchIds.push(patchId);
    core.shareMaterialOptionMask(state.patches.get(patchId),group);
    group.hasHarmonizedMaster=true;
    if(!preserveEditing||!state.selectionTargetPatchId)group.active=patchId;
    core.refreshGroupFootprint(group);
    records.push({groupId:group.id,patchId,matched:Boolean(crop),alignment:aligned.status});
  }
  for(const {group,mask,segment} of snapshots){
    const bounds=core.exactMaskBoundingBox(mask);
    if(!bounds)continue;
    if(!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster)){
      const paths=core.maskPathsFromRaster(mask);
      const oldId=core.uid('scene_before'),oldSourceId=core.uid('scene_before_crop');
      state.sources.set(oldSourceId,{id:oldSourceId,name:'Original · '+group.name,
        ...core.compactOptionSource(before,bounds,24),revealComplete:true});
      state.patches.set(oldId,{id:oldId,groupId:group.id,sourceId:oldSourceId,mask,
        bbox:bounds,maskPaths:paths,maskPoints:paths.flat(),
        name:'Original appearance',manualName:true,isOriginalMaster:true,versionCategory:'Original'});
      group.patchIds.unshift(oldId);
      core.shareMaterialOptionMask(state.patches.get(oldId),group);
    }
    // User-created/merged shapes retain their intentional geometry. Other
    // existing IDs may use the resegmented per-Option geometry.
    const crop=group.createdLocally||group.isMergedObject?null:segment?.crop;
    const legacyScene=group.objectName==='Entire image'||group.name==='Entire image';
    if((legacyScene||group.objectName==='Background')&&segmented?.background?.crop){
      group.name='Background';group.objectName='Background';
      register(group,segmented.background.crop,null,0,0);
    }else register(group,crop,mask,segment?.confidence||0,segment?.segmentId||null);
  }
  if(segmented){
    const newGroups=[];
    for(const item of segmented.unmatched){
      if(!item.crop)continue;
      const group=core.newGroupFromCrop(item.crop,item.category);
      group.name=item.label;group.objectName=item.label;
      group.objectMapKey='generated:'+category;
      group.objectMapObjectKey=core.uid('generated_object');
      group.objectId=group.objectMapObjectKey;
      group.mapPrepared=true;
      register(group,item.crop,null,1,item.segmentId);
      newGroups.push(group);
    }
    // Background is lower than objects in the draw order. Its mask fills only
    // unclaimed pixels and never blocks an older object Option from switching.
    const alreadyBackground=snapshots.some(({group})=>group.objectName==='Background');
    if(segmented.background?.crop&&!alreadyBackground){
      const group=core.newGroupFromCrop(segmented.background.crop,'Other');
      group.name='Background';group.objectName='Background';
      group.objectMapKey='generated:'+category;
      group.objectMapObjectKey=core.uid('generated_background');
      group.mapPrepared=true;
      register(group,segmented.background.crop,null,1,0);
      state.groups=state.groups.filter(g=>g!==group);
      state.groups.unshift(group);
    }
    // The existing Base index remains read-only; generated objects use live
    // compact masks and their own stable Group IDs.
    state.objectMapLocked=true;
  }else state.objectMapLocked=Boolean(groups.length)||state.objectMapLocked;
  state.sceneVersionHistory=[];
  renderGroups();render();
  if(segmentationError)window.MosaicCore?.toast?.('Object split unavailable. Original masks kept; retry segmentation later.');
  return {category,objectCount:records.length,
    matched:records.filter(v=>v.matched).length,
    segmentationStatus:segmented?.status||'locked-original'};
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
