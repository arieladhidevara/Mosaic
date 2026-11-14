const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const premium=fs.readFileSync('premium.js','utf8');

test('brush defers expensive mask bounding/geometry invalidation until release',()=>{
  const paint=app.slice(app.indexOf('function paint(e,first){'),app.indexOf('function historyStep(',app.indexOf('function paint(e,first){')));
  assert.match(paint,/invalidateDisplayedMask\(patch,\{geometryChanged:false\}\)/);
  assert.match(paint,/requestBrushRepaint\(\)/);
  assert.doesNotMatch(paint,/maskBoundingBox\(mask\)/);
  assert.doesNotMatch(paint,/exactMaskBoundingBox\(mask\)/);
  const up=app.slice(app.indexOf('function pointerUp(e){'),app.indexOf('function pointerCancel(){'));
  assert.match(up,/finishBrushRepaint\(\)/);
  assert.match(up,/exactMaskBoundingBox\(patch\.mask\)/);
  assert.match(up,/invalidateDisplayedMask\(patch\)/);
  assert.match(app,/if\(pendingBrushRepaint\)return/);
  assert.match(app,/pendingBrushRepaint=requestAnimationFrame/);
});
test('Create has a cropped, lossless alpha placement path for ordinary unwarped PNGs',()=>{
  const part=premium.slice(premium.indexOf('// Untransformed Create cuts out locally.'),premium.indexOf('if(regenerate){',premium.indexOf('// Untransformed Create cuts out locally.')));
  assert.match(part,/if\(!submittedPatch\.corners\?\.length\)/);
  assert.match(part,/prepareCroppedCreateLayer\(image,region\)/);
  assert.match(part,/else\{[\s\S]*core\.unwarpPatchSelection\(positioned,submittedPatch\)/);
  assert.match(premium,/existing\.mask=objectMask;existing\.maskOffset=maskOffset/);
  assert.match(premium,/core\.invalidateDisplayedMask\(existing,\{geometryChanged:false\}\)/);
  assert.match(app,/maskPathsFromRaster,maskPathsFromCrop,/);
});
