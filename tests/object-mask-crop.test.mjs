import test from 'node:test';
import assert from 'node:assert/strict';
import {cropObjectLabel} from '../object-mask-crop.mjs';
import {labelAt} from '../object-map-utils.mjs';

function expand(crop,w,h){
  const output=new Uint8Array(w*h);
  if(crop)for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++)
    output[(crop.y+y)*w+crop.x+x]=crop.alpha[y*crop.width+x];
  return output;
}
test('cropped Object ID masks round-trip to the original full-canvas positions without bleeding',()=>{
  const mw=6,mh=4,iw=12,ih=8,labels=new Uint32Array(mw*mh);
  for(let y=1;y<3;y++)for(let x=2;x<4;x++)labels[y*mw+x]=7;
  labels[1*mw+2]=0; // A genuine hole must stay transparent.
  const crop=cropObjectLabel(labels,mw,mh,{x:2,y:1,w:2,h:2},7,iw,ih);
  assert.ok(crop);
  assert.deepEqual({x:crop.x,y:crop.y,width:crop.width,height:crop.height},{x:4,y:2,width:4,height:4});
  assert.ok(crop.width*crop.height<iw*ih);
  const out=expand(crop,iw,ih);
  for(let y=0;y<ih;y++)for(let x=0;x<iw;x++)
    assert.equal(out[y*iw+x],labelAt(labels,mw,mh,x,y,iw,ih)===7?255:0,`pixel ${x},${y}`);
});
test('non-integer scaling and adjacent ids preserve exact location and boundaries',()=>{
  const mw=5,mh=3,w=13,h=8,labels=new Uint32Array([
    3,3,0,2,2,
    3,0,0,2,2,
    0,0,0,0,2
  ]);
  for(const [id,box] of [[3,{x:0,y:0,w:2,h:2}],[2,{x:3,y:0,w:2,h:3}]]){
    const crop=cropObjectLabel(labels,mw,mh,box,id,w,h);
    assert.ok(crop);
    assert.ok(crop.width*crop.height<w*h);
    const expanded=expand(crop,w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)
      assert.equal(expanded[y*w+x],labelAt(labels,mw,mh,x,y,w,h)===id?255:0,`id ${id} at ${x},${y}`);
  }
});
test('crop rejects invalid identifiers and unmapped objects safely',()=>{
  const labels=new Uint32Array([1,0,0,0]);
  assert.equal(cropObjectLabel(labels,2,2,{x:1,y:1,w:1,h:1},1,8,8),null);
  assert.equal(cropObjectLabel(labels,2,2,{x:0,y:0,w:1,h:1},2,8,8),null);
  assert.equal(cropObjectLabel(labels,2,2,null,1,8,8),null);
  assert.equal(cropObjectLabel(labels,2,2,{x:0,y:0,w:1,h:1},1,0,8),null);
});
