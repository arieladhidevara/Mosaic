import {splitColorInstances,CLEANUP_VERSION} from './object-map-cleanup.mjs';
import {PALETTE,CATEGORIES} from './object-map-utils.mjs';
export function readInstanceLabels(map){
  const rgba=map.raster.getContext('2d',{willReadFrequently:true}).getImageData(0,0,map.raster.width,map.raster.height).data;
  const labels=new Uint32Array(rgba.length/4);
  for(let i=0;i<labels.length;i++)labels[i]=map.version>=CLEANUP_VERSION?rgba[i*4]|rgba[i*4+1]<<8|rgba[i*4+2]<<16:rgba[i*4];
  return labels;
}
export function prepareInstanceMap(map,makeCanvas,geometry){
  const raw=map.colorRaster||map.raster,w=raw.width,h=raw.height,rgba=raw.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const colors=new Uint8Array(w*h);for(let i=0;i<colors.length;i++)colors[i]=rgba[i*4];
  const split=splitColorInstances(colors,w,h),output=new Uint32Array(w*h),tolerance=Math.min(3,Math.max(.75,Math.min(w,h)*.0025));
  const localPixels=(object,labels)=>{
    const padding=Math.ceil(tolerance)+2,b=object.box,x=Math.max(0,b.x-padding),y=Math.max(0,b.y-padding),right=Math.min(w,b.x+b.w+padding),bottom=Math.min(h,b.y+b.h+padding);
    const frame=makeCanvas(right-x,bottom-y),ctx=frame.getContext('2d'),pixels=ctx.createImageData(frame.width,frame.height);
    for(let yy=0;yy<frame.height;yy++)for(let xx=0;xx<frame.width;xx++)if(labels[(y+yy)*w+x+xx]===object.id)pixels.data.fill(255,(yy*frame.width+xx)*4,(yy*frame.width+xx)*4+4);
    const amount=Math.min(tolerance,Math.max(.25,Math.min(b.w,b.h)*.025));
    const paths=geometry.traceMask(pixels.data,frame.width,frame.height,1,1,amount);
    return {x,y,frame,ctx,pixels,paths};
  };
  // Rasterize straightened contours as hard masks. Smaller visible objects win
  // boundary conflicts; one pixel can still belong to only one object.
  for(const object of [...split.objects].sort((a,b)=>b.area-a.area||a.id-b.id)){
    const local=localPixels(object,split.labels),{ctx,frame}=local;
    ctx.fillStyle='#fff';ctx.beginPath();for(const path of local.paths){path.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath()}ctx.fill('evenodd');
    let clean=ctx.getImageData(0,0,frame.width,frame.height).data,count=0;for(let i=3;i<clean.length;i+=4)if(clean[i]>=128)count++;
    if(count<object.area*.88||count>object.area*1.12)clean=local.pixels.data;
    for(let yy=0;yy<frame.height;yy++)for(let xx=0;xx<frame.width;xx++){
      const pixel=(local.y+yy)*w+local.x+xx;
      if(colors[pixel]&&clean[(yy*frame.width+xx)*4+3]>=128)output[pixel]=object.id;
    }
  }
  // Close only narrow seams between two surviving objects. Preserve real voids
  // and don't reintroduce isolated spikes removed from the outside boundary.
  const stable=output.slice(),radius=Math.ceil(tolerance)+1;
  for(let p=0;p<output.length;p++)if(colors[p]&&split.labels[p]&&!stable[p]){
    const x=p%w,y=(p-x)/w,near=new Set();let best=0,distance=Infinity;
    for(let yy=Math.max(0,y-radius);yy<=Math.min(h-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(w-1,x+radius);xx++){
      const id=stable[yy*w+xx];if(!id)continue;near.add(id);const d=(xx-x)**2+(yy-y)**2;
      if(d<distance||d===distance&&id<best){best=id;distance=d}
    }
    if(near.size>1)output[p]=best;
  }
  const measured=new Map();for(let p=0;p<output.length;p++){
    const id=output[p];if(!id)continue;const x=p%w,y=(p-x)/w;let b=measured.get(id);
    if(!b){b={area:0,minX:x,maxX:x,minY:y,maxY:y};measured.set(id,b)}b.area++;b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);
  }
  const colorEntries=map.colorEntries||map.entries,legend=new Map(colorEntries.map(entry=>[entry.colorId||entry.id,entry]));
  const objects=split.objects.filter(object=>measured.has(object.id)).map(object=>{
    const b=measured.get(object.id),info=legend.get(object.colorId)||{},category=CATEGORIES.includes(info.category)?info.category:'Other';
    const result={...object,category,suggestedGroup:info.group||info.suggestedGroup||'',color:PALETTE[object.colorId-1].color,label:info.label||category+' object',key:map.sourceKey+':'+object.colorId+'@'+object.seed,area:b.area,box:{x:b.minX,y:b.minY,w:b.maxX-b.minX+1,h:b.maxY-b.minY+1}};
    const local=localPixels(result,output);result.paths=local.paths.map(path=>path.map(p=>({x:p.x+local.x,y:p.y+local.y})));return result;
  });
  const counts=new Map(),ordinals=new Map();for(const object of objects){const key=object.category+':'+object.label.toLowerCase();counts.set(key,(counts.get(key)||0)+1)}
  for(const object of objects){const key=object.category+':'+object.label.toLowerCase(),ordinal=(ordinals.get(key)||0)+1;ordinals.set(key,ordinal);if(counts.get(key)>1)object.label+=' '+ordinal}
  const raster=makeCanvas(w,h),ctx=raster.getContext('2d'),pixels=ctx.createImageData(w,h);
  for(let i=0;i<output.length;i++){pixels.data[i*4]=output[i]&255;pixels.data[i*4+1]=output[i]>>8&255;pixels.data[i*4+2]=output[i]>>16&255;pixels.data[i*4+3]=255}ctx.putImageData(pixels,0,0);
  return {...map,version:CLEANUP_VERSION,colorRaster:raw,colorEntries,raster,entries:objects,smoothTolerance:tolerance};
}
