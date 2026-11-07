/* Run in a fresh Mosaic browser tab served with tests/mock-openai.cjs preloaded.
   Sets a fake key, replaces the open project with generated fixtures, and never
   uses real OpenAI credentials. Returns a concise validation report. */
window.runMosaicBrowserChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state,canvas,makeCanvas}=core;
  const $=id=>document.getElementById(id),checks=[],requests=[];
  const assert=(condition,message)=>{if(!condition)throw Error(message)};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const wait=async(predicate,label)=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Timed out: '+label)};
  const frame=(w,h,color)=>{const c=makeCanvas(w,h);c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,w,h);return c};
  const image=async(data)=>{const blob=await (await nativeFetch(data)).blob();return createImageBitmap(blob)};
  const nativeFetch=window.fetch;
  window.fetch=async(url,options)=>{
    if(String(url).startsWith('/api/ai/'))requests.push({path:String(url),body:JSON.parse(options.body)});
    return nativeFetch(url,options);
  };
  const set=(id,value)=>{const element=$(id);if(element.type==='checkbox')element.checked=value;else element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}))};
  const polygon=[{x:200,y:200},{x:600,y:230},{x:570,y:440},{x:220,y:420}];
  const initialize=()=>{
    state.reference=frame(1200,800,'#228844');state.rawBase=state.reference;
    core.setMaster(frame(1000,700,'#224488'),'Browser validation');
    core.selectTool('lasso');state.lasso=polygon.map(point=>({...point}));core.updateMaskWithLasso();core.hideQuickPrompt();
  };
  const pixels=()=>core.composeApprovedCanvas().getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  function unchangedOutside(before,after,mask){
    const alpha=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;let tested=0,changed=0;
    for(let i=0;i<alpha.length;i+=4){if(alpha[i+3])continue;tested++;for(let c=0;c<4;c++)if(before[i+c]!==after[i+c]){changed++;break}}
    assert(changed===0,`${changed} pixels outside selection changed`);return tested;
  }
  const finished=()=>[...state.patches.values()].every(p=>!p.generating&&!p.awaitingResult);
  try{
    assert(same(ai.exportProjectState().settings,{preserveOriginalGeometry:false,regionQuality:'medium',harmonizeQuality:'high'}),'Incorrect default settings');
    assert(!$('advancedSettings').open,'Advanced Settings should start collapsed');
    $('apiKeyStatusBtn').click();$('apiKeyInput').value='sk-mosaic-browser-validation';$('apiKeyForm').requestSubmit();
    assert(window.MosaicAuth.isReady(),'Fake key form did not connect');
    for(const quality of ['low','medium','high'])for(const preserve of [false,true]){
      initialize();set('regionRenderQuality',quality);set('preserveOriginalGeometry',preserve);
      const before=pixels(),mask=state.selectionMask,bounds=core.exactMaskBoundingBox(mask);
      const padding=Math.max(48,Math.ceil(Math.max(bounds.w,bounds.h)*.15));
      const crop={x:Math.max(0,bounds.x-padding),y:Math.max(0,bounds.y-padding),right:Math.min(canvas.width,bounds.x+bounds.w+padding),bottom:Math.min(canvas.height,bounds.y+bounds.h+padding)};
      const tool=state.tool,points=JSON.stringify(state.selectionPoints);
      await ai.generateSelection('Make this wall red');
      assert([...state.patches.values()].some(p=>p.generating),'Generation did not run in the background');
      await wait(finished,'region generation');
      const sent=requests.filter(r=>r.path==='/api/ai/edit').at(-1);
      assert(sent.body.quality===quality,'Region quality was not forwarded');
      assert(('base' in sent.body)===preserve,'Geometry toggle did not control Base');
      assert(!('guide' in sent.body),'Region Guide still sent');
      const input=await image(sent.body.collage),editMask=await image(sent.body.mask);
      assert(input.width===crop.right-crop.x&&input.height===crop.bottom-crop.y,'Crop did not use exact bounds plus 15% padding');
      assert(input.width===editMask.width&&input.height===editMask.height,'Mask and collage dimensions differ');
      if(preserve){const reference=await image(sent.body.base);assert(Math.abs(reference.width/reference.height-1.5)<.005,'Base was cropped or distorted')}
      const mc=makeCanvas(editMask.width,editMask.height);mc.getContext('2d').drawImage(editMask,0,0);
      const localAlpha=mc.getContext('2d').getImageData(0,0,mc.width,mc.height).data;
      assert(localAlpha[3]===255,'Padding should be protected by mask');
      assert(localAlpha[((300-crop.y)*mc.width+350-crop.x)*4+3]===0,'Mask target is not aligned to crop');
      const after=pixels(),tested=unchangedOutside(before,after,mask),center=(300*canvas.width+350)*4;
      assert(after[center]>245&&after[center+1]<10&&after[center+2]<10,'Result was not composited at selected location');
      const patch=[...state.patches.values()].find(p=>p.prompt);
      assert(same(patch.maskPoints,polygon),'Clicked polygon vertices were lost');
      assert(state.tool===tool&&JSON.stringify(state.selectionPoints)===points,'Background generation interrupted selection');
      checks.push(`Region ${quality}, geometry ${preserve}: crop ${input.width}x${input.height}, ${tested} outside pixels unchanged`);
    }
    // Selection UI follows the polygon and its handles drive the existing warp.
    const selected=[...state.patches.values()].find(p=>p.prompt);
    core.resetSelection();state.selectedPatchId=selected.id;core.selectTool('transform');core.render();
    const outline=core.overlay.getContext('2d').getImageData(500,439,1,1).data;
    assert(outline[3]===0,'Selection still draws a bounding rectangle');
    assert(same(core.patchControlPoints(selected).map(({x,y})=>({x,y})),polygon),'Handles do not match clicked vertices');
    const capture=core.overlay.setPointerCapture;core.overlay.setPointerCapture=()=>{};
    try{
      const rect=core.overlay.getBoundingClientRect(),point=polygon[0],screen={x:rect.left+point.x/canvas.width*rect.width,y:rect.top+point.y/canvas.height*rect.height};
      const send=(type,x,y)=>core.overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'mouse',button:0,clientX:x,clientY:y}));
      send('pointerdown',screen.x,screen.y);send('pointermove',screen.x+12,screen.y+6);send('pointerup',screen.x+12,screen.y+6);
      const moved=core.patchControlPoints(selected)[0];
      assert(Math.abs(moved.x-point.x-12/state.zoom)<.01&&Math.abs(moved.y-point.y-6/state.zoom)<.01,'Mask vertex did not follow handle drag');
      $('undoBtn').click();assert(!selected.corners,'Undo did not restore the polygon transform');
    }finally{core.overlay.setPointerCapture=capture}
    checks.push('Selection: mask contour, clicked vertex handles, handle drag, transform undo');
    const clickAt=(x,y)=>{
      const rect=core.overlay.getBoundingClientRect();
      const event=new PointerEvent('pointerdown',{bubbles:true,pointerId:8,pointerType:'mouse',button:0,
        clientX:rect.left+x/canvas.width*rect.width,clientY:rect.top+y/canvas.height*rect.height});
      core.overlay.dispatchEvent(event);
      core.overlay.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:8,pointerType:'mouse',button:0,
        clientX:event.clientX,clientY:event.clientY}));
    };
    const originalPixels=pixels(),groupId=selected.groupId,maskBefore=selected.mask.toDataURL();
    // This point is inside the polygon's bounding box, but outside its mask.
    clickAt(595,430);
    assert(state.selectedPatchId===null&&state.boundaryCanvas===null,'Outside click kept the transform selection active');
    assert($('resetTransformBtn').classList.contains('hidden'),'Outside click kept transform controls visible');
    assert(!state.transformDrag,'Outside click started a transform');
    assert(core.overlay.style.cursor==='default','Outside click kept the move cursor active');
    assert(state.groups.find(g=>g.id===groupId)?.active===selected.id&&selected.mask.toDataURL()===maskBefore,'Deselecting changed the saved layer or mask');
    assert(pixels().every((value,index)=>value===originalPixels[index]),'Deselecting changed composition pixels');
    core.selectTool('select');clickAt(350,300);
    assert(state.draftGroupId===groupId&&state.boundaryCanvas,'Clicking the mask did not select it again');
    clickAt(900,600);
    assert(state.draftGroupId===null&&state.boundaryCanvas===null&&!core.maskBoundingBox(state.selectionMask),'Blank click kept the saved group selection active');
    assert($('quickAreaPromptForm').classList.contains('hidden'),'Blank click left the selection prompt open');
    // Padding must not get clamped to a selected pixel at the image edge.
    const edgeMask=makeCanvas(canvas.width,canvas.height);edgeMask.getContext('2d').fillRect(0,100,50,80);
    const edgePatch={id:core.uid('edge_patch'),sourceId:selected.sourceId,mask:edgeMask,bbox:{x:0,y:100,w:50,h:80},name:'Edge selection'};
    const edgeGroup=core.assignGroup(edgePatch);core.resetSelection();state.selectedPatchId=edgePatch.id;core.selectTool('transform');
    clickAt(-25/state.zoom,140);
    assert(state.selectedPatchId===null&&!state.transformDrag,'Viewport padding selected an edge mask');
    core.selectTool('select');clickAt(-25/state.zoom,140);
    assert(state.draftGroupId===null&&!state.boundaryCanvas,'Viewport padding selected an edge group');
    // Keep an unfinished import's mask safe when the user clicks blank space.
    state.pendingSourceId=selected.sourceId;state.selectionMask.getContext('2d').drawImage(selected.mask,0,0);core.updateSelectionOutline();
    clickAt(900,600);assert(core.maskBoundingBox(state.selectionMask),'Blank click discarded an unfinished import mask');
    state.pendingSourceId=null;core.resetSelection();
    assert(edgeGroup.active===edgePatch.id,'Deselecting hid an approved option');
    checks.push('Outside clicks: deselect mask and handles, preserve saved pixels/layers, reselect inside, ignore viewport padding, protect unfinished imports');
    // A tiny edge selection exercises the 48px minimum and canvas clipping.
    initialize();core.resetSelection();state.selectionMask.getContext('2d').fillRect(0,0,8,10);core.updateSelectionOutline();
    await ai.generateSelection('Tiny red corner');await wait(finished,'edge selection');
    let sent=requests.filter(r=>r.path==='/api/ai/edit').at(-1),input=await image(sent.body.collage);
    assert(Math.abs(input.width/input.height-56/58)<.015,'Minimum padding or proportional scaling is wrong');
    checks.push('Edge crop: 48px minimum padding, proportional resizing, canvas clipping');
    // Regenerate an already transformed patch and move it while queued.
    initialize();core.resetSelection();
    const mask=makeCanvas(canvas.width,canvas.height),m=mask.getContext('2d');m.fillStyle='#fff';m.fillRect(200,200,300,180);
    const sourceId=core.uid('test_source');state.sources.set(sourceId,{id:sourceId,name:'Existing source',canvas:frame(1000,700,'#224488')});
    const patch={id:core.uid('test_patch'),sourceId,mask,bbox:{x:200,y:200,w:300,h:180},maskPoints:[{x:200,y:200},{x:500,y:200},{x:500,y:380},{x:200,y:380}],corners:[{x:250,y:230},{x:560,y:210},{x:540,y:410},{x:260,y:430}],name:'Moved wall',prompt:'Red wall',manualName:true};
    const group=core.assignGroup(patch);core.selectTool('transform');core.render();
    const originalCorners=patch.corners.map(point=>({...point}));
    state.undo.push({type:'transform',patchId:patch.id,corners:originalCorners});
    const undoLength=state.undo.length;
    await ai.regenerateOption(patch.id);
    patch.corners=patch.corners.map(point=>({x:point.x+20,y:point.y+10}));core.invalidateDisplayedMask(patch);
    const corners=JSON.stringify(patch.corners),before=pixels(),visible=core.displayedPatchMask(patch);
    await wait(finished,'transformed regeneration');
    assert(JSON.stringify(patch.corners)===corners,'Regeneration cleared or changed the warp');
    assert(state.undo.length===undoLength&&group.active===patch.id,'Transform history or group choice changed');
    assert(state.sources.has(sourceId)&&patch.sourceId!==sourceId,'Regeneration overwrote an existing source');
    unchangedOutside(before,pixels(),visible);
    const transformedPixels=pixels(),redCenter=(310*canvas.width+400)*4;
    assert(transformedPixels[redCenter]>240&&transformedPixels[redCenter+2]<20,'Skewed result was not composited in the transformed position');
    assert(core.patchControlPoints(patch)[0].x===270&&core.patchControlPoints(patch)[0].y===240,'Handles do not track the transformed clicked vertices');
    checks.push('Transformed regeneration: move during generation, source isolation, warp and undo preserved');
    // Harmonize all three qualities; Base must be present for both toggle states.
    for(const quality of ['low','medium','high']){
      set('harmonizeQuality',quality);set('preserveOriginalGeometry',quality==='medium');
      const prior=ai.exportProjectState().serial;
      $('harmonizeBtn').click();await wait(()=>$('harmonizeDialog').open,'harmonize dialog');
      $('harmonizeForm').requestSubmit();
      await wait(()=>$('harmonizeBtn').disabled,'Harmonize started');
      assert(!$('harmonizeDialog').open,'Harmonize modal blocks the background editor');
      await wait(()=>!$('harmonizeBtn').disabled&&ai.exportProjectState().serial>prior,'harmonize');
      sent=requests.filter(r=>r.path==='/api/ai/harmonize').at(-1);
      assert(sent.body.quality===quality&&Boolean(sent.body.base),'Harmonize quality/Base contract failed');
      assert(JSON.stringify(patch.corners)===corners,'Harmonize mutated an archived layer transform');
      checks.push(`Harmonize ${quality}: Base included, layers and archived transforms preserved`);
    }
    // Round-trip the real .mosaic serializer, including nested history and preferences.
    set('preserveOriginalGeometry',true);set('regionRenderQuality','low');set('harmonizeQuality','medium');
    let savedBlob;const createURL=URL.createObjectURL,anchorClick=HTMLAnchorElement.prototype.click,confirm=window.confirm;
    URL.createObjectURL=blob=>{if(blob.type==='application/json')savedBlob=blob;return createURL(blob)};
    HTMLAnchorElement.prototype.click=function(){if(!this.download?.endsWith('.mosaic'))return anchorClick.call(this)};
    window.confirm=()=>true;
    try{
      $('saveProjectBtn').click();await wait(()=>Boolean(savedBlob),'project save');
      const savedText=await savedBlob.text(),data=JSON.parse(savedText);
      assert(!savedText.includes('sk-mosaic-browser-validation'),'Project contains API key');
      const expectedGroups=state.groups.map(g=>({id:g.id,patchIds:g.patchIds,active:g.active})),expectedSettings=ai.exportProjectState().settings,expectedSerial=ai.exportProjectState().serial;
      const load=async(fileData)=>{
        const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(fileData)],'validation.mosaic',{type:'application/json'}));
        $('projectOpenInput').files=transfer.files;$('projectOpenInput').dispatchEvent(new Event('change'));
        await wait(()=>$('openProjectBtn').disabled,'project load start');
        await wait(()=>!$('openProjectBtn').disabled,'project load finish');
        assert($('toast').textContent.startsWith('Project restored'),'Project restore failed: '+$('toast').textContent);
      };
      await load(data);
      assert(same(state.groups.map(g=>({id:g.id,patchIds:g.patchIds,active:g.active})),expectedGroups),'Group organization changed after save/open');
      assert(same(ai.exportProjectState().settings,expectedSettings),'Preferences did not round-trip');
      assert(ai.exportProjectState().serial===expectedSerial&&ai.exportProjectState().root.parent.parent,'Nested harmonization history was lost');
      assert(JSON.stringify(state.patches.get(patch.id).corners)===corners,'Layer transform did not round-trip');
      delete data.premium.settings;delete data.state.selectionPoints;
      for(const [,p] of data.state.patches.$map)delete p.maskPoints;
      await load(data);
      assert(same(ai.exportProjectState().settings,{preserveOriginalGeometry:false,regionQuality:'medium',harmonizeQuality:'high'}),'Legacy project defaults failed');
      assert(core.patchControlPoints(state.patches.get(patch.id)).length===4,'Legacy raster mask handles failed');
      checks.push('Project round trip: preferences, groups, layer transforms, nested history and API key exclusion; legacy v1 defaults');
    }finally{URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=anchorClick;window.confirm=confirm}
    // Initial Master ignores other quality choices and keeps the editor usable.
    state.reference=frame(1000,700,'#228844');core.setMaster(frame(1000,700,'#224488'),'Initial Master test');
    set('regionRenderQuality','low');set('harmonizeQuality','low');
    const initial=ai.getMasterVersions().length;
    $('generateMasterBtn').classList.remove('hidden');$('generateMasterBtn').click();
    await wait(()=>$('masterGenerateDialog').open,'Master dialog');$('masterGeneratePromptInput').value='Red architectural render';$('masterGenerateForm').requestSubmit();
    await wait(()=>ai.getMasterVersions().length>initial,'Initial Master generation');
    sent=requests.filter(r=>r.path==='/api/ai/master').at(-1);assert(sent.body.quality==='high','Initial Master quality is not fixed High');
    checks.push('Initial Master: High quality, async completion');
    // Leave an irregular mask visible for layout and screenshot inspection.
    core.selectTool('lasso');state.lasso=polygon.map(p=>({...p}));core.updateMaskWithLasso();core.hideQuickPrompt();
    $('advancedSettings').open=true;core.updateZoomFit();
    const viewport=$('viewport'),wrap=$('canvasWrap'),style=getComputedStyle(viewport),availableW=viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),availableH=viewport.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    assert(Math.abs(wrap.clientWidth-availableW)<=1||Math.abs(wrap.clientHeight-availableH)<=1,'Fit leaves unnecessary canvas gaps');
    assert(wrap.clientWidth<=availableW+1&&wrap.clientHeight<=availableH+1,'Fit overflows viewport');
    checks.push(`Fit: ${wrap.clientWidth}x${wrap.clientHeight} within ${availableW}x${availableH}`);
    return {passed:checks.length,checks,requests:requests.filter(r=>['/api/ai/edit','/api/ai/harmonize','/api/ai/master'].includes(r.path)).map(r=>({path:r.path,quality:r.body.quality,base:Boolean(r.body.base),guide:'guide' in r.body}))};
  }finally{window.fetch=nativeFetch}
};
