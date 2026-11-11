// Reject empty provider frames before they become saved options. This samples
// the entire returned crop, never just an intentionally black painted object.
export function generatedImageStats(rgba){
  let opaque=0,transparent=0,nearBlack=0,minimum=255,maximum=0,total=0;
  const count=rgba.length/4;
  for(let i=0;i<rgba.length;i+=4){
    if(rgba[i+3]<4){transparent++;continue}
    if(rgba[i+3]>=240)opaque++;
    const high=Math.max(rgba[i],rgba[i+1],rgba[i+2]);if(high<=4&&rgba[i+3]>=240)nearBlack++;
    minimum=Math.min(minimum,rgba[i],rgba[i+1],rgba[i+2]);maximum=Math.max(maximum,high);total+=(rgba[i]+rgba[i+1]+rgba[i+2])/3;
  }
  const empty=!count||transparent/count>=.999,black=count>0&&nearBlack/count>=.999&&maximum<=4;
  return {count,opaque,transparent,nearBlack,minimum,maximum,mean:Math.round(total/Math.max(1,count-transparent)*100)/100,invalid:empty||black,reason:empty?'transparent':black?'black':null};
}
export function assertGeneratedImage(image,makeCanvas){
  const sample=makeCanvas(64,64),x=sample.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,64,64);
  const stats=generatedImageStats(x.getImageData(0,0,64,64).data);
  if(stats.invalid){const error=Error('AI returned an empty '+(stats.reason==='black'?'black':'transparent')+' image. Your previous image was preserved. Please retry.');error.code='EMPTY_GENERATED_IMAGE';error.imageStats=stats;throw error}
  return stats;
}

// Compare only selected pixels with their accepted image. Scene context can
// otherwise hide a failed object inside an apparently valid provider crop.
export function generatedRegionStats(before,after,mask,{prompt=''}={}){
  if(before.length!==after.length||mask.length!==after.length)throw Error('Mismatched regional image dimensions.');
  let count=0,newBlack=0,newEmpty=0,black=0;
  const isBlack=(rgba,i)=>rgba[i+3]>=240&&Math.max(rgba[i],rgba[i+1],rgba[i+2])<=6;
  for(let i=0;i<after.length;i+=4){
    if(mask[i+3]<240)continue;
    count++;
    const dark=isBlack(after,i);
    if(dark)black++;
    if(dark&&!isBlack(before,i))newBlack++;
    if(after[i+3]<240&&before[i+3]>=240)newEmpty++;
  }
  const blackRequested=/\b(black|charcoal|ebony|onyx|dark|darker|midnight|hitam|gelap|areng|arang)\b/i.test(prompt);
  const blackFraction=black/Math.max(1,count),newBlackFraction=newBlack/Math.max(1,count),emptyFraction=newEmpty/Math.max(1,count);
  const reason=count>=24&&emptyFraction>=.1?'transparent-region':
    count>=24&&!blackRequested&&blackFraction>=.25&&newBlackFraction>=.2?'black-region':null;
  return {count,blackFraction,newBlackFraction,emptyFraction,blackRequested,invalid:Boolean(reason),reason};
}
export function assertGeneratedRegion({before,image,mask,makeCanvas,prompt='',bounds}){
  const b=bounds||{x:0,y:0,w:mask.width,h:mask.height};
  const scale=Math.min(1,384/Math.max(b.w,b.h)),w=Math.max(1,Math.round(b.w*scale)),h=Math.max(1,Math.round(b.h*scale));
  const sample=source=>{
    const frame=makeCanvas(w,h),x=frame.getContext('2d',{willReadFrequently:true});
    x.drawImage(source,b.x,b.y,b.w,b.h,0,0,w,h);return x.getImageData(0,0,w,h).data;
  };
  const stats=generatedRegionStats(sample(before),sample(image),sample(mask),{prompt});
  if(stats.invalid){
    const error=Error('The generated object contains an unexpected '+(stats.reason==='black-region'?'blank black':'transparent')+' area. Your previous image was preserved. Please retry.');
    error.code='INVALID_GENERATED_REGION';error.imageStats=stats;throw error;
  }
  return stats;
}
