const test=require('node:test'),assert=require('node:assert/strict');
const {inferContext,validateContext}=require('../api/ai/edit-context');
function jpeg(){const bytes=Buffer.alloc(80);bytes.set([255,216,255,192,0,17,8,0,64,0,64]);return 'data:image/jpeg;base64,'+bytes.toString('base64')}
test('context inference grounds vague prompts without rewriting their instructions',async()=>{
  const native=global.fetch;let sent;
  try{
    global.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);return Response.json({output:[{content:[{text:JSON.stringify({targetObject:'the cabinet door',confidence:.96})}]}]})};
    const result=await inferContext({image:jpeg(),prompt:'ubah jadi kayu',selectedObjects:['Door']},'sk-test');
    assert.equal(result.targetObject,'the cabinet door');
    assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);
    assert.deepEqual(JSON.parse(sent.input[1].content[0].text),{prompt:'ubah jadi kayu',selectedObjects:['Door']});
    assert.match(sent.input[0].content[0].text,/Do not invent an edit/);
    assert.match(sent.input[0].content[0].text,/Preserve multiple selected objects/);
    assert.equal(sent.input[1].content[1].image_url,jpeg());
  }finally{global.fetch=native}
});
test('uncertain targets remain empty and invalid provider output fails',()=>{
  assert.deepEqual(validateContext({targetObject:'a guess',confidence:.7}),{targetObject:'',confidence:.7});
  for(const value of [{targetObject:'door',confidence:4},{targetObject:22,confidence:.9},{targetObject:'x'.repeat(121),confidence:1},null])assert.throws(()=>validateContext(value),/Invalid/);
});
test('malformed context is rejected before contacting the provider',async()=>{
  const native=global.fetch;try{
    global.fetch=async()=>{throw Error('unexpected provider call')};
    await assert.rejects(inferContext({image:jpeg(),prompt:'wood',selectedObjects:[{}]},'sk-test'),/Invalid edit context/);
  }finally{global.fetch=native}
});
test('provider refusal or unavailable service can fall back to the original prompt',async()=>{
  const native=global.fetch;try{
    global.fetch=async()=>Response.json({error:'offline'},{status:503});
    await assert.rejects(inferContext({image:jpeg(),prompt:'wood'},'sk-test'),/provider unavailable/);
    global.fetch=async()=>Response.json({output:[{content:[{type:'refusal'}]}]});
    await assert.rejects(inferContext({image:jpeg(),prompt:'wood'},'sk-test'));
  }finally{global.fetch=native}
});
