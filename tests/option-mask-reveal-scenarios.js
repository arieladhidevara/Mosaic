// Browser regression: run with the isolated mock OpenAI provider only.
window.runOptionMaskRevealChecks=async function(){
  const core=window.MosaicCore,{state,canvas,overlay,makeCanvas}=core;
  const $=id=>document.getElementById(id),checks=[];
  const assert=(ok,label)=>{if(!ok)throw Error(label)};
  const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timeout: '+label)};
  const alpha=(mask,x,y)=>mask.getContext('2d').getImageData(x,y,1,1).data[3];
  const pixel=(image,x,y)=>[...image.getContext('2d').getImageData(x,y,1,1).data];
  const point=(type,x,y)=>{
    const bounds=overlay.getBoundingClientRect();
    overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',button:0,pointerId:87,clientX:bounds.left+x/canvas.width*bounds.width,clientY:bounds.top+y/canvas.height*bounds.height}));
  };
  const rect=(x,y,size=10)=>{
    point('pointerdown',x-size,y-size);point('pointermove',x+size,y+size);point('pointerup',x+size,y+size);
  };
  const native=window.fetch,originalCapture=Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture=()=>{};
  let edits=0;
  window.fetch=async(url,options)=>{
    if(url==='/api/ai/edit')edits++;
    return native(url,options);
  };
  try{
    await window.MosaicAccount.ready();
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();
    await wait(()=>$('apiKeyDialog').open,'key dialog');
    $('apiKeyInput').value='sk-option-reveal-browser-fixture';
    $('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'connected key');
    const base=makeCanvas(800,500),bx=base.getContext('2d');bx.fillStyle='#224488';bx.fillRect(0,0,800,500);
    core.setMaster(base,'Option mask reveal regression');
    await wait(()=>state.objectMap?.entries?.length>=3,'object map');
    core.updateZoomFit();
    const group=state.groups.find(g=>g.mapPrepared&&g.category==='Door'&&!g.active);
    assert(group,'Prepared test object was not found');
    const beforeCount=state.groups.length;
    core.selectGroupMask(group,{showOutline:true});
    await window.MosaicPremium.generateSelection('Make this door red');
    await wait(()=>group.active&&group.patchIds.length===1&&![...state.patches.values()].some(p=>p.generating),'generated option');
    const patch=state.patches.get(group.active),source=state.sources.get(patch.sourceId).canvas;
    const box=core.exactMaskBoundingBox(core.groupMask(group));
    const x=Math.max(5,Math.round(box.x-14)),y=Math.round(box.y+box.h/2);
    assert(!alpha(patch.mask,x,y),'Expected a pixel just outside the initial object mask');
    const aiPixel=pixel(source,x,y);
    assert(aiPixel[0]>180&&aiPixel[1]<100,'The unmasked generated crop was not preserved for reveal');
    const priorPixel=pixel(core.composeApprovedCanvas(),x,y);
    assert(priorPixel[2]>100,'The original scene outside the object mask changed');
    checks.push('Raw AI crop is retained beneath the hard per-object mask');

    core.selectGroupMask(group,{showOutline:true});
    core.showQuickPrompt();
    const rail=$('quickGroupOptions');
    const choice=[...rail.querySelectorAll('.quick-option')].find(item=>item.dataset.option===patch.id);
    assert(choice,'Floating prompt is missing the saved Option');
    choice.click();
    assert(state.selectionOverlayHidden&&$('selectedObjectOverlay').hidden&&!$('selectionOutlineVectors').querySelector('path'),'Choosing an Option did not hide the purple selection and outline');
    $('quickAreaPromptInput').focus();
    assert(!state.selectionOverlayHidden&&!$('selectedObjectOverlay').hidden,'Returning to prompt text did not restore selection overlay');
    checks.push('Option browsing hides masks; returning to the text field restores them');

    core.selectTool('rect');
    assert(!document.querySelector('.selection-modes').classList.contains('hidden'),'Selection mode row did not appear');
    assert(document.querySelector('[data-mode="new"]').hidden,'New must be unavailable while a mask is selected');
    assert(state.selectionMode==='add','Existing selection should default to Add');
    const maskBefore=alpha(patch.mask,x,y);
    const optionCount=group.patchIds.length;
    rect(x,y);
    assert(!maskBefore&&alpha(patch.mask,x,y)>=128,'Add did not extend the same Option mask');
    assert(group.patchIds.length===optionCount&&state.groups.length===beforeCount,'Add silently created or merged an object');
    const shown=pixel(core.composeApprovedCanvas(),x,y);
    assert(shown[0]>180&&shown[1]<100,'Add did not reveal the original AI-generated crop');
    assert(edits===1,'Mask refinement made a second AI request');
    checks.push('Rectangle Add reveals hidden generated pixels without making another Object, Option or API request');

    core.selectTool('rect');core.setMode('subtract');rect(x,y);
    assert(alpha(patch.mask,x,y)===0,'Subtract did not remove pixels from the active mask');
    assert(pixel(core.composeApprovedCanvas(),x,y)[2]>100,'Subtract did not restore the underlying composition');
    checks.push('Subtract hides the saved AI pixels without deleting the Option source');

    core.resetSelection();core.selectTool('rect');
    assert(!document.querySelector('[data-mode="new"]').hidden&&state.selectionMode==='new','New must return only after selection is cleared');
    checks.push('New is offered again after clearing selection');
    return {passed:checks.length,checks,edits};
  }finally{
    window.fetch=native;Element.prototype.setPointerCapture=originalCapture;
  }
};
