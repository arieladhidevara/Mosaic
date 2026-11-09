// Run with mask-worker-fixture.js injected before modules, using an isolated local browser.
window.runMaskWorkflowChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await pause(20)}throw Error('Mask workflow timed out')};
  const frame=core.makeCanvas(800,600),ctx=frame.getContext('2d');
  ctx.fillStyle='#d6c6b6';ctx.fillRect(0,0,800,600);
  ctx.fillStyle='#54351f';ctx.fillRect(260,120,180,380);
  ctx.fillStyle='#d7c78b';ctx.fillRect(420,310,12,12);
  await window.MosaicAccount.ready();
  $('apiKeyDialog').close();
  core.setMaster(frame,'Door context fixture');
  await wait(()=>window.maskWorkerStats.prepares===1);
  core.selectTool('wand');core.selectTool('select');core.selectTool('wand');
  await pause(450);
  assert(window.maskWorkerStats.prepares===1,'Unchanged image was analyzed again on tool switches');
  checks.push('Image analyzed upfront once; leaving Wand during analysis and returning does not restart it');
  const select=()=>{
    core.selectTool('rect');core.state.lasso=[{x:270,y:140},{x:420,y:140},{x:420,y:480},{x:270,y:480}];
    core.updateMaskWithLasso();core.hideQuickPrompt();
  };
  select();
  const originalAuth={ensure:window.MosaicAuth.ensure,request:window.MosaicAuth.request};
  const originalAccount={ensure:window.MosaicAccount.ensure,request:window.MosaicAccount.request};
  let submitted,resolveEdit,autoCalls=0;
  const red=core.makeCanvas(256,256);red.getContext('2d').fillStyle='#ff0000';red.getContext('2d').fillRect(0,0,256,256);
  const encoded=red.toDataURL('image/png').split(',')[1];
  window.MosaicAuth.ensure=async()=>true;
  window.MosaicAuth.request=async(path,payload)=>{
    if(path==='/api/ai/edit'){submitted=payload;return new Promise(resolve=>{resolveEdit=resolve})}
    return {};
  };
  try{
    const before=core.composeApprovedCanvas().getContext('2d').getImageData(0,0,800,600).data;
    const mask=core.state.selectionMask.getContext('2d').getImageData(0,0,800,600).data;
    const generation=ai.generateSelection('Make this door walnut wood');
    await wait(()=>Boolean(submitted));
    const hud=$('maskProgressHud'),glow=document.querySelector('.mask-processing-shimmer');
    assert(!hud.classList.contains('hidden')&&hud.textContent.includes('OpenAI is generating'),'Masked edit progress is hidden');
    assert(!glow.classList.contains('hidden')&&glow.style.maskImage.includes('data:image/png'),'Generation shimmer is not clipped to submitted mask');
    assert(getComputedStyle(glow).animationName==='mask-soft-shimmer'&&Number(getComputedStyle(glow).opacity)>=.3,'Purple/white animation is not visible');
    window.MosaicMaskProgress.show('wand','Wand','Predicting mask');
    window.MosaicMaskProgress.highlight('wand',{point:{x:20,y:20}});
    window.MosaicMaskProgress.hide('wand');
    assert(!glow.classList.contains('hidden')&&glow.style.maskImage.includes('data:image/png'),'Wand completion erased generation animation');
    assert(submitted.context&&submitted.base&&submitted.crop&&submitted.targetObject==='Door','Object/scene context missing from edit');
    assert(submitted.crop.width>=400,'Crop is too tight to recognize the door');
    const scene=await createImageBitmap(await(await fetch(submitted.context)).blob());
    assert(scene.width===800&&scene.height===600,'Full current composition was not sent as scene context');scene.close();
    resolveEdit({image:encoded});await generation;
    await wait(()=>[...core.state.patches.values()].every(p=>!p.generating));
    assert(glow.classList.contains('hidden'),'Generation animation was not removed after completion');
    const after=core.composeApprovedCanvas().getContext('2d').getImageData(0,0,800,600).data;
    for(let i=0;i<mask.length;i+=4)if(!mask[i+3])for(let c=0;c<4;c++)assert(before[i+c]===after[i+c],'Pixels outside submitted mask changed');
    checks.push('Visible edit progress and purple/white masked animation survive concurrent Wand jobs and clean up on success');
    checks.push('Door edit includes wider crop, full current scene, original geometry and object identity; outside pixels unchanged');
    select();window.MosaicAuth.request=async()=>{throw Error('Expected fixture failure')};
    await ai.generateSelection('Make the door oak');
    await wait(()=>[...core.state.patches.values()].every(p=>!p.generating));
    assert(glow.classList.contains('hidden'),'Failed edit left a stale animation');
    checks.push('Failed edits clear their animation and preserve the approved image');
    window.MosaicAccount.ensure=async()=>true;
    window.MosaicAccount.request=async(path,options)=>{
      if(path!=='/api/ai/sam3')return originalAccount.request(path,options);
      autoCalls++;
      const {width,height}=options.body,c=core.makeCanvas(width,height),context=c.getContext('2d');
      context.fillStyle='rgb(1,0,0)';context.fillRect(width*.3,height*.2,width*.25,height*.6);
      return {labels:c.toDataURL('image/png')};
    };
    await window.MosaicAutoRegions.start();window.MosaicAutoRegions.reset();
    await window.MosaicAutoRegions.start();window.MosaicAutoRegions.reset();
    assert(autoCalls===1,'Auto Create repeated analysis for unchanged pixels');
    const key=window.MosaicSlimWand.imageKey();
    assert(window.MosaicAutoRegions.maskAt({x:300,y:250},key),'Wand cannot reuse a previously detected object');
    assert(!window.MosaicAutoRegions.maskAt({x:300,y:250},'changed'),'Old masks were reused for a changed image');
    checks.push('Auto Create caches analysis; Wand reuses detected objects only for matching image pixels');
    ctx.fillStyle='#00ff00';ctx.fillRect(0,0,100,100);core.render();
    const count=window.maskWorkerStats.prepares;await wait(()=>window.maskWorkerStats.prepares>count);
    checks.push('Actual image changes invalidate the cache and trigger fresh analysis');
    return {passed:checks.length,checks};
  }finally{
    Object.assign(window.MosaicAuth,originalAuth);Object.assign(window.MosaicAccount,originalAccount);
    window.MosaicAutoRegions.reset();
  }
};
