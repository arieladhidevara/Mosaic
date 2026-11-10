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



// Fresh Mask B from the GENERATED RGB, not the old selection's raster and not
// SAM. Use the locked mask only to seed a local foreground/background color
// model; boundaries are classified from the new image's actual appearance.
// Uncertain color models safely return null (the immutable Mask A wins).
function materialColorDistance(rgb,center){
  const dr=rgb[0]-center[0],dg=rgb[1]-center[1],db=rgb[2]-center[2];
  return dr*dr*.85+dg*dg*1.15+db*db;
}
function materialColorCenters(samples,count=4){
  if(!samples.length)return [];
  const centers=[samples[Math.floor(samples.length/2)].slice()];
  for(let j=1;j<count;j++){
    let farthest=0,choice=null;
    for(const rgb of samples){
      const distance=Math.min(...centers.map(c=>materialColorDistance(rgb,c)));
      if(distance>farthest){farthest=distance;choice=rgb;}
    }
    if(!choice||farthest<196)break;
    centers.push(choice.slice());
  }
  for(let iteration=0;iteration<6;iteration++){
    const totals=centers.map(()=>[0,0,0,0]);
    for(const rgb of samples){
      let best=0,distance=Infinity;
      for(let j=0;j<centers.length;j++){
        const d=materialColorDistance(rgb,centers[j]);
        if(d<distance){best=j;distance=d;}
      }
      const t=totals[best];t[0]+=rgb[0];t[1]+=rgb[1];t[2]+=rgb[2];t[3]++;
    }
    centers.forEach((c,j)=>{
      const t=totals[j];if(t[3]){c[0]=t[0]/t[3];c[1]=t[1]/t[3];c[2]=t[2]/t[3];}
    });
  }
  return centers;
}
function materialNearest(rgb,centers){
  let distance=Infinity;
  for(const c of centers)distance=Math.min(distance,materialColorDistance(rgb,c));
  return distance;
}
export function segmentGeneratedMaterial({before,after,target,width,height}){
  if(!before||!after||!target||before.length!==width*height*4||
     after.length!==before.length||target.length!==width*height)
    throw new TypeError('Material segmentation requires matched RGBA and mask dimensions.');
  const box=measureBinaryMask(target,width,height);
  if(!box||box.area<24)return null;
  const marginX=Math.max(5,Math.ceil(box.w*.22)),marginY=Math.max(5,Math.ceil(box.h*.22));
  const x0=Math.max(0,box.x-marginX),x1=Math.min(width,box.x+box.w+marginX);
  const y0=Math.max(0,box.y-marginY),y1=Math.min(height,box.y+box.h+marginY);
  const stride=Math.max(1,Math.floor(Math.sqrt(((x1-x0)*(y1-y0))/5000)));
  const foreground=[],background=[];
  let insideChanged=0,insideTotal=0;
  for(let y=y0+1;y<y1-1;y+=stride)for(let x=x0+1;x<x1-1;x+=stride){
    const p=y*width+x,i=p*4,inside=target[p]!==0;
    const rgb=[after[i],after[i+1],after[i+2]];
    const diff=(Math.abs(after[i]-before[i])+Math.abs(after[i+1]-before[i+1])+
      Math.abs(after[i+2]-before[i+2]))/3;
    if(inside){
      insideTotal++;if(diff>18)insideChanged++;
      // Boundary pixels may be mixed with antialiasing. Train foreground only
      // from confident old interior, but classify NEW boundaries independently.
      if(diff>=14&&target[p-1]&&target[p+1]&&target[p-width]&&target[p+width])
        foreground.push(rgb);
    }else if(diff<20&&!target[p-1]&&!target[p+1]&&!target[p-width]&&!target[p+width]){
      // Stable surroundings provide negative examples; never assume pixels
      // outside A are the new target, because the new object may have shifted.
      background.push(rgb);
    }
  }
  if(foreground.length<Math.max(12,insideTotal*.10)||background.length<12||
     insideChanged<insideTotal*.24)return null;
  const fg=materialColorCenters(foreground,4),bg=materialColorCenters(background,4);
  if(!fg.length||!bg.length)return null;
  // Reject ambiguous edits where generated material cannot be distinguished
  // from its background: auto-warp must not stretch a door/frame into a wall.
  let distinct=0;
  for(const rgb of foreground)if(materialNearest(rgb,fg)*1.16+225<materialNearest(rgb,bg))distinct++;
  if(distinct/foreground.length<.56)return null;
  let mask=new Uint8Array(width*height),classifiedInside=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const p=y*width+x,i=p*4,rgb=[after[i],after[i+1],after[i+2]];
    const f=materialNearest(rgb,fg),b=materialNearest(rgb,bg);
    // A deliberately conservative color classifier. Material RGB must fit
    // the learned new foreground and be separated from the adjacent scene.
    if(f*1.12+135<b){mask[p]=1;if(target[p])classifiedInside++;}
  }
  if(classifiedInside<box.area*.52)return null;
  // Repair pinholes in photographic materials (wood grain, stone speckles)
  // without dilating the object's outer silhouette into neighboring objects.
  for(let repeat=0;repeat<2;repeat++){
    const updated=mask.slice();
    for(let y=Math.max(1,y0);y<Math.min(height-1,y1);y++)
      for(let x=Math.max(1,x0);x<Math.min(width-1,x1);x++){
        const p=y*width+x;if(mask[p])continue;
        let neighbors=0;
        for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)
          if(yy||xx)neighbors+=mask[p+yy*width+xx];
        if(neighbors>=7)updated[p]=1;
      }
    mask=updated;
  }
  // Connected region(s) must intersect the original object. Same-colored
  // regions elsewhere in the photograph are not part of Mask B.
  const seen=new Uint8Array(width*height),output=new Uint8Array(width*height);
  const queue=new Uint32Array(width*height),minIsland=Math.max(5,box.area*.008);
  let area=0,overlap=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const index=y*width+x;if(!mask[index]||seen[index])continue;
    let head=0,tail=1,attached=0;queue[0]=index;seen[index]=1;
    while(head<tail){
      const p=queue[head++],px=p%width,py=(p-px)/width;
      if(target[p])attached++;
      if(px>0&&mask[p-1]&&!seen[p-1]){seen[p-1]=1;queue[tail++]=p-1;}
      if(px+1<width&&mask[p+1]&&!seen[p+1]){seen[p+1]=1;queue[tail++]=p+1;}
      if(py>0&&mask[p-width]&&!seen[p-width]){seen[p-width]=1;queue[tail++]=p-width;}
      if(py+1<height&&mask[p+width]&&!seen[p+width]){seen[p+width]=1;queue[tail++]=p+width;}
    }
    if(attached>=Math.min(6,tail)&&tail>=minIsland){
      for(let i=0;i<tail;i++)output[queue[i]]=1;
      area+=tail;overlap+=attached;
    }
  }
  const ratio=area/box.area,iou=overlap/Math.max(1,box.area+area-overlap);
  if(ratio<.64||ratio>1.48||iou<.52)return null;
  return {mask:output,method:'generated-rgb-segmentation',confidence:iou,
    coverage:overlap/box.area,area};
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

// Piecewise contour registration. Every destination scanline is mapped from
// the actual NEW Mask B outline to the original Mask A outline. Unlike a
// bounding-box-only resize, this follows sloped walls and perspective edges.
function contourProfile(bits,width,box){
  const left=new Float32Array(box.h),right=new Float32Array(box.h),valid=new Uint8Array(box.h);
  for(let row=0;row<box.h;row++){
    const y=box.y+row;let lo=width,hi=-1;
    for(let x=box.x;x<box.x+box.w;x++)if(bits[y*width+x]){lo=Math.min(lo,x);hi=Math.max(hi,x);}
    if(hi>=lo){left[row]=lo;right[row]=hi+1;valid[row]=1;}
  }
  for(let row=0;row<box.h;row++)if(!valid[row]){
    let before=row-1,after=row+1;
    while(before>=0&&!valid[before])before--;
    while(after<box.h&&!valid[after])after++;
    const source=before<0?after>=box.h?-1:after:after>=box.h?before:
      (row-before<=after-row?before:after);
    left[row]=source<0?box.x:left[source];
    right[row]=source<0?box.x+box.w:right[source];
  }
  // Three-row smoothing avoids visible seams from individual jagged pixels
  // without flattening the larger perspective variation.
  const smooth=new Float32Array(box.h*2);
  for(let row=0;row<box.h;row++){
    let l=0,r=0,n=0;
    for(let j=Math.max(0,row-1);j<=Math.min(box.h-1,row+1);j++){l+=left[j];r+=right[j];n++;}
    smooth[row*2]=l/n;smooth[row*2+1]=r/n;
  }
  return smooth;
}
function contourAt(profile,box,t){
  const position=Math.max(0,Math.min(box.h-1,Math.max(0,t)*box.h-.5));
  const low=Math.floor(position),high=Math.min(box.h-1,low+1),blend=position-low;
  return {
    left:profile[low*2]*(1-blend)+profile[high*2]*blend,
    right:profile[low*2+1]*(1-blend)+profile[high*2+1]*blend
  };
}
function contourMapping(targetProfile,sourceProfile,fit,t){
  const target=fit.targetBox,source=fit.sourceBox;
  const a=contourAt(targetProfile,target,t),b=contourAt(sourceProfile,source,t);
  const aWidth=a.right-a.left,bWidth=b.right-b.left;
  if(aWidth<.4||bWidth<.4)return null;
  const stretch=aWidth/bWidth;
  if(!Number.isFinite(stretch)||stretch<.53||stretch>1.90)return null;
  return {leftA:a.left,rightA:a.right,leftB:b.left,rightB:b.right,
    sourceY:source.y+Math.max(0,Math.min(1,t))*source.h,stretch};
}
export function measureContourWarpCoverage(targetBits,sourceBits,width,height,fit){
  if(!fit?.approved)return {coverage:0,valid:false};
  const a=fit.targetBox,b=fit.sourceBox;
  const outlineA=contourProfile(targetBits,width,a),outlineB=contourProfile(sourceBits,width,b);
  let covered=0,total=0,validRows=0;
  for(let y=a.y;y<a.y+a.h;y++){
    const t=(y-a.y+.5)/a.h,mapping=contourMapping(outlineA,outlineB,fit,t);
    if(!mapping)continue;
    validRows++;
    const sy=Math.min(height-1,Math.max(0,Math.floor(mapping.sourceY)));
    for(let x=a.x;x<a.x+a.w;x++){
      if(!targetBits[y*width+x])continue;
      total++;
      const sx=Math.min(width-1,Math.max(0,Math.floor(
        mapping.leftB+(x+.5-mapping.leftA)/(mapping.rightA-mapping.leftA)*
        (mapping.rightB-mapping.leftB))));
      if(sourceBits[sy*width+sx])covered++;
    }
  }
  const coverage=covered/Math.max(1,a.area),valid=coverage>=.83&&
    validRows>=a.h*.86&&total>=a.area*.80;
  return {coverage,valid,validRows};
}
function alignedCanvas(generated,lockedBits,newBits,width,height,fit,makeCanvas,lockedMask){
  const target=fit.targetBox,source=fit.sourceBox;
  const scaleX=generated.width/width,scaleY=generated.height/height;
  const out=makeCanvas(generated.width,generated.height),ctx=out.getContext('2d');
  ctx.drawImage(generated,0,0);
  if(fit.iou>=.965)return out;
  const profileA=contourProfile(lockedBits,width,target),profileB=contourProfile(newBits,width,source);
  const warp=makeCanvas(out.width,out.height),c=warp.getContext('2d');
  c.imageSmoothingEnabled=true;
  const first=Math.max(0,Math.floor(target.y*scaleY));
  const last=Math.min(out.height,Math.ceil((target.y+target.h)*scaleY));
  const verticalStretch=source.h/target.h;
  for(let y=first;y<last;y++){
    const t=((y+.5)/scaleY-target.y)/target.h;
    const map=contourMapping(profileA,profileB,fit,t);
    if(!map)continue;
    const sourceX=map.leftB*scaleX,sourceY=map.sourceY*scaleY;
    const sourceWidth=(map.rightB-map.leftB)*scaleX;
    const sourceHeight=Math.max(.7,Math.min(2.5,verticalStretch));
    const destX=map.leftA*scaleX,destWidth=(map.rightA-map.leftA)*scaleX;
    if(sourceX<0||sourceY<0||sourceX+sourceWidth>out.width+1||
      sourceY+sourceHeight>out.height+1)continue;
    c.drawImage(generated,sourceX,sourceY,sourceWidth,sourceHeight,destX,y,destWidth,1.1);
  }
  // Use full-resolution Mask A for final registration compositing; resampled
  // low-resolution masks would introduce stair-step fringes at wall/door edges.
  c.globalCompositeOperation='destination-in';c.drawImage(lockedMask,0,0);
  c.globalCompositeOperation='source-over';
  ctx.drawImage(warp,0,0);
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
  let method=candidate?'supplied-generated-mask':'generated-rgb-segmentation';
  if(!candidate&&allowDifference){
    const sample=image=>{const temp=makeCanvas(w,h);temp.getContext('2d').drawImage(image,0,0,w,h);
      return temp.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;};
    const beforePixels=sample(before),afterPixels=sample(generated);
    // Material mode ALWAYS estimates a new Mask B from generated RGB first.
    // The old mask is only a training prior, never the returned segmentation.
    const segmented=segmentGeneratedMaterial({before:beforePixels,after:afterPixels,target,width:w,height:h});
    if(segmented)candidate=segmented.mask;
    else{
      // A pixel difference cannot distinguish an old silhouette from a new
      // shifted one. Only use it as a last-resort correspondence when it
      // almost perfectly overlaps A; otherwise skip warp.
      method='difference-fallback';
      candidate=differenceSilhouette(beforePixels,afterPixels,target,w,h);
      if(candidate){
        const fallback=registerBinaryMasks(target,candidate,w,h,{minIou:.90,maxSizeChange:.08});
        if(!fallback.approved)candidate=null;
      }
    }
  }
  if(!candidate)return {image:generated,status:'locked-mask-no-confident-b',aligned:false,
    segmentation:method};
  const fit=registerBinaryMasks(target,candidate,w,h);
  if(!fit.approved)return {image:generated,status:'locked-mask-unsafe-warp',aligned:false,
    segmentation:method,iou:fit.iou,reason:fit.reason};
  if(fit.iou<.965){
    const verification=measureContourWarpCoverage(target,candidate,w,h,fit);
    if(!verification.valid)return {image:generated,status:'locked-mask-unreliable-contour',
      aligned:false,segmentation:method,iou:fit.iou,coverage:verification.coverage};
  }
  return {image:alignedCanvas(generated,target,candidate,w,h,fit,makeCanvas,lockedMask),
    status:fit.iou<.965?'mask-b-contour-warped-to-a':'mask-b-already-aligned',
    aligned:fit.iou<.965,segmentation:method,iou:fit.iou};
}
