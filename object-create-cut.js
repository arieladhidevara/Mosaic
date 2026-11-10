/* Manual Create and Cut are pure local mask operations; no AI calls.
   Created masks are new foreground object identities, never a selection of an existing ID. */
import './app.js';
import {splitMaskByStroke} from './mask-cut.mjs';
const core=window.MosaicCore,{state,canvas,makeCanvas}=core;
const clone=source=>{const out=makeCanvas(source.width,source.height);out.getContext('2d').drawImage(source,0,0);return out;};
function binary(mask){
  const rgba=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
  const bits=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<bits.length;i++)bits[i]=rgba[i*4+3]>=128?1:0;
  return bits;
}
function raster(bits){
  const out=makeCanvas(canvas.width,canvas.height),ctx=out.getContext('2d'),data=ctx.createImageData(out.width,out.height);
  for(let i=0;i<bits.length;i++)if(bits[i])data.data.fill(255,i*4,i*4+4);
  ctx.putImageData(data,0,0);return out;
}
function overlappingGroupIds(mask){
  const small=makeCanvas(256,Math.max(1,Math.round(256*canvas.height/canvas.width)));
  const ctx=small.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.drawImage(mask,0,0,small.width,small.height);
  const target=ctx.getImageData(0,0,small.width,small.height).data;
  return state.groups.filter(g=>!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved).filter(g=>{
    const frame=makeCanvas(small.width,small.height),c=frame.getContext('2d',{willReadFrequently:true});
    c.imageSmoothingEnabled=false;c.drawImage(core.groupMask(g),0,0,frame.width,frame.height);
    const pixels=c.getImageData(0,0,frame.width,frame.height).data;
    for(let p=3;p<pixels.length;p+=4)if(pixels[p]>=128&&target[p]>=128)return true;
    return false;
  }).map(g=>g.id);
}
function registerForeground(mask,name='Created object'){
  const bbox=core.exactMaskBoundingBox(mask);if(!bbox)throw Error('Draw an area inside the image.');
  const behind=overlappingGroupIds(mask);
  const frame=core.composeApprovedCanvas(),group=core.newGroup(mask,'Region');
  group.objectMapKey='manual';group.objectMapObjectKey=core.uid('manual_object');
  group.objectId=group.id;group.mapPrepared=true;group.manualName=true;
  group.objectName=group.name=name;group.objectBehind=[...behind];
  group.createdLocally=true;group.collectionId=null;
  // An object drawn later is ABOVE every object it overlaps; place its ID
  // in the behind object's scene relationship, not the other way around.
  group.objectBehind=[];
  for(const id of behind){const covered=state.groups.find(item=>item.id===id);if(covered)
    covered.objectBehind=[...new Set([...(covered.objectBehind||[]),group.id])];}
  const sourceId=core.uid('create_source'),patchId=core.uid('create_option');
  state.sources.set(sourceId,{id:sourceId,name:'Created object pixels',canvas:clone(frame)});
  const paths=core.maskPathsFromRaster(mask);
  state.patches.set(patchId,{id:patchId,sourceId,groupId:group.id,mask:clone(mask),bbox,
    maskPaths:paths,maskPoints:paths.flat(),name:'Original',manualName:true,
    editMode:'create',objectId:group.id,objectMapObjectKey:group.objectMapObjectKey});
  group.patchIds.push(patchId);group.active=patchId;
  core.refreshGroupFootprint(group);
  window.MosaicObjectManager?.autoGroup?.();
  core.resetSelection();core.renderGroups();core.render();
  core.selectGroupMask(group,{showOutline:true});
  core.focusGroupInSidebar(group);
  core.showQuickPrompt();
  core.toast('New foreground object created. It can be edited independently.');
  return group;
}
const svg=document.getElementById('selectionDraft');
const path=document.createElementNS('http://www.w3.org/2000/svg','path');
path.id='cutStrokePreview';path.setAttribute('fill','none');path.setAttribute('stroke','#d5adff');
path.setAttribute('stroke-width','3');path.setAttribute('vector-effect','non-scaling-stroke');
path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');
path.setAttribute('stroke-dasharray','6 4');path.hidden=true;svg.append(path);
let stroke=null;
function selectedObject(){
  const g=state.groups.find(g=>g.id===state.draftGroupId&&!g.mergedInto&&!g.objectRemoved)||
    state.groups.find(g=>g.patchIds.includes(state.selectionTargetPatchId)&&!g.mergedInto&&!g.objectRemoved);
  return g&&core.exactMaskBoundingBox(core.groupMask(g))?g:null;
}
function beginCut(p){
  const group=selectedObject();
  if(!group){core.toast('Select an existing object with Pointer before using Cut.');return false;}
  stroke={group,points:[p],generation:state.selectionGeneration,master:state.master};
  path.hidden=false;paintStroke();core.hideQuickPrompt();return true;
}
function paintStroke(){
  if(!stroke)return;
  const pts=stroke.points;
  path.setAttribute('d',pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' '));
}
function moveCut(p){
  if(!stroke)return;
  const prev=stroke.points.at(-1);
  if(Math.hypot(prev.x-p.x,prev.y-p.y)>1.5/Math.max(.1,state.zoom)){
    stroke.points.push(p);paintStroke();
  }
}
function stopCut(){path.hidden=true;path.removeAttribute('d');stroke=null;}
function cut(){
  if(!stroke)return;
  const job=stroke;stopCut();
  if(state.selectionGeneration!==job.generation||state.master!==job.master){core.toast('Scene changed during Cut.');return;}
  const group=job.group,original=core.groupMask(group);
  let pieces;
  try{
    const parts=splitMaskByStroke(binary(original),canvas.width,canvas.height,job.points,
      Math.max(3,Math.round(3/Math.max(.5,state.zoom))));
    pieces=parts.parts.map(raster);
  }catch(error){core.toast(error.message);return;}
  const sourceSnapshot=clone(core.composeApprovedCanvas());
  const names=['A','B'],newGroups=[];
  for(let k=0;k<2;k++){
    const mask=pieces[k],child=core.newGroup(mask,group.category);
    child.name=group.name+' · '+names[k];child.objectName=child.name;child.manualName=true;
    child.objectMapKey='manual';child.objectMapObjectKey=core.uid('cut_object');
    child.objectId=child.id;child.mapPrepared=true;child.cutParentId=group.id;
    child.collectionId=group.collectionId||null;
    child.objectBehind=[...(group.objectBehind||[])];
    let active=null;
    for(const oldId of group.patchIds){
      const previous=state.patches.get(oldId);if(!previous)continue;
      const visible=core.displayedPatchMask(previous);
      const clipped=clone(visible),x=clipped.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(mask,0,0);
      if(!core.exactMaskBoundingBox(clipped))continue;
      let sourceId=previous.sourceId;
      if(previous.corners?.length){
        const source=core.renderedPatchLayer(previous);sourceId=core.uid('cut_source');
        state.sources.set(sourceId,{id:sourceId,name:'Transformed option before Cut',canvas:clone(source)});
      }
      const paths=core.maskPathsFromRaster(clipped),id=core.uid('cut_option');
      const patch={...previous,id,groupId:child.id,sourceId,mask:clipped,corners:null,
        bbox:core.exactMaskBoundingBox(clipped),maskPaths:paths,maskPoints:paths.flat(),
        objectId:child.id,objectMapObjectKey:child.objectMapObjectKey,
        cutFromPatchId:oldId,editMode:'cut',objectBehind:[...(child.objectBehind||[])]};
      state.patches.set(id,patch);child.patchIds.push(id);
      if(oldId===group.active)active=id;
    }
    if(!active){
      // Prepared object-map instances have no prior Option. Capture their visible pixels.
      const sourceId=core.uid('cut_original_source');
      state.sources.set(sourceId,{id:sourceId,name:'Original before Cut',canvas:clone(sourceSnapshot)});
      const id=core.uid('cut_original'),paths=core.maskPathsFromRaster(mask);
      state.patches.set(id,{id,groupId:child.id,sourceId,mask:clone(mask),bbox:core.exactMaskBoundingBox(mask),
        maskPaths:paths,maskPoints:paths.flat(),name:'Original',manualName:true,editMode:'cut',objectId:child.id});
      child.patchIds.push(id);active=id;
    }
    child.active=active;core.refreshGroupFootprint(child);newGroups.push(child);
  }
  group.mergedInto=newGroups[0].id;group.cutArchived=true;
  group.splitChildren=newGroups.map(g=>g.id);
  for(const foreground of state.groups){
    if(foreground===group)continue;
    if(foreground.objectBehind?.includes(group.id))
      foreground.objectBehind=[...new Set(foreground.objectBehind.flatMap(id=>id===group.id?group.splitChildren:[id]))];
  }
  (state.cutHistory??=[]).push({parentId:group.id,children:group.splitChildren,
    originalName:group.name,createdAt:new Date().toISOString(),cutPoints:job.points});
  core.resetSelection();window.MosaicObjectManager?.autoGroup?.();core.renderGroups();core.render();
  core.selectTool('select');core.selectGroupMask(newGroups[0],{showOutline:true});
  core.focusGroupInSidebar(newGroups[0]);
  core.showQuickPrompt();
  core.toast('Object split into 2 independent masks. Original options preserved.');
}
window.MosaicObjectCreateCut={create:registerForeground,beginCut,moveCut,endCut:cut,cancelCut:stopCut,isCutting:()=>Boolean(stroke)};
window.addEventListener('mosaic:projectloaded',stopCut);
