// Inject bad provider frames into the real regional crop/compositing flow.
window.runRegionResultChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,map=window.MosaicObjectMap,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await pause(20)}throw Error('Timed out: '+label)};
  const native=window.fetch;let kind='normal',calls=0,contextCalls=0,contextMode='normal',releaseContext=null;const payloads=[];
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/edit-context'){
      contextCalls++;
      if(contextMode==='held')return new Promise(resolve=>releaseContext=()=>resolve(Response.json({targetObject:'late object',confidence:.95})));
      if(contextMode==='offline')return Response.json({error:'Context offline'},{status:502});
      if(contextMode==='uncertain')return Response.json({targetObject:'invented object',confidence:.3});
    }
    const response=await native(path,options);if(path!=='/api/ai/edit')return response;
    calls++;payloads.push(JSON.parse(options.body));const data=await response.json(),frame=makeCanvas(256,256),x=frame.getContext('2d');
    if(kind==='normal'){x.fillStyle='#ff2211';x.fillRect(0,0,256,256)}
    if(kind==='black'){x.fillStyle='#000';x.fillRect(0,0,256,256)}
    if(kind==='black-object'){x.fillStyle='#ccddee';x.fillRect(0,0,256,256);x.fillStyle='#000';x.fillRect(40,40,176,176)}
    if(kind==='empty-object'){x.fillStyle='#ccddee';x.fillRect(0,0,256,256);x.clearRect(40,40,176,176)}
    if(kind==='compound-bad'){const c=payloads.at(-1).crop;x.fillStyle='#cc8844';x.fillRect(0,0,256,256);x.fillStyle='#000';x.fillRect((498-c.x)/c.width*256,(118-c.y)/c.height*256,34/c.width*256,34/c.height*256)}
    data.image=frame.toDataURL('image/png').split(',')[1];return Response.json(data,{status:response.status});
  };
  try{
    await window.MosaicAccount.ready();if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');$('apiKeyInput').value='sk-region-result-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'key');
    const base=makeCanvas(800,500),x=base.getContext('2d');x.fillStyle='#224488';x.fillRect(0,0,800,500);state.reference=base;core.setMaster(base,'Regional result checks',false);
    const mask=makeCanvas(800,500),mx=mask.getContext('2d');mx.fillStyle='#fff';mx.fillRect(100,100,200,140);
    const object=core.newGroup(mask,'Furniture');object.name='Test table';object.mapPrepared=true;
    const render=()=>core.composeApprovedCanvas().toDataURL();
    const generate=async(label)=>{map.selectObject(object);const count=calls;await window.MosaicPremium.generateSelection(label);await wait(()=>calls===count+1&&[...state.patches.values()].every(p=>!p.generating)&&state.groups.every(g=>!g.objectMapBatch),'settled '+label)};
    await generate('ubah jadi kayu');assert(object.patchIds.length===1,'Normal API result failed to composite');
    assert(payloads[0].prompt==='ubah jadi kayu'&&payloads[0].targetObject==='the selected table'&&contextCalls===1,'AI context did not reach generation or rewrote the original prompt');
    checks.push('Vague prompt gains a grounded object target through the real API while preserving the original user text');
    for(const mode of ['offline','uncertain']){
      contextMode=mode;await generate('make it red');
      assert(payloads.at(-1).prompt==='make it red'&&payloads.at(-1).targetObject!=='invented object','Fallback lost the user prompt or trusted uncertain context');
    }
    contextMode='normal';const approved=render(),options=object.patchIds.length;
    checks.push('Unavailable or uncertain context still generates with the original prompt and selected mask');
    for(const invalid of ['black','transparent']){
      kind=invalid;await generate('Test '+invalid+' provider frame');
      assert(render()===approved&&object.patchIds.length===options,'Invalid '+invalid+' frame replaced the approved image or created an option');
      assert(state.lastGenerationIssue?.stage==='provider-output'&&state.lastGenerationIssue.code==='EMPTY_GENERATED_IMAGE'&&state.lastGenerationIssue.stats.reason===invalid,'Invalid frame was not diagnosed at the provider boundary');
    }
    checks.push('Fully black and transparent API frames are rejected before compositing; approved pixels/options remain intact');
    for(const invalid of ['black-object','empty-object']){
      kind=invalid;await generate('make it wood');
      assert(render()===approved&&object.patchIds.length===options,'Partial bad object replaced the approved image');
      assert(state.lastGenerationIssue?.stage==='provider-region'&&state.lastGenerationIssue.code==='INVALID_GENERATED_REGION','Partial bad object was not diagnosed before mask alignment');
    }
    checks.push('Black or transparent objects inside a valid crop are rejected before alignment or saving');
    const previous=state.patches.get(object.active),sourceId=previous.sourceId;
    kind='black-object';const count=calls;await window.MosaicPremium.regenerateOption(previous.id);
    await wait(()=>calls===count+1&&!previous.generating,'rejected regeneration');
    assert(previous.sourceId===sourceId&&render()===approved&&object.patchIds.length===options,'Failed regeneration replaced a saved source');
    checks.push('Failed regeneration preserves the previous option and source pixels');
    kind='black-object';await generate('Make the table black in its existing scene');assert(object.patchIds.length===options+1,'An intentionally black object with visible scene context was rejected');
    checks.push('A legitimate black object inside a visible crop remains allowed');
    const secondMask=makeCanvas(800,500);secondMask.getContext('2d').fillRect(500,120,30,30);
    const second=core.newGroup(secondMask,'Furniture');second.name='Small stool';second.mapPrepared=true;
    const firstMask=core.groupMask(object).toDataURL(),smallMask=core.groupMask(second).toDataURL();
    const composeBefore=render(),optionCount=object.patchIds.length,sourceCount=state.sources.size;
    const selectBoth=()=>{map.selectObject(object);map.selectObject(second,{append:true})};
    selectBoth();kind='compound-bad';let previousCalls=calls;
    await window.MosaicPremium.generateSelection('make both wood');
    await wait(()=>calls===previousCalls+1&&[...state.patches.values()].every(p=>!p.generating),'compound failure');
    assert(render()===composeBefore&&object.patchIds.length===optionCount&&second.patchIds.length===0&&state.sources.size===sourceCount&&!state.groups.some(g=>g.objectMapBatch),'A bad small object partially committed the compound result');
    const originalSplit=window.MosaicSceneVersions.splitCreatedOverlap;
    try{
      window.MosaicSceneVersions.splitCreatedOverlap=async(image,parts)=>parts;
      selectBoth();kind='normal';previousCalls=calls;await window.MosaicPremium.generateSelection('make both red');
      await wait(()=>calls===previousCalls+1&&!state.groups.some(g=>g.objectMapBatch)&&[...state.patches.values()].every(p=>!p.generating),'compound success');
      assert(object.patchIds.length===optionCount+1&&second.patchIds.length===1,'Valid compound result failed to save both options');
      assert(core.groupMask(object).toDataURL()===firstMask&&core.groupMask(second).toDataURL()===smallMask,'Compound result changed object masks');
    }finally{window.MosaicSceneVersions.splitCreatedOverlap=originalSplit}
    checks.push('A black small object rejects the entire batch; a valid batch commits both options with their original masks');
    contextMode='held';map.selectObject(second);const callsBeforeReset=calls;
    await window.MosaicPremium.generateSelection('make it wood');await wait(()=>releaseContext,'held context');
    core.setMaster(base,'New project during context',false);releaseContext();await pause(100);
    assert(calls===callsBeforeReset,'A stale context response started image generation for the replaced project');
    checks.push('A project change while identifying the object prevents a stale image generation request');
    return {passed:checks.length,checks,requests:calls,contextCalls};
  }finally{window.fetch=native}
};
