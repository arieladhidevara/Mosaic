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


// The mask defines pixel ownership; image lines define optional perspective correction.
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
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const normalDistance=(line,p)=>line.nx*p.x+line.ny*p.y-line.rho;

// Long continuous image edges guide alignment. Grain, short contour details,
// and a newly segmented silhouette never become deformation control points.
export function structuralLines(rgba,mask,width,height){
  if(rgba.length!==width*height*4||mask.length!==width*height)throw new TypeError('Image dimensions differ.');
  const box=measureBinaryMask(mask,width,height);if(!box||Math.min(box.w,box.h)<20)return [];
  const reach=Math.ceil(Math.max(2,Math.min(7,Math.min(box.w,box.h)*.04)))+3,stride=width+1;
  const integral=new Uint32Array(stride*(height+1));
  for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){sum+=mask[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum}}
  const gray=new Float32Array(width*height),blur=new Float32Array(gray.length),kernel=[1,4,6,4,1];
  for(let i=0;i<gray.length;i++)gray[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    let sum=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)sum+=gray[(y+dy)*width+x+dx]*kernel[dy+2]*kernel[dx+2];
    blur[y*width+x]=sum/256;
  }
  const magnitudes=new Float32Array(gray.length),gradX=new Float32Array(gray.length),gradY=new Float32Array(gray.length);
  for(let y=3;y<height-3;y++)for(let x=3;x<width-3;x++){
    const i=y*width+x;gradX[i]=(blur[i+1]-blur[i-1])/2;gradY[i]=(blur[i+width]-blur[i-width])/2;
    magnitudes[i]=Math.hypot(gradX[i],gradY[i]);
  }
  const points=[],bins=180,radius=Math.ceil(Math.hypot(width,height)),rhoBins=radius*2+1;
  const votes=new Float32Array(bins*rhoBins),angles=Array.from({length:bins},(_,i)=>({x:Math.cos(i*Math.PI/bins),y:Math.sin(i*Math.PI/bins)}));
  for(let y=Math.max(3,box.y-reach);y<Math.min(height-3,box.y+box.h+reach);y++)for(let x=Math.max(3,box.x-reach);x<Math.min(width-3,box.x+box.w+reach);x++){
    const i=y*width+x;
    const x0=Math.max(0,x-reach),x1=Math.min(width,x+reach+1),y0=Math.max(0,y-reach),y1=Math.min(height,y+reach+1);
    if(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0]===0)continue;
    const gx=gradX[i],gy=gradY[i],magnitude=magnitudes[i];
    if(magnitude<8)continue;
    const step=Math.abs(gx)>Math.abs(gy)?1:width;
    if(magnitude<magnitudes[i-step]||magnitude<=magnitudes[i+step])continue;
    const point={x:x+.5,y:y+.5,gx:gx/magnitude,gy:gy/magnitude,weight:Math.min(3,magnitude/10)};
    points.push(point);
    const angle=(Math.atan2(gy,gx)+Math.PI)%Math.PI,center=Math.round(angle/Math.PI*bins);
    for(let offset=-3;offset<=3;offset++){
      const a=(center+offset+bins)%bins,n=angles[a],rho=Math.round(point.x*n.x+point.y*n.y)+radius;
      votes[a*rhoBins+rho]+=point.weight;
    }
  }
  const minLength=Math.max(24,Math.min(box.w,box.h)*.40),lines=[];
  for(let attempt=0;attempt<28&&lines.length<12;attempt++){
    let peak=-1,value=0;for(let i=0;i<votes.length;i++)if(votes[i]>value){peak=i;value=votes[i]}
    if(peak<0||value<minLength*.65)break;
    const a=Math.floor(peak/rhoBins),rho=peak%rhoBins-radius,n=angles[a];
    // Suppress thick-edge duplicate peaks, including the 0/pi wrap.
    for(let da=-4;da<=4;da++){
      const raw=a+da,aa=(raw+bins)%bins,rr=raw<0||raw>=bins?-rho:rho;
      for(let dr=-4;dr<=4;dr++)if(rr+dr+radius>=0&&rr+dr+radius<rhoBins)votes[aa*rhoBins+rr+dr+radius]=0;
    }
    // The vote is quantized; collect the thin edge across that angular error,
    // then fit its actual direction instead of keeping the Hough bin angle.
    const nearby=points.filter(p=>Math.abs(p.x*n.x+p.y*n.y-rho)<2.8&&Math.abs(p.gx*n.x+p.gy*n.y)>.97);
    if(nearby.length<minLength*.6)continue;
    nearby.sort((p,q)=>(-n.y*p.x+n.x*p.y)-(-n.y*q.x+n.x*q.y));
    let start=0,best=[];
    for(let i=1;i<=nearby.length;i++)if(i===nearby.length||(-n.y*nearby[i].x+n.x*nearby[i].y)-(-n.y*nearby[i-1].x+n.x*nearby[i-1].y)>4){
      if(i-start>best.length)best=nearby.slice(start,i);start=i;
    }
    if(best.length<minLength*.6)continue;
    // Fit a single straight line to the continuous run.
    const mean=best.reduce((s,p)=>({x:s.x+p.x/best.length,y:s.y+p.y/best.length}),{x:0,y:0});
    let xx=0,xy=0,yy=0;for(const p of best){const dx=p.x-mean.x,dy=p.y-mean.y;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy}
    const angle=.5*Math.atan2(2*xy,xx-yy),t={x:Math.cos(angle),y:Math.sin(angle)};
    let nx=-t.y,ny=t.x;if(nx*n.x+ny*n.y<0){nx=-nx;ny=-ny}
    const fittedRho=nx*mean.x+ny*mean.y,positions=best.map(p=>dot(t,p)),lo=Math.min(...positions),hi=Math.max(...positions);
    const occupied=new Set(positions.map(v=>Math.round(v/2))),length=hi-lo;
    if(length<minLength||occupied.size/(length/2)<.72)continue;
    if(lines.some(l=>Math.abs(l.nx*nx+l.ny*ny)>.997&&Math.max(Math.abs(normalDistance(l,mean)),Math.abs(normalDistance({nx,ny,rho:fittedRho},l.p)))<4))continue;
    lines.push({nx,ny,rho:fittedRho,p:{x:t.x*lo+nx*fittedRho,y:t.y*lo+ny*fittedRho},q:{x:t.x*hi+nx*fittedRho,y:t.y*hi+ny*fittedRho},length});
  }
  return lines.sort((a,b)=>b.length-a.length);
}
function matchLines(target,source,box){
  const distanceLimit=Math.max(2,Math.min(7,Math.min(box.w,box.h)*.04)),proposals=[];
  for(const line of target){
    const candidates=source.map((other,index)=>{
      if(Math.abs(line.nx*other.nx+line.ny*other.ny)<Math.cos(3*Math.PI/180))return null;
      const d=Math.max(Math.abs(normalDistance(other,line.p)),Math.abs(normalDistance(other,line.q)));
      if(d>distanceLimit)return null;
      const tangent={x:-line.ny,y:line.nx},span=[dot(tangent,line.p),dot(tangent,line.q)].sort((a,b)=>a-b),otherSpan=[dot(tangent,other.p),dot(tangent,other.q)].sort((a,b)=>a-b);
      const overlap=Math.max(0,Math.min(span[1],otherSpan[1])-Math.max(span[0],otherSpan[0]));
      if(overlap<line.length*.70||overlap<other.length*.65)return null;
      return {target:line,source:other,index,score:d+(1-overlap/Math.max(line.length,other.length))};
    }).filter(Boolean).sort((a,b)=>a.score-b.score);
    // Repeated tiles/wood slats often have equally plausible matches.
    if(!candidates.length||candidates[1]&&candidates[1].score-candidates[0].score<1.25)continue;
    proposals.push(candidates[0]);
  }
  const used=new Set();return proposals.sort((a,b)=>a.score-b.score).filter(pair=>{if(used.has(pair.index))return false;used.add(pair.index);return true}).slice(0,8);
}
function solve(rows,values){
  const n=8,m=Array.from({length:n},()=>new Float64Array(n+1));
  for(let k=0;k<rows.length;k++)for(let i=0;i<n;i++){
    for(let j=0;j<n;j++)m[i][j]+=rows[k][i]*rows[k][j];m[i][n]+=rows[k][i]*values[k];
  }
  for(let i=0;i<n;i++){
    let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;
    if(Math.abs(m[pivot][i])<1e-8)return null;
    [m[i],m[pivot]]=[m[pivot],m[i]];const divisor=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=divisor;
    for(let j=0;j<n;j++)if(j!==i){const factor=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=factor*m[i][k]}
  }
  return [...m.map(row=>row[n]),1];
}
export function projectPoint(matrix,point,frame){
  const x=(point.x-frame.x)/frame.scale,y=(point.y-frame.y)/frame.scale,d=matrix[6]*x+matrix[7]*y+1;
  return {x:frame.x+frame.scale*(matrix[0]*x+matrix[1]*y+matrix[2])/d,y:frame.y+frame.scale*(matrix[3]*x+matrix[4]*y+matrix[5])/d};
}
// One target->source homography, constrained only by long matched lines.
export function fitPerspectiveLines(pairs,box){
  const reject=reason=>({approved:false,reason,matchedLines:pairs.length});
  if(pairs.length<4)return reject('insufficient-structural-lines');
  const frame={x:box.x+box.w/2,y:box.y+box.h/2,scale:Math.max(box.w,box.h)},rows=[],values=[];
  for(const {target,source} of pairs){
    const a=source.nx,b=source.ny,r=(source.rho-a*frame.x-b*frame.y)/frame.scale;
    for(const p of [target.p,target.q]){
      const x=(p.x-frame.x)/frame.scale,y=(p.y-frame.y)/frame.scale;
      rows.push([a*x,a*y,a,b*x,b*y,b,-r*x,-r*y]);values.push(r);
    }
  }
  const matrix=solve(rows,values);if(!matrix||matrix.some(v=>!Number.isFinite(v)))return reject('ambiguous-structural-lines');
  const endpoints=pairs.flatMap(pair=>[pair.target.p,pair.target.q]);
  if(Math.max(...endpoints.map(p=>p.x))-Math.min(...endpoints.map(p=>p.x))<box.w*.55||
    Math.max(...endpoints.map(p=>p.y))-Math.min(...endpoints.map(p=>p.y))<box.h*.55)return reject('localized-structural-lines');
  let initial=0,residual=0,worst=0;
  for(const {target,source} of pairs)for(const p of [target.p,target.q]){
    initial+=normalDistance(source,p)**2;
    const error=Math.abs(normalDistance(source,projectPoint(matrix,p,frame)));residual+=error**2;worst=Math.max(worst,error);
  }
  initial=Math.sqrt(initial/(pairs.length*2));residual=Math.sqrt(residual/(pairs.length*2));
  if(initial<.65)return reject('structural-lines-already-aligned');
  if(residual>.7||worst>1.2||residual>initial*.55)return reject('inconsistent-structural-lines');
  const maxShift=Math.max(1.5,Math.min(6,Math.min(box.w,box.h)*.035));let displacement=0;
  // Check the whole plane, including corners with no anchor lines. Reject the
  // complete correction instead of pulling unconstrained corners into shape.
  for(const tx of [0,.5,1])for(const ty of [0,.5,1]){
    const p={x:box.x+tx*box.w,y:box.y+ty*box.h},q=projectPoint(matrix,p,frame);
    displacement=Math.max(displacement,Math.hypot(q.x-p.x,q.y-p.y));
    const px=projectPoint(matrix,{x:p.x+1,y:p.y},frame),py=projectPoint(matrix,{x:p.x,y:p.y+1},frame);
    const dx={x:px.x-q.x,y:px.y-q.y},dy={x:py.x-q.x,y:py.y-q.y},sx=Math.hypot(dx.x,dx.y),sy=Math.hypot(dy.x,dy.y);
    if(!Number.isFinite(displacement)||displacement>maxShift||sx<.94||sx>1.06||sy<.94||sy>1.06||
      Math.abs(dot(dx,dy)/(sx*sy))>.04||dx.x*dy.y-dx.y*dy.x<=0||Math.abs(Math.atan2(dx.y,dx.x))>Math.PI/60)
      return reject('perspective-correction-too-large');
  }
  return {approved:true,matrix,frame,matchedLines:pairs.length,residual,displacement};
}
export function estimatePerspective({before,after,mask,width,height}){
  const box=measureBinaryMask(mask,width,height);if(!box)return {approved:false,reason:'empty-mask'};
  const lines=structuralLines(before,mask,width,height);
  if(lines.length<4)return {approved:false,reason:'insufficient-structural-lines',matchedLines:0};
  return fitPerspectiveLines(matchLines(lines,structuralLines(after,mask,width,height),box),box);
}
// Inverse projective sampling preserves straight lines. No per-row warp,
// mesh vertices, boundary stretch, or alpha changes are introduced here.
export function perspectivePixels(rgba,mask,width,height,fit,sampleWidth=width,sampleHeight=height){
  if(rgba.length!==width*height*4||mask.length!==width*height)throw new TypeError('Image dimensions differ.');
  const output=new Uint8ClampedArray(rgba),sx=sampleWidth/width,sy=sampleHeight/height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!mask[i])continue;
    const p=projectPoint(fit.matrix,{x:(x+.5)*sx,y:(y+.5)*sy},fit.frame),xx=p.x/sx-.5,yy=p.y/sy-.5;
    if(xx<0||yy<0||xx>width-1||yy>height-1)return null;
    const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=xx-x0,fy=yy-y0;
    const indices=[(y0*width+x0)*4,(y0*width+x1)*4,(y1*width+x0)*4,(y1*width+x1)*4];
    const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
    let alpha=0;for(let k=0;k<4;k++)alpha+=rgba[indices[k]+3]*weights[k];
    if(alpha<254)return null;
    for(let c=0;c<3;c++){let value=0;for(let k=0;k<4;k++)value+=rgba[indices[k]+c]*weights[k];output[i*4+c]=value}
  }
  return output;
}
export function alignGeneratedToLockedMask({before,generated,lockedMask,makeCanvas,maxDimension=320}){
  if(!before||!generated||!lockedMask||!makeCanvas)return {image:generated,status:'unavailable',aligned:false};
  const fullW=generated.width,fullH=generated.height,scale=Math.min(1,maxDimension/Math.max(fullW,fullH));
  const width=Math.max(4,Math.round(fullW*scale)),height=Math.max(4,Math.round(fullH*scale));
  const sample=(image,w=width,h=height)=>{
    const frame=makeCanvas(w,h),x=frame.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,w,h);
    return x.getImageData(0,0,w,h);
  };
  const bits=(data,threshold=128)=>Uint8Array.from({length:data.length/4},(_,i)=>data[i*4+3]>=threshold?1:0);
  const fit=estimatePerspective({before:sample(before).data,after:sample(generated).data,mask:bits(sample(lockedMask).data),width,height});
  const details={segmentation:'structural-lines',matchedLines:fit.matchedLines||0,reason:fit.reason||null};
  if(!fit.approved)return {image:generated,status:'locked-mask-'+fit.reason,aligned:false,...details};
  const data=sample(generated,fullW,fullH),mask=bits(sample(lockedMask,fullW,fullH).data,1);
  const pixels=perspectivePixels(data.data,mask,fullW,fullH,fit,width,height);
  if(!pixels)return {image:generated,status:'locked-mask-missing-perspective-pixels',aligned:false,...details};
  data.data.set(pixels);const output=makeCanvas(fullW,fullH);output.getContext('2d').putImageData(data,0,0);
  return {image:output,status:'structural-perspective-aligned',aligned:true,...details};
}
