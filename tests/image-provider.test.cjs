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
const request=(body={})=>({headers:{},openAiApiKey:'sk-mosaic-test-placeholder',body:{prompt:'Warm walnut wall',collage,base,mask,...body}});

test('image generation request contract',async t=>{
  const originalFetch=global.fetch;let sent;
  t.after(()=>{global.fetch=originalFetch});
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/images/edits');
    sent=JSON.parse(options.body);
    return {ok:true,json:async()=>({data:[{b64_json:'mock-image'}]})};
  };
  for(const quality of ['low','medium','high']){
    for(const preserve of [true])await t.test(`Region ${quality}, geometry ${preserve}`,async()=>{
      const result=await generate(request({quality,...(preserve?{base}:{})}),true);
      assert.equal(result.model,'gpt-image-2.6-sunburst');
      assert.equal(sent.quality,quality);assert.equal(sent.size,'auto');
      assert.deepEqual(sent.images,[{image_url:collage},...(preserve?[{image_url:base}]:[])]);
      assert.deepEqual(sent.mask,{image_url:mask});
      assert.equal(sent.prompt.includes('Image 2 is the full original Base'),preserve);
      assert.doesNotMatch(sent.prompt,/colored region guide/i);
      assert.equal(sent.output_format,'jpeg');assert.equal(sent.output_compression,100);assert.equal(sent.n,1);
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
      assert.equal(sent.size,'2048x1536');
      assert.equal(sent.mask,undefined);assert.equal(sent.model,'gpt-image-2.6-sunburst');
    });
  }
  await t.test('Region Guide is ignored, including legacy payloads',async()=>{
    await generate(request({guide:'invalid-and-must-not-be-forwarded',references:[base]}),true);
    assert.deepEqual(sent.images,[{image_url:collage},{image_url:base},{image_url:base}]);
    assert.equal(sent.guide,undefined);assert.equal(sent.quality,'medium');
  });
  await t.test('initial references supply materials and style while Base owns geometry',async()=>{
    const reference=image(384,384);
    await generate(request({references:[reference]}),false,'master');
    assert.deepEqual(sent.images,[{image_url:base},{image_url:reference}]);
    assert.match(sent.prompt,/Image 1 is the sole authority for geometry/);
    assert.match(sent.prompt,/MATERIAL AND STYLE REFERENCES ONLY/);
    assert.match(sent.prompt,/Base always wins/);
  });
  await t.test('composition chat sends latest collage, Base, markup and style references in order',async()=>{
    const markup=image(256,256),reference=image(384,384);
    await generate(request({mode:'chat',markup,references:[reference]}),false);
    assert.deepEqual(sent.images,[{image_url:collage},{image_url:base},{image_url:markup},{image_url:reference}]);
    assert.match(sent.prompt,/FULL COMPOSITION EDIT/);
    assert.match(sent.prompt,/Image 3 is the current composition with user-drawn arrows/);
    assert.match(sent.prompt,/remove every mark/);
    assert.match(sent.prompt,/final 1 images are MATERIAL AND STYLE REFERENCES ONLY/);
    assert.equal(sent.mask,undefined);
  });
  await t.test('masked material edits retain object identity and the current scene context',async()=>{
    const context=image(1000,700),reference=image(384,384);
    await generate(request({context,targetObject:'Door',crop:{x:200,y:100,width:256,height:256,imageWidth:1000,imageHeight:700},references:[reference]}),true);
    assert.deepEqual(sent.images,[{image_url:collage},{image_url:base},{image_url:context},{image_url:reference}]);
    assert.deepEqual(sent.mask,{image_url:mask});
    assert.match(sent.prompt,/selected object is described as: Door/);
    assert.match(sent.prompt,/RESOLVED EDIT TARGET \(scene context\): Door/);
    assert.match(sent.prompt,/transparent part of the input mask means EDIT HERE/);
    assert.match(sent.prompt,/preserve its leaf, frame, opening, handle/);
    assert.match(sent.prompt,/Image 3 is the FULL CURRENT COMPOSITION/);
    assert.match(sent.prompt,/x=200, y=100, width=256, height=256/);
    assert.match(sent.prompt,/output only the crop in Image 1/);
  });
  await t.test('opt-in material cutouts return PNG with real transparency, without JPEG compression',async()=>{
    const result=await generate(request({transparentLayer:true,targetObject:'Wall with two door openings'}),true);
    assert.equal(result.mimeType,'image/png');
    assert.equal(sent.background,'transparent');
    assert.equal(sent.output_format,'png');
    assert.equal(sent.output_compression,undefined);
    assert.deepEqual(sent.mask,{image_url:mask});
    assert.match(sent.prompt,/TRANSPARENT OUTPUT CONTRACT/);
    assert.match(sent.prompt,/true RGBA|true transparency|TRUE transparent/i);
    assert.match(sent.prompt,/UNSELECTED/);
  });
  await t.test('shape/create/remove never use transparent cutouts',async()=>{
    for(const editIntent of ['shape','create','remove']){
      const result=await generate(request({transparentLayer:true,editIntent}),true);
      assert.equal(result.mimeType,'image/jpeg');
      assert.equal(sent.output_format,'jpeg');
      assert.equal(sent.background,undefined);
    }
  });
  await t.test('full-image edits remain opaque even if transparency was requested',async()=>{
    const result=await generate(request({transparentLayer:true}),false);
    assert.equal(result.mimeType,'image/jpeg');
    assert.equal(sent.output_format,'jpeg');
    assert.equal(sent.background,undefined);
  });
  await t.test('invalid scene crops fail before a provider request',async()=>{
    await assert.rejects(generate(request({context:base,crop:{x:500,y:0,width:256,height:256,imageWidth:512,imageHeight:384}}),true),/Invalid crop context/);
  });
  await t.test('legacy Harmonize defaults to High; missing Base is rejected',async()=>{
    await generate(request({base}),false);assert.equal(sent.quality,'high');
    await assert.rejects(generate(request({base:undefined}),false),/Missing image/);
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

test('first Master resolution is independent of Base pixel count and stays on the supported grid',()=>{
  const {target}=require('../master-resolution');
  assert.deepEqual(target(320,240),{width:2048,height:1536});assert.deepEqual(target(240,320),{width:1536,height:2048});
  assert.deepEqual(target(100,100),{width:1920,height:1920});assert.deepEqual(target(6000,4500),target(320,240));
  for(const [w,h] of [[900,600],[1280,720],[100,99],[1,3],[3,1]]){
    const size=target(w,h);assert.equal(size.width%16,0);assert.equal(size.height%16,0);assert(size.width*size.height<=3686400);assert(Math.max(size.width/size.height,size.height/size.width)<=3.01);
  }
  assert.equal(target(600,100),null);assert.equal(target(0,100),null);
});
