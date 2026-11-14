import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaBounds,planCreateAlphaCrop} from '../create-alpha.mjs';

test('Create PNG alpha is the only source of the object boundary',()=>{
  const w=32,h=24,pixels=new Uint8ClampedArray(w*h*4);
  pixels[(6*w+7)*4+3]=255;
  pixels[(7*w+8)*4+3]=150;
  pixels[(9*w+12)*4+3]=7; // very soft shadow is not solid geometry
  assert.deepEqual(alphaBounds(pixels,w,h,8),{x:7,y:6,width:2,height:2});
  assert.deepEqual(alphaBounds(pixels,w,h,1),{x:7,y:6,width:6,height:4});
  const before=pixels.slice();
  const plan=planCreateAlphaCrop(pixels,w,h,{x:100,y:200,w,h});
  assert.deepEqual(plan.bbox,{x:107,y:206,w:2,h:2});
  assert.deepEqual(pixels,before,'crop planning must not mutate the generated PNG');
});

test('Create mask and RGBA source stay cropped with correct world coordinates',()=>{
  const w=100,h=80,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=26;y<51;y++)for(let x=30;x<43;x++)pixels[(y*w+x)*4+3]=255;
  pixels[(52*w+36)*4+3]=35; // soft contact shadow remains in crop
  const region={x:520,y:310,w,h};
  const plan=planCreateAlphaCrop(pixels,w,h,region);
  assert.deepEqual(plan.localBox,{x:30,y:26,width:13,height:27});
  assert.deepEqual(plan.bbox,{x:550,y:336,w:13,h:27});
  assert.deepEqual(plan.sourceRect,{x:6,y:2,w:61,h:75});
  assert.deepEqual(plan.sourceCrop,{x:526,y:312,width:61,height:75});
  assert.ok(plan.sourceRect.w<region.w&&plan.sourceRect.h<region.h);
  assert.equal(pixels[(52*w+36)*4+3],35,'source alpha must not be changed by planning');
});
test('Create crop clamps source margins and refuses mismatched canvas dimensions',()=>{
  const w=40,h=30,pixels=new Uint8ClampedArray(w*h*4);
  pixels[(0*w+0)*4+3]=255;pixels[(29*w+39)*4+3]=255;
  const plan=planCreateAlphaCrop(pixels,w,h,{x:22,y:40,w,h});
  assert.deepEqual(plan.sourceRect,{x:0,y:0,w:40,h:30});
  assert.deepEqual(plan.sourceCrop,{x:22,y:40,width:40,height:30});
  assert.equal(planCreateAlphaCrop(new Uint8ClampedArray(w*h*4),w,h,{x:0,y:0,w,h}),null);
  assert.throws(()=>planCreateAlphaCrop(pixels,w,h,{x:0,y:0,w:41,h}),/dimensions/);
});
