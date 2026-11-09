// Inject only into an isolated browser before navigation. No model download or paid API calls.
window.maskWorkerStats={prepares:0,infers:0};
const NativeMaskWorker=window.Worker;
window.Worker=class extends EventTarget{
  constructor(url,options){
    super();
    if(!String(url).includes('slimsam-worker.mjs'))return new NativeMaskWorker(url,options);
  }
  postMessage(job){
    const emit=data=>this.dispatchEvent(new MessageEvent('message',{data}));
    if(job.type==='preload')setTimeout(()=>emit({type:'preloaded'}),20);
    if(job.type==='prepare'){
      this.width=job.width;this.height=job.height;
      window.maskWorkerStats.prepares++;
      setTimeout(()=>emit({type:'ready',epoch:job.epoch}),120);
    }
    if(job.type==='infer'){
      window.maskWorkerStats.infers++;
      const width=this.width,height=this.height,mask=new Uint8Array(width*height);
      for(let y=Math.floor(height*.25);y<height*.75;y++)for(let x=Math.floor(width*.25);x<width*.75;x++)mask[y*width+x]=1;
      setTimeout(()=>emit({type:'mask',epoch:job.epoch,id:job.id,click:job.click,width,height,mask,coverage:.25}),30);
    }
  }
  terminate(){}
};
