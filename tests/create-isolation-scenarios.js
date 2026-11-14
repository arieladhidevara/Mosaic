// Isolated browser regression: Create must never steal the existing Object ID or its pixels.
window.runCreateIsolationChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state,canvas,overlay,makeCanvas}=core;
  const checks=[],assert=(ok,description)=>{if(!ok)throw Error(description)};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async predicate=>{for(let i=0;i<350;i++){if(predicate())return;await pause(20)}throw Error('Create scenario timed out')};
  const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture;
  const originalAuth={ensure:window.MosaicAuth.ensure,request:window.MosaicAuth.request};
  const originalSamRequest=window.MosaicAccount.request;
  Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
  const pointer=(type,x,y)=>{
    const r=overlay.getBoundingClientRect();
    overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerType:'mouse',pointerId:74,
      clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height}));
  };
  try{
    await window.MosaicAccount.ready();
    const base=makeCanvas(640,480),x=base.getContext('2d');
    x.fillStyle='#eeeeee';x.fillRect(0,0,640,480);
    x.fillStyle='#a08060';x.fillRect(100,80,400,330);
    state.reference=base;core.setMaster(base,'Create placement fixture',false);core.updateZoomFit();
    const existingMask=makeCanvas(640,480),m=existingMask.getContext('2d');
    m.fillStyle='#ffffff';m.fillRect(100,80,400,330);
    const wall=core.newGroup(existingMask,'Wall');wall.name='Existing wall';wall.mapPrepared=true;
    const wallId=wall.id,originalScene=core.composeApprovedCanvas().toDataURL();
    core.selectGroupMask(wall,{showOutline:true});
    assert(state.draftGroupId===wallId,'Fixture did not select existing object');
    core.selectTool('rect');
    assert(state.draftGroupId!==wallId&&state.selectionMode==='new',
      'Create did not clear the existing selection and restore New mode');
    pointer('pointerdown',190,160);pointer('pointermove',320,310);pointer('pointerup',320,310);
    const created=state.groups.find(group=>group.createdLocally);
    assert(created&&created.id!==wallId,'Create reused an underlying Object ID');
    assert(state.groups.some(group=>group.id===wallId),'Create removed the original object');
    assert(created.patchIds.length===1&&state.draftGroupId===created.id,'Create failed to select its new Group');
    assert(document.querySelector('.geometry-mode-switcher')?.hidden,
      'Create should hide Material/Shape/Remove and use transparent PNG mode');
    const placeholder=state.patches.get(created.active),source=state.sources.get(placeholder.sourceId);
    const pixels=source.canvas.getContext('2d').getImageData(0,0,640,480).data;
    assert(pixels.every((value,index)=>index%4!==3||value===0),'Create copied underlying wall pixels');
    assert(core.composeApprovedCanvas().toDataURL()===originalScene,'Drawing Create modified the original scene');
    checks.push('Drawing over an existing object starts a new object ID, empty foreground and unchanged scene');
    window.MosaicAccount.request=async(path,options)=>{
      if(path==='/api/ai/sam3')throw Error('Fixture: SAM 3 unavailable, use PNG alpha.');
      return originalSamRequest(path,options);
    };
    window.MosaicAuth.ensure=async()=>true;
    let payload,finish;
    window.MosaicAuth.request=async(path,request)=>{
      if(path==='/api/ai/edit'){payload=request;return new Promise(resolve=>{finish=resolve})}
      if(path==='/api/ai/option-name')return {name:'New chair'};
      return {};
    };
    await ai.generateSelection('Add a blue chair with soft contact shadow');
    await wait(()=>Boolean(payload));
    assert(payload.createObject===true,'Create generation fell back to Material Edit');
    assert(Boolean(payload.placementGuide&&payload.context&&payload.mask&&payload.base),
      'Create omitted scene, Base, placement guide or approximate selection');
    assert(state.groups.some(g=>g.id===wallId),'Create request changed the old wall');
    checks.push('Generate bypasses existing Object Map and asks for a transparent foreground object');
    // A mock OpenAI cutout: transparent border + blue foreground + soft alpha shadow.
    const cutout=makeCanvas(256,256),c=cutout.getContext('2d');
    c.fillStyle='rgba(20,20,50,0.3)';c.beginPath();c.ellipse(128,203,80,20,0,0,Math.PI*2);c.fill();
    c.fillStyle='#3166bb';c.fillRect(80,58,94,128);
    finish({image:cutout.toDataURL('image/png').split(',')[1],mimeType:'image/png'});
    await wait(()=>[...state.patches.values()].some(p=>p.createObject&&!p.generating&&!p.awaitingResult));
    assert(state.groups.some(g=>g.id===wallId),'Create result removed the wall');
    assert(state.groups.some(g=>g.id===created.id),'Create result lost its independent Group');
    assert(core.composeApprovedCanvas().toDataURL()!==originalScene,'Transparent Create result did not composite');
    checks.push('Transparent PNG output is composited as a new object without changing the original Group');
    // Removing a new PNG cutout is just turning its own layer off. There is
    // already an accepted background underneath, so no image model is needed.
    const createdOption=created.active,generatedScene=core.composeApprovedCanvas().toDataURL();
    core.selectGroupMask(created,{showOutline:true});
    const formerAuth=window.MosaicAuth.request,formerSam=window.MosaicAccount.request;
    let extraCalls=0;
    window.MosaicAuth.request=async()=>{extraCalls++;throw Error('Remove must not call OpenAI')};
    window.MosaicAccount.request=async()=>{extraCalls++;throw Error('Remove must not call SAM 3')};
    document.getElementById('geometryRemoveBtn').click();
    const removed=state.patches.get(created.active);
    assert(removed?.localCutoutRemoval&&removed.editMode==='remove','Remove did not create an empty local Option');
    assert(created.objectRemoved&&created.patchIds.includes(createdOption),'Remove discarded original Create Option');
    assert(core.composeApprovedCanvas().toDataURL()===originalScene,'Removing Create did not reveal original underlying scene');
    assert(extraCalls===0,'Removing Create made an unnecessary AI call');
    assert(document.querySelector('.region-group[data-group="'+created.id+'"]'),
      'Removed Create object disappeared from Groups, blocking restoration');
    await core.chooseGroupOption(created,createdOption,{showOutline:false});
    assert(!created.objectRemoved&&core.composeApprovedCanvas().toDataURL()===generatedScene,
      'Selecting prior Option failed to restore the cutout');
    core.selectGroupMask(created,{showOutline:true});
    document.getElementById('geometryRemoveBtn').click();
    assert(state.patches.get(created.active)===removed&&created.patchIds.length===2,
      'Repeated Remove created duplicate empty Options instead of reusing it');
    window.MosaicAuth.request=formerAuth;
    window.MosaicAccount.request=formerSam;
    checks.push('Create Remove is instant, costs zero AI requests, and its Option remains reversible');
    return {passed:checks.length,checks};
  }finally{
    Object.assign(window.MosaicAuth,originalAuth);
    window.MosaicAccount.request=originalSamRequest;
    Element.prototype.setPointerCapture=capture;Element.prototype.releasePointerCapture=release;
  }
};
