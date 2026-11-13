/* Cropped per-object masks derived directly from the stable Object ID raster.
 * Keep offsets in full-image pixel coordinates. Nothing here rescales object
 * pixels with smoothing or merges neighboring identities.
 */
export function cropObjectLabel(labels,mapWidth,mapHeight,box,id,width,height) {
  if(!labels || labels.length!==mapWidth*mapHeight || !box ||
      !Number.isInteger(id) || id<1 ||
      ![mapWidth,mapHeight,width,height].every(n=>Number.isInteger(n)&&n>0)) return null;
  const left=Math.max(0,Math.min(width,Math.ceil(box.x*width/mapWidth)));
  const top=Math.max(0,Math.min(height,Math.ceil(box.y*height/mapHeight)));
  const right=Math.max(left,Math.min(width,Math.ceil((box.x+box.w)*width/mapWidth)));
  const bottom=Math.max(top,Math.min(height,Math.ceil((box.y+box.h)*height/mapHeight)));
  const w=right-left,h=bottom-top;
  if(!w||!h) return null;
  const alpha=new Uint8Array(w*h);
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++) {
    const mapY=Math.min(mapHeight-1,Math.floor((top+y)*mapHeight/height));
    for(let x=0;x<w;x++) {
      const mapX=Math.min(mapWidth-1,Math.floor((left+x)*mapWidth/width));
      if(labels[mapY*mapWidth+mapX]!==id) continue;
      alpha[y*w+x]=255;
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  if(maxX<0)return null;
  // An old imported bounding box may include surplus transparent space.
  const cw=maxX-minX+1,ch=maxY-minY+1;
  if(minX===0&&minY===0&&cw===w&&ch===h)
    return {x:left,y:top,width:w,height:h,alpha};
  const clipped=new Uint8Array(cw*ch);
  for(let y=0;y<ch;y++)
    clipped.set(alpha.subarray((minY+y)*w+minX,(minY+y)*w+minX+cw),y*cw);
  return {x:left+minX,y:top+minY,width:cw,height:ch,alpha:clipped};
}
