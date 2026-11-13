const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Object Map startup mounts on currently rendered Create toolbar',()=>{
  const html=source('index.html'),map=source('object-map.js');
  assert.match(html,/class="toolset selection-toolset"/);
  assert.match(map,/querySelector\('\.selection-toolset'\)/);
  assert.doesNotMatch(map,/querySelector\('\[aria-label="Selection tools"\]'\)/);
});
test('Base upload enters editor automatically and prepares Object Map',()=>{
  const app=source('app.js'),map=source('object-map.js');
  assert.ok(app.includes('onReferenceLoaded(file);setProjectTitle(fileName(file));continueWithBase(false)'));
  assert.ok(app.includes("setMaster(working,state.projectTitle||'Base'"));
  assert.match(app,/if\(prepareObjects\)window\.MosaicObjectMap\?\.imageReady\(c\)/);
  assert.match(map,/state\.objectMap=null;void prepareBase\(\)/);
  assert.match(map,/addEventListener\('mosaic:keyconnected',\(\)=>void prepareBase\(\)\)/);
});
