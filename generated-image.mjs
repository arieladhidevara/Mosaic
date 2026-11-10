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
