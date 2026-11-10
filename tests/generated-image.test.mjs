import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedImageStats} from '../generated-image.mjs';
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
