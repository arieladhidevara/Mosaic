import test from 'node:test';
import assert from 'node:assert/strict';
import {intersectObjectIds} from '../object-intersections.mjs';
test('returns only intersected stable Object IDs from the flat raster',()=>{
  const labels=Uint32Array.from([
    1,1,1,2,2,2,
    1,1,1,2,2,2,
    1,1,1,2,2,2,
    1,1,1,2,2,2
  ]);
  const rgba=new Uint8Array(6*4*4);
  for(let y=0;y<4;y++)for(let x=0;x<3;x++)rgba[(y*6+x)*4+3]=255;
  assert.deepEqual(intersectObjectIds(labels,6,4,rgba,6,4),[1]);
  rgba.fill(0);
  for(let y=0;y<4;y++)for(let x=3;x<6;x++)rgba[(y*6+x)*4+3]=255;
  assert.deepEqual(intersectObjectIds(labels,6,4,rgba,6,4),[2]);
});
test('counts upscaled rectangle without scanning any object masks',()=>{
  const labels=Uint32Array.from([2,2,3,3,2,2,3,3]);
  const rgba=new Uint8Array(8*4*4);rgba.fill(0);
  for(let y=0;y<4;y++)for(let x=4;x<8;x++)rgba[(y*8+x)*4+3]=255;
  assert.deepEqual(intersectObjectIds(labels,4,2,rgba,8,4,1),[3]);
});
