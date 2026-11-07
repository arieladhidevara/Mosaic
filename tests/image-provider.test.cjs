const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generate}=require('../lib/image-provider');

// Minimal PNG headers are sufficient for the provider's dimension validation.
function image(w=256,h=256){
  const bytes=Buffer.alloc(80);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
  bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);
  return 'data:image/png;base64,'+bytes.toString('base64');
}
const collage=image(),base=image(512,384),mask=image();
const request=(body={})=>({headers:{},body:{apiKey:'sk-mosaic-test-placeholder',prompt:'Warm walnut wall',collage,mask,...body}});

test('image generation request contract',async t=>{
  const originalFetch=global.fetch;let sent;
  t.after(()=>{global.fetch=originalFetch});
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/images/edits');
    sent=JSON.parse(options.body);
    return {ok:true,json:async()=>({data:[{b64_json:'mock-image'}]})};
  };
  for(const quality of ['low','medium','high']){
    for(const preserve of [false,true])await t.test(`Region ${quality}, geometry ${preserve}`,async()=>{
      const result=await generate(request({quality,...(preserve?{base}:{})}),true);
      assert.equal(result.model,'gpt-image-2.6-sunburst');
      assert.equal(sent.quality,quality);assert.equal(sent.size,'auto');
      assert.deepEqual(sent.images,[{image_url:collage},...(preserve?[{image_url:base}]:[])]);
      assert.deepEqual(sent.mask,{image_url:mask});
      assert.equal(sent.prompt.includes('Image 2 is the full original Base'),preserve);
      assert.doesNotMatch(sent.prompt,/colored region guide/i);
      assert.equal(sent.output_format,'jpeg');assert.equal(sent.output_compression,83);assert.equal(sent.n,1);
      assert.deepEqual(Object.keys(sent).sort(),['images','mask','model','n','output_compression','output_format','prompt','quality','size']);
    });
    await t.test(`Harmonize ${quality} always includes Base`,async()=>{
      await generate(request({base,quality,preserveOriginalGeometry:false}),false);
      assert.equal(sent.quality,quality);assert.deepEqual(sent.images,[{image_url:collage},{image_url:base}]);
      assert.equal(sent.mask,undefined);assert.equal(sent.model,'gpt-image-2.6-sunburst');
    });
    await t.test(`Initial Master stays High when requested quality is ${quality}`,async()=>{
      await generate(request({base,quality}),false,'master');
      assert.equal(sent.quality,'high');assert.deepEqual(sent.images,[{image_url:base}]);
      assert.equal(sent.mask,undefined);assert.equal(sent.model,'gpt-image-2.6-sunburst');
    });
  }
  await t.test('Region Guide is ignored, including legacy payloads',async()=>{
    await generate(request({guide:'invalid-and-must-not-be-forwarded',references:[base]}),true);
    assert.deepEqual(sent.images,[{image_url:collage},{image_url:base}]);
    assert.equal(sent.guide,undefined);assert.equal(sent.quality,'medium');
  });
  await t.test('legacy Harmonize defaults to High; missing Base is rejected',async()=>{
    await generate(request({base}),false);assert.equal(sent.quality,'high');
    await assert.rejects(generate(request(),false),/Missing image/);
  });
  await t.test('invalid quality and mismatched masks fail before sending',async()=>{
    await assert.rejects(generate(request({quality:'ultra'}),true),/Quality must be/);
    await assert.rejects(generate(request({mask:image(128,256)}),true),/Mask dimensions/);
  });
  await t.test('OpenAI errors propagate without returning a false success',async()=>{
    global.fetch=async()=>({ok:false,status:429,json:async()=>({error:{message:'Rate limited'}})});
    await assert.rejects(generate(request(),true),{message:'Rate limited',status:429});
  });
});
