/* Binary mask operations shared by the editor, repair worker and tests.
   Masks use 1 for selected pixels; MI-GAN's inverse convention is confined to its adapter. */
export function signature(bytes){let h=2166136261;for(const v of bytes)h=Math.imul(h^v,16777619);return (h>>>0).toString(36)+':'+bytes.length}
export function binary(rgba){const out=new Uint8Array(rgba.length/4);for(let i=0;i<out.length;i++)out[i]=rgba[i*4+3]>=128?1:0;return out}
export function count(mask){let n=0;for(const v of mask)n+=v?1:0;return n}
export function combine(a,b,op='union'){const out=new Uint8Array(a.length);for(let i=0;i<a.length;i++)out[i]=op==='subtract'?+(a[i]&&!b[i]):op==='intersect'?+(a[i]&&b[i]):+(a[i]||b[i]);return out}
export function overlap(a,b){let aa=0,bb=0,both=0;for(let i=0;i<a.length;i++){aa+=!!a[i];bb+=!!b[i];both+=!!(a[i]&&b[i])}return {a:aa,b:bb,intersection:both,iou:both/Math.max(1,aa+bb-both),coverage:both/Math.max(1,bb),twoWay:Math.min(both/Math.max(1,aa),both/Math.max(1,bb))}}
export function bounds(mask,w,h,pad=0){let x=w,y=h,r=-1,b=-1;for(let i=0;i<mask.length;i++)if(mask[i]){const xx=i%w,yy=Math.floor(i/w);x=Math.min(x,xx);y=Math.min(y,yy);r=Math.max(r,xx);b=Math.max(b,yy)}if(r<0)return null;x=Math.max(0,x-pad);y=Math.max(0,y-pad);r=Math.min(w,r+pad+1);b=Math.min(h,b+pad+1);return {x,y,w:r-x,h:b-y}}
// Twice the largest distance to a known pixel estimates the width of a gap,
// even for a long thin diagonal shape (a bounding box does not).
export function gapWidth(mask,w,h){const d=new Uint16Array(mask.length);d.fill(65530);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!mask[i])d[i]=0;else d[i]=Math.min(d[i],x?d[i-1]+1:1,y?d[i-w]+1:1)}let max=0;for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(mask[i]){d[i]=Math.min(d[i],x<w-1?d[i+1]+1:1,y<h-1?d[i+w]+1:1);max=Math.max(max,d[i])}}return max*2}
export function textureComplexity(rgba,mask,w,h){let sum=0,n=0;for(let y=1;y<h;y+=2)for(let x=1;x<w;x+=2){const i=y*w+x;if(mask[i]||mask[i-1]||mask[i-w])continue;const j=i*4;for(let c=0;c<3;c++){sum+=Math.abs(rgba[j+c]-rgba[j-4+c])+Math.abs(rgba[j+c]-rgba[j-w*4+c]);n+=2}}return sum/Math.max(1,n)/255}
// Neural reconstruction can drift on flat surfaces. Match color and contrast
// to reliable adjacent pixels; textured regions bypass this calibration.
export function matchFlatContext(before,after,holes,w,h){
  if(textureComplexity(before,holes,w,h)>.025)return after;
  const known=[0,0,0],predicted=[0,0,0],knownSq=[0,0,0],predictedSq=[0,0,0];let nk=0,np=0;
  for(let i=0;i<holes.length;i++){
    if(holes[i]){for(let c=0;c<3;c++){const v=after[i*4+c];predicted[c]+=v;predictedSq[c]+=v*v}np++;continue}
    const x=i%w,y=Math.floor(i/w);if(!(x&&holes[i-1]||x<w-1&&holes[i+1]||y&&holes[i-w]||y<h-1&&holes[i+w]))continue;
    for(let c=0;c<3;c++){const v=before[i*4+c];known[c]+=v;knownSq[c]+=v*v}nk++;
  }
  if(!nk||!np)return after;
  const mean=known.map(v=>v/nk),prediction=predicted.map(v=>v/np),gain=known.map((v,c)=>Math.min(1,Math.sqrt((Math.max(0,knownSq[c]/nk-mean[c]**2)+4)/(Math.max(0,predictedSq[c]/np-prediction[c]**2)+4))));
  for(let i=0;i<holes.length;i++)if(holes[i])for(let c=0;c<3;c++)after[i*4+c]=Math.max(0,Math.min(255,mean[c]+(after[i*4+c]-prediction[c])*gain[c]));return after;
}
export function validRepair(before,after,missing,w,h){if(!after||after.length!==before.length)return false;let error=0,n=0;for(let i=0;i<missing.length;i++)if(missing[i]){const j=i*4;if(after[j+3]<250)return false;for(let c=0;c<3;c++)if(!Number.isFinite(after[j+c]))return false;for(const k of [i%w?i-1:-1,i>=w?i-w:-1])if(k>=0&&!missing[k]){for(let c=0;c<3;c++)error+=Math.abs(after[j+c]-before[k*4+c]);n+=3}}return !n||error/n<100}
// Stable topological sort. Explicit scene relationships take priority; cyclic
// or legacy relationships retain their existing draw order.
export function sceneOrder(groups){const result=[],pending=new Set(groups);while(pending.size){const next=[...pending].find(g=>![...pending].some(other=>other!==g&&other.objectBehind?.includes(g.id)));if(!next){result.push(...pending);break}result.push(next);pending.delete(next)}return result}
