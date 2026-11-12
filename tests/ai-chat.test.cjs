const test=require('node:test'),assert=require('node:assert/strict');
const {consult}=require('../lib/ai-chat-handler');
const {clean}=require('../lib/ai-project-memory');
const bytes=Buffer.alloc(80);bytes.set([255,216]);
const image='data:image/jpeg;base64,'+bytes.toString('base64');
const objects=[
  {id:'chair-1',label:'Dining Chair',category:'Furniture',box:[0,0,40,40]},
  {id:'chair-2',label:'Dining Chair',category:'Furniture',box:[100,0,40,40]},
  {id:'table-1',label:'Dining Table',category:'Furniture',box:[50,80,100,40]}
];
const hash=n=>n.toString(16).padStart(64,'0');
const contextHashes={base:hash(1),canvas:hash(2),objects:hash(3),prompt:hash(4),references:hash(5)};
const base=()=>({message:'Select all chairs',objects,canvasSize:{width:200,height:200},
  contextHashes:{...contextHashes},projectPrompt:'Warm interior',
  base:image,currentImage:image,history:[],selectedIds:[],confirmedSelectedIds:[],references:[]});
const follow=()=>{const b=base();delete b.base;delete b.currentImage;delete b.objects;delete b.projectPrompt;delete b.references;return b};
const response=(raw={})=>Response.json({
  id:'v1_savedInteraction01',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({
    reply:'Select the chairs.',action:'select',scope:'none',target_ids:['chair-1'],
    group_name:'',edit_prompt:'',reason:'Furniture selection',project_memory:'Preserve furniture placement.',...raw
  })}]}],usage:{total_input_tokens:80,total_output_tokens:20,total_tokens:100}
});
test('Gemini receives live images, labels, and persistent session without exposing private IDs',async()=>{
  const original=global.fetch;let payload;
  try{
    global.fetch=async(url,options)=>{
      assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.headers['x-goog-api-key'],'test-key');
      payload=JSON.parse(options.body);return response();
    };
    const result=await consult(base(),'test-key',{id:'v1_oldInteraction01',memory:'Keep furniture',lastTargetIds:['chair-1']});
    assert.equal(payload.previous_interaction_id,'v1_oldInteraction01');
    assert.equal(payload.model,'gemini-3.5-flash-lite');
    assert.equal(payload.input[1].type,'image');
    assert.equal(payload.input[1].mime_type,'image/jpeg');
    assert.equal(payload.input[1].data,bytes.toString('base64'));
    assert.equal(JSON.parse(payload.input[0].text).persistent_design_memory,'Keep furniture');
    assert.equal(payload.response_format.mime_type,'application/json');
    assert.equal(result.session.id,'v1_savedInteraction01');
    assert.deepEqual(result.targetIds,['chair-1','chair-2']);
    assert.deepEqual(result.usage,{input_tokens:80,output_tokens:20,total_tokens:100});
  }finally{global.fetch=original}
});
test('Select all chairs cannot trigger OpenAI and never selects dining table',async()=>{
  const original=global.fetch;
  try{global.fetch=async()=>response({action:'generate',scope:'region',edit_prompt:'Recolor everything',target_ids:['chair-1','table-1']});
    const result=await consult(base(),'test-key');
    assert.equal(result.action,'select');assert.equal(result.scope,'none');
    assert.equal(result.editPrompt,'');assert.deepEqual(result.targetIds,['chair-1','chair-2']);
  }finally{global.fetch=original}
});
test('Confirmed multi-object selection is authoritative for edit them',async()=>{
  const original=global.fetch;
  try{global.fetch=async()=>response({reply:'I can recolor them.',action:'generate',scope:'region',
    target_ids:['table-1'],edit_prompt:'Change the selected chairs to blue leather'});
    const result=await consult({...base(),message:'Change them to blue leather',selectedIds:['chair-1','chair-2'],
      confirmedSelectedIds:['chair-1','chair-2']},'test-key');
    assert.equal(result.action,'generate');assert.equal(result.scope,'region');
    assert.deepEqual(result.targetIds,['chair-1','chair-2']);
  }finally{global.fetch=original}
});
test('Expired Gemini session restarts with complete current context, not old chat history',async()=>{
  const original=global.fetch;const bodies=[];let calls=0;
  try{
    global.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body);bodies.push(body);calls++;
      return calls===1?Response.json({error:{message:'Previous interaction ID not found'}},{status:400}):response();
    };
    const result=await consult({...base(),message:'Which finish?',history:[{role:'user',text:'Keep the desk'}]},
      'test-key',{id:'v1_expired',memory:'Keep desk',lastTargetIds:[]});
    assert.equal(calls,2);assert.equal(bodies[1].previous_interaction_id,undefined);
    assert.equal(JSON.parse(bodies[1].input[0].text).conversation_recovery,undefined);
    assert.equal(JSON.parse(bodies[1].input[0].text).objects.length,3);
    assert.equal(result.session.memory,'Preserve furniture placement.');
  }finally{global.fetch=original}
});
test('Quota and auth errors are visible and are not retried',async()=>{
  const original=global.fetch;
  try{for(const [status,code] of [[429,'GEMINI_QUOTA'],[403,'GEMINI_AUTH'],[500,'GEMINI_UNAVAILABLE']]){
    let calls=0;global.fetch=async()=>{calls++;return Response.json({error:{message:'provider secret'}},{status})};
    await assert.rejects(consult(base(),'test-key'),e=>e.code===code&&!e.message.includes('provider secret'));
    assert.equal(calls,1);
  }}finally{global.fetch=original}
});
test('Invalid image, long history, browser secrets, and malformed output are rejected',async()=>{
  const original=global.fetch;
  try{
    global.fetch=async()=>{throw Error('Should not call provider')};
    for(const bad of [{base:'invalid'},{history:Array(13).fill({role:'user',text:'hi'})},
      {apiKey:'browser-key'},{objects:Array(101).fill({id:'a',label:'b'})},
      {references:[image,image,image,image]}])
      await assert.rejects(consult({...base(),...bad},'test-key'),e=>e.status===400);
    global.fetch=async()=>Response.json({id:'test',steps:[{type:'model_output',content:[{type:'text',text:'bad json'}]}]});
    await assert.rejects(consult(base(),'test-key'),e=>e.code==='GEMINI_INVALID_RESPONSE');
  }finally{global.fetch=original}
});
test('Saved Gemini memory strips unsafe data',()=>{
  assert.deepEqual(clean({id:'bad/identifier',memory:'hello',lastTargetIds:['chair-1','chair-1',12]}),
    {id:null,memory:'hello',lastTargetIds:['chair-1'],context:null});
});

test('Omit unchanged Base, canvas, object map and project prompt on an active session',async()=>{
  const original=global.fetch;const calls=[];
  try{
    global.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return response()};
    const first=await consult(base(),'test-key');
    const next=await consult({...follow(),message:'What about the lighting?'},
      'test-key',first.session);
    assert.equal(calls.length,2);
    assert.equal(calls[1].previous_interaction_id,first.session.id);
    assert.equal(calls[1].input.length,1);
    const metadata=JSON.parse(calls[1].input[0].text);
    assert.equal(metadata.user_message,'What about the lighting?');
    assert.equal(metadata.objects,undefined);
    assert.equal(metadata.object_updates,undefined);
    assert.equal(metadata.project_design_intent,undefined);
    assert.equal(metadata.persistent_design_memory,undefined);
    assert.deepEqual(next.session.context.objects,first.session.context.objects);
  }finally{global.fetch=original}
});
test('Changed canvas sends only current canvas image; changed labels send only object updates',async()=>{
  const original=global.fetch;const calls=[];
  try{
    global.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return response()};
    const first=await consult(base(),'test-key');
    const changedCanvas={...follow(),message:'Review my new render',
      contextHashes:{...contextHashes,canvas:hash(17)},currentImage:image};
    const second=await consult(changedCanvas,'test-key',first.session);
    assert.deepEqual(calls[1].input.map(x=>x.type),['text','image']);
    assert.equal(JSON.parse(calls[1].input[0].text).objects,undefined);
    assert.equal(JSON.parse(calls[1].input[0].text).current_canvas_updated,true);
    const renamed=objects.map(o=>o.id==='chair-1'?{...o,label:'Lounge Chair'}:o);
    const withLabel={...follow(),message:'Select all chairs',
      contextHashes:{...contextHashes,canvas:hash(17),objects:hash(19)},objects:renamed};
    await consult(withLabel,'test-key',second.session);
    const metadata=JSON.parse(calls[2].input[0].text);
    assert.equal(calls[2].input.length,1);
    assert.equal(metadata.object_updates.upsert.length,1);
    assert.equal(metadata.object_updates.upsert[0].label,'Lounge Chair');
    assert.deepEqual(metadata.object_updates.removed_ids,[]);
  }finally{global.fetch=original}
});
test('Partial context requires a complete snapshot after Gemini session expiry',async()=>{
  const original=global.fetch;
  try{
    global.fetch=async()=>response();
    const first=await consult(base(),'test-key');
    let attempts=0;
    global.fetch=async()=>{attempts++;return Response.json({error:{message:'Previous interaction ID not found'}},{status:400})};
    await assert.rejects(consult(follow(),'test-key',first.session),
      e=>e.status===409&&e.code==='GEMINI_CONTEXT_REQUIRED');
    assert.equal(attempts,1);
    const partial={...follow(),contextHashes:{...contextHashes,objects:hash(21)}};
    await assert.rejects(consult(partial,'test-key',first.session),
      e=>e.status===409&&e.code==='GEMINI_CONTEXT_REQUIRED');
    assert.equal(attempts,1,'Must reject incomplete context before calling provider');
  }finally{global.fetch=original}
});
