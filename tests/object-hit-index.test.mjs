import test from 'node:test';
import assert from 'node:assert/strict';
import {buildObjectHitGrid} from '../object-hit-index.mjs';
test('spatial lookup sees only overlapping edited objects in front-to-back order',()=>{
  const back={id:'wall',bounds:{x:0,y:0,w:512,h:512}};
  const front={id:'chair',bounds:{x:112,y:112,w:30,h:60}};
  const index=buildObjectHitGrid([back,front],512,512,64);
  assert.deepEqual(index.candidates({x:120,y:130}).map(x=>x.id),['chair','wall']);
  assert.deepEqual(index.candidates({x:400,y:400}).map(x=>x.id),['wall']);
  assert.deepEqual(index.candidates({x:512,y:10}),[]);
});
test('negative bounds and off-canvas regions are clipped',()=>{
  const a={bounds:{x:-10,y:-10,w:30,h:30}},b={bounds:{x:900,y:900,w:10,h:10}};
  const index=buildObjectHitGrid([a,b],200,200,64);
  assert.deepEqual(index.candidates({x:2,y:2}),[a]);
  assert.deepEqual(index.candidates({x:150,y:150}),[]);
});
