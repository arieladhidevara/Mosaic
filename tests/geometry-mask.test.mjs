import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMaskDelta} from '../geometry-mask.mjs';

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
