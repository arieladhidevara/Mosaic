// Fresh isolated tab, mock provider, mask-worker fixture and base-only-legacy-html preload.
window.runBaseOnlyChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async predicate=>{for(let i=0;i<400;i++){if(predicate())return;await pause(20)}throw Error('Base-only flow timed out')};
  await window.MosaicAccount.ready();$('apiKeyDialog').close();
  assert(!document.querySelector('script[src="./generation-pool.js"]')&&ai,'AI module failed to load independently of the HTML pool tag');
  const base=core.makeCanvas(800,600),context=base.getContext('2d');context.fillStyle='#2468ab';context.fillRect(0,0,800,600);
  const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'Base only.png',{type:'image/png'}))));
  const transfer=new DataTransfer();transfer.items.add(file);$('referenceInput').files=transfer.files;$('referenceInput').dispatchEvent(new Event('change'));
  await wait(()=>state.reference&&!$('welcomeContinueBtn').classList.contains('hidden'));
  assert(!state.master,'Base upload unexpectedly created a Master');$('welcomeContinueBtn').click();
  assert(state.masterIsBase&&state.master&&!state.rawMaster&&ai.getMasterVersions().length===0,'Continue with Base only did not open a working draft');
  checks.push('Base-only onboarding works with cached older HTML; AI dependencies load through the module');
  const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
  const pointer=(type,x,y)=>{const r=core.overlay.getBoundingClientRect();core.overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse',pointerId:81,clientX:r.left+x/800*r.width,clientY:r.top+y/600*r.height}))};
  const nativeAuth={ensure:window.MosaicAuth.ensure,request:window.MosaicAuth.request,isReady:window.MosaicAuth.isReady};
  try{
    window.MosaicPremium=undefined;core.selectTool('rect');pointer('pointerdown',200,150);pointer('pointermove',480,350);pointer('pointerup',480,350);
    assert(core.maskBoundingBox(state.selectionMask)&&core.canCreateSelection(),'Manual Base-only selection still depends on Premium');
    assert(!/Upload a variation/i.test($('toast').textContent),'Base-only selection asked for a variation');
    assert(!state.pendingSourceId&&state.sources.size===0,'Drawing a selection imported an image');
    window.MosaicPremium=ai;
    checks.push('Manual selection works using Base alone while AI is unavailable, with no variation import');
    core.resetSelection();core.selectTool('reveal');pointer('pointerdown',240,250);pointer('pointermove',350,250);pointer('pointerup',350,250);
    assert(state.selectionMask.getContext('2d').getImageData(300,250,1,1).data[3]>0,'Brush cannot create a Base-only selection');
    core.selectTool('erase');pointer('pointerdown',300,250);pointer('pointerup',300,250);
    assert(state.selectionMask.getContext('2d').getImageData(300,250,1,1).data[3]===0,'Eraser cannot refine a Base-only selection');
    $('undoBtn').click();assert(state.selectionMask.getContext('2d').getImageData(300,250,1,1).data[3]>0,'Base-only mask Undo failed');
    checks.push('Brush, Eraser and Undo refine a Base-only mask without an uploaded option');
    core.resetSelection();core.selectTool('wand');await pause(450);window.MosaicSlimWand.hoverAt({x:400,y:300});
    await wait(()=>$('slimsamHoverOverlay').getContext('2d').getImageData(400,300,1,1).data[3]>0);window.MosaicSlimWand.selectAt({x:400,y:300});
    assert(core.maskBoundingBox(state.selectionMask),'Wand cannot select directly on Base');
    const originalBase=state.reference.toDataURL();let request,finish;
    window.MosaicAuth.ensure=async()=>true;window.MosaicAuth.isReady=()=>false;
    window.MosaicAuth.request=async(route,payload)=>{
      assert(route==='/api/ai/edit','Base-only edit requested a Master or variation');request=payload;return new Promise(resolve=>{finish=resolve});
    };
    await ai.generateSelection('Make the selected area warm wood');await wait(()=>Boolean(request));
    assert(request.collage&&request.mask&&request.base&&request.context,'Base-only regional request is incomplete');
    const output=core.makeCanvas(256,256);output.getContext('2d').fillStyle='#ff0000';output.getContext('2d').fillRect(0,0,256,256);finish({image:output.toDataURL('image/png').split(',')[1]});
    await wait(()=>[...state.patches.values()].some(patch=>!patch.generating&&!patch.awaitingResult));
    assert(state.masterIsBase&&!state.rawMaster&&ai.getMasterVersions().length===0,'Regional edit forced a full Master');
    assert(state.reference.toDataURL()===originalBase,'Regional edit mutated the original Base');
    checks.push('Wand and regional generation work directly on Base, preserving the original image without generating Master');
    return {passed:checks.length,checks};
  }finally{window.MosaicPremium=ai;Object.assign(window.MosaicAuth,nativeAuth);Element.prototype.setPointerCapture=capture;Element.prototype.releasePointerCapture=release}
};
