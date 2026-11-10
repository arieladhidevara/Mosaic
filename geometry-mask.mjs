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


// Derive a provisional new silhouette from image changes, WITHOUT SAM. It is
// never saved as the object's mask. Only use it as registration evidence.
function differenceSilhouette(before,after,target,width,height){
  const bounds=measureBinaryMask(target,width,height);
  if(!bounds)return null;
  const expandX=Math.max(3,Math.ceil(bounds.w*.20)),expandY=Math.max(3,Math.ceil(bounds.h*.20));
  const x0=Math.max(0,bounds.x-expandX),x1=Math.min(width,bounds.x+bounds.w+expandX);
  const y0=Math.max(0,bounds.y-expandY),y1=Math.min(height,bounds.y+bounds.h+expandY);
  const flags=new Uint8Array(width*height);
  let detected=0,inside=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const p=y*width+x,i=p*4;
    const difference=(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+
      Math.abs(before[i+2]-after[i+2]))/3;
    // JPEG noise and subtle shadows must not be mistaken for a new silhouette.
    if(difference<23)continue;
    flags[p]=1;detected++;if(target[p])inside++;
  }
  if(detected<Math.max(12,bounds.area*.16)||inside<bounds.area*.25)return null;
  // Close tiny gaps without growing beyond the immediate edited area.
  const result=flags.slice();
  for(let y=Math.max(1,y0);y<Math.min(height-1,y1);y++)
    for(let x=Math.max(1,x0);x<Math.min(width-1,x1);x++){
      const p=y*width+x;
      if(result[p])continue;
      let neighbors=0;
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)
        neighbors+=flags[p+yy*width+xx];
      if(neighbors>=6)result[p]=1;
    }
  // Reject unrelated scattered changes by keeping only components connected
  // to the original object interior.
  const queue=new Uint32Array(width*height),seen=new Uint8Array(width*height);
  let head=0,tail=0;
  for(let y=bounds.y;y<bounds.y+bounds.h;y++)
    for(let x=bounds.x;x<bounds.x+bounds.w;x++){
      const p=y*width+x;
      if(target[p]&&result[p]&&!seen[p]){seen[p]=1;queue[tail++]=p;}
    }
  if(!tail)return null;
  const keep=new Uint8Array(width*height);
  // Seed every changed pixel inside the locked selection. Preserve only their
  // immediate connected outward extension, never distant global edit changes.
  while(head<tail){
    const p=queue[head++],x=p%width,y=Math.floor(p/width);keep[p]=1;
    for(const n of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1])
      if(n>=0&&result[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}
  }
  return keep;
}
function rasterMaskBits(canvas,width,height,makeCanvas){
  const small=makeCanvas(width,height),ctx=small.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,0,0,width,height);
  const rgba=ctx.getImageData(0,0,width,height).data,bits=new Uint8Array(width*height);
  for(let i=0;i<bits.length;i++)bits[i]=rgba[i*4+3]>=128?1:0;
  return bits;
}
// A small mask-guided mesh: the top and bottom boundary profiles of Mask B
// are mapped onto the locked Mask A. All interpolation is computed in image
// coordinates; only resulting RGB pixels move, not the canonical selection.
function silhouetteEdges(bits,width,height,box,position){
  const y=Math.max(0,Math.min(height-1,Math.floor(box.y+box.h*position)));
  const radius=Math.max(1,Math.round(box.h*.07));
  let minX=width,maxX=-1,filled=0;
  for(let yy=Math.max(box.y,y-radius);yy<=Math.min(height-1,box.y+box.h-1,y+radius);yy++)
    for(let x=box.x;x<box.x+box.w;x++)
      if(bits[yy*width+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);filled++;}
  if(maxX<minX)return {left:box.x,right:box.x+box.w,stable:false};
  const coverage=filled/Math.max(1,(maxX-minX+1)*(Math.min(box.y+box.h-1,y+radius)-Math.max(box.y,y-radius)+1));
  return {left:minX,right:maxX+1,stable:coverage>.55};
}
function alignedCanvas(generated,lockedBits,newBits,width,height,fit,makeCanvas){
  const target=fit.targetBox,source=fit.sourceBox;
  const scaleX=generated.width/width,scaleY=generated.height/height;
  const out=makeCanvas(generated.width,generated.height),ctx=out.getContext('2d');
  ctx.drawImage(generated,0,0);
  if(fit.iou>=.965)return out;
  const warp=makeCanvas(out.width,out.height),c=warp.getContext('2d');
  const topA=silhouetteEdges(lockedBits,width,height,target,.12);
  const botA=silhouetteEdges(lockedBits,width,height,target,.88);
  const topB=silhouetteEdges(newBits,width,height,source,.12);
  const botB=silhouetteEdges(newBits,width,height,source,.88);
  // When silhouettes are fragmented (chairs, trees), use an affine correction
  // rather than stretching across empty regions between disconnected parts.
  const skew=[topA,botA,topB,botB].every(edge=>edge.stable);
  const yStart=Math.max(0,Math.floor(target.y*scaleY)),yEnd=Math.min(out.height,Math.ceil((target.y+target.h)*scaleY));
  for(let y=yStart;y<yEnd;y++){
    const t=Math.max(0,Math.min(1,(y/scaleY-target.y)/Math.max(1,target.h)));
    const sourceY=(source.y+t*source.h)*scaleY;
    const leftA=(skew?topA.left*(1-t)+botA.left*t:target.x)*scaleX;
    const rightA=(skew?topA.right*(1-t)+botA.right*t:target.x+target.w)*scaleX;
    const leftB=(skew?topB.left*(1-t)+botB.left*t:source.x)*scaleX;
    const rightB=(skew?topB.right*(1-t)+botB.right*t:source.x+source.w)*scaleX;
    const sw=Math.max(1,rightB-leftB),dw=Math.max(1,rightA-leftA);
    if(leftB<0||sourceY<0||leftB+sw>out.width+.5||sourceY+scaleY>out.height+.5)continue;
    c.drawImage(generated,leftB,sourceY,sw,Math.max(1,scaleY),leftA,y,dw,1.5);
  }
  // The target mask is the ONLY final boundary, regardless of Mask B shape.
  const mask=makeCanvas(out.width,out.height),mc=mask.getContext('2d');
  const rgba=mc.createImageData(width,height);
  for(let i=0;i<lockedBits.length;i++)if(lockedBits[i])rgba.data.fill(255,i*4,i*4+4);
  const low=makeCanvas(width,height);low.getContext('2d').putImageData(rgba,0,0);
  mc.imageSmoothingEnabled=false;mc.drawImage(low,0,0,out.width,out.height);
  c.globalCompositeOperation='destination-in';c.drawImage(mask,0,0);
  c.globalCompositeOperation='source-over';ctx.drawImage(warp,0,0);
  return out;
}
export function alignGeneratedToLockedMask({before,generated,lockedMask,candidateMask=null,makeCanvas,
  maxDimension=320,allowDifference=true}){
  const fullW=generated?.width,fullH=generated?.height;
  if(!before||!generated||!lockedMask||!makeCanvas||!fullW||!fullH)
    return {image:generated,status:'unavailable',aligned:false};
  const scale=Math.min(1,maxDimension/Math.max(fullW,fullH));
  const w=Math.max(4,Math.round(fullW*scale)),h=Math.max(4,Math.round(fullH*scale));
  const target=rasterMaskBits(lockedMask,w,h,makeCanvas);
  let candidate=candidateMask?rasterMaskBits(candidateMask,w,h,makeCanvas):null;
  if(!candidate&&allowDifference){
    const sample=image=>{const temp=makeCanvas(w,h);temp.getContext('2d').drawImage(image,0,0,w,h);
      return temp.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;};
    candidate=differenceSilhouette(sample(before),sample(generated),target,w,h);
  }
  if(!candidate)return {image:generated,status:'locked-mask-no-candidate',aligned:false};
  const fit=registerBinaryMasks(target,candidate,w,h);
  if(!fit.approved)return {image:generated,status:'locked-mask-unsafe-warp',aligned:false,
    iou:fit.iou,reason:fit.reason};
  return {image:alignedCanvas(generated,target,candidate,w,h,fit,makeCanvas),
    status:'mask-b-warped-to-locked-a',aligned:fit.iou<.965,iou:fit.iou};
}
