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
test('flat-map validation rejects an unchanged photograph or a single-color result',()=>{
  assert.throws(()=>decodeColors(new Uint8Array([255,255,255,255,255,255,255,255]),2,1),/flat-color/);
  const one=new Uint8Array([...PALETTE[0].rgb,255,...PALETTE[0].rgb,255]);assert.throws(()=>decodeColors(one,2,1),/separate enough/);
});
