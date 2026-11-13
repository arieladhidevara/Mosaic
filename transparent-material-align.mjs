/* Align a transparent AI material layer to immutable original object geometry.
 * A single RGBA output supplies both the new appearance and a provisional mask.
 * Geometry is read from the approved mask only; the AI alpha is never saved as
 * the new object silhouette. No segmentation provider is called.
 */
import {estimatePerspective,projectPoint} from './geometry-mask.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const index=(x,y,width)=>y*width+x;
const alphaBits=rgba=>Uint8Array.from({length:rgba.length/4},(_,i)=>rgba[i*4+3]>=128?1:0);

function bounds(mask,width,height){
  let x0=width,y0=height,x1=-1,y1=-1,count=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(mask[index(x,y,width)]){
    x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);count++;
  }
  return count?{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,count}:null;
}
function binaryFrame(mask){
  const out=new Uint8ClampedArray(mask.length*4);
  for(let i=0;i<mask.length;i++){const v=mask[i]*255,j=i*4;out[j]=out[j+1]=out[j+2]=v;out[j+3]=255}
  return out;
}
function boundaries(mask,width,height){
  const edge=new Uint8Array(mask.length),nx=new Float32Array(mask.length),ny=new Float32Array(mask.length);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=index(x,y,width),v=mask[i],left=mask[i-1],right=mask[i+1],up=mask[i-width],down=mask[i+width];
    if(v===left&&v===right&&v===up&&v===down)continue;
    let gx=right-left,gy=down-up;
    if(!gx&&!gy){gx=v-left;gy=v-up}
    const length=Math.hypot(gx,gy);
    if(!length)continue;
    edge[i]=1;nx[i]=gx/length;ny[i]=gy/length;
  }
  return {edge,nx,ny};
}
function score(target,source,width,height,box,map){
  let matched=0,compared=0;
  for(let y=box.y;y<box.y+box.h;y+=2)for(let x=box.x;x<box.x+box.w;x+=2){
    if(!target[index(x,y,width)])continue;
    compared++;
    const p=map(x,y),xx=Math.round(p.x),yy=Math.round(p.y);
    if(xx>=0&&yy>=0&&xx<width&&yy<height&&source[index(xx,yy,width)])matched++;
  }
  return matched/Math.max(1,compared);
}
function countRuns(mask,width,y,x0,x1,map){
  let count=0,previous=0;
  for(let x=x0;x<x1;x++){
    const p=map?map(x,y):{x,y},xx=Math.round(p.x),yy=Math.round(p.y);
    const current=xx>=0&&yy>=0&&xx<width&&yy<mask.length/width?mask[index(xx,yy,width)]:0;
    if(current&&!previous)count++;
    previous=current;
  }
  return count;
}
function topology(target,source,width,height,box,map){
  let compared=0,matching=0;
  const stride=Math.max(2,Math.floor(box.h/22));
  for(let y=box.y+2;y<box.y+box.h-2;y+=stride){
    const n=countRuns(target,width,y,box.x,box.x+box.w);
    if(n<2)continue;
    compared++;
    const m=countRuns(source,width,y,box.x,box.x+box.w,map);
    if(m===n)matching++;
  }
  return {compared,matching,ratio:compared?matching/compared:1};
}
const identity=(x,y)=>({x,y});

/** Pure fitting routine; samples need to be the same coordinate space. */
export function fitTransparentMasks({target,source,width,height}){
  if(!width||!height||target.length!==width*height||source.length!==target.length)
    throw new TypeError('Alpha mask dimensions differ');
  const box=bounds(target,width,height),sourceBox=bounds(source,width,height);
  const reject=reason=>({approved:false,reason,matchedPoints:0});
  if(!box||box.count<64||!sourceBox)return reject('empty-alpha-mask');
  if(sourceBox.count<box.count*.48||sourceBox.count>box.count*1.65)
    return reject('alpha-area-mismatch');
  const overlap=score(target,source,width,height,box,identity);
  if(overlap<.42)return reject('alpha-overlap-too-low');

  // First find a single conservative projective/translation registration.
  let base=identity,globalMethod='identity',best=overlap,shift={x:0,y:0},perspective=null;
  const radius=Math.min(8,Math.max(2,Math.round(Math.min(box.w,box.h)*.07)));
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    const current=score(target,source,width,height,box,(x,y)=>({x:x+dx,y:y+dy}));
    if(current>best+.002||Math.abs(current-best)<.002&&current>overlap+.008&&dx*dx+dy*dy<shift.x*shift.x+shift.y*shift.y){
      best=current;shift={x:dx,y:dy};globalMethod='translation';
    }
  }
  // Straight-line perspective is accepted only if it improves mask agreement.
  const candidate=estimatePerspective({before:binaryFrame(target),after:binaryFrame(source),mask:target,width,height});
  if(candidate.approved){
    const perspectiveMap=(x,y)=>projectPoint(candidate.matrix,{x,y},candidate.frame);
    const value=score(target,source,width,height,box,perspectiveMap);
    if(value>best+.008){best=value;base=perspectiveMap;perspective=candidate;globalMethod='perspective'}
  }
  if(!perspective)base=(x,y)=>({x:x+shift.x,y:y+shift.y});
  if(best<.68)return reject('alpha-boundaries-too-different');
  const shape=topology(target,source,width,height,box,base);
  if(shape.compared>=5&&shape.ratio<.72)return reject('opening-topology-mismatch');

  // Pair nearby boundaries with the same inward/outward orientation.
  // Different doors get independent local correspondences, not one big stretch.
  const a=boundaries(target,width,height),b=boundaries(source,width,height),anchors=[];
  const searchRadius=Math.min(10,Math.max(3,Math.ceil(Math.min(box.w,box.h)*.075)));
  let tested=0;
  for(let y=box.y+1;y<box.y+box.h-1;y++)for(let x=box.x+1;x<box.x+box.w-1;x++){
    const i=index(x,y,width);
    if(!a.edge[i]||(x+y)%3!==0)continue;
    tested++;
    const expected=base(x,y);let winner=null,smallest=Infinity;
    const cx=Math.round(expected.x),cy=Math.round(expected.y);
    for(let yy=Math.max(1,cy-searchRadius);yy<=Math.min(height-2,cy+searchRadius);yy++){
      for(let xx=Math.max(1,cx-searchRadius);xx<=Math.min(width-2,cx+searchRadius);xx++){
        const j=index(xx,yy,width);
        if(!b.edge[j])continue;
        const dot=a.nx[i]*b.nx[j]+a.ny[i]*b.ny[j];
        if(dot<.65)continue;
        const dist=(xx-expected.x)**2+(yy-expected.y)**2+Math.max(0,1-dot)*9;
        if(dist<smallest){smallest=dist;winner={x:xx,y:yy}}
      }
    }
    if(winner)anchors.push({x,y,dx:winner.x-expected.x,dy:winner.y-expected.y});
  }
  if(tested>=20&&anchors.length/tested<.38&&best<.96)
    return reject('unmatched-alpha-boundaries');

  const step=12,nx=Math.ceil(width/step)+1,ny=Math.ceil(height/step)+1;
  const gridX=new Float32Array(nx*ny),gridY=new Float32Array(nx*ny);
  const influence=Math.max(14,Math.min(36,Math.min(box.w,box.h)*.24)),influence2=influence*influence;
  for(let gy=0;gy<ny;gy++)for(let gx=0;gx<nx;gx++){
    const x=gx*step,y=gy*step;
    let wx=0,wy=0,total=0;
    for(const anchor of anchors){
      const d2=(x-anchor.x)**2+(y-anchor.y)**2;
      if(d2>=influence2)continue;
      const fade=1-d2/influence2,w=fade*fade/(9+d2);
      wx+=anchor.dx*w;wy+=anchor.dy*w;total+=w;
    }
    const i=gy*nx+gx;
    if(total){gridX[i]=clamp(wx/total,-searchRadius,searchRadius);gridY[i]=clamp(wy/total,-searchRadius,searchRadius)}
  }
  return {approved:true,box,globalMethod,shift,perspective,base,gridX,gridY,nx,ny,step,width,height,
    matchedPoints:anchors.length,baseline:overlap,globalCoverage:best,openingAgreement:shape.ratio};
}

export function mapTransparentPoint(fit,x,y){
  const b=fit.base(x,y),gx=clamp(x/fit.step,0,fit.nx-1),gy=clamp(y/fit.step,0,fit.ny-1);
  const x0=Math.min(fit.nx-1,Math.floor(gx)),y0=Math.min(fit.ny-1,Math.floor(gy));
  const x1=Math.min(fit.nx-1,x0+1),y1=Math.min(fit.ny-1,y0+1),fx=gx-x0,fy=gy-y0;
  const interpolate=values=>{
    const a=values[index(x0,y0,fit.nx)],c=values[index(x1,y0,fit.nx)];
    const d=values[index(x0,y1,fit.nx)],e=values[index(x1,y1,fit.nx)];
    return (a*(1-fx)+c*fx)*(1-fy)+(d*(1-fx)+e*fx)*fy;
  };
  return {x:b.x+interpolate(fit.gridX),y:b.y+interpolate(fit.gridY)};
}

function sampleOpaque(rgba,width,height,x,y){
  const candidates=[],x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
    const xx=x0+dx,yy=y0+dy;
    if(xx<0||yy<0||xx>=width||yy>=height)continue;
    const j=index(xx,yy,width)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy)*rgba[j+3]/255;
    if(weight>0)candidates.push({j,weight});
  }
  let sum=0,r=0,g=0,b=0;
  for(const item of candidates){sum+=item.weight;r+=rgba[item.j]*item.weight;g+=rgba[item.j+1]*item.weight;b+=rgba[item.j+2]*item.weight}
  // The PNG edge often contains valid antialiased/partially transparent RGB.
  // Renormalize its premultiplied contribution instead of demanding 82% alpha
  // and turning a usable material edge into an empty hole.
  if(sum>=.22)return [r/sum,g/sum,b/sum];
  // Only recover a narrow antialiased gap. Never extrapolate across a door.
  let winner=null,distance=Infinity;
  for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
    const xx=Math.round(x)+dx,yy=Math.round(y)+dy;
    if(xx<0||yy<0||xx>=width||yy>=height)continue;
    const j=index(xx,yy,width)*4;
    if(rgba[j+3]<112)continue;
    const d=dx*dx+dy*dy;
    if(d<distance){distance=d;winner=j}
  }
  return winner===null?null:[rgba[winner],rgba[winner+1],rgba[winner+2]];
}

/** Fill only narrow missing strips *within* the immutable approved mask.
 * Multi-source shortest-path propagation never enters an excluded door/hole,
 * and its distance cap prevents a missing wall/object from being fabricated.
 * This is a local RGB repair, not an alpha mask expansion.
 */
export function repairLockedMaskGaps({rgba,targetRGBA,width,height,maxDistance=0}){
  const totalPixels=width*height;
  if(rgba.length!==totalPixels*4||targetRGBA.length!==rgba.length)
    throw new TypeError('Locked-mask repair dimensions differ');
  const limit=Math.max(1,Math.min(48,Math.round(maxDistance||Math.min(36,Math.max(8,Math.min(width,height)*.018)))));
  const steps=new Uint8Array(totalPixels),queue=new Uint32Array(totalPixels);
  let head=0,tail=0,targetCount=0,initialFilled=0;
  for(let i=0;i<totalPixels;i++){
    const j=i*4;
    if(targetRGBA[j+3]<8)continue;
    targetCount++;
    if(rgba[j+3]>=8){steps[i]=1;queue[tail++]=i;initialFilled++}
  }
  // Do not turn mostly empty or incorrect cutouts into copied color patches.
  const initialCoverage=initialFilled/Math.max(1,targetCount);
  if(initialCoverage<.80)return {rgba:null,coverage:initialCoverage,initialCoverage,repairedPixels:0};
  let repairedPixels=0;
  while(head<tail){
    const i=queue[head++],distance=steps[i]-1;
    if(distance>=limit)continue;
    const x=i%width,y=Math.floor(i/width),sourceIndex=i*4;
    const copyTo=n=>{
      if(steps[n]||targetRGBA[n*4+3]<8)return;
      steps[n]=steps[i]+1;
      const k=n*4;
      rgba[k]=rgba[sourceIndex];rgba[k+1]=rgba[sourceIndex+1];
      rgba[k+2]=rgba[sourceIndex+2];rgba[k+3]=targetRGBA[k+3];
      queue[tail++]=n;repairedPixels++;
    };
    if(x>0)copyTo(i-1);
    if(x+1<width)copyTo(i+1);
    if(y>0)copyTo(i-width);
    if(y+1<height)copyTo(i+width);
  }
  const coverage=(initialFilled+repairedPixels)/Math.max(1,targetCount);
  // Filling more than 16% is no longer a small geometric correction.
  if(coverage<.995||repairedPixels/Math.max(1,targetCount)>.16)
    return {rgba:null,coverage,initialCoverage,repairedPixels};
  return {rgba,coverage,initialCoverage,repairedPixels};
}

export function warpTransparentPixels({sourceRGBA,targetRGBA,width,height,fit}){
  if(!fit?.approved||sourceRGBA.length!==width*height*4||targetRGBA.length!==sourceRGBA.length)
    throw new TypeError('Invalid transparent warp inputs');
  const output=new Uint8ClampedArray(sourceRGBA.length);
  const target=bounds(alphaBits(targetRGBA),width,height);
  if(!target)return {rgba:output,coverage:0};
  const sx=fit.width/width,sy=fit.height/height;
  let total=0,filled=0;
  for(let y=target.y;y<target.y+target.h;y++)for(let x=target.x;x<target.x+target.w;x++){
    const j=index(x,y,width)*4;
    if(targetRGBA[j+3]<8)continue;
    total++;
    const p=mapTransparentPoint(fit,(x+.5)*sx-.5,(y+.5)*sy-.5);
    const rgb=sampleOpaque(sourceRGBA,width,height,(p.x+.5)/sx-.5,(p.y+.5)/sy-.5);
    if(!rgb)continue;
    filled++;output[j]=rgb[0];output[j+1]=rgb[1];output[j+2]=rgb[2];
    output[j+3]=targetRGBA[j+3];
  }
  const initialCoverage=filled/Math.max(1,total);
  if(initialCoverage>=.9999)return {rgba:output,coverage:initialCoverage,initialCoverage,repairedPixels:0};
  // A transparent image can miss a thin anti-aliased rim around an otherwise
  // accurately matched floor, wall or opening. Repair those local strips rather
  // than rejecting an already-paid AI generation at 97% coverage.
  return repairLockedMaskGaps({rgba:output,targetRGBA,width,height});
}

/** Browser adapter; source is the transparent layer placed at full-canvas coordinates. */
export function alignTransparentLayerToLockedMask({generated,lockedMask,makeCanvas,maxDimension=512}){
  if(!generated||!lockedMask||!makeCanvas||generated.width!==lockedMask.width||generated.height!==lockedMask.height)
    return {image:null,aligned:false,status:'alpha-dimensions-mismatch'};
  const width=generated.width,height=generated.height,scale=Math.min(1,maxDimension/Math.max(width,height));
  const sampleW=Math.max(32,Math.round(width*scale)),sampleH=Math.max(32,Math.round(height*scale));
  const read=(frame,w,h)=>{
    const c=makeCanvas(w,h),x=c.getContext('2d',{willReadFrequently:true});
    x.drawImage(frame,0,0,w,h);
    return x.getImageData(0,0,w,h).data;
  };
  const targetSmall=alphaBits(read(lockedMask,sampleW,sampleH));
  const sourceSmall=alphaBits(read(generated,sampleW,sampleH));
  const fit=fitTransparentMasks({target:targetSmall,source:sourceSmall,width:sampleW,height:sampleH});
  if(!fit.approved)return {image:null,aligned:false,status:fit.reason};
  const warped=warpTransparentPixels({
    sourceRGBA:read(generated,width,height),targetRGBA:read(lockedMask,width,height),width,height,fit
  });
  if(!warped.rgba)return {image:null,aligned:false,status:'insufficient-alpha-coverage',coverage:warped.coverage};
  const output=makeCanvas(width,height),x=output.getContext('2d'),pixels=x.createImageData(width,height);
  pixels.data.set(warped.rgba);x.putImageData(pixels,0,0);
  return {image:output,aligned:true,status:warped.repairedPixels?'alpha-boundary-repaired':'alpha-boundary-aligned',
    coverage:warped.coverage,initialCoverage:warped.initialCoverage,
    repairedPixels:warped.repairedPixels,matchedPoints:fit.matchedPoints,
    globalMethod:fit.globalMethod,openingAgreement:fit.openingAgreement};
}
