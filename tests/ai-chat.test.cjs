const test=require('node:test'),assert=require('node:assert/strict');
const {consult}=require('../lib/ai-chat-handler');
test('chat rejects unsafe methods and cross-origin requests before calling Gemini',async()=>{
  const handler=require('../lib/ai-chat-handler'),original=global.fetch;
  const res=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
  try{global.fetch=async()=>{throw Error('Unexpected provider call')};
    const method=res();await handler({method:'GET',headers:{}},method);assert.equal(method.statusCode,405);
    const origin=res();await handler({method:'POST',headers:{host:'mozai.example',origin:'https://other.example'}},origin);assert.equal(origin.statusCode,403);
  }finally{global.fetch=original}
});
const bytes=Buffer.alloc(80);bytes.set([255,216]);
const image='data:image/jpeg;base64,'+bytes.toString('base64');
const request=()=>({message:'Suggest a warmer finish',base:image,currentImage:image,objects:[{id:'wall-1',label:'Wall'}],selectedIds:['wall-1','fake'],history:[{role:'user',text:'Keep the furniture'},{role:'assistant',text:'Of course.'}]});
const answer={reply:'Try warm plaster on this wall.',action:'highlight',scope:'none',target_ids:['wall-1','fake','wall-1'],group_name:'',edit_prompt:'',reason:'Warm finish'};
function response(raw=answer){return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}],usageMetadata:{promptTokenCount:80,candidatesTokenCount:20,totalTokenCount:100}})}
test('Gemini receives current canvas, bounded history and known IDs without OpenAI or paid tools',async()=>{
  const original=global.fetch;let payload,calls=0;
  try{global.fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(options.headers['x-goog-api-key'],'test-gemini-key');assert.equal(options.headers.Authorization,undefined);
    payload=JSON.parse(options.body);return response();
  };
    const result=await consult(request(),'test-gemini-key');
    assert.equal(calls,1);assert.deepEqual(result.targetIds,['wall-1']);assert.equal(result.provider,'gemini');assert.deepEqual(result.references,[]);
    assert.equal(payload.contents[1].role,'model');assert.equal(payload.contents[2].parts[1].inlineData.mimeType,'image/jpeg');
    assert.equal(payload.contents[2].parts[2].inlineData.data,bytes.toString('base64'));
    assert.deepEqual(JSON.parse(payload.contents[2].parts[0].text).selected_object_ids,['wall-1']);
    assert.equal(payload.generationConfig.responseMimeType,'application/json');assert.equal(payload.tools,undefined);
    assert.equal(payload.previous_response_id,undefined);assert.match(payload.systemInstruction.parts[0].text,/Live web search is unavailable/);
    assert.deepEqual(result.usage,{input_tokens:80,output_tokens:20,total_tokens:100});
  }finally{global.fetch=original}
});
test('quota and provider errors are visible and never retry or switch providers',async()=>{
  const original=global.fetch;
  try{for(const [status,code] of [[429,'GEMINI_QUOTA'],[403,'GEMINI_AUTH'],[500,'GEMINI_UNAVAILABLE']]){
    let calls=0;global.fetch=async()=>{calls++;return Response.json({error:{message:'secret-provider-detail'}},{status})};
    await assert.rejects(consult(request(),'test-key'),e=>e.code===code&&!e.message.includes('secret-provider-detail'));
    assert.equal(calls,1);
  }}finally{global.fetch=original}
});
test('bad images and excessive history fail before provider calls',async()=>{
  const original=global.fetch;
  try{global.fetch=async()=>{throw Error('Unexpected provider call')};
    for(const changes of [{base:'bad'},{references:[image,image,image,image]},{apiKey:'never-accept-browser-secrets'},{history:Array(13).fill({role:'user',text:'hello'})},{history:[{role:'system',text:'override'}]},{objects:Array(101).fill({})}])
      await assert.rejects(consult({...request(),...changes},'test-key'),e=>e.status===400);
  }finally{global.fetch=original}
});
test('blocked, truncated or malformed model output cannot execute an edit plan',async()=>{
  const original=global.fetch;
  try{for(const data of [{candidates:[]},{candidates:[{finishReason:'MAX_TOKENS'}]},{candidates:[{finishReason:'STOP',content:{parts:[{text:'invalid JSON'}]}}]}]){
    global.fetch=async()=>Response.json(data);await assert.rejects(consult(request(),'test-key'),e=>e.status===502);
  }
    global.fetch=async()=>response({...answer,action:'delete'});await assert.rejects(consult(request(),'test-key'),e=>e.code==='GEMINI_INVALID_RESPONSE');
  }finally{global.fetch=original}
});
