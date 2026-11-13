/* Mosaic v1 portable project file (.moz; legacy .mosaic supported).
   Local-only, lossless canvas snapshots; never serializes Premium credentials. */
const core=window.MosaicCore;
const premium=window.MosaicPremium;
if(!core||!premium)throw Error('Mosaic modules must load before project files.');
const {state,canvas,overlay,makeCanvas,toast,render,renderGroups}=core;
const $=id=>document.getElementById(id);
const MAGIC='MOSAIC_PROJECT',VERSION=1;
let fileBusy=false;

function createCodec(){
  const registry=[],seen=new Map(),seenDisk=new Map();
  const canvasImage=value=>value&&typeof value.toDataURL==='function'&&typeof value.getContext==='function';
  const isImageData=value=>typeof ImageData!=='undefined'&&value instanceof ImageData;
  const offloadedImage=diskKey=>{
    if(seenDisk.has(diskKey))return {$canvas:seenDisk.get(diskKey)};
    const id=registry.length;
    seenDisk.set(diskKey,id);
    registry.push({id,data:null,diskKey});
    return {$canvas:id};
  };
  function pack(value,depth=0){
    if(depth>85)throw Error('Project history is too deeply nested.');
    if(value==null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
    if(canvasImage(value)){
      if(seen.has(value))return {$canvas:seen.get(value)};
      const id=registry.length;
      seen.set(value,id);
      registry.push({id,data:value.toDataURL('image/png')});
      return {$canvas:id};
    }
    if(isImageData(value)){
      const c=makeCanvas(value.width,value.height);
      c.getContext('2d').putImageData(value,0,0);
      return {$imageData:pack(c,depth+1).$canvas};
    }
    if(value instanceof Map)return {$map:[...value].map(([k,v])=>[pack(k,depth+1),pack(v,depth+1)])};
    if(value instanceof Set)return {$set:[...value].map(v=>pack(v,depth+1))};
    if(Array.isArray(value))return value.map(v=>pack(v,depth+1));
    if(typeof value==='object'){
      const result={};
      for(const [key,val] of Object.entries(value)){
        if(key==='generationQueue'||typeof val==='function'||key.endsWith('DiskKey'))continue;
        const diskKey=value[key+'DiskKey'];
        result[key]=val==null&&typeof diskKey==='string'&&diskKey.length
          ?offloadedImage(diskKey):pack(val,depth+1);
      }
      return result;
    }
    return null;
  }
  return {pack,registry};
}
async function decodeImages(list){
  if(!Array.isArray(list)||list.length>3000)throw Error('Invalid image registry.');
  const canvases=[];
  for(let i=0;i<list.length;i++){
    const entry=list[i];
    if(entry?.id!==i||typeof entry.data!=='string'||!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(entry.data))
      throw Error('Corrupted image data in project.');
    const image=await new Promise((resolve,reject)=>{
      const obj=new Image();
      obj.onload=()=>resolve(obj);obj.onerror=()=>reject(Error('Cannot decode an image in project.'));
      obj.src=entry.data;
    });
    if(!image.width||!image.height||image.width>8192||image.height>8192)
      throw Error('Unsupported project image dimensions.');
    const frame=makeCanvas(image.width,image.height);
    frame.getContext('2d').drawImage(image,0,0);
    image.src='';
    canvases.push(frame);
  }
  return canvases;
}
function unpack(value,images,depth=0){
  if(depth>85)throw Error('Invalid project nesting.');
  if(value==null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(v=>unpack(v,images,depth+1));
  if(Object.hasOwn(value,'$canvas')){
    const id=value.$canvas;
    if(!Number.isInteger(id)||!images[id])throw Error('Project refers to a missing image.');
    return images[id];
  }
  if(Object.hasOwn(value,'$imageData')){
    const frame=images[value.$imageData];
    if(!frame)throw Error('Project refers to a missing selection history image.');
    return frame.getContext('2d').getImageData(0,0,frame.width,frame.height);
  }
  if(Object.hasOwn(value,'$map')){
    if(!Array.isArray(value.$map))throw Error('Corrupted layer map.');
    return new Map(value.$map.map(([k,v])=>[unpack(k,images,depth+1),unpack(v,images,depth+1)]));
  }
  if(Object.hasOwn(value,'$set')){
    if(!Array.isArray(value.$set))throw Error('Corrupted project set.');
    return new Set(value.$set.map(v=>unpack(v,images,depth+1)));
  }
  const result={};
  for(const [key,val] of Object.entries(value)){
    if(key==='__proto__'||key==='constructor'||key==='prototype')continue;
    result[key]=unpack(val,images,depth+1);
  }
  return result;
}
function projectState(){
  // Ensure durable .moz storage uses cropped, shared Option masks.
  core.compactAllOptionMasks?.();
  const fields=[
    'reference','master','rawBase','rawMaster','masterIsBase','alignmentTransforms',
    'sources','groups','patches','pendingSourceId','editingPatchId','selectedPatchId',
    'selectionMask','selectionGeometry','selectionPoints','selectionPaths','selectionTargetPatchId','selectionMode','tool','pendingRevealOnly','serial',
    'draftGroupId','queuedGroupId','selectionGeneration','brushTargetId',
    'undo','redo','zoom','fitZoom','projectTitle','projectTitleManual','brushSize','brushIntensity','maskEditOnly',
    'markups','chatMessages','copilotSession','chatResult','objectMap','objectMaps','autoObjectSelect','featherEnabled','collapsedCategories','objectCollections','objectSelectionParts','objectReconstruction','cutHistory','sceneVersionCounters','sceneVersionHistory','sceneTargetSelections','objectMapLocked'
  ];
  return Object.fromEntries(fields.map(name=>[name,state[name]]));
}
async function encodeQueue(pack){
  const output=[];
  for(const file of state.queue){
    const frame=await core.loadFileToCanvas(file);
    output.push({name:file.name||'Queued image',image:pack(frame)});
  }
  return output;
}
// The same complete, portable snapshot is used for .moz downloads and local recovery.
// A recovery snapshot is never uploaded and never includes account credentials.
async function buildProjectData(){
  const resume=window.MosaicDiskCache?.pause?.();
  try {
    const codec=createCodec();
    const packedState=codec.pack(projectState());
    const packedPremium=codec.pack(premium.exportProjectState());
    const queue=await encodeQueue(codec.pack);
    await window.MosaicDiskCache?.fillRegistry?.(codec.registry);
    return {
    format:MAGIC,version:VERSION,createdAt:new Date().toISOString(),
    analytics:{projectId:await window.MosaicAccount?.projectId().catch(()=>null)||null},
    app:'mozAI',state:packedState,premium:packedPremium,queue,
    ui:{projectName:$('projectName').textContent||'Untitled composition'},
      images:codec.registry
    };
  } finally {resume?.();}
}
async function saveProject(){
  if(fileBusy)return;
  if(!state.reference&&!state.master){toast('Upload an image before saving a project.');return}
  if(window.MosaicSourceEditor?.isEditing()){toast('Apply or cancel the image transform before saving.');return}
  if([...state.patches.values()].some(p=>p.generating)){toast('Finish the active AI generation before saving the project.');return}
  fileBusy=true;const button=$('saveProjectBtn'),old=button.innerHTML;
  button.disabled=true;button.textContent='Saving…';
  try{
    const file=await buildProjectData();
    const blob=new Blob([JSON.stringify(file)],{type:'application/json'});
    const name=(file.ui.projectName||'mozAI_project').replace(/[^a-z0-9_-]+/gi,'_').slice(0,48)||'mozAI_project';
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name+'.moz';document.body.appendChild(a);a.click();a.remove();void window.MosaicAccount?.track('project_saved');
    setTimeout(()=>URL.revokeObjectURL(url),20000);
    toast('Saved '+a.download+' with editable images, masks, Groups and Master history.');
    window.MosaicRecovery?.markSaved?.();
    return true;
  }catch(error){toast('Save project failed: '+error.message);return false}
  finally{fileBusy=false;button.disabled=false;button.innerHTML=old}
}
async function reviveQueue(data,images){
  const output=[];
  for(const item of data||[]){
    const image=unpack(item.image,images);
    if(!image||typeof image.toBlob!=='function')throw Error('Corrupt queued image.');
    const blob=await new Promise((resolve,reject)=>image.toBlob(b=>b?resolve(b):reject(Error('Cannot restore queued image.')),'image/png'));
    output.push(new File([blob],String(item.name||'Queued image.png'),{type:'image/png'}));
  }
  return output;
}
function restoreUI(saved,ui){
  const hasMaster=Boolean(state.master),hasBase=Boolean(state.reference),realMaster=hasMaster&&!state.masterIsBase;
  canvas.width=overlay.width=hasMaster?state.master.width:hasBase?state.reference.width:1;
  canvas.height=overlay.height=hasMaster?state.master.height:hasBase?state.reference.height:1;
  $('selectionDraft').setAttribute('viewBox','0 0 '+canvas.width+' '+canvas.height);
  $('welcome').classList.toggle('hidden',hasMaster);
  $('canvasWrap').classList.toggle('hidden',!hasMaster);
  $('referenceZone').classList.toggle('ready',hasBase);
  $('masterZone').classList.toggle('ready',realMaster);
  $('referenceStatus').textContent=hasBase?'✓':'＋';
  $('masterStatus').textContent=realMaster?'✓':'＋';
  $('referenceTitle').textContent='Base';$('masterTitle').textContent='Master';
  $('referenceInfo').textContent=hasBase?state.reference.width+' × '+state.reference.height:'Original geometry & view';
  $('masterInfo').textContent=realMaster?state.master.width+' × '+state.master.height:hasMaster?'Base-only working draft':'Working canvas';
  $('basePreview').classList.add('hidden');$('welcomeBaseThumb').classList.add('hidden');$('masterPreview').classList.add('hidden');
  if(hasBase){core.setSourcePreview('basePreview',state.reference);core.setSourcePreview('welcomeBaseThumb',state.reference)}
  if(realMaster)core.setSourcePreview('masterPreview',state.master);
  state.projectTitle=String(saved.projectTitle||ui?.projectName||'Untitled composition');state.projectTitleManual=Boolean(saved.projectTitleManual);core.setProjectTitle(state.projectTitle);
  state.brushSize=Number(saved.brushSize)||36;state.brushIntensity=Number.isFinite(saved.brushIntensity)?saved.brushIntensity:100;
  $('brushSize').value=state.brushSize;$('brushValue').textContent=state.brushSize;
  $('brushIntensity').value=state.brushIntensity;$('brushIntensityValue').textContent=state.brushIntensity+'%';
  $('projectSize').textContent=hasMaster?canvas.width+' × '+canvas.height:'';
  if(hasMaster)core.updateZoomFit();
  if(hasMaster&&Number.isFinite(saved.zoom)&&saved.zoom>0){
    const z=Math.max(.01,Math.min(4,saved.zoom));
    state.zoom=z;
    $('canvasWrap').style.width=Math.round(canvas.width*z)+'px';
    $('canvasWrap').style.height=Math.round(canvas.height*z)+'px';
  }
  core.selectTool(['select','lasso','rect','ellipse','wand','reveal','erase','transform','zoom','pan'].includes(saved.tool)&&saved.tool!=='zoom'?saved.tool:'select');
  core.setMode(['new','add','subtract'].includes(saved.selectionMode)?saved.selectionMode:'new');
  core.updateSelectionOutline();core.updateApplyButton();
  core.updateSourceActions();renderGroups();render();
  window.MosaicSources?.refresh?.();
}
async function loadProjectFile(file,{recovery=false}={}){
  if(fileBusy||!file)return;
  if(file.size>(recovery?500*1024*1024:300000000)){toast('Project exceeds the supported file size limit.');return false}
  if(window.MosaicSourceEditor?.isEditing()){toast('Apply or cancel the current transform before opening a project.');return}
  if([...state.patches.values()].some(p=>p.generating)){toast('Complete the current AI request before opening another project.');return}
  if(!recovery&&(state.master||state.reference)&&!window.confirm('Open this project and replace the current unsaved project?'))return false;
  fileBusy=true;const button=$('openProjectBtn'),old=button.innerHTML;
  button.disabled=true;button.textContent='Opening…';
  try{
    const data=JSON.parse(await file.text());
    if(data?.format!==MAGIC||data.version!==VERSION||!data.state||!data.premium)
      throw Error('This file is not a supported .moz project.');
    // Decode/validate all images BEFORE mutating the existing open project.
    const images=await decodeImages(data.images);
    const saved=unpack(data.state,images),restoredPremium=unpack(data.premium,images);
    const restoredQueue=await reviveQueue(data.queue,images);
    if(!(saved.sources instanceof Map)||!(saved.patches instanceof Map)||!Array.isArray(saved.groups))
      throw Error('Missing Groups or image layers.');
    if(saved.master&&(!saved.master.width||!saved.master.height))
      throw Error('Invalid Master canvas.');
    if(!saved.master&&!saved.reference)throw Error('Project contains no images.');
    window.MosaicObjects?.reset();
    window.MosaicWorkspace?.reset();
    Object.assign(state,saved);
    // Older .moz versions stored a separate identical mask for every
    // appearance Option. Consolidate them on load without changing geometry.
    core.shareSavedOptionMasks?.();
    state.objectCollections=Array.isArray(saved.objectCollections)?saved.objectCollections:[];state.objectSelectionParts=Array.isArray(saved.objectSelectionParts)?saved.objectSelectionParts:[];
    state.selectionPoints=Array.isArray(saved.selectionPoints)?saved.selectionPoints:[];
    state.selectionPaths=Array.isArray(saved.selectionPaths)?saved.selectionPaths:[];
    state.queue=restoredQueue;
    state.busy=false;state.before=false;state.transformDrag=null;state.maskVertexDrag=null;state.maskMoveDrag=null;state.maskEditOnly=Boolean(saved.maskEditOnly);state.selectionTargetPatchId=saved.selectionTargetPatchId||null;state.drawing=false;
    state.lasso=[];state.hoverPoint=null;state.pointerStart=null;
    state.brushTargetId=null;state.hoveredGroupId=null;
    state.selectionMask=state.selectionMask||(state.selectionGeometry?null:(state.master?makeCanvas(state.master.width,state.master.height):null));
    premium.restoreProjectState(restoredPremium);
    restoreUI(saved,data.ui);window.dispatchEvent(new Event('mosaic:projectloaded'));void window.MosaicAccount?.startProject(true,data.analytics?.projectId);void window.MosaicAccount?.track('project_opened');
    if(!recovery)window.MosaicRecovery?.markLoaded?.();
    toast(recovery?'Recovered your temporary workspace from this device.':'Project restored, including Groups, options, selections and Master history.');
    return true;
  }catch(error){toast((recovery?'Recovery failed: ':'Open project failed: ')+error.message);return false}
  finally{fileBusy=false;button.disabled=false;button.innerHTML=old}
}
$('saveProjectBtn').addEventListener('click',()=>void saveProject());
$('openProjectBtn').addEventListener('click',()=>$('projectOpenInput').click());
$('projectOpenInput').addEventListener('change',event=>{
  const file=event.target.files?.[0];event.target.value='';
  if(file)void loadProjectFile(file);
});
$('helpBtn').addEventListener('click',()=>{
  if(!$('helpDialog').open)$('helpDialog').showModal();
});
for(const id of ['helpCloseBtn','helpDoneBtn'])$(id).addEventListener('click',()=>$('helpDialog').close());
window.MosaicProjects={saveProject,loadProjectFile,buildProjectData};
