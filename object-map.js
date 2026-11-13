import './app.js';
import './object-management.js';
import {PALETTE,decodeColors,idsOverlappingShape,labelAt,CATEGORIES,objectMapSize} from './object-map-utils.mjs';
import {CLEANUP_VERSION} from './object-map-cleanup.mjs';
import {cropObjectLabel} from './object-mask-crop.mjs';
import {buildObjectHitGrid,cropContainsPoint} from './object-hit-index.mjs';
import {intersectObjectIds} from './object-intersections.mjs';
import {prepareInstanceMap,readInstanceLabels} from './object-map-geometry.mjs';
const core=window.MosaicCore,{state,canvas,makeCanvas}=core;
let labels=null,mapWidth=0,mapHeight=0,serial=0,busy=false,pendingBase=null,attemptedBase=null,picking=false,pickingIds=[],pickingMode='new',pendingClick=null,active=false,hoverId=0,hoverMask=null,heldImage=null,operation=null;
let hitIndex=null,entryById=new Map(),sourceCropCache=new Map();
// Full image outputs wait for THIS initial Base mapping, not another model call.
// Waiters keep their generated image in the caller until existing IDs hydrate.
const preparedWaiters=new Set();
function hasPreparedObjects(){return Boolean(state.objectMap?.raster&&
  state.groups.some(g=>g.mapPrepared&&!g.mergedInto&&!g.objectRemoved));}
function notifyPrepared(){
  if(!hasPreparedObjects())return;
  for(const waiter of preparedWaiters)waiter.resolve();
  preparedWaiters.clear();
}
function rejectPrepared(error){
  for(const waiter of preparedWaiters)waiter.reject(error);
  preparedWaiters.clear();
}
function whenReady(onStatus=()=>{}){
  if(hasPreparedObjects())return Promise.resolve();
  if(!state.master)return Promise.reject(Error('No Base image is loaded.'));
  if(!busy&&attemptedBase===state.master)
    onStatus('Object preparation needs attention. Click Retry objects to continue.');
  return new Promise((resolve,reject)=>preparedWaiters.add({resolve,reject,onStatus}));
}

function invalidateHitIndex(){hitIndex=null;hoverId=0;hoverMask=null;preview.hidden=true}
function indexedObjects(){
  if(hitIndex&&hitIndex.groups===state.groups&&hitIndex.count===state.groups.length&&hitIndex.width===canvas.width&&hitIndex.height===canvas.height)return hitIndex;
  const byId=new Map(),dynamic=[];
  for(const [order,group] of state.groups.entries()){
    if(group.mergedInto||group.objectMapBatch||group.objectRemoved)continue;
    if(group.objectMapKey===state.objectMap?.sourceKey&&group.objectMapInstanceId)byId.set(group.objectMapInstanceId,group);
    // Prepared, unedited objects belong to the flat ID raster. Index only
    // moved, shape-edited and manually created objects as spatial overrides.
    if(!group.mapPrepared||group.active||group.objectOriginal||group.footprint)
      dynamic.push({group,order,bounds:group.area});
  }
  hitIndex={groups:state.groups,count:state.groups.length,width:canvas.width,height:canvas.height,
    byId,grid:buildObjectHitGrid(dynamic,canvas.width,canvas.height)};
  return hitIndex;
}
function hitObjectAt(point){
  if(!point||point.x<0||point.y<0||point.x>=canvas.width||point.y>=canvas.height)return null;
  const index=indexedObjects();
  // Only groups in this small spatial cell are considered; never scan every
  // full-resolution object mask on each pointer move.
  for(const item of index.grid.candidates(point))
    if(cropContainsPoint(core.groupMaskCrop(item.group),point))return item.group;
  const id=labels?labelAt(labels,mapWidth,mapHeight,point.x,point.y,canvas.width,canvas.height):0;
  const mapped=index.byId.get(id);
  // A moved object must not remain selectable at its obsolete Base pixels.
  return mapped&&!mapped.active?mapped:null;
}
const controls=document.createElement('div');controls.className='object-selection-controls';
controls.innerHTML='<span id="objectMapStatus" role="status">Preparing objects…</span><button id="objectMapRetry" type="button" hidden>Retry objects</button>';
(document.querySelector('.selection-toolset')?.closest('.toolbar-section')||document.getElementById('tools'))?.append(controls);
document.getElementById('autoCreateGroupsBtn')?.remove();
const status=document.getElementById('objectMapStatus'),retry=document.getElementById('objectMapRetry');
const groupsStatus=document.createElement('span');
groupsStatus.id='objectMapGroupStatus';
groupsStatus.className='object-map-group-status';
groupsStatus.setAttribute('role','status');
groupsStatus.setAttribute('aria-live','polite');
groupsStatus.textContent='Objects not prepared';
document.getElementById('inspectorHeading')?.after(groupsStatus);
state.autoObjectSelect=true;state.featherEnabled=false;
retry.addEventListener('click',()=>void prepareBase(true));
const preview=makeCanvas(1,1);preview.className='object-map-hover-overlay';preview.hidden=true;preview.setAttribute('aria-hidden','true');document.getElementById('canvasWrap').append(preview);
const selectedOverlay=makeCanvas(1,1);selectedOverlay.id='selectedObjectOverlay';selectedOverlay.className='object-map-selection-overlay';selectedOverlay.setAttribute('aria-hidden','true');document.getElementById('canvasWrap').append(selectedOverlay);
function drawSelection(){
  const crop=state.selectionGeometry?.crop;
  selectedOverlay.hidden=!state.objectMapSelection||(!state.selectionMask&&!crop)||
    state.before||state.selectionOverlayHidden||Boolean(window.MosaicPremium?.isPreviewing());
  if(selectedOverlay.hidden)return;
  if(crop){tintCrop(selectedOverlay,crop,.12);return}
  const bounds=core.selectionBounds();
  if(!bounds)return;
  const image=makeCanvas(bounds.w,bounds.h);
  image.getContext('2d').drawImage(state.selectionMask,-bounds.x,-bounds.y);
  tintCrop(selectedOverlay,{mask:image,x:bounds.x,y:bounds.y},.12);
}
function update(text,failed=false,allowRetry=failed){
  status.textContent=text;
  groupsStatus.textContent=text;
  groupsStatus.classList.toggle('error',failed);
  status.classList.toggle('error',failed);
  retry.hidden=!allowRetry;
  // The old SlimSAM status element is no longer present in index.html.
  const legacyStatus=document.getElementById('slimsamWandStatus');
  if(legacyStatus)legacyStatus.textContent=text;
}
function sourceKey(base){
  const sample=makeCanvas(64,64),x=sample.getContext('2d');x.drawImage(base,0,0,64,64);let hash=2166136261;
  for(const byte of x.getImageData(0,0,64,64).data)hash=Math.imul(hash^byte,16777619)>>>0;
  return base.width+'x'+base.height+':'+hash.toString(16);
}
function hydrate(){
  let map=state.objectMap;if(!map?.raster)return false;
  if(!Array.isArray(map.entries)||map.raster.width*map.raster.height>2500000||state.master&&map.sourceKey!==sourceKey(state.master)&&!state.objectMapLocked){state.objectMap=null;labels=null;return false}
  if(map.version!==CLEANUP_VERSION){
    // Previously saved edited projects own stable Object IDs. Avoid silently
    // reindexing those identities when the cleanup algorithm changes.
    const hasEdits=map.version>=3&&state.groups.some(g=>g.objectMapKey===map.sourceKey&&g.patchIds?.length);
    if(!hasEdits&&(map.colorRaster||map.version<3)){
      map=prepareInstanceMap(map,makeCanvas,window.MozMaskGeometry);
      state.objectMap=map;(state.objectMaps??={})[map.sourceKey]=map;
    }
  }
  mapWidth=map.raster.width;mapHeight=map.raster.height;labels=readInstanceLabels(map);
  entryById=new Map(map.entries.map(entry=>[entry.id,entry]));sourceCropCache.clear();invalidateHitIndex();
  migrateLegacyGroups(map);
  window.MosaicObjectManager.ensureObjects(map,maskForIds,maskCropForEntry);core.renderGroups();
  if(!map.entries.length){
    update('No separate objects found · click Retry objects',true);
    for(const waiter of preparedWaiters)
      waiter.onStatus('No separate objects detected. Click Retry objects to finish splitting.');
    return true;
  }
  const needsReview=Array.isArray(map.qualityWarnings)&&map.qualityWarnings.length>0;
  update(needsReview?'Objects ready · review map quality':map.labelsAvailable?'Objects ready':'Objects ready · categories unavailable',false,needsReview);
  notifyPrepared();return true;
}
function baseLoaded(base){
  if(pendingBase&&pendingBase!==base)
    rejectPrepared(Error('The Base changed before object preparation finished.'));
  if(state.objectMapLocked&&state.objectMap?.raster){hydrate();return}
  if(pendingBase===base&&(busy||attemptedBase===base)){if(state.objectMap)hydrate();return}
  pendingBase=base;serial++;busy=false;attemptedBase=null;pendingClick=null;labels=null;state.objectMapSelection=null;selectedOverlay.hidden=true;
  const cached=state.objectMaps?.[sourceKey(base)];if(cached)state.objectMap=cached;
  if(state.objectMap?.sourceKey===sourceKey(base)&&hydrate())return;
  state.objectMap=null;void prepareBase();
}
async function prepareBase(force=false){
  const base=pendingBase||state.master;if(!base||base===heldImage||busy||(!force&&attemptedBase===base))return;
  if(state.objectMap?.sourceKey===sourceKey(base)&&!force&&hydrate())return;
  const ticket=serial;
  try{
    await window.MosaicAccount.ready();
    if(!window.MosaicAuth.isReady()&&!await window.MosaicAuth.restore()){update('Connect AI to prepare objects');return}
    if(ticket!==serial||state.master!==base||busy)return;
    attemptedBase=base;busy=true;update('Preparing objects…');
    for(const waiter of preparedWaiters)
      waiter.onStatus('Preparing original Base objects…');
    window.MosaicMaskProgress?.show('objects','Preparing objects','Preparing the working image object map…');
    const target=objectMapSize(base.width,base.height),w=target.width,h=target.height;
    const sample=makeCanvas(w,h);sample.getContext('2d').drawImage(base,0,0,w,h);
    const answer=await window.MosaicAuth.request('/api/ai/object-map',{image:sample.toDataURL('image/jpeg',.94)});
    if(ticket!==serial||state.master!==base)return;
    const image=new Image();image.src='data:image/png;base64,'+answer.image;await image.decode();
    if(image.width!==w||image.height!==h)throw Error('The object map changed image dimensions. Retry objects.');
    const map=makeCanvas(w,h),x=map.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);
    const decoded=decodeColors(x.getImageData(0,0,w,h).data,w,h),pixels=x.createImageData(w,h);
    for(let i=0;i<decoded.labels.length;i++){pixels.data[i*4]=decoded.labels[i];pixels.data[i*4+3]=255}x.putImageData(pixels,0,0);
    if(ticket!==serial||state.master!==base)return;
    const legend=new Map((answer.legend||[]).map(entry=>[entry.id,entry]));
    state.objectMap=prepareInstanceMap({sourceKey:sourceKey(base),raster:map,labelsAvailable:Boolean(answer.labelsAvailable),qualityWarnings:decoded.warnings,entries:decoded.ids.map(id=>{const item=legend.get(id);return {id,color:PALETTE[id-1].color,category:CATEGORIES.includes(item?.category)?item.category:'Other',group:item?.group||'',label:item?.label||'Object '+id}})},makeCanvas,window.MozMaskGeometry);
    (state.objectMaps??={})[state.objectMap.sourceKey]=state.objectMap;
    hydrate();
    if(pendingClick&&active){const pending=pendingClick;pendingClick=null;selectAt(pending.point,pending.options)}
  }catch(error){if(ticket===serial){
    update(error.message||'Object preparation failed',true);
    for(const waiter of preparedWaiters)
      waiter.onStatus('Object mapping failed. Click Retry objects to finish splitting the generated image.');
  }}
  finally{if(ticket===serial){busy=false;window.MosaicMaskProgress?.hide('objects')}}
}
function maskCropForEntry(entry){
  const crop=cropObjectLabel(labels,mapWidth,mapHeight,entry.box,entry.id,canvas.width,canvas.height);
  if(!crop)return null;
  const mask=makeCanvas(crop.width,crop.height),ctx=mask.getContext('2d'),pixels=ctx.createImageData(crop.width,crop.height);
  for(let i=0;i<crop.alpha.length;i++)if(crop.alpha[i])pixels.data.fill(255,i*4,i*4+4);
  ctx.putImageData(pixels,0,0);
  return {mask,x:crop.x,y:crop.y};
}
function maskForIds(ids){
  const selected=new Set(ids),mask=makeCanvas(canvas.width,canvas.height),x=mask.getContext('2d'),pixels=x.createImageData(mask.width,mask.height);
  for(let y=0;y<mask.height;y++)for(let xx=0;xx<mask.width;xx++){
    const id=labelAt(labels,mapWidth,mapHeight,xx,y,mask.width,mask.height);
    if(selected.has(id))pixels.data.fill(255,(y*mask.width+xx)*4,(y*mask.width+xx)*4+4);
  }
  x.putImageData(pixels,0,0);return mask;
}
function liveObjectAt(point){return hitObjectAt(point)}
function compactObjectPart(group){
  const crop=core.groupMaskCrop(group);
  if(!crop?.mask)return null;
  const patch=state.patches.get(group.active);
  return {objectKey:group.objectMapObjectKey||group.id,
    instanceId:group.objectMapInstanceId||null,category:group.category,label:group.name,
    mapKey:group.objectMapKey||'manual',mask:null,maskCrop:crop,
    paths:patch?core.patchSelectionPaths(patch):group.maskPaths||[]};
}
function drawPartMask(context,part){
  if(part.maskCrop?.mask)context.drawImage(part.maskCrop.mask,part.maskCrop.x,part.maskCrop.y);
  else if(part.mask)context.drawImage(part.mask,0,0);
}
function partsOverlappingMask(mask){
  const index=indexedObjects(),bounds=core.exactMaskBoundingBox(mask);
  if(!bounds)return [];
  const selected=new Map();
  const remember=group=>{
    if(!group||group.mergedInto||group.objectRemoved||group.objectMapBatch)return;
    const part=compactObjectPart(group);
    if(part)selected.set(group.id,part);
  };
  if(labels&&mapWidth&&mapHeight){
    // One scan of the saved low-resolution ID raster. No per-object
    // full-frame canvas, and no SAM / inference request.
    const reduced=makeCanvas(mapWidth,mapHeight),ctx=reduced.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;ctx.drawImage(mask,0,0,mapWidth,mapHeight);
    const alpha=ctx.getImageData(0,0,mapWidth,mapHeight).data;
    for(const id of intersectObjectIds(labels,mapWidth,mapHeight,alpha,mapWidth,mapHeight)){
      const group=index.byId.get(id);
      // An edited Option owns its *current* crop, not obsolete Base pixels.
      if(group&&!group.active)remember(group);
    }
  }
  // Edited, moved, and manually created Groups are checked only in cells
  // intersecting the drawn shape, at their actual cropped geometry.
  const candidates=labels?index.grid.candidatesInBox(bounds):
    state.groups.map((group,order)=>({group,order,bounds:group.area}));
  for(const {group} of candidates){
    if(group.mergedInto||group.objectMapBatch||group.objectRemoved)continue;
    const crop=core.groupMaskCrop(group);
    if(!crop?.mask)continue;
    const x=Math.max(bounds.x,crop.x),y=Math.max(bounds.y,crop.y);
    const right=Math.min(bounds.x+bounds.w,crop.x+crop.mask.width);
    const bottom=Math.min(bounds.y+bounds.h,crop.y+crop.mask.height);
    const w=Math.ceil(right-x),h=Math.ceil(bottom-y);
    if(w<=0||h<=0)continue;
    const overlap=makeCanvas(w,h),ctx=overlap.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(mask,-x,-y);
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(crop.mask,crop.x-x,crop.y-y);
    const bits=ctx.getImageData(0,0,w,h).data;
    let count=0;for(let i=3;i<bits.length;i+=4)if(bits[i]>=128)count++;
    if(count>=Math.max(1,Math.min(6,Math.round(w*h*.002))))remember(group);
  }
  return [...selected.values()];
}

// Line, Rectangle and Oval select all touched Object IDs as one temporary
// generation area. They are not permanently merged into a single object.
// After generation the existing independent masks receive separate Options.
function selectShape(mask){
  if(state.pendingSourceId||state.maskEditOnly)return null;
  const parts=partsOverlappingMask(mask);
  if(!parts.length)return null;
  const combined=makeCanvas(canvas.width,canvas.height),ctx=combined.getContext('2d');
  for(const part of parts)drawPartMask(ctx,part);
  picking=true;pickingIds=[];pickingMode='new';
  operation={parts:[],picked:parts};
  return combined;
}
function refineMask(mask,tool){
  // Add/subtract also snap the NEW drawn shape to current object masks.
  if(!['rect','ellipse','lasso','freehand'].includes(tool)||state.pendingSourceId||state.maskEditOnly)return mask;
  const parts=partsOverlappingMask(mask);
  if(!labels&&!parts.length)return mask;
  if(!parts.length){
    // Recover initial map shapes if a legacy project has no prepared Object Groups.
    const ids=idsOverlappingShape(labels,mapWidth,mapHeight,mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data,mask.width,mask.height);
    for(const id of ids)parts.push(partForId(id));
  }
  picking=true;pickingIds=[];pickingMode=state.selectionMode;operation={parts:snapshotSelection(),picked:parts};
  if(!parts.length)core.toast('No meaningful object overlap found. Enlarge the selection.');
  const result=makeCanvas(canvas.width,canvas.height);
  for(const part of parts)drawPartMask(result.getContext('2d'),part);
  return result;
}
function selectionCompleted(){
  if(picking){
    const byKey=new Map((pickingMode==='new'?[]:operation?.parts||[]).map(part=>[part.objectKey,part]));
    for(const part of operation?.picked||pickingIds.map(partForId)){if(pickingMode==='subtract')byKey.delete(part.objectKey);else if(!byKey.has(part.objectKey))byKey.set(part.objectKey,part)}
    // Snapped selections are already unions of whole Object IDs.
    // Keep their compact references; generation materializes only chosen IDs.
    adoptSelection([...byKey.values()]);picking=false;
  }else if(operation?.parts?.length)adoptSelection(reconcileParts(state.selectionMask,operation.parts));
  operation=null;
  if(state.objectSelectionParts?.length){state.selectionPaths=state.objectSelectionParts.flatMap(part=>part.paths||core.maskPathsFromRaster(part.mask));state.selectionPoints=state.selectionPaths.flat()}
}
const cloneMask=mask=>{const out=makeCanvas(mask.width,mask.height);out.getContext('2d').drawImage(mask,0,0);return out};
// Adopt always copies masks before writing, so history can share these immutable masks.
function snapshotSelection(){return (state.objectSelectionParts||[]).map(part=>({...part}))}
function adoptIdentity(group){
  const part={objectKey:group.objectMapObjectKey||group.id,
    instanceId:group.objectMapInstanceId||null,
    category:group.category,label:group.name,mapKey:group.objectMapKey||'manual',
    mask:null,paths:state.selectionPaths};
  state.objectSelectionParts=[part];
  state.objectMapSelection=state.objectMap?.sourceKey||part.mapKey;
  state.objectMapSelectedIds=part.instanceId?[part.instanceId]:[];
  window.MosaicObjectManager?.refreshActions?.();
}
function adoptSelection(parts){
  const canonical=new Map();
  for(const part of parts){
    const resolved=window.MosaicObjectManager.resolvePart(part,true),key=resolved.objectKey,previous=canonical.get(key);
    if(previous){
      if(part.mask){if(!previous.mask)previous.mask=cloneMask(part.mask);
        else previous.mask.getContext('2d').drawImage(part.mask,0,0);}
      previous.paths=null;
    }else canonical.set(key,{...part,objectKey:key,mapKey:resolved.mapKey,label:resolved.label,
      instanceId:resolved.instanceId,mask:part.mask?cloneMask(part.mask):null});
  }
  state.objectSelectionParts=[...canonical.values()];state.objectMapSelection=canonical.size?(state.objectMap?.sourceKey||parts[0].mapKey):null;state.objectMapSelectedIds=state.objectSelectionParts.map(p=>p.instanceId).filter(Boolean);window.MosaicObjectManager.refreshActions();
}
function partForId(id){
  const group=indexedObjects().byId.get(id);if(group)return compactObjectPart(group);
  const entry=entryById.get(id);return entry?{objectKey:entry.key,instanceId:id,category:entry.category,label:entry.label,mapKey:state.objectMap.sourceKey,mask:maskForIds([id])}:null;
}
function reconcileParts(mask,parts){
  if(!parts.length)return [];
  const w=mask.width,h=mask.height,target=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,owner=new Uint16Array(w*h);
  const outputs=parts.map((stored,index)=>{
    const part=stored.mask?stored:window.MosaicObjectManager.resolvePart(stored);
    if(!part.mask)return null;
    const bits=part.mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;for(let i=0;i<owner.length;i++)if(bits[i*4+3]>=128&&!owner[i])owner[i]=index+1;const frame=makeCanvas(w,h),ctx=frame.getContext('2d');return {...part,mask:frame,ctx,pixels:ctx.createImageData(w,h),box:core.exactMaskBoundingBox(part.mask),count:0}});
  if(outputs.some(item=>!item))return [];
  for(let i=0;i<owner.length;i++)if(target[i*4+3]>=128){
    let which=owner[i]-1;if(which<0){const x=i%w,y=(i-x)/w;let best=Infinity;outputs.forEach((part,index)=>{const b=part.box;if(!b)return;const distance=Math.max(0,b.x-x,x-b.x-b.w)**2+Math.max(0,b.y-y,y-b.y-b.h)**2;if(distance<best){best=distance;which=index}})}
    if(which>=0){outputs[which].pixels.data.fill(255,i*4,i*4+4);outputs[which].count++}
  }
  return outputs.filter(part=>part.count).map(({ctx,pixels,box,count,...part})=>{ctx.putImageData(pixels,0,0);return {...part,paths:core.maskPathsFromRaster(part.mask)}});
}
function cancelSelection(){state.objectMapSelection=null;state.objectMapSelectedIds=[];state.objectSelectionParts=[];window.MosaicObjectManager.refreshActions();selectedOverlay.hidden=true;preview.getContext('2d').clearRect(0,0,preview.width,preview.height)}
function partsForSelection(mask,stored=false){
  if(!mask)return state.objectSelectionParts||[];
  if(!stored&&state.objectSelectionParts?.length)return reconcileParts(mask,state.objectSelectionParts);
  if(!labels||!state.objectMap||!stored&&state.objectMapSelection!==state.objectMap.sourceKey)return null;
  const rgba=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data,entries=new Map(state.objectMap.entries.map(e=>[e.id,e])),parts=new Map();
  for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++){
    const offset=(y*mask.width+x)*4;if(rgba[offset+3]<128)continue;
    const id=labelAt(labels,mapWidth,mapHeight,x,y,mask.width,mask.height),entry=entries.get(id);if(!entry)continue;
    let part=parts.get(id);
    if(!part){const image=makeCanvas(mask.width,mask.height),ctx=image.getContext('2d');part={instanceId:id,objectKey:entry.key,category:entry.category,labels:new Set(),count:0,entry,mask:image,ctx,pixels:ctx.createImageData(mask.width,mask.height)};parts.set(id,part)}
    part.count++;part.labels.add(entry.label);part.pixels.data.fill(255,offset,offset+4);
  }
  return [...parts.values()].map(part=>{
    part.ctx.putImageData(part.pixels,0,0);
    const expected=part.entry.area*mask.width*mask.height/(mapWidth*mapHeight);
    const paths=part.count>=expected*.98?part.entry.paths.map(path=>path.map(p=>({x:p.x*mask.width/mapWidth,y:p.y*mask.height/mapHeight}))):core.maskPathsFromRaster(part.mask);
    return {instanceId:part.instanceId,objectKey:part.objectKey,category:part.category,label:[...part.labels].join(', '),mask:part.mask,paths,mapKey:state.objectMap.sourceKey};
  });
}
function migrateLegacyGroups(map){
  const legacy=state.groups.filter(group=>group.objectMapKey===map.sourceKey&&!group.objectMapObjectKey&&!group.objectMapBatch);
  let changed=false;
  for(const previous of legacy){
    const parts=(partsForSelection(core.groupMask(previous),true)||[]).filter(part=>part.category===previous.objectMapCategory),options=previous.patchIds.map(id=>state.patches.get(id)).filter(patch=>patch&&!patch.hideUntilReady);
    if(!parts.length||!options.length)continue;
    for(const part of parts){
      const group=core.newGroup(part.mask,part.category);group.objectMapKey=map.sourceKey;group.objectMapCategory=part.category;group.objectMapObjectKey=part.objectKey;group.objectMapInstanceId=part.instanceId;
      group.name=part.label.charAt(0).toUpperCase()+part.label.slice(1);group.objectName=group.name;
      for(const previousPatch of options){
        const mask=makeCanvas(canvas.width,canvas.height),x=mask.getContext('2d');x.drawImage(core.displayedPatchMask(previousPatch),0,0);x.globalCompositeOperation='destination-in';x.drawImage(part.mask,0,0);if(!core.exactMaskBoundingBox(mask))continue;
        let sourceId=previousPatch.sourceId;
        if(previousPatch.corners?.length){
          const featherBefore=state.featherEnabled;state.featherEnabled=false;
          let image;try{image=core.renderedPatchLayer(previousPatch)}finally{state.featherEnabled=featherBefore}
          sourceId=core.uid('object_source');state.sources.set(sourceId,{id:sourceId,name:group.name,canvas:image});
        }
        const patch={...previousPatch,id:core.uid('object_patch'),groupId:group.id,sourceId,mask,bbox:core.exactMaskBoundingBox(mask),corners:null,maskPaths:part.paths,maskPoints:part.paths.flat(),objectMapObjectKey:part.objectKey,objectMapInstanceId:part.instanceId,objectLabel:part.label,request:{...previousPatch.request,mask}};
        state.patches.set(patch.id,patch);group.patchIds.push(patch.id);if(previous.active===previousPatch.id)group.active=patch.id;
      }
      if(group.patchIds.length)core.refreshGroupFootprint(group);else state.groups=state.groups.filter(g=>g!==group);
    }
    state.groups=state.groups.filter(group=>group!==previous);for(const id of previous.patchIds)state.patches.delete(id);changed=true;
  }
  if(changed){state.selectedPatchId=null;state.draftGroupId=null;core.renderGroups();core.render()}
}
function onToolChange(tool){active=tool==='wand'||tool==='select';leave();if(active&&!labels&&!state.groups.some(g=>g.mapPrepared))update(busy?'Preparing objects…':'Upload Base and connect AI to prepare objects',Boolean(attemptedBase&&!busy&&!state.objectMap))}
// Both the hover tint and the selected-object tint are small local canvases.
// Their CSS position maps the crop back into the Master coordinate system.
function tintCrop(target,crop,opacity){
  if(!crop?.mask)return;
  const {mask,x,y}=crop;
  if(target.width!==mask.width)target.width=mask.width;
  if(target.height!==mask.height)target.height=mask.height;
  const t=target.getContext('2d');
  t.clearRect(0,0,mask.width,mask.height);t.drawImage(mask,0,0);
  t.globalCompositeOperation='source-in';t.fillStyle='rgba(180,147,245,'+opacity+')';
  t.fillRect(0,0,mask.width,mask.height);t.globalCompositeOperation='source-over';
  target.style.position='absolute';target.style.inset='auto';target.style.pointerEvents='none';
  target.style.left=(x/canvas.width*100)+'%';target.style.top=(y/canvas.height*100)+'%';
  target.style.width=(mask.width/canvas.width*100)+'%';
  target.style.height=(mask.height/canvas.height*100)+'%';
  target.hidden=false;
}
function idAt(point,group){
  if(group)return group.id;
  if(!labels)return 0;
  const id=labelAt(labels,mapWidth,mapHeight,point.x,point.y,canvas.width,canvas.height);
  // A shifted/replaced object is no longer located at its original ID pixels.
  return indexedObjects().byId.get(id)?.active?0:id;
}
function cropAt(point,group){
  if(group)return core.groupMaskCrop(group);
  const id=labels?labelAt(labels,mapWidth,mapHeight,point.x,point.y,canvas.width,canvas.height):0;
  if(!id)return null;
  if(!sourceCropCache.has(id)){
    const entry=entryById.get(id);
    sourceCropCache.set(id,entry?maskCropForEntry(entry):null);
  }
  return sourceCropCache.get(id);
}
function hoverAt(point){
  if(!active||state.before||state.busy||window.MosaicPremium?.isPreviewing())return leave();
  const live=liveObjectAt(point);
  if(!live&&(!labels||state.objectMapLocked))return leave();
  const id=idAt(point,live);if(!id)return leave();
  const crop=cropAt(point,live);if(!crop)return leave();
  if(id===hoverId&&hoverMask===crop.mask&&!preview.hidden)return;
  hoverId=id;hoverMask=crop.mask;
  tintCrop(preview,crop,.10);core.overlay.style.cursor='pointer';
}
function leave(){hoverId=0;hoverMask=null;preview.hidden=true}
function selectAt(point,options={}){
  if(!active)return;
  const live=liveObjectAt(point);
  if(live&&!options.append&&!options.subtract&&!state.maskEditOnly&&!state.pendingSourceId){
    core.selectGroupMask(live,{showOutline:true});leave();return;
  }
  if(!live&&(!labels||state.objectMapLocked)){
    if(busy){pendingClick={point:{...point},options};core.message('Object selection queued until the image map is ready.');}
    else if(!options.append&&!options.subtract){core.resetSelection();core.render();}
    return;
  }
  const id=idAt(point,live);
  if(!id){if(!options.append&&!options.subtract){core.resetSelection();core.render()}return}
  core.ensureSelectionMask();
  const hasObjects=state.objectSelectionParts?.length;
  const mode=options.append&&hasObjects?'add':options.subtract&&hasObjects?'subtract':'new';core.setMode(mode);
  const part=live?compactObjectPart(live):partForId(id);if(!part)return;
  operation={parts:snapshotSelection(),picked:[part]};picking=true;pickingIds=[id];pickingMode=mode;state.maskEditOnly=false;state.selectionTargetPatchId=null;state.draftGroupId=null;
  const selection=makeCanvas(canvas.width,canvas.height);drawPartMask(selection.getContext('2d'),part);
  core.applyWandMask(selection);picking=false;leave();
}
function selectObject(object,{append=false}={}){
  if(!append){core.selectGroupMask(object,{showOutline:true});return}
  core.ensureSelectionMask();
  const part=compactObjectPart(object),mode=append&&state.objectSelectionParts?.length?'add':'new';operation={parts:snapshotSelection(),picked:[part]};picking=true;pickingMode=mode;state.selectionTargetPatchId=null;state.draftGroupId=null;state.selectedPatchId=null;state.maskEditOnly=false;core.setMode(mode);const selection=makeCanvas(canvas.width,canvas.height);drawPartMask(selection.getContext('2d'),part);core.applyWandMask(selection);picking=false}
function invalidateBase(){rejectPrepared(Error('Original Object Map invalidated.'));serial++;busy=false;pendingBase=state.master;attemptedBase=pendingBase;labels=null;state.objectMap=null;state.objectMapSelection=null;if(state.master)delete state.objectMaps?.[sourceKey(state.master)];leave();window.MosaicMaskProgress?.hide('objects');update('Image changed · prepare objects again',true)}
function imageChanged(){if(state.objectMapLocked)return;if(state.master&&state.master!==heldImage&&state.master!==pendingBase)baseLoaded(state.master)}
window.MosaicObjectMap={imageReady:baseLoaded,baseLoaded,prepareBase,whenReady,hasPreparedObjects,refineMask,selectShape,selectionCompleted,cancelSelection,partsForSelection,adoptSelection,adoptIdentity,snapshotSelection,selectObject,hitTest:hitObjectAt,invalidateHitIndex,cropAt,tintCrop,hasSelection:()=>Boolean(state.objectSelectionParts?.length),hydrate,invalidateBase,drawSelection,holdImage:image=>{heldImage=image}};
// Preserve the canvas tool integration while removing model downloads and all
// SAM calls. Wand hover/click are now lookups into the saved Base index map.
window.MosaicSlimWand={onToolChange,hoverAt,selectAt,leave,reset:()=>{active=false;pendingClick=null;leave()},preload(){},imageChanged,imageKey:()=>state.objectMap?.sourceKey};
window.addEventListener('mosaic:keyconnected',()=>void prepareBase());
window.addEventListener('mosaic:account',()=>void prepareBase());
window.addEventListener('mosaic:projectloaded',()=>{rejectPrepared(Error('Project changed.'));serial++;busy=false;heldImage=null;pendingBase=state.master;attemptedBase=null;state.featherEnabled=false;state.autoObjectSelect=true;labels=null;if(!hydrate()&&state.master)baseLoaded(state.master);if(state.objectSelectionParts?.length)adoptSelection(state.objectSelectionParts)});
if(state.master)baseLoaded(state.master);
