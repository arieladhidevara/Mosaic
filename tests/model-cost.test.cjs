const test=require('node:test');
const assert=require('node:assert/strict');
const {MODELS,usageFromModel}=require('../lib/model-cost');
test('Object ID Lab includes 1.5, 2, 2.5 and 2.6',()=>{
  assert.deepEqual(MODELS,['gpt-image-1.5','gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.6-sunburst']);
});
test('each model is priced with its own published image token rates',()=>{
  const usage={input_tokens:1200,output_tokens:300,total_tokens:1500,input_tokens_details:{image_tokens:1000,text_tokens:200}};
  assert.equal(usageFromModel(usage,'gpt-image-1.5').estimated_cost_usd,.0186);
  assert.equal(usageFromModel(usage,'gpt-image-2').estimated_cost_usd,.009);
  assert.equal(usageFromModel(usage,'gpt-image-2.5-sunburst').estimated_cost_usd,.018);
  assert.equal(usageFromModel(usage,'gpt-image-2.6-sunburst').estimated_cost_usd,.018);
});
test('missing modality breakdown is unknown, never estimated as zero',()=>{
  const result=usageFromModel({input_tokens:1200,output_tokens:300,total_tokens:1500},'gpt-image-2');
  assert.equal(result.estimated_cost_usd,null);
});
