window.runGeneratedObjectMapChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,$=id=>document.getElementById(id),native=window.fetch,checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<1000;i++){if(predicate())return;await pause(20)}throw Error('Timed out: '+label)};
  let masters=0,maps=0,sam=0,releaseMaster,releaseMap,mapInput;
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/master'){masters++;const answer=await native(path,options);await new Promise(resolve=>{releaseMaster=resolve});return answer}
    if(path==='/api/ai/object-map'){maps++;mapInput=JSON.parse(options.body).image;const answer=await native(path,options);await new Promise(resolve=>{releaseMap=resolve});return answer}
    if(path==='/api/ai/sam3')sam++;
    return native(path,options);
  };
  try{
    await window.MosaicAccount.ready();if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');
    $('apiKeyInput').value='sk-generated-map-browser-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'key');
    const base=makeCanvas(800,500),x=base.getContext('2d');x.fillStyle='#224488';x.fillRect(0,0,800,500);
    const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'blue-base.png',{type:'image/png'}))));
    const transfer=new DataTransfer();transfer.items.add(file);$('referenceInput').files=transfer.files;$('referenceInput').dispatchEvent(new Event('change'));
    await wait(()=>state.reference,'Base upload');assert(maps===0,'Base upload prepared objects too early');
    $('welcomeBasePromptInput').value='Create the initial Master';$('welcomeBasePromptForm').requestSubmit();await wait(()=>releaseMaster,'pending Master');
    assert(state.masterIsBase&&maps===0,'Provisional Base during Master generation caused a paid map request');
    releaseMaster();await wait(()=>releaseMap,'generated-image map');
    assert(!state.masterIsBase&&masters===1&&maps===1,'Generated Master did not start exactly one map request');
    const image=new Image();image.src=mapInput;await image.decode();const probe=makeCanvas(1,1);probe.getContext('2d').drawImage(image,0,0,1,1);const pixel=probe.getContext('2d').getImageData(0,0,1,1).data;
    assert(pixel[0]>200&&pixel[2]<20,'Map input used the blue Base instead of the generated red Master');
    assert(image.width*image.height>=1048576&&image.width%16===0&&image.height%16===0,'Generated-image map violates the size budget');
    checks.push('Initial Master generation waits for its result, then maps the generated image once at a valid resolution');
    core.selectTool('wand');window.MosaicSlimWand.selectAt({x:state.master.width*.2,y:state.master.height*.3});
    releaseMap();await wait(()=>Boolean(state.objectMapSelection),'queued Wand click');
    assert(state.patches.size===0&&!$('selectedObjectOverlay').hidden&&sam===0&&state.tool==='wand','Queued Wand click created options, exited Wand, hid the overlay, or called SAM');
    checks.push('A Wand click while mapping runs is applied when ready, with a thin purple overlay and no premature Groups');
    return {passed:checks.length,checks,masters,maps,sam,mapSize:{width:image.width,height:image.height}};
  }finally{window.fetch=native}
};
