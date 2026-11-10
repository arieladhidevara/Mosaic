import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMaskDelta,registerBinaryMasks,measureBinaryMask,segmentGeneratedMaterial,measureContourWarpCoverage} from '../geometry-mask.mjs';

test('shape grows: expanded pixels are occlusions, not revealed background',()=>{
  const a=Uint8Array.from([0,1,1,0,0]);
  const b=Uint8Array.from([1,1,1,0,0]);
  const d=calculateMaskDelta(a,b);
  assert.deepEqual([...d.added],[1,0,0,0,0]);
  assert.equal(d.addedCount,1);assert.equal(d.revealedCount,0);
  assert.equal(d.oldCount,2);assert.equal(d.newCount,3);
});
test('shape shrinks: former object pixels become background candidates',()=>{
  const d=calculateMaskDelta(Uint8Array.from([0,1,1,1]),Uint8Array.from([0,1,0,0]));
  assert.deepEqual([...d.revealed],[0,0,1,1]);
  assert.deepEqual([...d.union],[0,1,1,1]);assert.equal(d.revealedCount,2);
});
test('remove: every old visible pixel becomes a revealed background candidate',()=>{
  const d=calculateMaskDelta(Uint8Array.from([1,0,1]),new Uint8Array(3));
  assert.equal(d.revealedCount,2);assert.equal(d.newCount,0);
});
test('moving object produces both newly covered and newly revealed regions',()=>{
  const d=calculateMaskDelta(Uint8Array.from([1,1,0,0]),Uint8Array.from([0,0,1,1]));
  assert.equal(d.addedCount,2);assert.equal(d.revealedCount,2);assert.equal(d.iou,0);
});
test('rejects unmatched image dimensions',()=>{
  assert.throws(()=>calculateMaskDelta(new Uint8Array(3),new Uint8Array(2)),TypeError);
});


const rect=(width,height,x0,y0,w,h)=>{
  const mask=new Uint8Array(width*height);
  for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)mask[y*width+x]=1;
  return mask;
};
test('generated mask B can register a small translation into the immutable original mask A',()=>{
  const w=80,h=60,a=rect(w,h,12,10,35,28),b=rect(w,h,15,12,35,28);
  const original=a.slice(),candidate=b.slice();
  const fit=registerBinaryMasks(a,b,w,h);
  assert.equal(fit.approved,true);
  assert.equal(fit.dx,-3);assert.equal(fit.dy,-2);
  assert.ok(fit.iou>.65);
  assert.deepEqual(a,original);assert.deepEqual(b,candidate);
});
test('appearance registration rejects large shape changes instead of distorting the original geometry',()=>{
  const w=80,h=60,a=rect(w,h,12,10,35,28);
  const replacement=rect(w,h,11,8,58,44);
  const fit=registerBinaryMasks(a,replacement,w,h);
  assert.equal(fit.approved,false);
  assert.equal(fit.reason,'inconsistent-shapes');
  assert.deepEqual(measureBinaryMask(a,w,h),{x:12,y:10,w:35,h:28,area:980});
});
test('mask registration rejects incompatible dimensions and empty suggestions',()=>{
  const w=12,h=10,a=rect(w,h,2,2,6,5),empty=new Uint8Array(w*h);
  assert.equal(registerBinaryMasks(a,empty,w,h).approved,false);
  assert.throws(()=>registerBinaryMasks(a,new Uint8Array(2),w,h),TypeError);
});


function materialScene(width,height,oldMask,newMask,{textured=false,unchanged=false,editOutside=false}={}){
  const before=new Uint8ClampedArray(width*height*4),after=new Uint8ClampedArray(width*height*4);
  for(let p=0;p<width*height;p++){
    const x=p%width,y=(p-x)/width;
    const background=[25,35,50],oldColor=[226,229,232];
    const wood=textured?(x%5<2?[97,58,31]:[151,100,59]):[137,88,48];
    const old=oldMask[p]?oldColor:background;
    const next=unchanged?old:newMask[p]?wood:
      editOutside&&x>65&&x<80&&y>20&&y<58?[190,25,30]:background;
    for(let c=0;c<3;c++){before[p*4+c]=old[c];after[p*4+c]=next[c];}
    before[p*4+3]=after[p*4+3]=255;
  }
  return {before,after,target:oldMask,width,height};
}
test('Material Edit rebuilds Mask B from newly generated RGB, not from the old mask',()=>{
  const w=110,h=80,a=rect(w,h,15,12,43,46),b=rect(w,h,18,13,43,46);
  const beforeA=a.slice(),scene=materialScene(w,h,a,b);
  const segmented=segmentGeneratedMaterial(scene);
  assert.ok(segmented,'newly generated material should have a distinct silhouette');
  assert.equal(segmented.method,'generated-rgb-segmentation');
  assert.deepEqual(measureBinaryMask(segmented.mask,w,h),measureBinaryMask(b,w,h));
  assert.deepEqual(a,beforeA,'Mask A must remain unchanged');
  const fit=registerBinaryMasks(a,segmented.mask,w,h);
  assert.equal(fit.approved,true);
  assert.equal(fit.dx,-3);assert.equal(fit.dy,-1);
  const warped=measureContourWarpCoverage(a,segmented.mask,w,h,fit);
  assert.ok(warped.valid,'Mask B must geometrically map onto A');
  assert.ok(warped.coverage>.98);
});
test('textured material and unrelated changes still produce a localized Mask B',()=>{
  const w=110,h=80,a=rect(w,h,15,12,43,46),b=rect(w,h,18,13,43,46);
  const segmented=segmentGeneratedMaterial(materialScene(w,h,a,b,{textured:true,editOutside:true}));
  assert.ok(segmented);
  assert.deepEqual(measureBinaryMask(segmented.mask,w,h),measureBinaryMask(b,w,h));
});
test('unchanged material produces no confident new Mask B, keeping the locked mask',()=>{
  const w=110,h=80,a=rect(w,h,15,12,43,46);
  const segmented=segmentGeneratedMaterial(materialScene(w,h,a,a,{unchanged:true}));
  assert.equal(segmented,null);
});
test('registration follows different sloping perspective outlines without changing A',()=>{
  const w=100,h=80,a=new Uint8Array(w*h),b=new Uint8Array(w*h);
  for(let y=10;y<60;y++){
    const t=(y-10)/49,l=10+Math.round(10*t),r=72-Math.round(9*t);
    for(let x=l;x<r;x++)a[y*w+x]=1;
  }
  for(let y=13;y<63;y++){
    const t=(y-13)/49,l=14+Math.round(11*t),r=74-Math.round(7*t);
    for(let x=l;x<r;x++)b[y*w+x]=1;
  }
  const original=a.slice(),fit=registerBinaryMasks(a,b,w,h);
  assert.equal(fit.approved,true);
  const result=measureContourWarpCoverage(a,b,w,h,fit);
  assert.equal(result.valid,true);
  assert.ok(result.coverage>.96);
  assert.deepEqual(a,original);
});
