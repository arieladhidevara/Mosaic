/* Pure mask-difference helpers. Binary pixels use 1 for visible object ownership. */
export function calculateMaskDelta(oldBits,newBits){
  if(!(oldBits instanceof Uint8Array)||!(newBits instanceof Uint8Array)||oldBits.length!==newBits.length)
    throw new TypeError('Masks must have the same pixel dimensions.');
  const union=new Uint8Array(oldBits.length),revealed=new Uint8Array(oldBits.length),added=new Uint8Array(oldBits.length);
  let oldCount=0,newCount=0,unionCount=0,revealedCount=0,addedCount=0,overlapCount=0;
  for(let i=0;i<oldBits.length;i++){
    const was=oldBits[i]>0,now=newBits[i]>0;
    union[i]=was||now?1:0;revealed[i]=was&&!now?1:0;added[i]=now&&!was?1:0;
    oldCount+=Number(was);newCount+=Number(now);unionCount+=Number(was||now);
    revealedCount+=Number(was&&!now);addedCount+=Number(now&&!was);overlapCount+=Number(was&&now);
  }
  return {union,revealed,added,oldCount,newCount,unionCount,revealedCount,addedCount,overlapCount,iou:overlapCount/Math.max(1,unionCount)};
}


// Mask-to-mask geometry registration. Source silhouette B is matched to the
// locked target silhouette A; the canonical A pixels are never modified.
// Bounds and row profiles are deliberately conservative to avoid inventing
// perspective when the generated object is actually a different shape.
export function measureBinaryMask(bits,width,height){
  if(bits.length!==width*height)throw new TypeError('Mask dimensions differ.');
  let left=width,right=-1,top=height,bottom=-1,area=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!bits[y*width+x])continue;
    area++;if(x<left)left=x;if(x>right)right=x;
    if(y<top)top=y;if(y>bottom)bottom=y;
  }
  return area?{x:left,y:top,w:right-left+1,h:bottom-top+1,area}:null;
}
export function registerBinaryMasks(target,source,width,height,options={}){
  const original=measureBinaryMask(target,width,height);
  const candidate=measureBinaryMask(source,width,height);
  if(!original||!candidate)return {approved:false,reason:'empty'};
  let overlap=0;
  for(let i=0;i<target.length;i++)if(target[i]&&source[i])overlap++;
  const union=original.area+candidate.area-overlap,iou=overlap/Math.max(1,union);
  const ratio=candidate.area/Math.max(1,original.area);
  const dx=(original.x+original.w/2)-(candidate.x+candidate.w/2);
  const dy=(original.y+original.h/2)-(candidate.y+candidate.h/2);
  const difference=Math.max(Math.abs(original.w-candidate.w)/original.w,
    Math.abs(original.h-candidate.h)/original.h);
  // Only register small, plausible silhouette drift for appearance edits.
  const approved=iou>=(options.minIou??.58)&&ratio>=(options.minRatio??.68)&&
    ratio<=(options.maxRatio??1.48)&&difference<=(options.maxSizeChange??.28)&&
    Math.abs(dx)<=Math.max(3,original.w*.22)&&Math.abs(dy)<=Math.max(3,original.h*.22);
  return {approved,reason:approved?'mask-fit':'inconsistent-shapes',
    targetBox:original,sourceBox:candidate,iou,ratio,dx,dy};
}
