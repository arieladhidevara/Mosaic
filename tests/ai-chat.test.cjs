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
const base=()=>({message:'Select all chairs',objects,canvasSize:{width:200,height:200},
  base:image,currentImage:image,history:[],selectedIds:[],confirmedSelectedIds:[],references:[]});
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
test('Expired Gemini session recovers using local chat history and long-lived design memory',async()=>{
  const original=global.fetch;const bodies=[];let calls=0;
  try{
    global.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body);bodies.push(body);calls++;
      return calls===1?Response.json({error:{message:'Previous interaction ID not found'}},{status:400}):response();
    };
    const result=await consult({...base(),message:'Which finish?',history:[{role:'user',text:'Keep the desk'}]},
      'test-key',{id:'v1_expired',memory:'Keep desk',lastTargetIds:[]});
    assert.equal(calls,2);assert.equal(bodies[1].previous_interaction_id,undefined);
    assert.deepEqual(JSON.parse(bodies[1].input[0].text).conversation_recovery,[{role:'user',text:'Keep the desk'}]);
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
    {id:null,memory:'hello',lastTargetIds:['chair-1']});
});
