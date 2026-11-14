import test from 'node:test';
import assert from 'node:assert/strict';
import {createSamLabel,alphaBounds,samMaskBits,refineCreatePixels} from '../create-sam3.mjs';

test('SAM label is based on the Create prompt, not an existing Object ID',()=>{
  assert.equal(createSamLabel('Create a blue velvet lounge chair by the window'),
    'blue velvet lounge chair by the window');
  assert.equal(createSamLabel('Add an oak table; keep the lighting warm'),'oak table');
  assert.equal(createSamLabel(''), 'object');
  assert.equal(createSamLabel('a'.repeat(180)).length,80);
});

test('SAM 3 accepts alpha masks and opaque white-on-black masks',()=>{
  const w=8,h=8,transparent=new Uint8ClampedArray(w*h*4);
  transparent[(3*w+4)*4+3]=255;
  assert.equal(samMaskBits(transparent,w,h)[3*w+4],1);
  assert.equal(samMaskBits(transparent,w,h)[0],0);
  const black=new Uint8ClampedArray(w*h*4);
  for(let p=0;p<w*h;p++)black[p*4+3]=255;
  for(let y=2;y<6;y++)for(let x=2;x<6;x++){
    const i=(y*w+x)*4;black[i]=black[i+1]=black[i+2]=255;
  }
  assert.equal(samMaskBits(black,w,h)[0],0);
  assert.equal(samMaskBits(black,w,h)[4*w+4],1);
});

test('SAM refinement retains transparent contact shadows while trimming reliable object edges',()=>{
  const w=20,h=20,rgba=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h);
  for(let y=5;y<15;y++)for(let x=5;x<15;x++){
    const i=y*w+x;rgba[i*4+3]=255;mask[i]=1;
  }
  // A handful of inaccurate foreground pixels are trimmed by SAM.
  for(let x=5;x<9;x++)mask[5*w+x]=0;
  rgba[(16*w+10)*4+3]=60; // soft shadow: must keep original partial alpha
  const bbox=alphaBounds(rgba,w,h);
  assert.deepEqual(bbox,{x:5,y:5,width:10,height:10});
  const result=refineCreatePixels(rgba,mask);
  assert.equal(result.applied,true);
  assert.equal(rgba[(5*w+6)*4+3],0);
  assert.equal(rgba[(10*w+10)*4+3],255);
  assert.equal(rgba[(16*w+10)*4+3],60);
});

test('SAM segmentation mismatch does not destroy transparent PNG',()=>{
  const w=20,h=20,rgba=new Uint8ClampedArray(w*h*4),bad=new Uint8Array(w*h);
  for(let y=5;y<15;y++)for(let x=5;x<15;x++)rgba[(y*w+x)*4+3]=255;
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)bad[y*w+x]=1;
  const before=rgba.slice(),result=refineCreatePixels(rgba,bad);
  assert.equal(result.applied,false);
  assert.deepEqual(rgba,before);
});
