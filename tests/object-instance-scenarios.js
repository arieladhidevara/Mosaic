// Cached legacy project -> local cleanup/migration -> independent object edits.
window.runObjectInstanceChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,map=window.MosaicObjectMap,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<700;i++){if(predicate())return;await pause(20)}throw Error('Timed out: '+label)};
  const alpha=(mask,x,y)=>mask.getContext('2d').getImageData(x,y,1,1).data[3];
  const pixel=(x,y)=>[...core.composeApprovedCanvas().getContext('2d').getImageData(x,y,1,1).data];
  const native=window.fetch;let maps=0,edits=0,blue=false;
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/object-map')maps++;
    if(path==='/api/ai/edit'){
      edits++;const result=await native(path,options);if(!blue||!result.ok)return result;
      const data=await result.json(),image=makeCanvas(256,256),x=image.getContext('2d');x.fillStyle='#0055ff';x.fillRect(0,0,256,256);data.image=image.toDataURL('image/png').split(',')[1];return Response.json(data);
    }
    return native(path,options);
  };
  try{
    await window.MosaicAccount.ready();if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');
    $('apiKeyInput').value='sk-object-instance-browser-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'test key');
    const base=makeCanvas(800,500),x=base.getContext('2d');x.fillStyle='#224488';x.fillRect(0,0,800,500);
    state.reference=base;core.setMaster(base,'Legacy furniture project',false);
    const sample=makeCanvas(64,64);sample.getContext('2d').drawImage(base,0,0,64,64);let hash=2166136261;for(const byte of sample.getContext('2d').getImageData(0,0,64,64).data)hash=Math.imul(hash^byte,16777619)>>>0;
    const key='800x500:'+hash.toString(16),raw=makeCanvas(800,500),r=raw.getContext('2d');r.fillStyle='rgb(1,0,0)';r.fillRect(0,0,800,500);
    // A noisy table, a second remote table reusing its color, and an occluding chair.
    r.fillStyle='rgb(2,0,0)';for(let y=150;y<350;y++)r.fillRect(150+(y%2),y,220-(y%2),1);
    r.fillRect(500,180,80,80);r.fillRect(372,220,2,3);r.fillRect(700,70,1,1);
    r.fillStyle='rgb(3,0,0)';r.fillRect(220,200,50,80);
    r.fillStyle='rgb(0,0,0)';r.fillRect(300,240,10,15);
    const legend=[{id:1,category:'Wall',label:'wall'},{id:2,category:'Furniture',label:'table'},{id:3,category:'Furniture',label:'chair'}];
    state.objectMap={sourceKey:key,raster:raw,entries:legend,labelsAvailable:true};state.objectMaps={[key]:state.objectMap};
    // Old releases stored every Furniture object as one mask/option.
    const mask=makeCanvas(800,500),mx=mask.getContext('2d');mx.fillStyle='#fff';mx.fillRect(150,150,220,200);mx.fillRect(500,180,80,80);mx.clearRect(300,240,10,15);
    const old=core.newGroup(mask,'Furniture');old.objectMapKey=key;old.objectMapCategory='Furniture';old.active='legacy-option';old.patchIds=['legacy-option'];
    const source=makeCanvas(800,500);source.getContext('2d').fillStyle='#22aa44';source.getContext('2d').fillRect(0,0,800,500);
    state.sources.set('legacy-source',{id:'legacy-source',name:'Legacy green',canvas:source});
    state.patches.set('legacy-option',{id:'legacy-option',sourceId:'legacy-source',groupId:old.id,mask,bbox:core.exactMaskBoundingBox(mask),name:'Green furniture',prompt:'Green furniture',maskPaths:core.maskPathsFromRaster(mask),opacity:1});
    assert(map.hydrate(),'Legacy map did not hydrate');core.renderGroups();core.render();core.updateZoomFit();
    assert(maps===0&&state.objectMap.version===3&&state.objectMap.entries.length===4,'Cached color map was billed again or distant objects merged');
    assert(state.groups.length===4&&state.groups.every(g=>g.objectMapObjectKey)&&!state.patches.has('legacy-option'),'Legacy category option was not migrated per object');
    const collection=window.MosaicObjectManager.createCollection('Furniture');window.MosaicObjectManager.moveObjects(state.groups.filter(g=>g.category==='Furniture').map(g=>g.id),collection.id);
    assert(document.querySelector('[data-collection="'+collection.id+'"]').querySelectorAll('.region-group').length===3,'Furniture group is missing Table and Chair children');
    assert(pixel(170,170)[1]===170&&pixel(240,240)[1]===170&&pixel(530,210)[1]===170,'Migration lost an approved option');
    checks.push('A legacy Furniture mask becomes Table 1, Table 2 and Chair with independent options, entirely locally');

    core.selectTool('wand');window.MosaicSlimWand.selectAt({x:170,y:170});
    assert(alpha(state.selectionMask,170,170)===255&&alpha(state.selectionMask,240,240)===0&&alpha(state.selectionMask,530,210)===0&&alpha(state.selectionMask,305,245)===0&&alpha(state.selectionMask,700,70)===0,'Table selection includes the chair, distant table, void or noise');
    const part=map.partsForSelection(state.selectionMask)[0],table=state.objectMap.entries.find(e=>e.key===part.objectKey);
    assert(table.paths[0].length<25,'Zigzag contour was not straightened');
    const bytes=state.selectionMask.getContext('2d').getImageData(0,0,800,500).data;for(let i=3;i<bytes.length;i+=4)assert(bytes[i]===0||bytes[i]===255,'Contour cleanup feathered the stored mask');
    checks.push('Table edges are straightened without feather; chair occlusion, real voids and distant identity stay intact');

    blue=true;const chairBefore=pixel(240,240),otherBefore=pixel(530,210),voidBefore=pixel(305,245),before=state.patches.size;
    await window.MosaicPremium.generateSelection('Make this table blue');await wait(()=>state.patches.size===before+1&&state.groups.every(g=>!g.objectMapBatch),'single table result');
    assert(pixel(170,170)[2]===255&&pixel(170,170)[0]===0,'Table edit was not applied');
    assert(pixel(240,240).join()===chairBefore.join()&&pixel(530,210).join()===otherBefore.join()&&pixel(305,245).join()===voidBefore.join(),'Editing the table changed its chair, neighboring table or hole');
    const edited=state.groups.find(g=>g.objectMapObjectKey===part.objectKey);assert(edited.patchIds.length===2&&state.groups.filter(g=>g!==edited&&g.category==='Furniture').every(g=>g.patchIds.length===1),'Single-object generation merged same-category options');
    checks.push('Editing only Table 1 changes its pixels while its occluding Chair and Table 2 remain green');

    $('autoObjectSelect').checked=true;$('autoObjectSelect').dispatchEvent(new Event('change'));core.setMode('new');core.selectTool('lasso');
    state.lasso=[{x:120,y:120},{x:600,y:120},{x:600,y:380},{x:120,y:380}];core.updateMaskWithLasso();
    const parts=map.partsForSelection(state.selectionMask);assert(parts.length===3&&new Set(parts.map(p=>p.objectKey)).size===3,'Multi-selection collapsed three Furniture objects');
    blue=false;const editCount=edits;await window.MosaicPremium.generateSelection('Make the furniture red');await wait(()=>state.groups.length===4&&state.groups.filter(g=>g.category==='Furniture').every(g=>g.patchIds.length>=2)&&state.groups.every(g=>!g.objectMapBatch),'multi-object result');
    assert(edits===editCount+1&&pixel(170,170)[0]===255&&pixel(240,240)[0]===255&&pixel(530,210)[0]===255,'Furniture multi-edit was not one request split across all objects');
    assert(maps===0&&state.groups.find(g=>g.objectMapObjectKey===part.objectKey).patchIds.length===3,'Existing per-object options were not retained');
    checks.push('Multi-select generates once for all Furniture and stores a separate new option on each object');
    return {passed:checks.length,checks,maps,edits,objects:state.objectMap.entries.map(e=>({label:e.label,category:e.category}))};
  }finally{window.fetch=native}
};
