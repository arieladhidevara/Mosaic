import test from 'node:test';
import assert from 'node:assert/strict';
import {idsOverlappingShape,idsInShape} from '../object-map-utils.mjs';
test('rect automatically chooses meaningful object overlap, including partial objects',()=>{
  const labels=Uint32Array.from([101,101,101,101,101,202,202,202,202,202]);
  const rgba=new Uint8Array(10*4);
  for(const i of [0,1,2,3,5,6])rgba[i*4+3]=255;
  assert.deepEqual(idsOverlappingShape(labels,10,1,rgba,10,1),[101,202]);
  assert.deepEqual(idsInShape(labels,10,1,rgba,10,1),[101]);
});
test('accidental single-pixel contact does not select huge region',()=>{
  const labels=new Uint32Array(100).fill(7),rgba=new Uint8Array(100*4);
  rgba[3]=255;
  assert.deepEqual(idsOverlappingShape(labels,100,1,rgba,100,1),[]);
});
