const test=require('node:test'),assert=require('node:assert/strict');
const {validateIntent}=require('../api/ai/object-intent');
const {validateObjectRequest,segmentImage}=require('../lib/hf-sam3');
test('intent validation rejects unsafe confidence and unknown scene identities',()=>{
  const intent={kind:'object',label:'table',confidence:.9,geometry:'change',behind:['other','known']};
  assert.deepEqual(validateIntent(intent,['known']).behind,['known']);
  assert.throws(()=>validateIntent({...intent,confidence:NaN}),/Invalid/);
  assert.throws(()=>validateIntent({...intent,kind:'anything'}),/Invalid/);
});
test('semantic SAM validates spatial guidance before using fixed HF origin',async()=>{
  const body={mode:'object',image:'data:image/jpeg;base64,AAAA',width:20,height:10,label:'table',box:[2,2,18,9]};
  assert.equal(validateObjectRequest(body).label,'table');
  assert.throws(()=>validateObjectRequest({...body,box:[2,2,21,9]}),/guidance/);
  assert.throws(()=>validateObjectRequest({...body,label:'\n'}),/guidance/);
  const originalFetch=global.fetch,originalURL=process.env.MOZAI_HF_SAM3_SPACE_URL,calls=[];
  try{
    process.env.MOZAI_HF_SAM3_SPACE_URL='https://mozai-test.hf.space';
    global.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/segment_object')?{ok:true,json:async()=>({event_id:'semantic_1'})}:{ok:true,text:async()=>('event: complete\ndata: ["data:image/png;base64,AAAA"]\n\n')}};
    assert.equal(await segmentImage(body),'data:image/png;base64,AAAA');
    assert.deepEqual(JSON.parse(calls[0].options.body).data,[body.image,'table',2,2,18,9]);
    assert.equal(calls[1].url,'https://mozai-test.hf.space/gradio_api/call/segment_object/semantic_1');
  }finally{global.fetch=originalFetch;if(originalURL===undefined)delete process.env.MOZAI_HF_SAM3_SPACE_URL;else process.env.MOZAI_HF_SAM3_SPACE_URL=originalURL}
});
