/* Run against the test server with tests/mock-openai.cjs in a fresh tab. */
window.runInitialMasterChecks=async function(pausePreview=false){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state,makeCanvas}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const wait=async(predicate)=>{for(let i=0;i<400;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Initial Master flow timed out')};
  assert(!state.master&&!state.reference,'Use a fresh browser tab for onboarding checks');
  $('apiKeyStatusBtn').click();$('apiKeyInput').value='sk-initial-master-validation';$('apiKeyForm').requestSubmit();
  const base=makeCanvas(900,600),context=base.getContext('2d');context.fillStyle='#52667f';context.fillRect(0,0,900,600);context.fillStyle='#d8dee9';context.fillRect(160,100,500,280);context.fillStyle='#74859e';context.fillRect(210,160,150,220);context.fillRect(440,160,150,220);
  const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'Initial base.png',{type:'image/png'})),'image/png'));
  const transfer=new DataTransfer();transfer.items.add(file);$('referenceInput').files=transfer.files;$('referenceInput').dispatchEvent(new Event('change'));
  await wait(()=>Boolean(state.reference));assert(!state.master&&!$('welcome').classList.contains('hidden'),'Base upload should stay on onboarding before Generate');
  let releaseReply;const gate=new Promise(resolve=>{releaseReply=resolve}),nativeFetch=window.fetch;let requests=0;
  window.fetch=async(url,options)=>{
    const response=await nativeFetch(url,options);
    if(String(url)==='/api/ai/master'){requests++;await gate}
    return response;
  };
  try{
    $('projectName').click();$('projectNameInput').value='First render';$('projectNameInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    $('welcomeBasePromptInput').value='Create a refined architectural render';$('welcomeBasePromptForm').requestSubmit();
    await wait(()=>Boolean(state.master&&$('canvasGenerationProgress')?.children.length));
    assert(state.masterIsBase&&$('welcome').classList.contains('hidden')&&!$('canvasWrap').classList.contains('hidden'),'Generate did not immediately enter the main canvas with Base');
    assert(ai.getMasterVersions().length===0,'Base preview was registered as a generated Master');
    const pixel=core.ctx.getImageData(30,30,1,1).data;assert(pixel[0]===82&&pixel[1]===102&&pixel[2]===127,'Canvas does not show Base while generating');
    const viewport=$('viewport').getBoundingClientRect(),progress=$('canvasGenerationProgress').getBoundingClientRect();
    assert(Math.abs(progress.left+progress.width/2-viewport.left-viewport.width/2)<2&&Math.abs(progress.top+progress.height/2-viewport.top-viewport.height/2)<2,'Progress bar is not centered in the canvas viewport');
    assert($('canvasGenerationProgress').querySelector('[role="progressbar"]'),'Centered generation progress bar is missing');
    assert($('projectName').textContent==='First render','Starting generation overwrote the project name');
    const zoom=state.zoom;core.overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:viewport.left+viewport.width/2,clientY:viewport.top+viewport.height/2}));
    const zoomedProgress=$('canvasGenerationProgress').getBoundingClientRect();
    assert(state.zoom>zoom&&Math.abs(zoomedProgress.left+zoomedProgress.width/2-viewport.left-viewport.width/2)<2,'Progress moved away from the center during scroll zoom');
    $('zoomValue').click();assert(Math.abs(state.zoom-state.fitZoom)<.001&&$('zoomValue').textContent==='Fit','Fit did not restore the Base preview');
    checks.push('Base upload stays on onboarding; Generate enters the editor immediately with Base and centered progress');
    $('generateMasterBtn').click();assert(!$('masterGenerateDialog').open,'A duplicate Master generation dialog opened while generating');
    core.selectTool('lasso');state.lasso=[{x:180,y:150},{x:370,y:150},{x:350,y:300}];core.updateMaskWithLasso();core.hideQuickPrompt();
    const mask=state.selectionMask.toDataURL(),group=state.draftGroupId;
    window.initialPreviewReady=true;
    if(pausePreview)await new Promise(resolve=>{window.finishInitialPreview=resolve});
    releaseReply();
    await wait(()=>!state.masterIsBase&&ai.getMasterVersions().length===1);
    assert(requests===1,'Initial flow sent duplicate Master requests');
    assert($('projectName').textContent==='First render','Generated Master overwrote the project name');
    assert(state.selectionMask.toDataURL()===mask&&state.draftGroupId===group,'Master arrival lost the in-progress selection or Group');
    const transition=$('canvasWrap').querySelector('.master-image-transition');
    assert(transition&&getComputedStyle(transition).animationName==='master-image-reveal','Base-to-Master transition is missing');
    const master=state.master.getContext('2d').getImageData(30,30,1,1).data;assert(master[0]>245&&master[1]<10,'Generated Master was not applied behind the transition');
    await wait(()=>!$('canvasWrap').querySelector('.master-image-transition')&&!$('canvasGenerationProgress').children.length);
    checks.push('One Initial Master request; editable canvas during generation; Base fades into Master; selection and Group survive');
    assert($('projectOpenInput').accept.includes('.moz')&&$('projectOpenInput').accept.includes('.mosaic'),'New or legacy project file support is missing');
    const createURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click;let name,blob;
    URL.createObjectURL=value=>{if(value.type==='application/json')blob=value;return createURL(value)};
    HTMLAnchorElement.prototype.click=function(){if(this.download?.endsWith('.moz'))name=this.download;else anchorClick.call(this)};
    try{
      $('saveProjectBtn').click();await wait(()=>Boolean(name&&blob));assert(name.endsWith('.moz'),'Project does not save as .moz');
      const saved=JSON.parse(await blob.text());assert(saved.app==='mozAI'&&saved.format==='MOSAIC_PROJECT','New branding broke the portable project format');
      assert(!JSON.stringify(saved).includes('sk-initial-master-validation'),'Project contains API credentials');
      checks.push('.moz project download, mozAI metadata, legacy .mosaic support, and no saved API key');
    }finally{URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick}
    // A failed first render stays editable on Base, then retries cleanly.
    state.master=null;state.rawMaster=null;state.masterIsBase=false;ai.onMasterReset();core.continueWithBase(false);
    let failOnce=true;
    window.fetch=async(url,options)=>{
      if(String(url)==='/api/ai/master'&&failOnce){failOnce=false;return Response.json({error:'Test provider unavailable'},{status:502})}
      return nativeFetch(url,options);
    };
    $('generateMasterBtn').click();await wait(()=>$('masterGenerateDialog').open);
    $('masterGeneratePromptInput').value='Retry the first render';$('masterGenerateForm').requestSubmit();
    await wait(()=>Boolean($('canvasGenerationProgress').querySelector('.error'))&&!ai.isMasterGenerating());
    assert(state.masterIsBase&&!$('generateMasterBtn').disabled&&ai.getMasterVersions().length===0,'Generation failure lost Base or blocked retry');
    $('generateMasterBtn').click();await wait(()=>$('masterGenerateDialog').open);$('masterGenerateForm').requestSubmit();
    await wait(()=>!state.masterIsBase&&ai.getMasterVersions().length===1);
    assert(!$('canvasGenerationProgress').querySelector('.error'),'Old error progress remained on the new Master');
    checks.push('First-generation errors preserve Base and unlock retry; successful retry removes stale error progress');
    return {passed:checks.length,checks};
  }finally{releaseReply();window.fetch=nativeFetch;delete window.finishInitialPreview;delete window.initialPreviewReady}
};
