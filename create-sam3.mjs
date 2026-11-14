// Create masks: SAM 3 refines a GPT-generated transparent PNG using the user's
// prompt as semantic guidance. Alpha remains the lossless fallback.
export function createSamLabel(prompt){
  let label=String(prompt||'').trim()
    .replace(/^(?:please\s+)?(?:create|add|insert|place|put|generate|draw|render|make|build|design)\s+/i,'')
    .replace(/^(?:me\s+)?(?:a|an|the)\s+/i,'')
    .replace(/[\r\n]+/g,' ')
    .split(/[.;!?]/)[0].trim();
  return (label||'object').slice(0,80);
}
export function alphaBounds(pixels,width,height,minAlpha=96){
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const alpha=pixels[(y*width+x)*4+3];
    if(alpha<minAlpha)continue;
    minX=Math.min(minX,x);minY=Math.min(minY,y);
    maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  return maxX<0?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
}
export function samMaskBits(rgba,width,height){
  if(rgba.length!==width*height*4)throw Error('SAM dimensions mismatch');
  // Some backends return a white foreground on an opaque black PNG rather
  // than transparency. Detect both formats without treating opaque black as
  // a full-scene selection.
  const corners=[0,width-1,(height-1)*width,height*width-1];
  const opaqueCorners=corners.filter(p=>rgba[p*4+3]>240).length;
  const useLuma=opaqueCorners===4;
  const bits=new Uint8Array(width*height);
  for(let p=0;p<bits.length;p++){
    const i=p*4;
    bits[p]=useLuma
      ?(rgba[i]*.2126+rgba[i+1]*.7152+rgba[i+2]*.0722)>130?1:0
      :rgba[i+3]>127?1:0;
  }
  return bits;
}
export function refineCreatePixels(rgba,maskBits,{minCoverage=.72,maxExpansion=2.2}={}){
  if(rgba.length/4!==maskBits.length)throw Error('SAM and Create image sizes differ');
  let foreground=0,matched=0,segmented=0;
  for(let p=0;p<maskBits.length;p++){
    const strong=rgba[p*4+3]>=180;
    if(strong)foreground++;
    if(maskBits[p])segmented++;
    if(strong&&maskBits[p])matched++;
  }
  const coverage=matched/Math.max(1,foreground);
  const expansion=segmented/Math.max(1,foreground);
  if(foreground<16||coverage<minCoverage||expansion<.45||expansion>maxExpansion)
    return {applied:false,coverage,expansion,matched,foreground};
  // Only trim solid object pixels that SAM confidently excludes. Preserve all
  // semitransparent edges and shadows from GPT's genuine RGBA cutout.
  for(let p=0;p<maskBits.length;p++){
    const i=p*4;
    if(rgba[i+3]>=180&&!maskBits[p])rgba[i+3]=0;
  }
  return {applied:true,coverage,expansion,matched,foreground};
}
