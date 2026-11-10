// Real account/API transport with the isolated mock provider. No live AI calls.
window.runObjectMapChecks=async function(){
  const core=window.MosaicCore,{state,canvas,overlay,makeCanvas}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<700;i++){if(predicate())return;await pause(20)}throw Error('Timed out: '+label)};
  const nativeFetch=window.fetch,capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=()=>{};
  let maps=0,edits=0,sam=0,intent=0,release,hold=false,payload;
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/object-map')maps++;
    if(path==='/api/ai/sam3')sam++;
    if(path==='/api/ai/object-intent')intent++;
    if(path==='/api/ai/edit'){edits++;payload=JSON.parse(options.body);const response=await nativeFetch(path,options);if(hold)await new Promise(resolve=>{release=resolve});return response}
    return nativeFetch(path,options);
  };
  const at=(type,x,y,modifiers={})=>{const r=overlay.getBoundingClientRect();overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:71,pointerType:'mouse',clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height,...modifiers}))};
  const shape=tool=>{core.selectTool(tool);core.setMode('new');if(tool==='lasso'){state.lasso=[{x:80,y:75},{x:760,y:75},{x:760,y:425},{x:80,y:425}];core.updateMaskWithLasso()}else{at('pointerdown',tool==='ellipse'?64:80,tool==='ellipse'?35:75);at('pointermove',tool==='ellipse'?768:760,tool==='ellipse'?465:425);at('pointerup',tool==='ellipse'?768:760,tool==='ellipse'?465:425)}};
  const alpha=(mask,x,y)=>mask.getContext('2d').getImageData(x,y,1,1).data[3];
  const pixel=(x,y)=>[...core.composeApprovedCanvas().getContext('2d').getImageData(x,y,1,1).data];
  try{
    await window.MosaicAccount.ready();assert(window.MosaicObjectMap,'Object-map module did not initialize');
    assert(!document.querySelector('[data-smart-select]')&&!$('autoCreateGroupsBtn'),'Old Smart Select or SAM Auto Create is still present');
    assert(!$('featherEdges')&&!state.featherEnabled,'Feather must be removed');
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'test key dialog');
    $('apiKeyInput').value='sk-object-map-browser-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'test key');
    const base=makeCanvas(800,500),bx=base.getContext('2d');bx.fillStyle='#224488';bx.fillRect(0,0,800,500);
    const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'base.png',{type:'image/png'}))));
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=$('referenceInput');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    await wait(()=>Boolean(state.reference),'Base upload');await pause(120);assert(maps===0&&!state.objectMap,'Uploading Base started mapping before Continue or Generate');
    $('welcomeContinueBtn').click();await wait(()=>state.masterIsBase,'Base-only canvas');
    await wait(()=>state.objectMap?.entries?.length===4,'background map');
    assert(maps===1&&state.groups.length===4&&state.objectCollections.length===0&&state.patches.size===0,'Map did not create independent ungrouped objects');
    assert(state.objectMap.raster.width*state.objectMap.raster.height>=1048576,'Object map is below the model pixel budget');
    assert($('selectedObjectOverlay').hidden,'Prepared masks appeared before selection');
    window.MosaicObjectMap.imageReady(state.master);await pause(120);assert(maps===1,'Existing working-image map was billed again');
    await new Promise(requestAnimationFrame);core.updateZoomFit();
    checks.push('Base upload waits; Continue with Base starts one correctly sized background map without replacing Base or creating Groups');

    core.selectTool('wand');window.MosaicSlimWand.hoverAt({x:170,y:150});at('pointerdown',170,150);at('pointerup',170,150);
    assert(alpha(state.selectionMask,170,150)===255&&alpha(state.selectionMask,220,225)===0,'Wand lost the object silhouette or its hole');
    assert(state.objectCollections.length===0&&sam===0&&intent===0&&state.tool==='wand','Wand created a Group, exited or used SAM/intent');
    assert(!$('selectedObjectOverlay').hidden&&alpha($('selectedObjectOverlay'),170,150)>0&&alpha($('selectedObjectOverlay'),170,150)<60&&alpha($('selectedObjectOverlay'),220,225)===0,'Thin purple overlay does not follow the selected object mask');
    checks.push('Wand looks up the clicked object immediately and preserves holes without SAM or a model download');

    core.selectTool('wand');core.setMode('add');at('pointerdown',420,200);at('pointerup',420,200);
    assert(alpha(state.selectionMask,420,200)===255&&alpha(state.selectionMask,170,150)===0,'A normal Wand click merged the previous object');
    core.selectTool('wand');at('pointerdown',170,150,{ctrlKey:true});at('pointerup',170,150,{ctrlKey:true});
    assert(window.MosaicObjectMap.partsForSelection(state.selectionMask).length===2,'Ctrl-click failed to keep separate same-color instances');
    core.selectTool('wand');at('pointerdown',170,150);at('pointerup',170,150);
    assert(alpha(state.selectionMask,420,200)===0&&alpha(state.selectionMask,760,60)===0,'Same-color distant object or noise joined the clicked mask');
    checks.push('Plain Wand replaces stale Add mode; Ctrl-click adds independent objects, while distant same-color noise is excluded');

    $('autoObjectSelect').checked=true;$('autoObjectSelect').dispatchEvent(new Event('change'));
    for(const tool of ['rect','ellipse','lasso']){
      shape(tool);const parts=window.MosaicObjectMap.partsForSelection(state.selectionMask);
      assert(parts?.length===3&&parts.filter(p=>p.category==='Door').length===2&&parts.some(p=>p.category==='Floor'),tool+' did not select independent prepared objects');
      assert(alpha(state.selectionMask,220,225)===0,'Auto Select filled a hole');
      assert(state.objectCollections.length===0&&state.groups.length===4,'Auto Select implicitly grouped or merged objects');
      const data=state.selectionMask.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=3;i<data.length;i+=4)assert(data[i]===0||data[i]===255,'Automatic smoothing changed mask alpha');
    }
    checks.push('Rectangle, Oval and Line multi-select three independent objects with hard masks and no premature Groups');

    hold=true;await window.MosaicPremium.generateSelection('Make these surfaces red');await wait(()=>release,'held generation');
    assert(edits===1&&document.querySelectorAll('#groupList .region-group').length===4,'Generate submitted multiple images or exposed its temporary batch');
    assert(payload.crop.x>0&&payload.crop.y>0&&payload.crop.width<canvas.width&&payload.context&&payload.mask,'Request is missing its local crop, offset or exact mask');
    hold=false;release();await wait(()=>state.groups.length===4&&[...state.patches.values()].every(p=>!p.generating&&!p.awaitingResult),'object results');
    assert(state.groups.some(g=>g.category==='Door')&&state.groups.some(g=>g.category==='Floor'),'Generated image was not split into category Groups');
    assert([...state.patches.values()].every(p=>!p.aiProgress),'Completed category options retained stale generation progress');
    assert(pixel(170,150)[0]===255&&pixel(600,250)[0]===255&&pixel(420,200)[0]===255,'Generated pixels did not land in every object mask');
    assert(state.groups.filter(g=>g.category==='Door').length===2&&new Set(state.groups.map(g=>g.objectMapObjectKey)).size===4,'Same-category objects were merged');
    window.MosaicObjectManager.autoGroup();
    const doorCategory=document.querySelector('[data-collection="'+state.objectCollections.find(c=>c.name==='Door').id+'"]');
    assert(doorCategory.querySelectorAll('.region-group').length===2,'Explicit AI grouping lost object children');
    const collectionId=doorCategory.dataset.collection;doorCategory.querySelector('.object-category-head').click();assert(document.querySelector('[data-collection="'+collectionId+'"] .object-category-items').hidden,'Group did not collapse');
    document.querySelector('[data-collection="'+collectionId+'"] .object-category-head').click();
    assert(pixel(220,225)[2]===136&&pixel(15,15)[2]===136,'Generation changed a hole or pixels outside the original masks');
    checks.push('One cropped edit is split into three independent Options; explicit AI grouping creates collapsible containers');

    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click,confirm=window.confirm;let saved;
    URL.createObjectURL=blob=>{if(blob.type==='application/json')saved=blob;return create(blob)};HTMLAnchorElement.prototype.click=()=>{};window.confirm=()=>true;
    try{await window.MosaicProjects.saveProject();assert(saved,'Project was not saved');const text=await saved.text();assert(!text.includes('sk-object-map-browser-fixture'),'Project leaked credentials');await window.MosaicProjects.loadProjectFile(new File([text],'objects.moz'));assert(state.objectMap.entries.length===4,'Project lost its object map');core.selectTool('wand');window.MosaicSlimWand.selectAt({x:170,y:150});assert(alpha(state.selectionMask,170,150)===255&&maps===1,'Restored project called Sunburst again or lost selection')}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;window.confirm=confirm}
    assert(sam===0&&intent===0,'A retired selection service was called');
    checks.push('Project round-trip preserves the color map and categories without keys or a second mapping request');
    const restoredDoor=state.groups.find(g=>g.category==='Door'&&g.area.x<200),options=restoredDoor.patchIds.length;
    const otherDoor=state.groups.find(g=>g.category==='Door'&&g!==restoredDoor),otherActive=otherDoor.active,otherPixel=pixel(420,200);
    hold=true;release=null;await window.MosaicPremium.generateSelection('Change the door finish again');await wait(()=>release,'second category generation');
    core.chooseGroupOption(restoredDoor,null);hold=false;release();await wait(()=>restoredDoor.patchIds.length===options+1,'saved second option');
    assert(state.groups.length===4&&restoredDoor.active===null&&pixel(170,150)[2]===136,'Late object result replaced the user choice or duplicated an object');
    const newest=state.patches.get(restoredDoor.patchIds.at(-1));assert(alpha(newest.mask,420,200)===0&&otherDoor.active===otherActive&&pixel(420,200).join()===otherPixel.join(),'Editing one object changed another same-category object');
    checks.push('A later single-object edit leaves its same-category neighbor untouched and preserves a newer option choice');
    core.selectTool('wand');window.MosaicSlimWand.selectAt({x:170,y:150});
    const generationMask=window.MosaicObjects.generationMask,patchesBefore=state.patches.size,editsBefore=edits;
    window.MosaicObjects.generationMask=()=>{throw Error('Simulated crop preparation failure')};
    try{await window.MosaicPremium.generateSelection('Test crop preparation');await wait(()=>state.groups.every(group=>!group.objectMapBatch),'failed batch cleanup');assert(state.patches.size===patchesBefore&&edits===editsBefore,'Crop failure left a hidden request or called the provider')}finally{window.MosaicObjects.generationMask=generationMask}
    checks.push('Local crop failure removes its temporary batch without phantom Groups, pending requests or a provider call');
    return {passed:checks.length,checks,maps,edits,sam,intent};
  }finally{window.fetch=nativeFetch;Element.prototype.setPointerCapture=capture}
};
