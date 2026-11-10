import test from 'node:test';
import assert from 'node:assert/strict';
import {PALETTE,decodeColors,idsInShape,labelAt,objectMapSize,MIN_MAP_PIXELS} from '../object-map-utils.mjs';
test('object map sizing meets pixel budget for landscapes, portraits and small inputs',()=>{
  assert.deepEqual(objectMapSize(1024,608),{width:1344,height:800});
  for(const [w,h] of [[64,64],[800,500],[500,800],[300,100],[100,300],[4000,2400]]){
    const size=objectMapSize(w,h);assert.equal(size.width%16,0);assert.equal(size.height%16,0);assert.ok(size.width*size.height>=Math.max(MIN_MAP_PIXELS,1048576));assert.ok(size.width*size.height<=2500000);assert.ok(size.width/size.height<=3&&size.height/size.width<=3);
  }
  assert.throws(()=>objectMapSize(4000,100),/aspect ratio/);
});
test('color IDs preserve disconnected pixels, single-pixel features and holes without smoothing',()=>{
  const w=6,h=4,rgba=new Uint8ClampedArray(w*h*4),expected=[];
  for(let i=0;i<w*h;i++){const id=i===7?2:i===8?0:i%2?1:3;expected.push(id);rgba.set(id?[...PALETTE[id-1].rgb,255]:[0,0,0,255],i*4)}
  const decoded=decodeColors(rgba,w,h);assert.deepEqual([...decoded.labels],expected);assert.deepEqual(decoded.ids,[1,2,3]);
  assert.equal(labelAt(decoded.labels,w,h,4,2,12,8),decoded.labels[8]);assert.equal(labelAt(decoded.labels,w,h,-1,0,12,8),0);
});
test('shape selection picks objects predominantly inside and ignores grazing an adjacent object',()=>{
  const labels=new Uint8Array([1,1,1,2,2,2,3,3,3]),rgba=new Uint8Array(9*4);
  for(const index of [0,1,2,3,4,6])rgba[index*4+3]=255;
  assert.deepEqual(idsInShape(labels,9,1,rgba,9,1),[1,2]);
});
test('off-palette output is decoded without a palette-distance rejection',()=>{
  const rgba=new Uint8Array([250,10,10,255,10,240,10,255]);
  const decoded=decodeColors(rgba,2,1);
  assert.equal(decoded.ids.length,2);
  assert.notEqual(decoded.labels[0],decoded.labels[1]);
  assert.deepEqual(decoded.warnings,[]);
});
test('single-color results are nonblocking but flagged for review',()=>{
  const one=new Uint8Array([...PALETTE[0].rgb,255,...PALETTE[0].rgb,255]);
  const decoded=decodeColors(one,2,1);
  assert.deepEqual(decoded.ids,[1]);
  assert.match(decoded.warnings.join(' '),/one object color/i);
});
test('empty and transparent results are still rejected',()=>{
  assert.throws(()=>decodeColors(new Uint8Array(8),2,1),/empty or transparent/);
  assert.throws(()=>decodeColors(new Uint8Array([0,0,0,255,0,0,0,255]),2,1),/empty or transparent/);
});
test('color variation is checked independently of the fixed palette and only warns',()=>{
  const w=128,h=32,rgba=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    rgba[i]=40+(x*7)%200;rgba[i+1]=40+(y*13)%200;rgba[i+2]=120;rgba[i+3]=255;
  }
  const decoded=decodeColors(rgba,w,h);
  assert.ok(decoded.ids.length>1);
  assert.match(decoded.warnings.join(' '),/gradients or texture/);
});
