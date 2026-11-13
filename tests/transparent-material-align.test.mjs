import test from 'node:test';
import assert from 'node:assert/strict';
import {fitTransparentMasks,mapTransparentPoint,warpTransparentPixels} from '../transparent-material-align.mjs';

const width=240,height=180;
function wall(doorShiftA=0,doorShiftB=0,missingDoor=false){
  const bits=new Uint8Array(width*height);
  for(let y=18;y<170;y++)for(let x=15;x<225;x++){
    const first=y>=75&&x>=48+doorShiftA&&x<75+doorShiftA;
    const second=!missingDoor&&y>=86&&x>=148+doorShiftB&&x<180+doorShiftB;
    if(!first&&!second)bits[y*width+x]=1;
  }
  return bits;
}
const rgba=bits=>{
  const out=new Uint8ClampedArray(bits.length*4);
  for(let i=0;i<bits.length;i++)if(bits[i]){
    out[i*4]=180;out[i*4+1]=140;out[i*4+2]=80;out[i*4+3]=255;
  }
  return out;
};
test('matches independent offsets at two door openings while retaining original mask holes',()=>{
  const target=wall(),source=wall(4,-5);
  const fit=fitTransparentMasks({target,source,width,height});
  assert.equal(fit.approved,true,fit.reason);
  assert.ok(fit.matchedPoints>=10);
  // The two openings cannot be fixed by a single uniform translation.
  const a=mapTransparentPoint(fit,47,120),b=mapTransparentPoint(fit,148,125);
  assert.ok(a.x>47.5,'first doorway needs rightward local sampling');
  assert.ok(b.x<147.5,'second doorway needs leftward local sampling');
  const corrected=warpTransparentPixels({
    sourceRGBA:rgba(source),targetRGBA:rgba(target),width,height,fit
  });
  assert.ok(corrected.rgba,'transparent material should cover the approved wall');
  assert.ok(corrected.coverage>=.98);
  for(let i=0;i<target.length;i++){
    assert.equal(corrected.rgba[i*4+3],target[i]*255,
      'door opening and object silhouette must remain exactly original');
  }
});
test('rejects a missing door instead of stretching generated pixels across it',()=>{
  const fit=fitTransparentMasks({target:wall(),source:wall(0,0,true),width,height});
  assert.equal(fit.approved,false);
  assert.match(fit.reason,/topology|area|boundary/);
});
test('rejects blank and wildly different alpha silhouettes',()=>{
  assert.equal(fitTransparentMasks({target:wall(),source:new Uint8Array(width*height),width,height}).approved,false);
  const source=new Uint8Array(width*height);
  for(let y=0;y<30;y++)for(let x=0;x<40;x++)source[y*width+x]=1;
  assert.equal(fitTransparentMasks({target:wall(),source,width,height}).approved,false);
});
