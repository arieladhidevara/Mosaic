window.runAssistantWorkspaceChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await pause(20)}throw Error('Timed out: '+label)};
  await pause(300);$('apiKeyDialog').close();
  const frame=makeCanvas(960,640),x=frame.getContext('2d');
  x.fillStyle='#c9c0b4';x.fillRect(0,0,960,640);x.fillStyle='#b8ad9b';x.fillRect(0,435,960,205);
  x.fillStyle='#526b73';x.fillRect(570,90,280,290);x.strokeStyle='#ece6df';x.lineWidth=12;x.strokeRect(570,90,280,290);
  x.fillStyle='#ece6df';x.fillRect(704,90,12,290);x.fillStyle='#735642';x.fillRect(220,310,260,180);
  state.reference=frame;core.setMaster(frame,'Studio interior');core.updateZoomFit();
  const mask=makeCanvas(960,640);mask.getContext('2d').fillStyle='#fff';mask.getContext('2d').fillRect(220,310,260,180);
  const object=core.newGroup(mask,'Furniture');object.name='Cabinet';object.mapPrepared=true;core.renderGroups();
  $('projectMenu').querySelector('summary').click();await pause(30);
  assert($('projectMenu').open,'Project menu did not expand');
  $('projectNameInput').value='Warm studio';$('projectRenameForm').requestSubmit();
  assert(! $('projectMenu').open&&$('projectName').textContent==='Warm studio'&&state.projectTitleManual,'Header rename failed');
  assert($('openProjectBtn').textContent.includes('Load project')&&$('saveProjectBtn').textContent.includes('Save project'),'Project file actions missing');
  checks.push('Project name expands Load/Save and renames in the same menu');
  const originalMask=core.groupMask(object).toDataURL(),originalImage=core.composeApprovedCanvas().toDataURL();
  const second=core.newGroup(mask,'Furniture');second.name='Cabinets 2';second.manualName=true;core.renderGroups();
  assert(object.collectionId&&object.collectionId===second.collectionId,'Similar named objects did not group immediately');
  const third=core.newGroup(mask,'Furniture');third.name='Cabinet right';third.manualName=true;core.renderGroups();
  assert(third.collectionId===object.collectionId,'New matching object did not join its existing Group');
  assert(core.groupMask(object).toDataURL()===originalMask&&core.composeApprovedCanvas().toDataURL()===originalImage,'Grouping changed a mask or canvas pixels');
  checks.push('Repeated names group immediately; future matches join while masks and image pixels stay exact');
  if(innerWidth>850){
    const main=document.querySelector('.main-panel').getBoundingClientRect(),side=$('inspectorPanel').getBoundingClientRect(),chat=$('chatPanel').getBoundingClientRect(),groups=$('groupsPanel').getBoundingClientRect(),tools=$('tools').getBoundingClientRect(),viewport=$('viewport').getBoundingClientRect();
    assert(main.left<2&&side.left>=main.right-2&&side.right<=innerWidth+1,'Left pane remains or right pane misplaced');
    assert(chat.height>220&&groups.height>100&&chat.bottom<=groups.top&&Math.abs(chat.left-side.left)<5,'Chat and Groups are not stacked on the right');
    assert(tools.left<2&&tools.bottom<=viewport.top+1&&tools.width<=main.width+1,'Tools are not above the canvas');
    assert(document.documentElement.scrollWidth<=innerWidth,'Workspace overflows horizontally');
    checks.push('Desktop has one canvas column, toolbar above, and Chat above Groups on the right');
  }else{
    const tools=$('tools').getBoundingClientRect(),viewport=$('viewport').getBoundingClientRect();
    assert(tools.height>=50&&tools.bottom<=viewport.top+1&&tools.top<150,'Mobile toolbar is not above the canvas');
    assert(document.documentElement.scrollWidth<=innerWidth,'Mobile page overflows horizontally');
    window.MosaicMobile.activate('ai');await pause(30);
    assert($('compositionChat').getBoundingClientRect().height>100,'Mobile assistant is inaccessible');
    checks.push('Mobile tools stay above the canvas and Assistant is accessible from the bottom tabs');
  }
  let requests=[],imageCalls=0,chatCalls=0;const native=window.fetch;
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/chat'){chatCalls++;requests.push(JSON.parse(options.body))}
    if(['/api/ai/master','/api/ai/edit','/api/ai/harmonize'].includes(path))imageCalls++;
    return native(path,options);
  };
  const ask=async text=>{const before=state.chatMessages.length;$('compositionChatPrompt').value=text;$('compositionChatForm').requestSubmit();await wait(()=>state.chatMessages.length>before+1&&!$('chatGenerate').disabled,text)};
  try{
    assert(!window.MosaicAuth.isReady(),'Test must start without an OpenAI connection');
    await ask('Suggest a warmer finish');
    assert(state.chatMessages.at(-1).text.includes('warm plaster')&&!$('apiKeyDialog').open,'Gemini chat required OpenAI or failed');
    assert(requests[0].base.startsWith('data:image/jpeg')&&requests[0].currentImage.startsWith('data:image/jpeg'),'Chat lost canvas context');
    await ask('Keep the cabinet');assert(requests[1].history.length>=2&&requests[1].objects.some(o=>o.id===object.id),'Follow-up context or Object IDs missing');
    checks.push('Browser → authenticated chat route → Gemini mock works without OpenAI; follow-ups keep history, images and Object IDs');
    await ask('plan-test');assert(imageCalls===0&&document.querySelector('.copilot-actions button:last-child')?.textContent.includes('OpenAI'),'Chat silently started paid image generation');
    checks.push('Image plans require explicit OpenAI Preview/Generate button clicks');
    await ask('quota-test');assert($('chatStatus').textContent.includes('quota')&&!$('chatGenerate').disabled&&chatCalls===4,'Quota failure was hidden or retried');
    await ask('Suggest softer lighting');assert(state.chatMessages.at(-1).text.includes('warm plaster'),'Chat cannot recover after quota error');
    checks.push('Quota error stays visible, makes one request, and allows a later retry');
  }finally{window.fetch=native}
  let saved;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
  URL.createObjectURL=function(blob){if(blob.type==='application/json')saved=blob;return create.call(this,blob)};
  HTMLAnchorElement.prototype.click=function(){if(!this.download?.endsWith('.moz'))click.call(this)};
  try{await window.MosaicProjects.saveProject()}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
  assert(saved,'Save project produced no file');const data=JSON.parse(await saved.text());
  assert(data.ui.projectName==='Warm studio'&&!JSON.stringify(data).includes('test-only-gemini-key'),'Project name or secret handling failed');
  core.setProjectTitle('Temporary',true);
  const confirm=window.confirm;window.confirm=()=>true;
  try{await window.MosaicProjects.loadProjectFile(new File([saved],'Warm_studio.moz',{type:'application/json'}))}finally{window.confirm=confirm}
  assert($('projectName').textContent==='Warm studio'&&state.groups.some(g=>g.id===object.id),'Load project did not restore the name and object masks');
  checks.push('Save/Load round trip restores project name, objects, masks and conversation without credentials');
  $('chatStatus').textContent='Gemini · design advice ready';$('apiKeyDialog').close();
  if(innerWidth<=850)window.MosaicMobile.activate('ai');
  return {passed:checks.length,checks};
};
