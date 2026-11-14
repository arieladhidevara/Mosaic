import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMaskDelta,intersectBinaryMasks} from '../geometry-mask.mjs';
import {readFileSync} from 'node:fs';

const bits=(width,height,rects)=>{
  const mask=new Uint8Array(width*height);
  for(const [x,y,w,h] of rects)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)mask[yy*width+xx]=1;
  return mask;
};

test('Remove skips ownership for nonintersecting Option even with overlapping bounding boxes',()=>{
  // Interleaved stripes have the same bounding box, but no common pixels.
  const exposed=bits(12,12,[[2,2,2,8],[8,2,2,8]]);
  const option=bits(12,12,[[4,2,4,8]]);
  const result=intersectBinaryMasks(exposed,option);
  assert.equal(result.count,0);
  assert.equal(result.bits,null,'no new full-image intersection mask should be allocated');
});

test('only overlapping Option pixels can be candidates for reassignment',()=>{
  const exposed=bits(10,10,[[2,2,5,5]]);
  const option=bits(10,10,[[5,0,3,6]]);
  const unrelated=bits(10,10,[[0,7,10,2]]);
  const result=intersectBinaryMasks(exposed,option);
  assert.equal(result.count,8);
  assert.equal(result.bits[5*10+5],1);
  assert.equal(result.bits[4*10+5],1);
  assert.equal(result.bits[4*10+4],0,'cutout pixel without Option conflict must stay untouched');
  assert.equal(result.bits[0*10+5],0,'Option pixels outside cutout are not owned by Remove');
  assert.equal(intersectBinaryMasks(exposed,unrelated).count,0);
});

test('Remove uses the whole released mask as the saved reconstruction, not a resegmented mask',()=>{
  const old=bits(10,10,[[2,2,5,5]]);
  const empty=new Uint8Array(old.length);
  const change=calculateMaskDelta(old,empty);
  assert.deepEqual([...change.revealed],[...old]);
  assert.equal(change.revealedCount,25);
  assert.equal(intersectBinaryMasks(change.revealed,bits(10,10,[[0,0,2,2]])).count,0);
});

test('ownership analysis is gated by visible ready Options AND exact intersection',()=>{
  const source=readFileSync('geometry-edit.js','utf8');
  assert.match(source,/activeSavedOption\(group\)&&boxesIntersect\(group\.area,revealedBox\)/);
  assert.match(source,/intersectBinaryMasks\(exposed,old\)/);
  assert.match(source,/if\(!intersection\.count\)return null/);
  assert.match(source,/if\(!candidates\.length\)return none/);
  assert.match(source,/entry\.overlapBits\[i\]&&fresh\[i\]&&!claimed\[i\]/);
  assert.match(source,/no-option-overlap/);
  assert.match(source,/return \{assignments,optionOverlapPixels:/);
  assert.doesNotMatch(source,/newlyVisible<Math\.max\(16,revealCount\*\.04\)/);
});
