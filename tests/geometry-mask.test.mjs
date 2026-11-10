import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMaskDelta,registerBinaryMasks,measureBinaryMask} from '../geometry-mask.mjs';

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
