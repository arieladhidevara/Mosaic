import './app.js';
import {clusterSceneObjects,MAX_SCENE_GROUPS} from './object-clustering.mjs';
const core=window.MosaicCore,{state,makeCanvas,canvas}=core;
const clone=source=>{const out=makeCanvas(source.width,source.height);out.getContext('2d').drawImage(source,0,0);return out};
const title=text=>String(text||'Object').replace(/^./,c=>c.toUpperCase());
const objects=()=>state.groups.filter(g=>!g.objectMapBatch&&!g.mergedInto&&!g.cutArchived&&!g.objectRemoved);
state.objectCollections??=[];
function createCollection(name){
  const collection={id:core.uid('collection'),name:String(name||'Group '+(state.objectCollections.length+1)).trim().slice(0,64)||'New group',auto:false};
  state.objectCollections.push(collection);core.renderGroups();return collection;
}
function moveObjects(ids,collectionId){
  if(collectionId&&!state.objectCollections.some(c=>c.id===collectionId))return;
  for(const object of objects())if(ids.includes(object.id)){object.collectionId=collectionId||null;object.collectionPinned=true;}
  core.renderGroups();refreshActions();
}
function ensureObjects(map,maskForIds){
  for(const entry of map.entries){
    let object=state.groups.find(g=>g.objectMapKey===map.sourceKey&&g.objectMapObjectKey===entry.key);
    if(!object){const mask=maskForIds([entry.id]);object=core.newGroup(mask,entry.category);object.objectMapKey=map.sourceKey;object.objectMapObjectKey=entry.key;object.objectMapInstanceId=entry.id;object.objectMapCategory=entry.category;object.mapPrepared=true;object.maskPaths=entry.paths.map(path=>path.map(p=>({x:p.x*canvas.width/map.raster.width,y:p.y*canvas.height/map.raster.height})))}
    if(object.footprint&&!object.active&&!object.objectOriginal){
      const bounds=core.exactMaskBoundingBox(object.footprint);
      if(bounds){
        const mask=makeCanvas(bounds.w,bounds.h);
        mask.getContext('2d').drawImage(object.footprint,-bounds.x,-bounds.y);
        object.maskCrop={mask,x:bounds.x,y:bounds.y};
        object.footprint=null;
      }
    }
    object.objectName=title(entry.label);object.suggestedCollection=entry.suggestedGroup||entry.category;
    object.spatialBox={x:entry.box.x*canvas.width/map.raster.width,
      y:entry.box.y*canvas.height/map.raster.height,
      w:entry.box.w*canvas.width/map.raster.width,h:entry.box.h*canvas.height/map.raster.height};
    if(!object.manualName)object.name=object.objectName;
  }
  // The saved instance map is already enough for semantic-spatial clustering.
  // No additional AI call and no mask or Object ID modifications.
  autoGroup();
}
function partForObject(object){
  object.objectMapObjectKey||=object.id;object.objectMapKey||='manual';object.objectName||=object.name;
  return {objectKey:object.objectMapObjectKey||object.id,instanceId:object.objectMapInstanceId,category:object.category,label:object.name,mapKey:object.objectMapKey||'manual',mask:core.groupMask(object),paths:object.active?core.patchSelectionPaths(state.patches.get(object.active)):object.maskPaths?.length?object.maskPaths:core.maskPathsFromRaster(core.groupMask(object))};
}
function resolvePart(part,identityOnly=false){
  let object=state.groups.find(g=>g.objectMapObjectKey===part.objectKey&&g.objectMapKey===part.mapKey);
  const visited=new Set();while(object?.mergedInto&&!visited.has(object.id)){visited.add(object.id);object=state.groups.find(g=>g.id===object.mergedInto)}
  return object?(identityOnly?{...part,objectKey:object.objectMapObjectKey||object.id,mapKey:object.objectMapKey||'manual',label:object.name,instanceId:object.objectMapInstanceId}:partForObject(object)):part;
}
function busyObjects(keys){return [...state.patches.values()].some(p=>p.generating&&(keys.includes(p.objectMapObjectKey)||p.objectMapParts?.some(part=>keys.includes(part.objectKey))))}
function selectedParts(){return window.MosaicObjectMap?.partsForSelection(state.selectionMask)||[]}
function mergedMaskFor(parts){
  const mask=makeCanvas(canvas.width,canvas.height),x=mask.getContext('2d');
  for(const part of parts)x.drawImage(part.mask,0,0);
  return mask;
}
function consolidate(parts,mask,collectionId=null){
  if(parts.length<2)return false;
  if(busyObjects(parts.map(p=>p.objectKey))){core.toast('Selected objects are still generating. Try again after they finish.');return false}
  const image=core.composeApprovedCanvas();
  if(!image||!core.exactMaskBoundingBox(mask))return false;
  const keys=new Set(parts.map(p=>p.objectKey));
  const members=objects().filter(g=>keys.has(g.objectMapObjectKey||g.id));
  if(members.length<2)return false;
  const object=core.newGroup(mask,parts.every(p=>p.category===parts[0].category)?parts[0].category:'Other');
  object.objectMapKey='manual';object.objectMapObjectKey=core.uid('merged_object');
  const labels=[...new Set(parts.map(p=>title(p.label)))];
  object.name=object.objectName=labels.length<=3?labels.join(' + ').slice(0,64):labels.slice(0,2).join(' + ')+' + '+(labels.length-2);
  object.manualName=true;object.isMergedObject=true;
  object.memberObjectKeys=members.flatMap((g)=>g.memberObjectKeys||[g.objectMapObjectKey||g.id]);
  object.collectionId=collectionId||((new Set(members.map(g=>g.collectionId)).size===1)?members[0].collectionId:null);
  object.collectionPinned=true;
  object.maskPaths=core.maskPathsFromRaster(mask);
  const sourceId=core.uid('merged_source'),id=core.uid('merged_option');
  state.sources.set(sourceId,{id:sourceId,name:object.name,canvas:image});
  state.patches.set(id,{id,sourceId,groupId:object.id,mask:clone(mask),bbox:core.exactMaskBoundingBox(mask),
    maskPaths:object.maskPaths,maskPoints:object.maskPaths.flat(),name:'Before merge',
    objectMapObjectKey:object.objectMapObjectKey});
  object.patchIds.push(id);object.active=id;
  // Old objects are archived behind the new independent object. Their masks
  // and options are preserved for the project history, not selected anymore.
  for(const member of members){
    member.mergedInto=object.id;
    member.objectBehind=[...new Set([...(member.objectBehind||[]),object.id])];
  }
  state.selectionTargetPatchId=null;state.draftGroupId=null;state.selectedPatchId=null;
  core.resetSelection();core.refreshGroupFootprint(object);
  core.selectGroupMask(object,{showOutline:true});
  core.showQuickPrompt();
  core.renderGroups();core.render();refreshActions();
  core.toast('Merged '+members.length+' parts into one Object ID and mask.');
  return true;
}
function mergeSelection(){
  const parts=selectedParts();if(parts.length<2)return false;
  // Preserve explicitly subtracted pixels in the user's current selection.
  const collectionId=new Set(parts.map(part=>objects().find(g=>(g.objectMapObjectKey||g.id)===part.objectKey)?.collectionId)).size===1
    ?objects().find(g=>(g.objectMapObjectKey||g.id)===parts[0].objectKey)?.collectionId:null;
  return consolidate(parts,clone(state.selectionMask),collectionId);
}
function mergeCollection(id){
  const collection=state.objectCollections.find(c=>c.id===id);
  if(!collection)return false;
  const children=objects().filter(g=>g.collectionId===id);
  if(children.length<2)return false;
  return consolidate(children.map(partForObject),mergedMaskFor(children.map(partForObject)),id);
}
function objectBox(group){
  // Map boxes are cheap to use (avoid decoding every full-resolution mask).
  if(group.active&&group.area?.w>0&&group.area?.h>0)return group.area;
  if(group.spatialBox?.w>0&&group.spatialBox?.h>0)return group.spatialBox;
  if(group.maskCrop?.mask)return {x:group.maskCrop.x,y:group.maskCrop.y,w:group.maskCrop.mask.width,h:group.maskCrop.mask.height};
  if(group.area?.w>0&&group.area?.h>0)return group.area;
  return core.exactMaskBoundingBox(core.groupMask(group));
}
function autoGroup(){
  state.objectCollections??=[];
  const manual=state.objectCollections.filter(c=>!c.auto);
  const eligible=objects().filter(object=>!object.collectionPinned
    &&!manual.some(collection=>collection.id===object.collectionId));
  // Keep explicitly moved/renamed Group membership and user-created groups.
  const limit=Math.max(0,MAX_SCENE_GROUPS-manual.length);
  const plans=limit?clusterSceneObjects(eligible.map(group=>({
    id:group.id,box:objectBox(group),category:group.category,
    label:group.objectName||group.name,suggestedGroup:group.suggestedCollection
  })),{width:canvas.width,height:canvas.height,maxGroups:limit}):[];
  const oldAuto=state.objectCollections.filter(c=>c.auto);
  const oldMembers=new Map(oldAuto.map(c=>[c.id,new Set(eligible.filter(g=>g.collectionId===c.id).map(g=>g.id))]));
  const used=new Set(),latest=[],collapsed=new Set(state.collapsedCategories||[]);
  for(const plan of plans){
    let old=null,overlap=0;
    for(const candidate of oldAuto){
      if(used.has(candidate.id))continue;
      const score=plan.ids.filter(id=>oldMembers.get(candidate.id)?.has(id)).length;
      if(score>overlap){overlap=score;old=candidate}
    }
    const collection=old||{id:core.uid('collection'),auto:true,name:plan.name};
    if(!collection.manualName)collection.name=plan.name;
    collection.auto=true;used.add(collection.id);latest.push(collection);
    if(!old)collapsed.add(collection.id);
    for(const object of eligible)if(plan.ids.includes(object.id))object.collectionId=collection.id;
  }
  for(const old of oldAuto)if(!used.has(old.id))collapsed.delete(old.id);
  for(const object of eligible)if(!plans.some(plan=>plan.ids.includes(object.id)))object.collectionId=null;
  state.collapsedCategories=[...collapsed];
  state.objectCollections=[...manual,...latest];
  core.renderGroups();refreshActions();
}
const form=document.getElementById('quickAreaPromptForm'),actions=document.createElement('div');actions.className='multi-object-actions';actions.id='multiObjectActions';actions.hidden=true;
actions.innerHTML='<span id="selectedObjectCount"></span><button type="button" id="mergeObjectsBtn">Merge to object</button><select id="addObjectsToGroup" aria-label="Add selected objects to group"><option value="">Add to group…</option></select>';
form.querySelector('.prompt-footer')?.before(actions);if(!actions.parentNode)form.append(actions);
document.getElementById('mergeObjectsBtn').addEventListener('click',mergeSelection);
const groupPicker=document.getElementById('addObjectsToGroup');
groupPicker.addEventListener('change',()=>{
  let id=groupPicker.value;if(id==='new')id=createCollection().id;if(!id)return;
  const keys=selectedParts().map(p=>p.objectKey);moveObjects(objects().filter(g=>keys.includes(g.objectMapObjectKey||g.id)).map(g=>g.id),id);core.toast('Objects moved into a Group; masks remain independent.');
});
function refreshActions(){
  const count=state.objectSelectionParts?.length||0;actions.hidden=count<2;
  document.getElementById('selectedObjectCount').textContent=count+' objects';
  groupPicker.replaceChildren(new Option('Add to group…',''),...state.objectCollections.map(c=>new Option(c.name,c.id)),new Option('+ New group','new'));
}
function decorate(){
  for(const section of document.querySelectorAll('#groupList .region-group[data-group]')){
    const object=state.groups.find(g=>g.id===section.dataset.group);if(!object||section.querySelector('[data-object-collection]'))continue;
    const picker=document.createElement('select');picker.className='object-collection-picker';picker.dataset.objectCollection=object.id;picker.setAttribute('aria-label','Move '+object.name+' to group');
    picker.append(new Option('Group: none',''),...state.objectCollections.map(c=>new Option('Group: '+c.name,c.id)));picker.value=object.collectionId||'';
    picker.addEventListener('change',()=>moveObjects([object.id],picker.value));section.querySelector('.group-details')?.append(picker);
  }
  refreshActions();
}
const aiButton=document.createElement('button');aiButton.type='button';aiButton.id='autoGroupObjectsBtn';aiButton.className='icon-btn';aiButton.textContent='Regroup';aiButton.title='Automatically cluster nearby related objects (no AI generation)';aiButton.addEventListener('click',autoGroup);document.getElementById('addRegionBtn').before(aiButton);
document.getElementById('groupList').addEventListener('click',e=>{
  const merge=e.target.closest('[data-merge-collection]');
  if(merge){mergeCollection(merge.dataset.mergeCollection);return}
  const remove=e.target.closest('[data-remove-collection]');if(!remove)return;
  const id=remove.dataset.removeCollection;state.objectCollections=state.objectCollections.filter(c=>c.id!==id);for(const object of state.groups)if(object.collectionId===id){object.collectionId=null;object.collectionPinned=true;}core.renderGroups();
});
document.getElementById('groupList').addEventListener('change',e=>{const input=e.target.closest('[data-collection-name]');if(!input)return;const collection=state.objectCollections.find(c=>c.id===input.dataset.collectionName);if(collection){collection.name=input.value.trim().slice(0,64)||collection.name;collection.manualName=true;core.renderGroups()}});
window.MosaicObjectManager={objects,createCollection,moveObjects,ensureObjects,resolvePart,partForObject,mergeSelection,mergeCollection,autoGroup,decorate,refreshActions};
