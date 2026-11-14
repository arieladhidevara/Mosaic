import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaBits,extractAlphaCorners,fitCornerMesh,mapCornerPoint,warpMaterialRGBA,triangulate} from '../transparent-corner-warp.mjs';
import {readFileSync} from 'node:fs';

const width=240,height=180;
function wall(shiftA=0,shiftB=0){
  const bits=new Uint8Array(width*height);
  for(let y=18;y<170;y++)for(let x=15;x<225;x++){
    const first=y>=75&&x>=48+shiftA&&x<75+shiftA;
    const second=y>=86&&x>=148+shiftB&&x<180+shiftB;
    if(!first&&!second)bits[y*width+x]=1;
  }
  return bits;
}
const rgba=(bits,r=172,g=110,b=75)=>{
  const out=new Uint8ClampedArray(bits.length*4);
  for(let i=0;i<bits.length;i++)if(bits[i])out.set([r,g,b,255],i*4);
  return out;
};
const solid=(r,g,b)=>{
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set([r,g,b,255],i);
  return data;
};
test('only outer and doorway corners are extracted, without dense line control points',()=>{
  const pts=extractAlphaCorners(wall(),width,height);
  assert.ok(pts.length>=8,'wall + two doors should expose several corners: '+pts.length);
  assert.ok(pts.length<=40,'never store thousands of boundary points');
  assert.ok(pts.some(p=>Math.abs(p.x-48)<8&&Math.abs(p.y-75)<8),'first door top-left');
  assert.ok(pts.some(p=>Math.abs(p.x-148)<8&&Math.abs(p.y-86)<8),'second door top-left');
});
test('locally shifted openings use independent corner matches and triangular interpolation',()=>{
  const target=wall(),source=wall(5,-6);
  const fit=fitCornerMesh({target,source,width,height});
  assert.equal(fit.approved,true,JSON.stringify({reason:fit.reason,matches:fit.matchedCorners}));
  assert.ok(fit.matchedCorners>=8);
  assert.ok(fit.anchors.length<=fit.matchedCorners+4,'mesh vertices are corners plus fixed anchors only');
  assert.ok(triangulate(fit.anchors.map(p=>p.target)).length>0);
  const doorA=mapCornerPoint(fit,48,77),doorB=mapCornerPoint(fit,148,88);
  assert.ok(doorA.x>49, 'first door requires right shift: '+JSON.stringify(doorA));
  assert.ok(doorB.x<147, 'second door requires left shift: '+JSON.stringify(doorB));
});
test('warp preserves every original mask hole and every outside pixel',()=>{
  const locked=wall(),source=rgba(wall(4,-5),222,104,52),before=solid(40,50,60);
  const fit=fitCornerMesh({target:locked,source:wall(4,-5),width,height});
  const result=warpMaterialRGBA({
    sourceRGBA:source,underlayRGBA:before,maskRGBA:rgba(locked),width,height,
    fit:fit.approved?fit:null
  });
  assert.ok(result.coverage>.8,'most target should receive generated RGB');
  let changed=0;
  for(let i=0;i<locked.length;i++){
    const pixel=i*4;
    if(!locked[i]){
      assert.deepEqual(Array.from(result.rgba.slice(pixel,pixel+4)),[40,50,60,255],
        'unselected door and scene pixels must be bit-identical');
    }else if(result.rgba[pixel]>180)changed++;
    assert.equal(result.rgba[pixel+3],255);
  }
  assert.ok(changed>1000,'generated wall material should be applied');
});
test('missing alpha, silhouette mismatch and shifted material never reject the AI option',()=>{
  const locked=wall(),before=solid(30,40,50),mask=rgba(locked);
  for(const bits of [new Uint8Array(width*height),wall(30,-30),wall(5,-6)]){
    const generated=rgba(bits,170,123,96);
    const fit=fitCornerMesh({target:locked,source:bits,width,height});
    const out=warpMaterialRGBA({sourceRGBA:generated,underlayRGBA:before,
      maskRGBA:mask,width,height,fit:fit.approved?fit:null});
    assert.equal(out.rgba.length,before.length);
    assert.ok(out.coverage>=0&&out.coverage<=1);
    for(let i=0;i<locked.length;i++)if(!locked[i]){
      const p=i*4;assert.equal(out.rgba[p],before[p]);
    }
  }
});
test('partially transparent image RGB can be recovered without changing final mask alpha',()=>{
  const locked=wall(),source=rgba(locked),before=solid(100,100,100),mask=rgba(locked);
  for(let i=0;i<locked.length;i++)if(locked[i])source[i*4+3]=80;
  const out=warpMaterialRGBA({sourceRGBA:source,underlayRGBA:before,maskRGBA:mask,width,height});
  assert.ok(out.coverage>.99);
  for(let i=0;i<locked.length;i++)assert.equal(out.rgba[i*4+3],255);
});
test('browser Material Edit uses opaque JPG and only structural perspective alignment',()=>{
  const premium=readFileSync('premium.js','utf8');
  assert.doesNotMatch(premium,/transparentLayer|alignTransparentCornersBestEffort|transparentResult/);
  assert.match(premium,/alignGeneratedToLockedMask/);
  assert.match(premium,/lockedMask:visibleMask,makeCanvas/);
  assert.match(premium,/validateRegionalResult\(aligned\.image,capture\.collage,visibleMask/);
  const provider=readFileSync('lib/image-provider.js','utf8');
  // Material Edit remains JPEG; only the separate Create flow opts into PNG.
  assert.match(provider,/output_format:p\.createObject\?'png':'jpeg'/);
  assert.match(provider,/else payload\.output_compression=100/);
  assert.match(provider,/mimeType:p\.createObject\?'image\/png':'image\/jpeg'/);
});
