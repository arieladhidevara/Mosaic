// Fast, pure PNG-alpha crop planning for Create. No SAM or additional AI step.
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
// A pure crop plan: preserve original PNG alpha but only rasterize the new
// object's local silhouette. Coordinates returned for source and mask are in
// the same full scene without allocating full-scene RGBA arrays.
export function planCreateAlphaCrop(pixels,width,height,region,minAlpha=8){
  if(!region||width!==region.w||height!==region.h)throw new TypeError('Create crop dimensions differ');
  const localBox=alphaBounds(pixels,width,height,minAlpha);
  if(!localBox)return null;
  const bbox={x:region.x+localBox.x,y:region.y+localBox.y,
    w:localBox.width,h:localBox.height};
  const pad=Math.max(24,Math.ceil(Math.max(bbox.w,bbox.h)*.08));
  const sx=Math.max(0,localBox.x-pad),sy=Math.max(0,localBox.y-pad);
  const sr=Math.min(width,localBox.x+localBox.width+pad);
  const sb=Math.min(height,localBox.y+localBox.height+pad);
  return {localBox,bbox,sourceRect:{x:sx,y:sy,w:sr-sx,h:sb-sy},
    sourceCrop:{x:region.x+sx,y:region.y+sy,width:sr-sx,height:sb-sy}};
}
