import test from 'node:test';
import assert from 'node:assert/strict';
import {fitTransparentMasks,mapTransparentPoint,warpTransparentPixels,repairLockedMaskGaps} from '../transparent-material-align.mjs';

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

test('repairs a transparent top rim and a small gap without changing door openings',()=>{
  const target=wall(),source=rgba(target),original=rgba(target);
  // AI output loses the upper rim and a narrow horizontal interior strip.
  for(let y=18;y<29;y++)for(let x=15;x<225;x++)source[(y*width+x)*4+3]=0;
  for(let y=117;y<121;y++)for(let x=15;x<225;x++)source[(y*width+x)*4+3]=0;
  const fit=fitTransparentMasks({target,source:target,width,height});
  assert.equal(fit.approved,true);
  const repaired=warpTransparentPixels({sourceRGBA:source,targetRGBA:original,width,height,fit});
  assert.ok(repaired.rgba,'narrow transparent gaps should be repaired instead of discarded');
  assert.ok(repaired.initialCoverage<.98,'this is the previously rejected scenario');
  assert.equal(repaired.coverage,1);
  assert.ok(repaired.repairedPixels>0);
  for(let i=0;i<target.length;i++)assert.equal(repaired.rgba[i*4+3],target[i]*255,
    'all material is strictly clipped to original mask and excludes both doors');
});
test('repair respects disconnected objects and refuses major transparency loss',()=>{
  const target=wall(),before=rgba(target),out=new Uint8ClampedArray(before);
  // A large part of the surface is entirely missing: not safe to hallucinate.
  for(let y=18;y<90;y++)for(let x=15;x<225;x++)out[(y*width+x)*4+3]=0;
  const fit=fitTransparentMasks({target,source:target,width,height});
  const rejected=warpTransparentPixels({sourceRGBA:out,targetRGBA:before,width,height,fit});
  assert.equal(rejected.rgba,null);
  assert.ok(rejected.initialCoverage<.8);
});
test('semi-transparent but colored pixels count as valid AI material',()=>{
  const target=wall(),before=rgba(target),source=rgba(target);
  for(let i=0;i<target.length;i++)if(target[i])source[i*4+3]=96;
  const fit=fitTransparentMasks({target,source:target,width,height});
  const result=warpTransparentPixels({sourceRGBA:source,targetRGBA:before,width,height,fit});
  assert.ok(result.rgba,'antialiased material must not fail opacity-only coverage checks');
  assert.ok(result.coverage>=.995);
});
