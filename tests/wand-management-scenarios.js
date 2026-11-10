// Run only against the isolated mock server; never a live key/account.
window.runWandManagementChecks=async function(){
  const core=window.MosaicCore,{state,canvas,overlay,makeCanvas}=core,map=window.MosaicObjectMap,manager=window.MosaicObjectManager,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<800;i++){if(predicate())return;await pause(20)}throw Error('Timed out: '+label)};
  const alpha=(mask,x,y)=>mask.getContext('2d').getImageData(x,y,1,1).data[3],pixel=(x,y)=>[...core.composeApprovedCanvas().getContext('2d').getImageData(x,y,1,1).data];
  const native=window.fetch,capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=()=>{};
  let maps=0,edits=0,retired=0,hold=false;const held=[],payloads=[];
  const at=(type,x,y,extra={})=>{const r=overlay.getBoundingClientRect();overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerType:'mouse',pointerId:91,clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height,...extra}))};
  const click=(x,y,ctrl=false)=>{at('pointerdown',x,y,{ctrlKey:ctrl});at('pointerup',x,y,{ctrlKey:ctrl})};
  const wand=(x,y,ctrl=false)=>{core.selectTool('wand');click(x,y,ctrl)};
  const rect=(mode,a,b)=>{core.selectTool('rect');core.setMode(mode);at('pointerdown',...a);at('pointermove',...b);at('pointerup',...b)};
  const parts=()=>map.partsForSelection(state.selectionMask)||[];
  window.fetch=async(path,options)=>{
    if(['/api/ai/sam3','/api/ai/object-intent'].includes(path))retired++;
    const response=await native(path,options);
    if(path==='/api/ai/object-map'){
      maps++;const data=await response.json();data.legend=data.legend.map(item=>item.id===2?{...item,label:'Table',category:'Furniture',group:'Dining area'}:item.id===3?{...item,label:'Chair',category:'Furniture',group:'Dining area'}:item);return Response.json(data,{status:response.status});
    }
    if(path==='/api/ai/edit'){
      const index=edits++;payloads.push(JSON.parse(options.body));const data=await response.json(),image=makeCanvas(256,256),x=image.getContext('2d');x.fillStyle=index===0?'#0055ff':index===1?'#22aa44':'#ff2211';x.fillRect(0,0,256,256);data.image=image.toDataURL('image/png').split(',')[1];
      if(hold)await new Promise(resolve=>held[index]=resolve);return Response.json(data,{status:response.status});
    }
    return response;
  };
  try{
    await window.MosaicAccount.ready();assert(manager&&map,'Object modules missing');
    assert(!$('featherEdges')&&!state.featherEnabled,'Feather control must be removed');
    assert(document.querySelector('[data-tool="select"]').textContent.includes('Pointer')&&!document.querySelector('[data-tool="pan"] span'),'Navigation labels were not updated');
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');$('apiKeyInput').value='sk-wand-management-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'key');
    const base=makeCanvas(800,500),x=base.getContext('2d');x.fillStyle='#224488';x.fillRect(0,0,800,500);
    const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'Base.png',{type:'image/png'}))));
    const transfer=new DataTransfer();transfer.items.add(file);$('referenceInput').files=transfer.files;$('referenceInput').dispatchEvent(new Event('change'));await wait(()=>state.reference,'Base');assert(maps===0,'Upload mapped before Continue');
    $('welcomeContinueBtn').click();await wait(()=>state.objectMap?.entries.length===4,'map');await new Promise(requestAnimationFrame);core.updateZoomFit();
    assert(manager.objects().length===4&&state.objectCollections.length===0&&state.patches.size===0,'Map masks must be named objects, without creating Groups or edits');
    assert(manager.objects().some(g=>g.name==='Table 1')&&manager.objects().some(g=>g.name==='Chair'),'Object names were replaced by category/Other');
    checks.push('Continue prepares named, ungrouped objects; Pointer and icon-only Pan are clear; Feather is absent');

    $('autoObjectSelect').checked=true;$('autoObjectSelect').dispatchEvent(new Event('change'));
    rect('new',[80,75],[760,425]);assert(parts().length===3&&new Set(parts().map(p=>p.objectKey)).size===3&&state.objectCollections.length===0,'Rectangle Auto Select implicitly merged objects or created a Group');
    checks.push('Rectangle Auto Select selects three object masks independently, with no implicit merge or Group');

    wand(170,150);click(420,200,true);assert(state.tool==='wand'&&parts().length===2&&manager.objects().length===4,'Ctrl Wand merged objects or exited Wand');
    assert(!$('multiObjectActions').hidden&&$('mergeObjectsBtn').textContent==='Merge to object','Multi-selection actions missing');
    document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true}));assert(parts().length===2,'Releasing Ctrl lost selection');
    click(600,250);assert(state.tool==='wand'&&parts().length===1&&alpha(state.selectionMask,170,150)===0,'Plain click failed to replace previous selections');
    click(170,150,true);click(420,200,true);assert(parts().length===3&&new Set(parts().map(p=>p.objectKey)).size===3,'Three objects lost their separate identities');
    checks.push('Wand stays active; Ctrl adds independent masks and a plain click replaces the entire multi-selection');

    const picker=$('addObjectsToGroup');picker.value='new';picker.dispatchEvent(new Event('change'));
    const collection=state.objectCollections[0];assert(collection&&manager.objects().filter(g=>g.collectionId===collection.id).length===3&&parts().length===3,'Add to group merged masks');
    const name=document.querySelector('[data-collection-name="'+collection.id+'"]');name.value='Furniture';name.dispatchEvent(new Event('change',{bubbles:true}));
    const table1=manager.objects().find(g=>g.name==='Table 1'),table2=manager.objects().find(g=>g.name==='Table 2'),chair=manager.objects().find(g=>g.name==='Chair');
    const move=document.querySelector('[data-object-collection="'+table1.id+'"]');move.value='';move.dispatchEvent(new Event('change'));assert(!table1.collectionId&&state.objectCollections[0].name==='Furniture','Right inspector failed to rename group or ungroup object');
    $('autoGroupObjectsBtn').click();assert(state.objectCollections.some(c=>c.name==='Dining area')&&table1.collectionId!==chair.collectionId,'AI grouping ignored scene suggestions or moved already grouped objects');
    checks.push('Group creation, rename, Add to group, right-side ungrouping and scene-based AI grouping preserve object masks');

    wand(170,150);$('autoObjectSelect').checked=true;$('autoObjectSelect').dispatchEvent(new Event('change'));
    rect('subtract',[160,110],[190,190]);assert(alpha(state.selectionMask,170,150)===0&&alpha(state.selectionMask,300,150)===255&&parts().length===1,'Rectangle subtraction snapped back to the full Wand object');
    $('undoBtn').click();assert(alpha(state.selectionMask,170,150)===255&&parts().length===1,'Undo lost object identity or cut mask');$('redoBtn').click();assert(alpha(state.selectionMask,170,150)===0,'Redo lost subtract');
    core.selectTool('lasso');core.setMode('subtract');state.lasso=[{x:280,y:130},{x:340,y:130},{x:300,y:190}];core.updateMaskWithLasso();assert(alpha(state.selectionMask,300,150)===0&&alpha(state.selectionMask,310,270)===255,'Line subtraction did not cut the Wand mask');
    core.selectTool('lasso');core.setMode('subtract');at('pointerdown',300,250);at('pointermove',340,250);at('pointermove',340,290);at('pointermove',300,290);at('pointerup',300,250);
    assert(alpha(state.selectionMask,320,270)===0&&parts().length===1,'Freehand subtraction lost the object selection');
    rect('add',[160,110],[190,190]);assert(alpha(state.selectionMask,170,150)===255&&parts().length===1,'Adding a shape implicitly created or merged another object');
    checks.push('Rectangle, Line and Freehand refine the Wand mask exactly, with Add/Subtract and undo/redo, even while Auto Select is enabled');

    // Generate the refined mask; select and submit another object while it runs.
    const cutKey=parts()[0].objectKey;hold=true;await window.MosaicPremium.generateSelection('Make the first table blue');await wait(()=>held[0],'first request');
    assert(state.patches.size===1&&parts()[0].objectKey===cutKey,'Request mutated the live selection');
    wand(420,200);await window.MosaicPremium.generateSelection('Make the second table green');await wait(()=>held[1],'parallel request');
    assert(edits===2&&!state.busy&&state.tool==='wand','A second object was blocked until the first generation finished');
    held[1]();await wait(()=>table2.patchIds.length===1,'second result');held[0]();hold=false;await wait(()=>table1.patchIds.length===1&&state.groups.every(g=>!g.objectMapBatch),'first result');
    assert(pixel(170,150)[2]===255&&pixel(420,200)[1]===170&&pixel(320,270)[2]===136&&pixel(600,250)[2]===136,'Concurrent crops crossed objects or lost the subtracted area');
    checks.push('Two independent object edits run concurrently, may finish out of order, and preserve their own masks and crop offsets');

    wand(170,150);click(600,250,true);const before=edits;await window.MosaicPremium.generateSelection('Red finish on both objects');await wait(()=>table1.patchIds.length===2&&chair.patchIds.length===1,'multi-object generation');
    assert(edits===before+1&&pixel(170,150)[0]===255&&pixel(600,250)[0]===255&&table2.patchIds.length===1,'Multi-object generation did not split one image into independent options');
    assert(parts().length===2&&state.tool==='wand','Generation changed the tool or merged the selected objects');
    checks.push('One multi-object request creates a separate option for each selected object without waiting for serial generation');

    rect('subtract',[160,110],[190,190]);const excludedBefore=pixel(170,150).join();
    $('mergeObjectsBtn').click();const merged=manager.objects().find(g=>g.isMergedObject);assert(merged&&manager.objects().length===3&&parts().length===1&&pixel(170,150).join()===excludedBefore,'Explicit merge lost existing pixels outside its refined mask');
    wand(300,150);assert(parts().length===1&&alpha(state.selectionMask,600,250)===255&&alpha(state.selectionMask,170,150)===0,'Merged table click did not reuse the refined union mask');
    click(600,250);assert(parts().length===1&&parts()[0].objectKey===merged.objectMapObjectKey&&alpha(state.selectionMask,300,150)===255,'Merged chair click selected a former child separately');
    const mergedOptions=merged.patchIds.length,mergeEditCount=edits;await window.MosaicPremium.generateSelection('Refine this merged object');await wait(()=>merged.patchIds.length===mergedOptions+1&&state.groups.every(g=>!g.objectMapBatch),'merged object result');
    assert(edits===mergeEditCount+1&&manager.objects().length===3&&pixel(170,150)[0]===255&&pixel(600,250)[0]===255&&pixel(420,200)[1]===170,'Merged generation split into former objects or changed its neighbor');
    click(420,200,true);assert(parts().length===2&&manager.objects().length===3,'Ctrl added a selection by implicitly merging objects');
    document.querySelector('[data-tool="select"]').click();assert(state.tool==='select','Pointer failed to end Wand');
    checks.push('Only Merge to object creates a reusable union; either former object selects it, while Ctrl remains selection-only');

    const create=URL.createObjectURL,clickAnchor=HTMLAnchorElement.prototype.click,confirm=window.confirm;let saved;
    URL.createObjectURL=blob=>{if(blob.type==='application/json')saved=blob;return create(blob)};HTMLAnchorElement.prototype.click=()=>{};window.confirm=()=>true;
    try{await window.MosaicProjects.saveProject();const text=await saved.text();assert(!text.includes('sk-wand-management-fixture'),'Project leaked a key');await window.MosaicProjects.loadProjectFile(new File([text],'objects.moz'));assert(manager.objects().length===3&&state.objectCollections.some(c=>c.name==='Furniture'),'Project lost merged object or groups');wand(600,250);assert(parts().length===1&&alpha(state.selectionMask,300,150)===255&&alpha(state.selectionMask,170,150)===0&&maps===1,'Restored merged object lost its union or requested another map')}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=clickAnchor;window.confirm=confirm}
    assert(retired===0,'Retired SAM/intent service was called');
    checks.push('Project round-trip retains independent objects, persistent merges, refined options and Groups without a new map request');
    return {passed:checks.length,checks,maps,edits,retired};
  }finally{window.fetch=native;Element.prototype.setPointerCapture=capture;for(const release of held)release?.()}
};
