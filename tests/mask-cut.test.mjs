import test from 'node:test';
import assert from 'node:assert/strict';
import {splitMaskByStroke} from '../mask-cut.mjs';
function rectMask(w,h,x,y,dx,dy){
  const mask=new Uint8Array(w*h);
  for(let j=y;j<y+dy;j++)for(let i=x;i<x+dx;i++)mask[j*w+i]=1;
  return mask;
}
test('a stroke splitting an object creates two disjoint masks without losing pixels',()=>{
  const w=32,h=24,input=rectMask(w,h,5,3,22,18);
  const result=splitMaskByStroke(input,w,h,[{x:16,y:0},{x:16,y:23}],3);
  assert.equal(result.parts.length,2);
  for(let i=0;i<input.length;i++){
    assert.equal(result.parts[0][i]+result.parts[1][i],input[i], 'Every existing pixel belongs to exactly one child');
  }
  assert.ok(result.counts.every(n=>n>100));
});
test('refuses strokes that do not cross the object',()=>{
  const b=rectMask(30,30,7,7,14,14);
  assert.throws(()=>splitMaskByStroke(b,30,30,[{x:0,y:0},{x:3,y:3}]),/cross/);
});
test('refuses short internal stroke that does not divide the silhouette',()=>{
  const b=rectMask(30,30,5,5,20,20);
  assert.throws(()=>splitMaskByStroke(b,30,30,[{x:12,y:11},{x:12,y:16}]),/across|two parts/);
});
test('accepts slanted cut and keeps image-wide geometry unchanged',()=>{
  const w=40,h=35,b=rectMask(w,h,4,4,32,27);
  const o=splitMaskByStroke(b,w,h,[{x:3,y:30},{x:38,y:5}],3);
  assert.equal(o.parts[0].reduce((a,v)=>a+v,0)+o.parts[1].reduce((a,v)=>a+v,0),32*27);
});
