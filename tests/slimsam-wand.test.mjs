import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentDimensions,selectSlimMask} from '../slimsam-mask-utils.mjs';
import {cleanAutoMask} from '../mask-cleanup.mjs';

const size=256;
test('an in-flight image analysis is reused when a newer tool request targets the same pixels',async()=>{
  let encodes=0,release,started;
  const gate=new Promise(resolve=>{release=resolve});
  const encoding=new Promise(resolve=>{started=resolve});
  const messages=[];
  const model={get_image_embeddings:async()=>{encodes++;started();if(encodes===1)await gate;return {image_embeddings:'fixture'}}};
  const context=vm.createContext({self:{postMessage:message=>messages.push(message)},hf:{
    Tensor:class{},RawImage:class{},env:{},
    SamModel:{from_pretrained:async()=>model},AutoProcessor:{from_pretrained:async()=>async()=>({})}
  }});
  const source=(await readFile(new URL('../slimsam-worker.mjs',import.meta.url),'utf8'))
    .replace(/^import .*;\r?\n/m,'').replace('await import(CDN)','globalThis.hf');
  vm.runInContext(source,context);
  const prepare=(epoch,fingerprint)=>context.self.onmessage({data:{type:'prepare',epoch,fingerprint,width:2,height:2,pixels:new Uint8Array(16)}});
  prepare(1,'same');await encoding;
  prepare(2,'same');release();await vm.runInContext('jobs',context);
  assert.equal(encodes,1);
  assert(messages.some(message=>message.type==='ready'&&message.epoch===2&&message.reused));
  assert(!messages.some(message=>message.type==='ready'&&message.epoch===1));
  prepare(3,'changed');await vm.runInContext('jobs',context);
  assert.equal(encodes,2,'Changed image must be reanalyzed');
});
const empty = () => new Float32Array(3*size*size).fill(-1);
const paint = (logits, index, x1,y1,x2,y2) => {
  for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)logits[index*size*size+y*size+x]=2;
};
test('SlimSAM mask coordinates respect longest-edge scaling and zero padding',()=>{
  assert.deepEqual(contentDimensions(1024,512),{width:256,height:128});
  assert.deepEqual(contentDimensions(512,1024),{width:128,height:256});
  assert.deepEqual(contentDimensions(512,512),{width:256,height:256});
});
test('SlimSAM accepts connected mask containing cursor, ignores detached artifacts',()=>{
  const logits=empty();
  paint(logits,0,20,30,70,90);
  paint(logits,0,180,180,210,210);
  const mask=selectSlimMask(logits,[.91,.1,.1],256,256,35,50);
  assert.ok(mask);
  assert.equal(mask.mask[50*256+35],1);
  assert.equal(mask.mask[190*256+190],0);
  assert.ok(mask.coverage>0.04 && mask.coverage<0.05);
});
test('SlimSAM chooses best-scoring plausible candidate rather than larger noisy one',()=>{
  const logits=empty();
  paint(logits,0,0,0,240,240);
  paint(logits,1,55,55,100,100);
  paint(logits,2,50,50,72,72);
  const mask=selectSlimMask(logits,[.99,.9,.68],256,256,60,60);
  assert.ok(mask);
  assert.equal(mask.mask[90*256+90],1);
  assert.equal(mask.mask[120*256+120],0);
});
test('SlimSAM rejects mask covering almost entire image',()=>{
  const logits=empty();
  paint(logits,0,0,0,256,256);
  assert.equal(selectSlimMask(logits,[.99,.2,.1],256,256,60,60),null);
});
test('SlimSAM rejects an object that does not contain the click',()=>{
  const logits=empty();
  paint(logits,0,10,10,40,40);
  assert.equal(selectSlimMask(logits,[.99,.2,.1],256,256,220,220),null);
});
test('SlimSAM ignores click outside image bounds',()=>{
  const logits=empty();
  assert.equal(selectSlimMask(logits,[.9,.8,.7],256,128,300,40),null);
});

test('SAM 3 mask cleanup drops isolated islands and seals pinholes',()=>{
  const w=40,h=40,data=new Uint8Array(w*h);
  for(let y=8;y<29;y++)for(let x=9;x<28;x++)data[y*w+x]=1;
  data[20*w+18]=0;
  data[2*w+2]=1;
  const out=cleanAutoMask(data,w,h);
  assert.equal(out[20*w+18],1);
  assert.equal(out[2*w+2],0);
  assert.equal(out[12*w+12],1);
});
test('SAM 3 mask cleanup keeps meaningful thin objects intact',()=>{
  const w=40,h=40,data=new Uint8Array(w*h);
  for(let y=8;y<30;y++)for(let x=18;x<20;x++)data[y*w+x]=1;
  const out=cleanAutoMask(data,w,h);
  assert.equal(out[20*w+18],1);
  assert.equal(out[20*w+19],1);
});
