import test from 'node:test';
import assert from 'node:assert/strict';
import {buildObjectHitGrid,cropContainsPoint} from '../object-hit-index.mjs';
test('spatial lookup sees only overlapping edited objects in front-to-back order',()=>{
  const back={id:'wall',bounds:{x:0,y:0,w:512,h:512}};
  const front={id:'chair',bounds:{x:112,y:112,w:30,h:60}};
  const index=buildObjectHitGrid([back,front],512,512,64);
  assert.deepEqual(index.candidates({x:120,y:130}).map(x=>x.id),['chair','wall']);
  assert.deepEqual(index.candidates({x:400,y:400}).map(x=>x.id),['wall']);
  assert.deepEqual(index.candidates({x:512,y:10}),[]);
});
test('crop-only alpha hit respects offset, holes and transparent margins',()=>{
  const rgba=new Uint8ClampedArray(5*4*4);
  rgba[(2*5+3)*4+3]=255;rgba[(1*5+2)*4+3]=0;
  const crop={x:100,y:40,mask:{width:5,height:4,
    getContext:()=>({getImageData(x,y){return{data:rgba.slice((y*5+x)*4,(y*5+x)*4+4)}})}}};
  assert.equal(cropContainsPoint(crop,{x:103.7,y:42.8}),true);
  assert.equal(cropContainsPoint(crop,{x:102,y:41}),false);
  assert.equal(cropContainsPoint(crop,{x:99,y:42}),false);
});
test('negative bounds and off-canvas regions are clipped',()=>{
  const a={bounds:{x:-10,y:-10,w:30,h:30}},b={bounds:{x:900,y:900,w:10,h:10}};
  const index=buildObjectHitGrid([a,b],200,200,64);
  assert.deepEqual(index.candidates({x:2,y:2}),[a]);
  assert.deepEqual(index.candidates({x:150,y:150}),[]);
});
