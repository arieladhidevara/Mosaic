const test = require('node:test');
const assert = require('node:assert/strict');
const {validateRequest, parseCompleteEvent, configuredSpace, segmentImage} = require('../lib/hf-sam3');

test('validates image and coordinates before sending to HF', () => {
  const image='data:image/jpeg;base64,/9j/4AAQ';
  assert.equal(validateRequest({image,width:16,height:12,x:3,y:9}).x,3);
  assert.throws(()=>validateRequest({image,width:16,height:12,x:16,y:9}),/coordinates/);
  assert.throws(()=>validateRequest({image:'https://evil/image.jpg',width:16,height:12,x:3,y:9}),/image/);
});

test('only configured HTTPS hf.space origins accepted', () => {
  const old=process.env.MOZAI_HF_SAM3_SPACE_URL;
  try {
    process.env.MOZAI_HF_SAM3_SPACE_URL='https://example.com';
    assert.throws(configuredSpace,/Invalid/);
    process.env.MOZAI_HF_SAM3_SPACE_URL='https://example.hf.space';
    assert.equal(configuredSpace(),'https://example.hf.space');
  } finally {
    if(old === undefined)delete process.env.MOZAI_HF_SAM3_SPACE_URL;
    else process.env.MOZAI_HF_SAM3_SPACE_URL=old;
  }
});

test('parses queued Gradio completion as PNG data URI',()=>{
  const s='event: generating\ndata: null\n\nevent: complete\ndata: ["data:image/png;base64,AAAA"]\n\n';
  assert.equal(parseCompleteEvent(s),'data:image/png;base64,AAAA');
  assert.throws(()=>parseCompleteEvent('event: error\ndata: null\n\n'),/failed/);
});

test('SAM3 performs exactly two calls to fixed Space endpoint',async()=>{
  const oldUrl=process.env.MOZAI_HF_SAM3_SPACE_URL, oldFetch=global.fetch;
  try{
    process.env.MOZAI_HF_SAM3_SPACE_URL='https://mozai-example.hf.space';
    const urls=[];
    global.fetch=async url=>{
      urls.push(url);
      if(url.endsWith('/segment'))return {ok:true,json:async()=>({event_id:'job_12'})};
      return {ok:true,text:async()=> 'event: complete\ndata: ["data:image/png;base64,AAAA"]\n\n'};
    };
    const mask=await segmentImage({image:'data:image/jpeg;base64,/9j/4AAQ',width:16,height:12,x:3,y:9});
    assert.equal(mask,'data:image/png;base64,AAAA');
    assert.deepEqual(urls,[
      'https://mozai-example.hf.space/gradio_api/call/segment',
      'https://mozai-example.hf.space/gradio_api/call/segment/job_12'
    ]);
  } finally {
    global.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.MOZAI_HF_SAM3_SPACE_URL;
    else process.env.MOZAI_HF_SAM3_SPACE_URL=oldUrl;
  }
});
