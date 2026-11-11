import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedImageStats,generatedRegionStats} from '../generated-image.mjs';
test('fully black or transparent provider frames are rejected',()=>{
  assert.equal(generatedImageStats(new Uint8Array(400)).reason,'transparent');
  const black=new Uint8Array(400);for(let i=3;i<black.length;i+=4)black[i]=255;
  assert.equal(generatedImageStats(black).reason,'black');
});
test('dark scenes with detail and black objects in a visible scene remain valid',()=>{
  const image=new Uint8Array(400);for(let i=0;i<100;i++)image.set([0,0,0,255],i*4);
  image.set([24,24,24,255],40);assert.equal(generatedImageStats(image).invalid,false);
  for(let i=0;i<50;i++)image.set([120,100,80,255],i*4);assert.equal(generatedImageStats(image).invalid,false);
});

const pixels=(n,color)=>Uint8Array.from({length:n*4},(_,i)=>color[i%4]);
test('rejects unexpected partial black objects despite valid scene context',()=>{
  const before=pixels(400,[140,90,40,255]),after=before.slice(),mask=pixels(400,[0,0,0,0]);
  for(let i=100;i<200;i++){mask.set([255,255,255,255],i*4);if(i<135)after.set([0,0,0,255],i*4)}
  assert.equal(generatedImageStats(after).invalid,false);
  assert.equal(generatedRegionStats(before,after,mask,{prompt:'make it wood'}).reason,'black-region');
  assert.equal(generatedRegionStats(before,after,mask,{prompt:'ubah jadi hitam'}).invalid,false);
  assert.equal(generatedRegionStats(before,after,mask,{prompt:'black metal'}).invalid,false);
  assert.equal(generatedRegionStats(after,after,mask).invalid,false,'existing dark pixels are not a failure');
});
test('rejects transparent selected pixels even when black was requested',()=>{
  const before=pixels(100,[140,90,40,255]),after=before.slice(),mask=pixels(100,[255,255,255,255]);
  for(let i=0;i<30;i++)after[i*4+3]=0;
  assert.equal(generatedRegionStats(before,after,mask,{prompt:'black metal'}).reason,'transparent-region');
});
test('ignores black pixels outside selection and accepts detailed dark materials',()=>{
  const before=pixels(100,[140,90,40,255]),after=pixels(100,[0,0,0,255]),mask=pixels(100,[0,0,0,0]);
  for(let i=0;i<40;i++){mask.set([255,255,255,255],i*4);after.set([12+i%20,12+i%20,12+i%20,255],i*4)}
  assert.equal(generatedRegionStats(before,after,mask).invalid,false);
});
