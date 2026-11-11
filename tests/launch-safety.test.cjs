const test=require('node:test'),assert=require('node:assert/strict');
const {send}=require('../lib/auth');
test('5xx diagnostics never log prompts or credentials',()=>{
  const original=console.error,logs=[],headers={};
  console.error=message=>logs.push(message);
  const res={setHeader:(k,v)=>headers[k]=v,status(code){this.code=code;return this},json(body){this.body=body;return this}};
  try{
    send(res,503,{code:'SERVICE_UNAVAILABLE',error:'private prompt sk-test-secret'});
    assert.equal(res.code,503);
    assert.match(headers['X-MozAI-Error-ID'],/^[a-f0-9-]{36}$/i);
    const logged=JSON.parse(logs.join(''));
    assert.equal(logged.event,'mozai_api_error');
    assert.equal(logged.code,'SERVICE_UNAVAILABLE');
    assert.ok(!logs.join('').includes('private prompt'));
    assert.ok(!logs.join('').includes('sk-test-secret'));
  }finally{console.error=original}
});
test('success responses are not error-logged',()=>{
  const original=console.error,logs=[];
  console.error=message=>logs.push(message);
  try{send({setHeader(){},status(){return this},json(){return this}},200,{ok:true});assert.equal(logs.length,0)}
  finally{console.error=original}
});
test('legal pages and security headers are present',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
  for(const file of ['privacy.html','terms.html']){let page=fs.readFileSync(path.join(root,file),'utf8');assert.match(page,/mozAI/);assert.match(page,/November 8, 2026/)}
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.ok(vercel.headers.some(rule=>rule.headers.some(header=>header.key==='X-Frame-Options'&&header.value==='DENY')));
});
// Every registered admin benchmark request must pass the browser route gate and the server module must load.
test('benchmark and scene chat API routes are allowed by the browser request guard',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'../account.js'),'utf8');
  const routes=['benchmark-object-map','chat','scene-intent'];
  const gate=code.match(/if\(!\/(\^\\\/api\\\/.*)\/\.test\(path\)\)/)?.[1]||'';
  for(const route of routes)assert.ok(gate.includes(route),route+' must be allowed through the client API gate');
});
test('admin Object ID benchmark handler and cost module can load',()=>{
  assert.equal(typeof require('../lib/ai-benchmark-handler'),'function');
  assert.ok(require('../lib/model-cost').MODELS.length>=1);
});
