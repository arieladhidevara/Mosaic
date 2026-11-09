// Uses an isolated auto-login browser and mock image responses, never paid API calls.
const interactionPause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const interactionWait=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await interactionPause(20)}throw Error('Interaction scenario timed out')};
const interactionAssert=(value,message)=>{if(!value)throw Error(message)};
function interactionFrame(core,color){const c=core.makeCanvas(800,600);c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,800,600);return c}
function interactionPatch(core,group,box,color,name){
  const mask=core.makeCanvas(800,600);mask.getContext('2d').fillStyle='#fff';mask.getContext('2d').fillRect(box.x,box.y,box.w,box.h);
  const sourceId=core.uid('fixture_source'),patch={id:core.uid('fixture_patch'),sourceId,mask,bbox:box,name};
  core.state.sources.set(sourceId,{id:sourceId,canvas:interactionFrame(core,color)});core.state.patches.set(patch.id,patch);
  const target=core.assignGroup(patch,group?.id);target.active=patch.id;return {group:target,patch};
}
function interactionSelect(core,box){
  core.resetSelection();core.selectTool('rect');core.state.lasso=[{x:box.x,y:box.y},{x:box.x+box.w,y:box.y},{x:box.x+box.w,y:box.y+box.h},{x:box.x,y:box.y+box.h}];core.updateMaskWithLasso();core.hideQuickPrompt();
}
window.runGroupPromptCompareChecks=async function(){
  const core=window.MosaicCore,{state}=core,$=id=>document.getElementById(id),checks=[];
  await window.MosaicAccount.ready();$('apiKeyDialog').close();
  core.setMaster(interactionFrame(core,'#0000ff'),'Interaction fixture');state.reference=interactionFrame(core,'#00ff00');
  const first=interactionPatch(core,null,{x:80,y:90,w:180,h:220},'#ff0000','Red door');
  const alternate=interactionPatch(core,first.group,{x:80,y:90,w:180,h:220},'#ff9900','Orange door');
  const second=interactionPatch(core,null,{x:450,y:120,w:180,h:220},'#00ffff','Cyan window');
  core.renderGroups();core.render();
  document.querySelector('.region-group[data-group="'+first.group.id+'"] .group-head').click();
  interactionAssert(state.selectionOverlayHidden&&$('quickAreaPromptForm').classList.contains('hidden'),'Sidebar selection must remain quiet');
  interactionAssert([...$('selectionOutlineVectors').querySelectorAll('path')].every(p=>getComputedStyle(p).opacity==='0.2'),'Sidebar outline is not at 20%');
  const order=state.groups.map(group=>group.id).join('|'),rect=core.overlay.getBoundingClientRect();
  const point={clientX:rect.left+530/800*rect.width,clientY:rect.top+220/600*rect.height};
  const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
  try{for(const type of ['pointerdown','pointerup'])core.overlay.dispatchEvent(new PointerEvent(type,{...point,bubbles:true,pointerType:'mouse',pointerId:71,button:0}))}finally{Element.prototype.setPointerCapture=capture;Element.prototype.releasePointerCapture=release}
  interactionAssert($('groupList').firstElementChild.dataset.group===second.group.id,'Canvas selection did not bring its Group to the top');
  interactionAssert(state.groups.map(group=>group.id).join('|')===order,'Sidebar focus changed canvas layer order');
  interactionAssert([...$('selectionOutlineVectors').querySelectorAll('path')].every(p=>p.getAttribute('stroke')==='#fff'&&getComputedStyle(p).opacity==='0.8'),'Active outline is not white/transparent at 80%');
  checks.push('Sidebar outline stays at 20%; canvas clicks focus the correct Group at the top without changing composition order');
  core.selectGroupMask(first.group,{showOutline:true});core.showQuickPrompt();$('quickAreaPromptInput').value='Keep my prompt text';
  const rail=$('quickGroupOptions');interactionAssert(!rail.hidden&&rail.querySelectorAll('button').length===3,'Attached option list is missing');
  rail.querySelector('[data-option="'+first.patch.id+'"]').click();
  interactionAssert(first.group.active===first.patch.id&&$('quickAreaPromptInput').value==='Keep my prompt text','Switching options lost the prompt or selected the wrong image');
  interactionAssert(document.querySelector('.region-group[data-group="'+first.group.id+'"] .variant-row[data-patch]').dataset.patch===first.patch.id,'Active option did not move to the top within its Group');
  interactionAssert(!$('quickAreaPromptForm').classList.contains('hidden'),'Option switch closed the prompt');
  const formBefore=$('quickAreaPromptForm').getBoundingClientRect(),railBefore=rail.getBoundingClientRect(),view=$('viewport').getBoundingClientRect();
  const key=formBefore.right+8<view.right?'ArrowRight':'ArrowLeft';
  $('quickAreaDragHandle').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
  const formAfter=$('quickAreaPromptForm').getBoundingClientRect(),railAfter=rail.getBoundingClientRect();
  interactionAssert(Math.abs((railAfter.left-railBefore.left)-(formAfter.left-formBefore.left))<.5,'Options detached while moving the prompt');
  interactionAssert(formAfter.left>=view.left-1&&formAfter.right<=Math.min(innerWidth,view.right)+1,'Prompt/options overflow the viewport');
  checks.push('Compact vertical option buttons stay attached to the movable prompt and preserve entered text');
  const savedMask=state.selectionMask.toDataURL();$('beforeBtn').click();
  interactionAssert(state.before&&!$('compareView').hidden,'Compare did not open a slider');
  const base=$('compareView').querySelector('canvas').getContext('2d').getImageData(530,220,1,1).data;
  const latest=core.ctx.getImageData(530,220,1,1).data;
  interactionAssert(base[1]===255&&base[2]===0&&latest[1]===255&&latest[2]===255,'Compare is not showing original Base versus latest composition');
  $('compareSlider').value='25';$('compareSlider').dispatchEvent(new Event('input',{bubbles:true}));
  interactionAssert($('compareView').style.getPropertyValue('--compare-position')==='25%','Compare divider did not move');
  interactionAssert($('compareView').querySelector('.compare-base-clip').style.clipPath.includes('75%'),'Base image clip does not follow the divider');
  $('compareSlider').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  interactionAssert(!state.before&&$('compareView').hidden&&state.selectionMask.toDataURL()===savedMask,'Closing Compare changed the selection');
  checks.push('Base/latest comparison opens on click, slides, and closes with Escape without changing the image or mask');
  core.showQuickPrompt(state.lastCanvasPointer,true);
  return {passed:checks.length,checks};
};
window.runParallelGenerationChecks=async function(){
  const core=window.MosaicCore,ai=window.MosaicPremium,{state}=core,$=id=>document.getElementById(id),checks=[],requests=[];
  await window.MosaicAccount.ready();$('apiKeyDialog').close();
  const original={ensure:window.MosaicAuth.ensure,request:window.MosaicAuth.request,isReady:window.MosaicAuth.isReady};
  window.MosaicAuth.ensure=async()=>true;window.MosaicAuth.isReady=()=>false;
  window.MosaicAuth.request=async(path,payload)=>path==='/api/ai/edit'?new Promise((resolve,reject)=>requests.push({payload,resolve,reject})):{};
  const answer=color=>({image:interactionFrame(core,color).toDataURL('image/png').split(',')[1]});
  const finished=()=>[...state.patches.values()].every(patch=>!patch.generating);
  const boxes=[{x:80,y:80,w:110,h:110},{x:400,y:80,w:110,h:110},{x:80,y:350,w:110,h:110},{x:400,y:350,w:110,h:110}];
  try{
    core.setMaster(interactionFrame(core,'#222222'),'Parallel edits');
    for(let i=0;i<4;i++){interactionSelect(core,boxes[i]);await ai.generateSelection('Area '+i)}
    await interactionWait(()=>requests.length===3);await interactionPause(80);
    interactionAssert(requests.length===3,'Concurrency must be bounded at three requests');
    const glow=document.querySelector('.mask-processing-shimmer'),uri=glow.style.maskImage.match(/url\("([^"]+)"\)/)?.[1];
    const glowImage=await createImageBitmap(await(await fetch(uri)).blob()),glowFrame=core.makeCanvas(800,600);glowFrame.getContext('2d').drawImage(glowImage,0,0);
    const glowAlpha=(x,y)=>glowFrame.getContext('2d').getImageData(x,y,1,1).data[3];
    interactionAssert(glowAlpha(120,120)>0&&glowAlpha(440,120)>0&&glowAlpha(120,390)>0&&!glowAlpha(440,390),'Active request masks were not combined in the loading animation');glowImage.close();
    requests[1].resolve(answer('#00ff00'));await interactionWait(()=>requests.length===4);
    requests[3].resolve(answer('#ffff00'));requests[2].resolve(answer('#0000ff'));requests[0].resolve(answer('#ff0000'));await interactionWait(finished);
    const result=core.composeApprovedCanvas().getContext('2d'),colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
    boxes.forEach((box,index)=>{const pixel=result.getImageData(box.x+50,box.y+50,1,1).data;interactionAssert(colors[index].every((value,c)=>Math.abs(pixel[c]-value)<3),'Out-of-order result landed in the wrong mask')});
    checks.push('Three masks generate in parallel, a fourth starts when any slot frees, and each result stays in its own region');
    core.setMaster(interactionFrame(core,'#222222'),'Concurrent options');
    const existing=interactionPatch(core,null,boxes[0],'#777777','Existing option');core.renderGroups();core.render();
    core.selectGroupMask(existing.group,{showOutline:true});await ai.generateSelection('Older result',existing.group.id);
    core.selectGroupMask(existing.group,{showOutline:true});await ai.generateSelection('Newer result',existing.group.id);
    await interactionWait(()=>requests.length===6);
    requests[5].resolve(answer('#00ff00'));await interactionWait(()=>[...state.patches.values()].some(p=>p.prompt==='Newer result'&&!p.generating));
    const newer=[...state.patches.values()].find(p=>p.prompt==='Newer result');
    requests[4].resolve(answer('#ff0000'));await interactionWait(finished);
    interactionAssert(existing.group.active===newer.id,'A late older response replaced the newer option');
    core.selectGroupMask(existing.group,{showOutline:true});await ai.generateSelection('Background result',existing.group.id);await interactionWait(()=>requests.length===7);
    core.chooseGroupOption(existing.group,existing.patch.id,{showOutline:true});requests[6].resolve(answer('#0000ff'));await interactionWait(finished);
    interactionAssert(existing.group.active===existing.patch.id,'Background result overrode a manual option choice');
    checks.push('Out-of-order results within one Group preserve the newest generated option and respect manual choices made while generating');
    core.setMaster(interactionFrame(core,'#222222'),'Project before replacement');const start=requests.length;
    for(let i=0;i<4;i++){interactionSelect(core,boxes[i]);await ai.generateSelection('Obsolete '+i)}
    await interactionWait(()=>requests.length===start+3);core.setMaster(interactionFrame(core,'#ffffff'),'Replacement project');
    for(const request of requests.slice(start))request.resolve(answer('#ff0000'));
    await interactionPause(250);
    interactionAssert(requests.length===start+3&&state.patches.size===0,'Queued edit was sent or applied after its project was replaced');
    checks.push('Queued requests are skipped when their project is replaced; old responses do not modify the new project');
    return {passed:checks.length,checks};
  }finally{Object.assign(window.MosaicAuth,original)}
};
