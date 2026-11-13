/* mozAI Material Edit: corner-only best-effort transparent PNG alignment.
 * Original object mask remains immutable; the generated alpha is temporary.
 * No fit/coverage threshold may reject a provider image that was decoded.
 */
import {alignGeneratedToLockedMask} from './geometry-mask.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const index=(x,y,w)=>y*w+x;
export function alphaBits(rgba,threshold=96){
  const bits=new Uint8Array(rgba.length/4);
  for(let i=0;i<bits.length;i++)bits[i]=rgba[i*4+3]>=threshold?1:0;
  return bits;
}
function bounds(bits,w,h){
  let l=w,t=h,r=-1,b=-1,n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(bits[index(x,y,w)]){
    l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);n++;
  }
  return n?{x:l,y:t,w:r-l+1,h:b-t+1,count:n}:null;
}
function signature(bits,w,h,x,y,r){
  const dirs=[[-1,-1],[1,-1],[1,1],[-1,1]];
  let s=0;
  for(let k=0;k<4;k++){
    const px=x+dirs[k][0]*r,py=y+dirs[k][1]*r;
    if(px>=0&&py>=0&&px<w&&py<h&&bits[index(px,py,w)])s|=(1<<k);
  }
  return s;
}
const pop4=n=>((n&1)>0)+((n&2)>0)+((n&4)>0)+((n&8)>0);
/** Find only true silhouette corners: one or three occupied quadrants
 * (convex outer corners and concave door/window opening corners).
 * Points along straight boundaries have two occupied quadrants: excluded.
 */
export function extractAlphaCorners(bits,w,h,maxPoints=64){
  if(bits.length!==w*h)throw new TypeError('Alpha geometry size mismatch');
  const b=bounds(bits,w,h);if(!b||b.count<32)return [];
  const r=Math.max(3,Math.round(Math.min(b.w,b.h)*.018));
  const radius=Math.max(5,r*2);
  const candidates=[];
  const startX=Math.max(r+1,b.x-r-1),endX=Math.min(w-r-2,b.x+b.w+r+1);
  const startY=Math.max(r+1,b.y-r-1),endY=Math.min(h-r-2,b.y+b.h+r+1);
  for(let y=startY;y<=endY;y++)for(let x=startX;x<=endX;x++){
    const s=signature(bits,w,h,x,y,r),n=pop4(s);
    if(n!==1&&n!==3)continue;
    const larger=signature(bits,w,h,x,y,Math.min(r*2,Math.max(4,Math.floor(radius*1.4))));
    if(larger!==s)continue;
    // Avoid interior points: require an alpha transition in a small cross.
    const d=Math.min(r,3),center=bits[index(x,y,w)];
    if(bits[index(x-d,y,w)]===center&&bits[index(x+d,y,w)]===center&&
       bits[index(x,y-d,w)]===center&&bits[index(x,y+d,w)]===center)continue;
    const score=(n===1||n===3?10:0)+
      Math.min(Math.abs(x-b.x),Math.abs(x-(b.x+b.w-1)))*.00001;
    candidates.push({x,y,signature:s,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const picked=[];
  for(const pt of candidates){
    if(picked.some(p=>(p.x-pt.x)**2+(p.y-pt.y)**2<radius*radius))continue;
    picked.push(pt);
    if(picked.length>=maxPoints)break;
  }
  return picked.sort((a,b)=>a.y-b.y||a.x-b.x);
}
function matchCorners(target,source,sourceBox,targetBox){
  const sx=sourceBox.w/targetBox.w,sy=sourceBox.h/targetBox.h;
  const radius=clamp(Math.max(targetBox.w,targetBox.h)*.13,8,42);
  const pairs=[];
  for(let i=0;i<target.length;i++)for(let j=0;j<source.length;j++){
    const a=target[i],b=source[j];
    if(a.signature!==b.signature)continue;
    const px=sourceBox.x+(a.x-targetBox.x)*sx,py=sourceBox.y+(a.y-targetBox.y)*sy;
    const d=Math.hypot(b.x-px,b.y-py);
    if(d>radius)continue;
    // Penalize very large shifts and extreme size mismatch, not alpha coverage.
    pairs.push({i,j,d});
  }
  pairs.sort((a,b)=>a.d-b.d);
  const usedA=new Set(),usedB=new Set(),result=[];
  for(const p of pairs){
    if(usedA.has(p.i)||usedB.has(p.j))continue;
    usedA.add(p.i);usedB.add(p.j);
    result.push({target:{x:target[p.i].x,y:target[p.i].y},
      source:{x:source[p.j].x,y:source[p.j].y},distance:p.d});
  }
  return result;
}
const area=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function circle(a,b,c){
  const d=2*area(a,b,c);if(Math.abs(d)<1e-7)return null;
  const A=a.x*a.x+a.y*a.y,B=b.x*b.x+b.y*b.y,C=c.x*c.x+c.y*c.y;
  const x=(A*(b.y-c.y)+B*(c.y-a.y)+C*(a.y-b.y))/d;
  const y=(A*(c.x-b.x)+B*(a.x-c.x)+C*(b.x-a.x))/d;
  return {x,y,r2:(x-a.x)**2+(y-a.y)**2};
}
/** Delaunay mesh vertices consist of corners only, plus 4 fixed frame anchors.
 * Never builds per-row/per-boundary soft control points.
 */
export function triangulate(points){
  if(points.length<3)return [];
  const n=points.length,range=Math.max(100,Math.max(...points.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y))))*10);
  const all=[...points,{x:-range,y:-range},{x:range*3,y:-range},{x:0,y:range*3}];
  let triangles=[[n,n+1,n+2]];
  for(let k=0;k<n;k++){
    const border=new Map(),kept=[];
    for(const tri of triangles){
      const c=circle(...tri.map(i=>all[i]));
      if(!c||(all[k].x-c.x)**2+(all[k].y-c.y)**2>c.r2+1e-5){kept.push(tri);continue}
      for(const [i,j] of [[tri[0],tri[1]],[tri[1],tri[2]],[tri[2],tri[0]]]){
        const key=i<j?i+':'+j:j+':'+i,edge=border.get(key);
        if(edge)edge.count++;else border.set(key,{i,j,count:1});
      }
    }
    triangles=kept;
    for(const edge of border.values())if(edge.count===1)triangles.push([edge.i,edge.j,k]);
  }
  return triangles.filter(t=>t.every(i=>i<n)&&Math.abs(area(...t.map(i=>all[i])))>1e-6);
}
function barycentric(a,b,c,x,y){
  const denominator=area(a,b,c);if(Math.abs(denominator)<1e-7)return null;
  const u=((x-a.x)*(c.y-a.y)-(y-a.y)*(c.x-a.x))/denominator;
  const v=((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x))/denominator;
  return [1-u-v,u,v];
}
export function fitCornerMesh({target,source,width,height}){
  if(target.length!==width*height||source.length!==target.length)
    throw new TypeError('Mask dimensions differ');
  const bt=bounds(target,width,height),bs=bounds(source,width,height);
  if(!bt||!bs)return {approved:false,reason:'missing-alpha-silhouette',matchedCorners:0};
  const a=extractAlphaCorners(target,width,height),b=extractAlphaCorners(source,width,height);
  const matches=matchCorners(a,b,bs,bt);
  if(matches.length<4)return {approved:false,reason:'unpaired-corners',matchedCorners:matches.length};
  const xx=matches.map(p=>p.target.x),yy=matches.map(p=>p.target.y);
  if(Math.max(...xx)-Math.min(...xx)<bt.w*.35||
    Math.max(...yy)-Math.min(...yy)<bt.h*.28)
    return {approved:false,reason:'corners-in-one-local-area',matchedCorners:matches.length};
  const anchors=[...matches];
  // Preserve the frame and minimize displacement far from the edited object.
  for(const [x,y] of [[0,0],[width-1,0],[width-1,height-1],[0,height-1]])
    if(!anchors.some(p=>Math.hypot(p.target.x-x,p.target.y-y)<2))
      anchors.push({target:{x,y},source:{x,y}});
  const triangles=triangulate(anchors.map(a=>a.target));
  if(!triangles.length)return {approved:false,reason:'mesh-empty',matchedCorners:matches.length};
  for(const t of triangles){
    const aa=area(...t.map(i=>anchors[i].target)),bb=area(...t.map(i=>anchors[i].source));
    const ratio=bb/aa;
    if(ratio<.50||ratio>1.9)return {approved:false,reason:'folding-corners',matchedCorners:matches.length};
  }
  return {approved:true,width,height,matchedCorners:matches.length,anchors,triangles};
}
export function mapCornerPoint(fit,x,y){
  if(!fit?.approved)return {x,y};
  for(const t of fit.triangles){
    const [a,b,c]=t.map(i=>fit.anchors[i]),weights=barycentric(a.target,b.target,c.target,x,y);
    if(weights&&Math.min(...weights)>=-1e-5)return {
      x:weights[0]*a.source.x+weights[1]*b.source.x+weights[2]*c.source.x,
      y:weights[0]*a.source.y+weights[1]*b.source.y+weights[2]*c.source.y
    };
  }
  return {x,y};
}
function sampleColor(rgba,w,h,x,y){
  if(x<0||y<0||x>=w||y>=h)return null;
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=x-x0,fy=y-y0;let weight=0,r=0,g=0,b=0;
  for(const [xx,yy,p] of [[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]]){
    const i=index(xx,yy,w)*4,v=p*rgba[i+3]/255;
    weight+=v;r+=v*rgba[i];g+=v*rgba[i+1];b+=v*rgba[i+2];
  }
  if(weight>.12)return [r/weight,g/weight,b/weight];
  // Recover just narrow soft edges. Missing areas retain the earlier RGB.
  for(let rad=1;rad<=8;rad++)for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==rad)continue;
    const xx=Math.round(x)+dx,yy=Math.round(y)+dy;
    if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const j=index(xx,yy,w)*4;if(rgba[j+3]>=96)return [rgba[j],rgba[j+1],rgba[j+2]];
  }
  return null;
}
/** RGB only. Outside original mask the approved underlay is bit-identical. */
export function warpMaterialRGBA({sourceRGBA,underlayRGBA,maskRGBA,width,height,fit=null}){
  const count=width*height;
  if(sourceRGBA.length!==count*4||underlayRGBA.length!==sourceRGBA.length||maskRGBA.length!==sourceRGBA.length)
    throw new TypeError('Invalid material warp dimensions');
  const output=new Uint8ClampedArray(underlayRGBA),visited=new Uint8Array(count);
  const sx=fit?.approved?fit.width/width:1,sy=fit?.approved?fit.height/height:1;
  let covered=0,filled=0;
  const copy=(x,y,px=x,py=y)=>{
    const idx=index(x,y,width),i=idx*4;
    if(maskRGBA[i+3]<8||visited[idx])return;
    visited[idx]=1;covered++;
    const rgb=sampleColor(sourceRGBA,width,height,px,py);
    if(!rgb)return;
    filled++;output[i]=rgb[0];output[i+1]=rgb[1];output[i+2]=rgb[2];
    // Use original underlay alpha, never the generated alpha as geometry.
  };
  if(fit?.approved){
    for(const tri of fit.triangles){
      const [a,b,c]=tri.map(i=>fit.anchors[i]);
      const xx=[a.target.x,b.target.x,c.target.x],yy=[a.target.y,b.target.y,c.target.y];
      const x0=Math.max(0,Math.floor(Math.min(...xx)/sx)),x1=Math.min(width-1,Math.ceil(Math.max(...xx)/sx));
      const y0=Math.max(0,Math.floor(Math.min(...yy)/sy)),y1=Math.min(height-1,Math.ceil(Math.max(...yy)/sy));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const weights=barycentric(a.target,b.target,c.target,(x+.5)*sx-.5,(y+.5)*sy-.5);
        if(!weights||Math.min(...weights)<-1e-5)continue;
        const px=weights[0]*a.source.x+weights[1]*b.source.x+weights[2]*c.source.x;
        const py=weights[0]*a.source.y+weights[1]*b.source.y+weights[2]*c.source.y;
        copy(x,y,(px+.5)/sx-.5,(py+.5)/sy-.5);
      }
    }
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)copy(x,y);
  return {rgba:output,coverage:filled/Math.max(1,covered),filled,covered};
}
export function alignTransparentCornersBestEffort({before,generated,lockedMask,makeCanvas,maxDimension=448}){
  if(!before||!generated||!lockedMask||!makeCanvas||
     before.width!==generated.width||before.height!==generated.height||
     lockedMask.width!==generated.width||lockedMask.height!==generated.height)
    return {image:before||generated,aligned:false,method:'direct-clip',status:'invalid-input'};
  const w=before.width,h=before.height,scale=Math.min(1,maxDimension/Math.max(w,h));
  const sw=Math.max(20,Math.round(w*scale)),sh=Math.max(20,Math.round(h*scale));
  const read=(src,x,y)=>{const c=makeCanvas(x,y),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(src,0,0,x,y);return ctx.getImageData(0,0,x,y).data};
  const a=read(before,w,h),b=read(generated,w,h),m=read(lockedMask,w,h);
  let fit=null,method='direct-clip',corners=0;
  try{
    const candidate=fitCornerMesh({target:alphaBits(read(lockedMask,sw,sh)),
      source:alphaBits(read(generated,sw,sh)),width:sw,height:sh});
    corners=candidate.matchedCorners||0;
    if(candidate.approved){fit=candidate;method='corner-warp'}
  }catch(error){console.warn('[mozAI:corner-warp]',error)}
  let warped=warpMaterialRGBA({sourceRGBA:b,underlayRGBA:a,maskRGBA:m,width:w,height:h,fit});
  if(fit){
    const direct=warpMaterialRGBA({sourceRGBA:b,underlayRGBA:a,maskRGBA:m,width:w,height:h});
    if(warped.coverage<direct.coverage-.03){warped=direct;fit=null;method='direct-clip'}
  }
  if(!fit){
    try{
      const composite=makeCanvas(w,h),ctx=composite.getContext('2d');
      ctx.drawImage(before,0,0);ctx.drawImage(generated,0,0);
      const perspective=alignGeneratedToLockedMask({before,generated:composite,lockedMask,makeCanvas});
      if(perspective.aligned&&perspective.image){
        const corrected=read(perspective.image,w,h),out=new Uint8ClampedArray(a);
        for(let i=0;i<m.length;i+=4)if(m[i+3]>=8){
          out[i]=corrected[i];out[i+1]=corrected[i+1];out[i+2]=corrected[i+2];
        }
        warped={rgba:out,coverage:warped.coverage,filled:warped.filled,covered:warped.covered};
        method='perspective-warp';
      }
    }catch(error){console.warn('[mozAI:perspective-fallback]',error)}
  }
  const result=makeCanvas(w,h),ctx=result.getContext('2d'),data=ctx.createImageData(w,h);
  data.data.set(warped.rgba);ctx.putImageData(data,0,0);
  return {image:result,aligned:method!=='direct-clip',method,status:method,
    matchedCorners:corners,coverage:warped.coverage};
}
