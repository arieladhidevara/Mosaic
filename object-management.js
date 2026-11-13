import './app.js';
import {groupSimilarObjects} from './object-grouping.mjs';
const core=window.MosaicCore,{state,makeCanvas,canvas}=core;
const clone=source=>{const out=makeCanvas(source.width,source.height);out.getContext('2d').drawImage(source,0,0);return out};
const title=text=>String(text||'Object').replace(/^./,c=>c.toUpperCase());
const objects=()=>state.groups.filter(g=>!g.objectMapBatch&&!g.mergedInto&&!g.objectRemoved);
state.objectCollections??=[];
function createCollection(name){
  const collection={id:core.uid('collection'),name:String(name||'Group '+(state.objectCollections.length+1)).trim().slice(0,64)||'New group'};
  state.objectCollections.push(collection);core.renderGroups();return collection;
}
function moveObjects(ids,collectionId){
  if(collectionId&&!state.objectCollections.some(c=>c.id===collectionId))return;
  for(const object of objects())if(ids.includes(object.id)){object.collectionId=collectionId||null;object.autoGroupExcluded=!collectionId;}
  core.renderGroups();refreshActions();
}
function ensureObjects(map,maskForIds,maskCropForEntry){
  for(const entry of map.entries){
    let object=state.groups.find(g=>g.objectMapKey===map.sourceKey&&g.objectMapObjectKey===entry.key);
    if(!object){
      const crop=maskCropForEntry?.(entry);
      // Legacy maps without an entry box retain the full-mask fallback.
      object=crop?core.newGroupFromCrop(crop,entry.category):core.newGroup(maskForIds([entry.id]),entry.category);
      object.objectMapKey=map.sourceKey;object.objectMapObjectKey=entry.key;object.objectMapInstanceId=entry.id;object.objectMapCategory=entry.category;object.mapPrepared=true;
      object.maskPaths=entry.paths.map(path=>path.map(p=>({x:p.x*canvas.width/map.raster.width,y:p.y*canvas.height/map.raster.height})));
    }
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
    if(!object.manualName)object.name=object.objectName;
  }
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
function mergeSelection(){
  core.ensureSelectionMask();
  const parts=selectedParts();if(parts.length<2)return;
  if(busyObjects(parts.map(p=>p.objectKey))){core.toast('The selected objects are still generating. Other objects can be edited now.');return}
  const mask=clone(state.selectionMask),image=core.composeApprovedCanvas(),members=parts.map(part=>state.groups.find(g=>(g.objectMapObjectKey||g.id)===part.objectKey));
  const object=core.newGroup(mask,parts.every(p=>p.category===parts[0].category)?parts[0].category:'Other');
  object.objectMapKey=parts[0].mapKey;object.objectMapObjectKey=core.uid('merged_object');object.name=object.objectName=parts.map(p=>title(p.label)).join(' + ').slice(0,64);object.manualName=true;object.isMergedObject=true;
  object.memberObjectKeys=members.flatMap((g,i)=>g?.memberObjectKeys||[parts[i].objectKey]);object.collectionId=members.every(g=>g?.collectionId===members[0]?.collectionId)?members[0]?.collectionId:null;
  object.maskPaths=core.maskPathsFromRaster(mask);
  const sourceId=core.uid('merged_source'),id=core.uid('merged_option');state.sources.set(sourceId,{id:sourceId,name:object.name,canvas:image});
  state.patches.set(id,{id,sourceId,groupId:object.id,mask:clone(mask),bbox:core.exactMaskBoundingBox(mask),maskPaths:object.maskPaths,maskPoints:object.maskPaths.flat(),name:'Before merge',objectMapObjectKey:object.objectMapObjectKey});object.patchIds.push(id);object.active=id;
  // Keep approved pixels outside a refined merge mask. Archived members still
  // render underneath the new object, but cannot be selected independently.
  for(const member of members)if(member){member.mergedInto=object.id;member.objectBehind=[...new Set([...(member.objectBehind||[]),object.id])]}
  state.selectionTargetPatchId=null;state.draftGroupId=null;state.selectedPatchId=null;
  window.MosaicObjectMap.adoptSelection([partForObject(object)]);core.updateSelectionOutline();core.renderGroups();core.render();refreshActions();
  core.toast('Merged into one object. Future Wand clicks select its combined mask.');
}
function groupSimilarNames(options){
  return groupSimilarObjects(objects(),state.objectCollections,()=>core.uid('collection'),options);
}
function autoGroup(){
  const count=groupSimilarNames({includeExcluded:true});
  core.renderGroups();refreshActions();
  core.toast(count?'Grouped '+count+' objects by similar names.':'Objects with matching names are already grouped.');
}

const form=document.getElementById('quickAreaPromptForm'),actions=document.createElement('div');actions.className='multi-object-actions';actions.id='multiObjectActions';actions.hidden=true;
actions.innerHTML='<span id="selectedObjectCount"></span><button type="button" id="mergeObjectsBtn">Merge to object</button><select id="addObjectsToGroup" aria-label="Add selected objects to group"><option value="">Add to group…</option></select>';
form.querySelector('.prompt-footer')?.before(actions);if(!actions.parentNode)form.append(actions);
document.getElementById('mergeObjectsBtn').addEventListener('click',mergeSelection);
const groupPicker=document.getElementById('addObjectsToGroup');
groupPicker.addEventListener('change',()=>{
  let id=groupPicker.value;if(id==='new')id=createCollection().id;if(!id)return;
  const keys=selectedParts().map(p=>p.objectKey);moveObjects(objects().filter(g=>keys.includes(g.objectMapObjectKey||g.id)).map(g=>g.id),id);core.toast('Objects added to group; masks remain separate.');
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
const aiButton=document.createElement('button');aiButton.type='button';aiButton.id='autoGroupObjectsBtn';aiButton.className='icon-btn';aiButton.textContent='Group similar';aiButton.title='Group matching object names without merging their masks';aiButton.addEventListener('click',autoGroup);document.getElementById('addRegionBtn').before(aiButton);
document.getElementById('groupList').addEventListener('click',e=>{
  const remove=e.target.closest('[data-remove-collection]');if(!remove)return;
  const id=remove.dataset.removeCollection;state.objectCollections=state.objectCollections.filter(c=>c.id!==id);for(const object of state.groups)if(object.collectionId===id){object.collectionId=null;object.autoGroupExcluded=true;}core.renderGroups();
});
document.getElementById('groupList').addEventListener('change',e=>{const input=e.target.closest('[data-collection-name]');if(!input)return;const collection=state.objectCollections.find(c=>c.id===input.dataset.collectionName);if(collection){collection.name=input.value.trim().slice(0,64)||collection.name;core.renderGroups()}});
window.MosaicObjectManager={objects,createCollection,moveObjects,ensureObjects,resolvePart,partForObject,mergeSelection,autoGroup,groupSimilarNames,decorate,refreshActions};
