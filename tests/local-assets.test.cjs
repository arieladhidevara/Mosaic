const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'local-server.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const allowlist=source.match(/const publicFiles = new Set\(\[([\s\S]*?)\]\);/)?.[1]||'';
const files=new Set([...allowlist.matchAll(/^\s*'([^']+)',/gm)].map(match=>match[1]));

test('local server serves every current frontend script and stylesheet',()=>{
  const links=[...index.matchAll(/(?:src|href)="\.\/([^"]+\.(?:js|css|mjs))"/g)].map(match=>match[1]);
  assert.ok(links.length>=15,'index should contain frontend imports');
  for(const file of links) {
    assert.ok(files.has(file),file+' is missing from localhost allowlist');
    assert.ok(fs.statSync(path.join(root,file)).isFile(),file+' does not exist');
  }
});
test('local server allows deterministic scene clustering module imported by object manager',()=>{
  const manager=fs.readFileSync(path.join(root,'object-management.js'),'utf8');
  assert.match(manager,/from '\.\/object-clustering\.mjs'/);
  assert.ok(files.has('object-clustering.mjs'),'Frontend import of object-clustering.mjs would return 404');
});

test('local server serves the browser model worker and its modules with JavaScript MIME',()=>{
  for(const file of ['slimsam-worker.mjs','slimsam-mask-utils.mjs','mask-cleanup.mjs','auto-regions.js','mask-progress.js','slimsam-wand.js']){
    assert.ok(files.has(file),'Local server returned 404 for '+file);
    assert.ok(fs.statSync(path.join(root,file)).isFile(),file+' missing');
  }
  assert.match(source,/['"]\.mjs['"]\s*:\s*['"]text\/javascript/);
  assert.match(source,/['"]\.js['"]\s*:\s*['"]text\/javascript/);
});
test('local Auto Create uses same SAM 3 URL as production without exposing secrets',()=>{
  const dev=fs.readFileSync(path.join(root,'scripts/dev-server.js'),'utf8');
  const proxy=fs.readFileSync(path.join(root,'api/ai/sam3.js'),'utf8');
  assert.match(dev,/MOZAI_HF_SAM3_SPACE_URL\?\?=['"]https:\/\/arieladhidevara-mozai\.hf\.space/);
  assert.match(proxy,/segmentAllImage/);
  assert.match(source,/['"]\/api\/ai\/sam3['"]/);
  assert.doesNotMatch(allowlist,/\.env\.local|package\.json|local-server\.js/);
});
test('local navigation supports legal pages',()=>{
  for(const file of ['privacy.html','terms.html'])assert.ok(files.has(file));
});
