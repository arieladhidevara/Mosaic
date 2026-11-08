/* Run in a fresh browser tab with tests/mock-openai.cjs; no real AI calls. */
window.runHoverGroupChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state,canvas,overlay,makeCanvas}=core;
  const $=id=>document.getElementById(id),checks=[],requests=[],nativeFetch=window.fetch;
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const wait=async(predicate)=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Hover/group check timed out')};
  const frame=()=>{const c=makeCanvas(800,500),x=c.getContext('2d');x.fillStyle='#26384d';x.fillRect(0,0,800,500);return c};
  const draw=(x=100,y=100,w=300,h=200)=>{
    core.setMode('new');core.selectTool('lasso');state.lasso=[{x,y},{x:x+w,y:y+20},{x:x+w-30,y:y+h},{x,y:y+h}];
    core.updateMaskWithLasso();core.hideQuickPrompt();
  };
  const hover=(x,y)=>{const r=overlay.getBoundingClientRect();overlay.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height}))};
  const rectMask=(x,y,w,h,alpha=1)=>{const m=makeCanvas(canvas.width,canvas.height),c=m.getContext('2d');c.globalAlpha=alpha;c.fillStyle='#fff';c.fillRect(x,y,w,h);return m};
  const save=(mask)=>{
    const id=core.uid('fixture_source');state.sources.set(id,{id,name:'Group fixture',canvas:frame()});
    const patch={id:core.uid('fixture_patch'),sourceId:id,mask,bbox:core.exactMaskBoundingBox(mask),name:'Fixture option'};
    return {patch,group:core.assignGroup(patch)};
  };
  window.fetch=async(url,options)=>{if(String(url).startsWith('/api/ai/'))requests.push(String(url));return nativeFetch(url,options)};
  try{
    core.setMaster(frame(),'Hover validation');core.createBlankRegion();
    assert(state.groups.length===0&&state.tool==='lasso','+ created an empty Group');
    draw();assert(!state.groups.length&&!state.draftGroupId&&!requests.length,'Closing a draft created a Group or called AI');
    hover(200,200);
    assert(!$('groupHoverHint').classList.contains('hidden')&&$('groupHoverHint').textContent==='Selection (unsaved)','Select hover did not name the unsaved selection');
    assert($('regionHoverVectors').querySelector('path[fill="#b19aff30"]'),'Select hover did not highlight the area');
    hover(700,400);assert($('groupHoverHint').classList.contains('hidden')&&!$('regionHoverVectors').childElementCount,'Hover survived leaving the mask');
    const paths=[...$('selectionOutlineVectors').querySelectorAll('path')],outline=paths.at(-1).getAttribute('d'),points=JSON.stringify(state.selectionPaths),mask=state.selectionMask.toDataURL();
    assert(paths.length===2&&outline.includes('M100 100 L400 120'),'Line outline lost exact clicked vector coordinates');
    const r=overlay.getBoundingClientRect();overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-700,clientX:r.left+200,clientY:r.top+150}));
    assert(state.zoom>2,'Zoom fixture did not zoom far enough');
    for(const path of $('selectionOutlineVectors').querySelectorAll('path'))assert(path.getAttribute('vector-effect')==='non-scaling-stroke'&&path.getAttribute('d')===outline,'Zoom rasterized or changed the outline');
    const dot=$('selectionOutlineVectors').querySelector('circle');assert(Math.abs(Number(dot.getAttribute('r'))*state.zoom-2.5)<1e-6,'Vertex size changed on screen with zoom');
    assert(JSON.stringify(state.selectionPaths)===points&&state.selectionMask.toDataURL()===mask,'Zoom changed the actual mask');
    $('zoomValue').click();core.resetSelection();assert(!$('selectionOutlineVectors').childElementCount,'Deselection left vector outlines visible');
    checks.push('Unsaved draft hover shows area and name without AI calls; SVG outline retains exact points and constant stroke/handle sizes at high zoom');

    for(const alpha of [1,.25]){
      core.setMaster(frame(),'Native mask overlap');
      const original=save(rectMask(100,100,100,100,alpha));
      draw(600,300,100,100);assert(state.groups.length===1,'An unrelated draft created a Group');
      const exact85=save(rectMask(115,100,100,100,alpha));
      assert(exact85.group===original.group&&original.group.patchIds.length===2,'Exactly 85% overlap did not create another option');
      const below85=save(rectMask(131,100,100,100,alpha));
      assert(below85.group!==original.group&&state.groups.length===2,'84% overlap was grouped');
      const small=save(rectMask(140,120,20,20,alpha));
      assert(small.group!==original.group&&small.group!==below85.group,'A small contained mask bypassed two-way overlap');
    }
    core.setMaster(frame(),'Actual mask overlap');
    const a=rectMask(100,100,100,100),b=rectMask(100,100,100,100);
    a.getContext('2d').clearRect(110,110,80,80);
    const ring=save(a),filled=save(b);assert(ring.group!==filled.group,'Matching bounding boxes hid different actual mask areas');
    checks.push('Native mask comparison: exactly 85% shares options, 84% separates, containment requires two-way overlap, low-opacity masks and holes are respected');

    core.setMaster(frame(),'Generated options');draw();
    $('apiKeyStatusBtn').click();$('apiKeyInput').value='sk-mozai-group-validation';$('apiKeyForm').requestSubmit();
    await ai.generateSelection('Make this wall red');await wait(()=>[...state.patches.values()].every(p=>!p.generating&&!p.awaitingResult));
    assert(state.groups.length===1&&state.groups[0].patchIds.length===1,'First generation did not create one Group and option');
    const group=state.groups[0];group.name='Living room wall';group.manualName=true;core.renderGroups();
    assert(state.selectionTargetPatchId===group.active&&state.draftGroupId===group.id,'Generated image did not attach to its unchanged live selection');
    core.resetSelection();core.selectTool('select');hover(200,200);
    assert($('groupHoverHint').textContent===group.name&&$('regionHoverVectors').querySelector('path'),'Saved selection hover omitted its name or area');
    core.selectTool('pan');assert($('groupHoverHint').classList.contains('hidden'),'Switching tools left a hover hint');
    draw();assert(state.groups.length===1,'Reselecting a region created an empty Group');
    await ai.generateSelection('Make this wall walnut');await wait(()=>[...state.patches.values()].every(p=>!p.generating&&!p.awaitingResult));
    assert(state.groups.length===1&&group.patchIds.length===2,'Repeated generation did not become an option in the existing Group');
    $('regionGuidesBtn').click();
    for(const path of $('regionGuideVectors').querySelectorAll('path'))assert(path.getAttribute('vector-effect')==='non-scaling-stroke','Region guide still uses a raster outline');
    assert($('regionGuideVectors').querySelector('path'),'Region guide outline missing');
    draw(550,300,150,130);assert(state.groups.length===1&&!state.draftGroupId,'Unsubmitted unrelated selection created or reused a Group');
    core.resetSelection();assert(state.groups.length===1&&group.patchIds.length===2,'Discarding an unsaved selection changed saved options');
    assert(!requests.includes('/api/ai/classify'),'Drawing a selection triggered an automatic classifier request');
    checks.push('Real UI/API flow with mocked provider: only Generate creates a Group; repeat masks create options; saved hover uses the Group name; guides are vector; discarded drafts leave options intact');
    return {passed:checks.length,checks};
  }finally{window.fetch=nativeFetch}
};
