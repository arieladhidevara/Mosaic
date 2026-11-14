const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=path=>fs.readFileSync(new URL('../'+path,'file://'+__filename), 'utf8');

test('Create and regional edits show estimated progress while OpenAI is working',()=>{
  const premium=source('premium.js');
  const hud=source('mask-progress.js');
  assert.match(premium,/patch\.createObject\?'Creating object/);
  assert.match(premium,/MosaicMaskProgress\?\.show\(owner,label,currentDetail,value,true\)/);
  assert.match(premium,/requestAnimationFrame\(\(\)=>requestAnimationFrame\(resolve\)\)/);
  assert.match(hud,/id="maskProgressPercent"/);
  assert.match(hud,/entry\.estimated\?'≈ '/);
  assert.match(hud,/percentage\.textContent='Working…'/);
});

test('full-image generation in Assistant reports progress through result application',()=>{
  const premium=source('premium.js');
  const copilot=source('design-copilot.js');
  const scene=source('scene-versioning.js');
  assert.match(premium,/async function generateComposition[\s\S]*?beginAIProgress\(options\?\.quality/);
  assert.match(premium,/onProgress:options\.onProgress/);
  assert.match(premium,/typeof options\.onResult==='function'/);
  assert.match(copilot,/setChatGenerationProgress\(event\)/);
  assert.match(copilot,/copilotGenerationProgress/);
  assert.match(copilot,/OpenAI does not report a live percentage/);
  assert.match(copilot,/onProgress:setChatGenerationProgress/);
  assert.match(copilot,/onResult:async\(img,progress\)/);
  assert.match(copilot,/MosaicSceneVersions\.apply\(img/);
  assert.match(scene,/onProgress=\(\)=>\{\}/);
  assert.match(scene,/onProgress\(93\+Math\.round/);
  assert.match(scene,/requestAnimationFrame\(resolve\)/);
});

test('Auto Create yields between object masks so progress can repaint',()=>{
  const code=source('auto-regions.js');
  assert.match(code,/show\?\.\('auto','SAM 3 · Auto Create','Preparing image for segmentation…'/);
  assert.match(code,/if\(id%2===0\)await new Promise\(resolve=>requestAnimationFrame\(resolve\)\)/);
});
