window.runObjectMapFailureChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,map=window.MosaicObjectMap,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<400;i++){if(predicate())return;await pause(20)}throw Error('Timed out: '+label)};
  const {PALETTE}=await import('/object-map-utils.mjs');
  const saved={ready:window.MosaicAuth.isReady,restore:window.MosaicAuth.restore,request:window.MosaicAuth.request};
  let connected=false,calls=0,hold=true,release,fail=false;
  const frame=color=>{const c=makeCanvas(256,256),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,256,256);return c};
  const response=label=>{const c=makeCanvas(1024,1024),x=c.getContext('2d');x.fillStyle=PALETTE[0].color;x.fillRect(0,0,1024,1024);x.fillStyle=PALETTE[1].color;x.fillRect(200,200,480,560);return {image:c.toDataURL('image/png').split(',')[1],legend:[{id:1,category:'Wall',label:'wall'},{id:2,category:'Door',label}],labelsAvailable:true}};
  try{
    await window.MosaicAccount.ready();document.querySelector('[data-enter-guest]').click();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    window.MosaicAuth.isReady=()=>connected;window.MosaicAuth.restore=async()=>connected;
    window.MosaicAuth.request=async(path,body)=>{
      if(path!=='/api/ai/object-map')return saved.request(path,body);
      const call=++calls;if(fail)throw Object.assign(Error('Object-map quota reached.'),{status:429});
      if(hold&&call===1)await new Promise(resolve=>{release=resolve});return response(call===1?'old door':'new door');
    };
    state.reference=frame('#112244');core.setMaster(state.reference,'Unconnected working image');await wait(()=>$('objectMapStatus').textContent.includes('Connect AI'),'missing connection');
    assert(calls===0&&!$('apiKeyDialog').open,'Missing connection generated a map or reopened key onboarding');
    connected=true;window.dispatchEvent(new Event('mosaic:keyconnected'));await wait(()=>release,'queued map');map.imageReady(state.master);await pause(80);
    assert(calls===1,'Duplicate Base-ready events created duplicate paid requests');
    checks.push('Missing connection waits without another key dialog; connecting starts only one request despite duplicate Base events');

    core.setMaster(frame('#445511'),'Replacement Master');await wait(()=>state.objectMap?.entries.some(entry=>entry.label==='new door'),'replacement Master');
    hold=false;release();await pause(80);assert(state.objectMap.entries.some(entry=>entry.label==='new door')&&calls===2,'Late old map replaced the new Base map');
    checks.push('Replacing Base during mapping rejects the old response and preserves the new map');

    map.invalidateBase();assert(!state.objectMap&&$('objectMapRetry').hidden===false,'Base edit did not invalidate stale object masks');
    fail=true;$('objectMapRetry').click();await wait(()=>$('objectMapStatus').textContent.includes('quota'),'quota error');
    const failedCalls=calls;window.dispatchEvent(new Event('mosaic:keyconnected'));window.dispatchEvent(new CustomEvent('mosaic:account',{detail:{user:window.MosaicAccount.current()}}));await pause(100);
    assert(calls===failedCalls&&!state.objectMap&&!$('objectMapRetry').hidden,'Failed mapping retried automatically or hid Retry');
    fail=false;$('objectMapRetry').click();await wait(()=>Boolean(state.objectMap),'explicit retry');
    assert(calls===failedCalls+1&&state.patches.size===0&&state.objectCollections.length===0,'Explicit retry duplicated requests or created premature Groups');
    checks.push('Base edits invalidate the map; quota failures need explicit Retry and never create Groups');
    return {passed:checks.length,checks,requests:calls};
  }finally{window.MosaicAuth.isReady=saved.ready;window.MosaicAuth.restore=saved.restore;window.MosaicAuth.request=saved.request}
};
