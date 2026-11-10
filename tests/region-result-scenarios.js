// Inject bad provider frames into the real regional crop/compositing flow.
window.runRegionResultChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,map=window.MosaicObjectMap,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await pause(20)}throw Error('Timed out: '+label)};
  const native=window.fetch;let kind='normal',calls=0;
  window.fetch=async(path,options)=>{
    const response=await native(path,options);if(path!=='/api/ai/edit')return response;
    calls++;const data=await response.json(),frame=makeCanvas(256,256),x=frame.getContext('2d');
    if(kind==='normal'){x.fillStyle='#ff2211';x.fillRect(0,0,256,256)}
    if(kind==='black'){x.fillStyle='#000';x.fillRect(0,0,256,256)}
    if(kind==='black-object'){x.fillStyle='#ccddee';x.fillRect(0,0,256,256);x.fillStyle='#000';x.fillRect(40,40,176,176)}
    data.image=frame.toDataURL('image/png').split(',')[1];return Response.json(data,{status:response.status});
  };
  try{
    await window.MosaicAccount.ready();if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');$('apiKeyInput').value='sk-region-result-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'key');
    const base=makeCanvas(800,500),x=base.getContext('2d');x.fillStyle='#224488';x.fillRect(0,0,800,500);state.reference=base;core.setMaster(base,'Regional result checks',false);
    const mask=makeCanvas(800,500),mx=mask.getContext('2d');mx.fillStyle='#fff';mx.fillRect(100,100,200,140);
    const object=core.newGroup(mask,'Furniture');object.name='Test table';object.mapPrepared=true;
    const render=()=>core.composeApprovedCanvas().toDataURL();
    const generate=async(label)=>{map.selectObject(object);const count=calls;await window.MosaicPremium.generateSelection(label);await wait(()=>calls===count+1&&state.groups.every(g=>!g.objectMapBatch),'settled '+label)};
    await generate('Normal red table');assert(object.patchIds.length===1,'Normal API result failed to composite');const approved=render(),options=object.patchIds.length;
    checks.push('A normal opaque result passes crop placement and masking without becoming black');
    for(const invalid of ['black','transparent']){
      kind=invalid;await generate('Test '+invalid+' provider frame');
      assert(render()===approved&&object.patchIds.length===options,'Invalid '+invalid+' frame replaced the approved image or created an option');
      assert(state.lastGenerationIssue?.stage==='provider-output'&&state.lastGenerationIssue.code==='EMPTY_GENERATED_IMAGE'&&state.lastGenerationIssue.stats.reason===invalid,'Invalid frame was not diagnosed at the provider boundary');
    }
    checks.push('Fully black and transparent API frames are rejected before compositing; approved pixels/options remain intact');
    kind='black-object';await generate('Make the table black in its existing scene');assert(object.patchIds.length===options+1,'An intentionally black object with visible scene context was rejected');
    checks.push('A legitimate black object inside a visible crop remains allowed');
    return {passed:checks.length,checks,requests:calls};
  }finally{window.fetch=native}
};
