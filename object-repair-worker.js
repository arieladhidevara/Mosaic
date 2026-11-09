/* Lazy browser-local repair. No images leave this worker. */
let cvReady,ortReady,sessionReady,sessionProvider;
const defaults={opencvURL:'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@5.0.0-release.1/dist/opencv.js',ortURL:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',modelURL:'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx',gapWidth:40};
async function openCV(config){
  if(!cvReady)cvReady=(async()=>{importScripts(config.opencvURL);const cv=await self.cv;if(!cv?.Mat)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('OpenCV initialization timed out')),30000);cv.onRuntimeInitialized=()=>{clearTimeout(timer);resolve()}});if(typeof cv.inpaint!=='function')throw Error('OpenCV photo module is unavailable');return cv})();
  return cvReady;
}
async function onnx(config){
  if(!ortReady)ortReady=(async()=>{importScripts(config.ortURL+'ort.webgpu.min.js');self.ort.env.wasm.wasmPaths=config.ortURL;self.ort.env.wasm.numThreads=1;return self.ort})();
  return ortReady;
}
async function modelBytes(url){
  let cache;try{cache=await caches.open('mozai-migan-pipeline-v2')}catch{/* Private browsing can deny CacheStorage. */}
  let response=await cache?.match(url);
  if(!response){response=await fetch(url);if(!response.ok)throw Error('MI-GAN download failed');try{await cache?.put(url,response.clone())}catch{/* Storage quota must not break inference. */}}
  return new Uint8Array(await response.arrayBuffer());
}
async function migan(rgba,holes,w,h,config){
  const ort=await onnx(config);
  if(!sessionReady)sessionReady=(async()=>{const bytes=await modelBytes(config.modelURL);if(self.navigator?.gpu){try{sessionProvider='webgpu';return await ort.InferenceSession.create(bytes,{executionProviders:['webgpu','wasm']})}catch{/* Unsupported operators use WASM. */}}sessionProvider='wasm';return ort.InferenceSession.create(bytes,{executionProviders:['wasm']})})();
  let session=await sessionReady;
  const n=w*h,rgb=new Uint8Array(n*3),known=new Uint8Array(n);
  for(let i=0;i<n;i++){known[i]=holes[i]?0:255;for(let c=0;c<3;c++)rgb[c*n+i]=rgba[i*4+c]}
  const feeds={image:new ort.Tensor('uint8',rgb,[1,3,h,w]),mask:new ort.Tensor('uint8',known,[1,1,h,w])};
  let output;
  try{try{output=await session.run(feeds)}catch(error){if(sessionProvider!=='webgpu')throw error;await session.release();sessionProvider='wasm';session=await ort.InferenceSession.create(await modelBytes(config.modelURL),{executionProviders:['wasm']});sessionReady=Promise.resolve(session);output=await session.run(feeds)}
    const result=output.result||output[session.outputNames[0]];
    if(result.type!=='uint8'||result.dims.length!==4||result.dims[1]!==3||result.dims[2]!==h||result.dims[3]!==w)throw Error('Unexpected MI-GAN output');
    const repaired=new Uint8ClampedArray(rgba);
    for(let i=0;i<n;i++)if(holes[i]){for(let c=0;c<3;c++)repaired[i*4+c]=result.data[c*n+i];repaired[i*4+3]=255}return repaired;
  }finally{for(const tensor of Object.values(feeds))tensor.dispose?.();for(const tensor of Object.values(output||{}))tensor.dispose?.()}
}
async function telea(rgba,holes,w,h,config){
  const cv=await openCV(config),allocated=[];
  try{
    const input=cv.matFromArray(h,w,cv.CV_8UC4,rgba),rgb=new cv.Mat(),mask=cv.matFromArray(h,w,cv.CV_8UC1,Uint8Array.from(holes,x=>x?255:0)),out=new cv.Mat();allocated.push(input,rgb,mask,out);
    cv.cvtColor(input,rgb,cv.COLOR_RGBA2RGB);cv.inpaint(rgb,mask,out,3,cv.INPAINT_TELEA);
    const repaired=new Uint8ClampedArray(rgba);
    for(let i=0;i<holes.length;i++)if(holes[i]){for(let c=0;c<3;c++)repaired[i*4+c]=out.data[i*3+c];repaired[i*4+3]=255}return repaired;
  }finally{for(const mat of allocated)mat.delete()}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  const {id,rgba,missing,exclude,width:w,height:h}=data,config={...defaults,...data.config};
  try{
    const {gapWidth,textureComplexity,validRepair,matchFlatContext}=await import('./object-mask-utils.mjs');
    // Occluding geometry and all unknown pixels are holes, never texture samples.
    const holes=Uint8Array.from(missing,(v,i)=>+(v||exclude?.[i]));
    const simple=gapWidth(holes,w,h)<=config.gapWidth/(1+textureComplexity(rgba,holes,w,h)*4);
    let result,backend='opencv';
    if(simple){try{result=await telea(rgba,holes,w,h,config);if(!validRepair(rgba,result,holes,w,h))result=null}catch{cvReady=null;/* Escalate low-quality or unavailable local CV to MI-GAN. */}}
    if(!result){backend='migan';try{result=matchFlatContext(rgba,await migan(rgba,holes,w,h,config),holes,w,h)}catch(error){sessionReady=null;throw error}}
    if(!validRepair(rgba,result,missing,w,h))throw Error('Repair quality rejected');
    // The compositor receives only requested pixels, never modified context.
    for(let i=0;i<missing.length;i++)if(!missing[i])result.set(rgba.subarray(i*4,i*4+4),i*4);
    self.postMessage({id,rgba:result,backend},[result.buffer]);
  }catch{self.postMessage({id,error:'Local repair unavailable'})}
}).catch(()=>{});};
