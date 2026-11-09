// Isolated browser suite. SAM, vision, generation and repair responses below
// are deterministic fixtures; no credentials or paid provider calls are used.
window.runObjectAwareChecks=async function(){
  const core=window.MosaicCore,objects=window.MosaicObjects,ai=window.MosaicPremium,{state}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(fn())return;await pause(20)}throw Error('Timed out: '+label)};
  await window.MosaicAccount.ready();$('apiKeyDialog').close();
  // Keep the real account transport here: replacing request() hid a missing
  // endpoint allowlist entry in the first integration pass.
  const transportFetch=window.fetch;let transported=false;
  window.fetch=async(path,options)=>{if(path==='/api/ai/object-intent'){transported=options.method==='POST'&&JSON.parse(options.body).prompt==='door';return Response.json({kind:'object',label:'door',confidence:.95,geometry:'appearance',behind:[]})}return transportFetch(path,options)};
  try{await window.MosaicAccount.request('/api/ai/object-intent',{method:'POST',body:{prompt:'door'}});assert(transported,'Intent never passed through the real account transport')}finally{window.fetch=transportFetch}
  checks.push('Prompt intent passes through the real authenticated account transport');
  const saved={request:window.MosaicAccount.request,auth:window.MosaicAuth.request,ready:window.MosaicAuth.isReady,ensure:window.MosaicAuth.ensure,Worker:window.Worker};
  const stats={sam:0,intent:0,generation:0,repair:0},W=800,H=600;
  const frame=color=>{const c=core.makeCanvas(W,H),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,W,H);return c};
  const tableMask=(large=false)=>{const c=core.makeCanvas(W,H),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(large?210:280,large?150:200,large?380:240,large?270:190);return c};
  let large=false,delayIntent=null,delayRepair=0;
  const rugMask=()=>{const c=core.makeCanvas(W,H),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(100,100,600,420);x.globalCompositeOperation='destination-out';x.drawImage(tableMask(large),0,0);return c};
  const newMaster=()=>{const c=frame('#aaaaaa'),x=c.getContext('2d');x.fillStyle='#eeeeee';x.fillRect(100,100,600,420);x.fillStyle='#795138';x.fillRect(280,200,240,190);core.setMaster(c,'Object scene');};
  const pixel=(x,y)=>[...core.composeApprovedCanvas().getContext('2d').getImageData(x,y,1,1).data];
  window.MosaicAuth.isReady=()=>true;window.MosaicAuth.ensure=async()=>true;
  window.MosaicAccount.request=async(path,options)=>{
    if(path==='/api/ai/object-intent'){
      stats.intent++;const text=options.body.prompt;
      if(text.includes('wait'))await new Promise(r=>{delayIntent=r});
      const label=/rug|carpet/i.test(text)?'rug':'table';
      return {kind:text.includes('area')?'area':'object',label,confidence:.96,geometry:/style|larger/.test(text)?'change':'appearance',behind:label==='rug'?state.groups.filter(g=>g.objectLabel==='table').map(g=>g.id):[]};
    }
    if(path==='/api/ai/sam3'){
      stats.sam++;const b=options.body,c=core.makeCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b.label==='rug'?rugMask():tableMask(large),0,0,b.width,b.height);return {mask:c.toDataURL('image/png')};
    }
    return saved.request(path,options);
  };
  window.MosaicAuth.request=async(path,payload)=>{
    if(path==='/api/ai/edit'){
      stats.generation++;if(/style|larger/.test(payload.prompt))large=true;
      const c=frame(/rug|carpet/i.test(payload.prompt)?'#00aa44':'#9a6030');return {image:c.toDataURL('image/jpeg',1).split(',')[1]};
    }
    return {};
  };
  window.Worker=class{
    constructor(url,options){if(!String(url).includes('object-repair-worker'))return new saved.Worker(url,options)}
    postMessage(job){stats.repair++;const rgba=new Uint8ClampedArray(job.rgba);for(let i=0;i<job.missing.length;i++)if(job.missing[i])rgba.set([0,170,68,255],i*4);setTimeout(()=>this.onmessage?.({data:{id:job.id,rgba}}),delayRepair)}
    terminate(){}
  };
  const select=(tool='rect',box={x:180,y:110,w:440,h:350})=>{
    core.resetSelection();core.selectTool(tool);core.setMode('new');
    if(tool==='rect'||tool==='ellipse'){
      const capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=()=>{};
      try{const r=core.overlay.getBoundingClientRect();for(const [type,x,y] of [['pointerdown',box.x,box.y],['pointermove',box.x+box.w,box.y+box.h],['pointerup',box.x+box.w,box.y+box.h]])core.overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:77,pointerType:'mouse',clientX:r.left+x/W*r.width,clientY:r.top+y/H*r.height}))}finally{Element.prototype.setPointerCapture=capture}
    }else{state.lasso=[{x:box.x,y:box.y},{x:box.x+box.w,y:box.y},{x:box.x+box.w,y:box.y+box.h},{x:box.x,y:box.y+box.h}];state.dragFreehand=tool==='freehand';core.updateMaskWithLasso()}
    core.hideQuickPrompt();
  };
  const prompt=text=>{$('quickAreaPromptInput').value=text;$('quickAreaPromptInput').dispatchEvent(new Event('input',{bubbles:true}))};
  try{
    for(const tool of ['rect','ellipse','lasso','freehand']){
      newMaster();large=false;select(tool);const original=objects.maskKey(state.selectionMask),n=stats.generation;
      prompt('change this table to walnut');await wait(()=>objects.maskKey(state.selectionMask)===objects.maskKey(tableMask()),tool+' object preview');
      assert(objects.maskKey(state.selectionMask)!==original,'Original selection did not refine: '+tool);
      assert(stats.generation===n,'Preview generated an image');
      assert($('selectionOutlineVectors').querySelector('path[stroke="#b493f5"]'),'Purple object outline is missing');
      checks.push(tool+' retains original shape, then refines to purple object mask without generating');
    }
    const samAt=stats.sam;prompt('change this table to oak');await pause(1100);assert(stats.sam===samAt,'Identical target repeated SAM');checks.push('Material prompt changes reuse the cached mask');
    prompt('wait for this table');await wait(()=>delayIntent,'delayed intent');prompt('change this rug to green');await wait(()=>objects.maskKey(state.selectionMask)===objects.maskKey(rugMask()),'changed target');delayIntent();await pause(200);assert(objects.maskKey(state.selectionMask)===objects.maskKey(rugMask()),'Stale table intent replaced rug');
    prompt('brighten this area');await pause(1100);assert(objects.maskKey(state.selectionMask)!==objects.maskKey(rugMask()),'Arbitrary area did not restore original shape');checks.push('Target changes reject stale intent; arbitrary area restores the drawn region');
    newMaster();large=false;select();prompt('change this table to mid-century style');await wait(()=>objects.maskKey(state.selectionMask)===objects.maskKey(tableMask()),'table preview');
    await ai.generateSelection('change this table to mid-century style');await wait(()=>[...state.patches.values()].some(p=>p.objectLabel==='table'&&!p.generating),'table generated');
    const table=state.groups.find(g=>g.objectLabel==='table'),tableOption=state.patches.get(table.active);
    assert(tableOption&&objects.maskKey(tableOption.mask)===objects.maskKey(tableMask(true)),'Geometry mask was not updated');
    assert(tableOption.geometryId!==table.objectOriginal.geometryId,'Geometry is not independent from appearance');
    select('rect',{x:90,y:90,w:620,h:440});prompt('change this carpet to green');await wait(()=>objects.maskKey(state.selectionMask)===objects.maskKey(rugMask()),'rug preview');
    await ai.generateSelection('change this carpet to green');await wait(()=>[...state.patches.values()].some(p=>p.objectLabel==='rug'&&!p.generating),'rug generated');
    const rug=state.groups.find(g=>g.objectLabel==='rug'),rugOption=state.patches.get(rug.active),rugSource=rugOption.sourceId;
    assert(objects.orderedGroups().indexOf(rug)<objects.orderedGroups().indexOf(table),'Rug covered foreground furniture');
    core.chooseGroupOption(table,null);await objects.flushRepairs();
    assert(rug.active===rugOption.id&&rugOption.sourceId===rugSource,'Restoring table reverted rug option');
    const exposed=pixel(230,250),unchanged=pixel(140,140),original=pixel(350,280);
    assert(exposed[1]>130&&exposed[0]<30,'Exposed carpet was not repaired green: '+exposed);
    assert(unchanged[1]>130&&unchanged[0]<30,'Valid green carpet changed');assert(original[0]>80&&original[0]<180&&original[1]<120,'Original table did not return');
    assert(rugOption.objectRepairs.length>0,'Reusable repairs were not stored');checks.push('Table geometry changes; green rug remains independent; original table exposes repaired green carpet');
    const repairs=stats.repair;core.chooseGroupOption(table,tableOption.id);core.chooseGroupOption(table,null);await objects.flushRepairs();assert(stats.repair===repairs,'Cached exposure repeated repair');checks.push('Rapid option switching reuses repairs');
    // Real portable codec round-trip, including internal masks and repair crops.
    let blob;const createURL=URL.createObjectURL,click=HTMLAnchorElement.prototype.click,confirm=window.confirm;
    URL.createObjectURL=value=>{if(value.type==='application/json')blob=value;return createURL(value)};HTMLAnchorElement.prototype.click=function(){if(!this.download?.endsWith('.moz'))click.call(this)};window.confirm=()=>true;
    try{await window.MosaicProjects.saveProject();assert(blob,'Project was not saved');const text=await blob.text();assert(!text.includes('apiKey'),'Project contains credentials');await window.MosaicProjects.loadProjectFile(new File([text],'objects.moz'));const restored=state.groups.find(g=>g.objectLabel==='rug');assert(restored&&state.patches.get(restored.active).objectRepairs.length,'Object repairs did not round-trip');assert(pixel(230,250)[1]>130,'Restored composition lost repaired pixels')}finally{URL.createObjectURL=createURL;HTMLAnchorElement.prototype.click=click;window.confirm=confirm}
    checks.push('Existing project format round-trips object identities, geometry masks and incremental repairs');
    return {passed:checks.length,checks,stats};
  }finally{window.MosaicAccount.request=saved.request;window.MosaicAuth.request=saved.auth;window.MosaicAuth.isReady=saved.ready;window.MosaicAuth.ensure=saved.ensure;window.Worker=saved.Worker}
};

window.runLocalOpenCVRepairCheck=async function(){
  const worker=new Worker('./object-repair-worker.js'),w=64,h=64,rgba=new Uint8ClampedArray(w*h*4),missing=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)rgba.set([20,160,70,255],i*4);
  for(let y=27;y<35;y++)for(let x=27;x<35;x++){missing[y*w+x]=1;rgba.set([0,0,0,255],(y*w+x)*4)}
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Real OpenCV repair timeout')),90000);worker.onerror=e=>reject(Error(e.message));worker.onmessage=({data})=>{clearTimeout(timer);if(data.error)return reject(Error(data.error));for(let i=0;i<w*h;i++){if(!missing[i]&&rgba.slice(i*4,i*4+4).some((v,c)=>v!==data.rgba[i*4+c]))return reject(Error('Context pixels changed'));if(missing[i]&&Math.abs(data.rgba[i*4+1]-160)>8)return reject(Error('Repair color is invalid: '+data.backend+' '+data.rgba.slice(i*4,i*4+4)))}resolve({passed:true,backend:data.backend,preservedContext:true})};worker.postMessage({id:1,rgba,missing,width:w,height:h})})}finally{worker.terminate()}
};

window.runLocalMIGANRepairCheck=async function(){
  const worker=new Worker('./object-repair-worker.js'),w=128,h=128,rgba=new Uint8ClampedArray(w*h*4),missing=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++)rgba.set([20,160,70,255],i*4);
  for(let y=48;y<80;y++)for(let x=48;x<80;x++){missing[y*w+x]=1;rgba.set([0,0,0,255],(y*w+x)*4)}
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Real MI-GAN repair timeout')),90000);worker.onerror=e=>reject(Error(e.message));worker.onmessage=async({data})=>{clearTimeout(timer);if(data.error)return reject(Error(data.error));if(data.backend!=='migan')return reject(Error('MI-GAN was not used'));let delta=0,n=0;for(let i=0;i<w*h;i++){if(!missing[i]&&rgba.slice(i*4,i*4+4).some((v,c)=>v!==data.rgba[i*4+c]))return reject(Error('Context pixels changed'));if(missing[i]){delta+=Math.abs(data.rgba[i*4+1]-160);n++}}if(delta/n>8)return reject(Error('MI-GAN repair quality is too low'));const cache=await caches.open('mozai-migan-pipeline-v2'),keys=await cache.keys();resolve({passed:true,backend:data.backend,preservedContext:true,modelCached:keys.some(key=>key.url.includes('406830d0fa60666da0071c342ad2fbc8f30c5c64')),averageGreenError:delta/n})};worker.postMessage({id:1,rgba,missing,width:w,height:h,config:{gapWidth:0}})})}finally{worker.terminate()}
};

window.runObjectLocalSmoke=async function(){
  await window.MosaicAccount.ready();
  if(!window.MosaicObjects||!window.MosaicPremium||!window.MosaicProjects)throw Error('Object editor modules did not initialize');
  const files=['object-aware.js','object-mask-utils.mjs','object-repair-worker.js'];
  for(const file of files){const result=await fetch('./'+file);if(!result.ok||!result.headers.get('content-type').includes('javascript'))throw Error('Local module unavailable: '+file)}
  const route=await fetch('/api/ai/object-intent');if(route.status!==405)throw Error('Local intent route is not registered');
  return {passed:true,url:location.origin,modules:files,apiRegistered:true};
};
