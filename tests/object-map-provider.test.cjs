const test=require('node:test'),assert=require('node:assert/strict');
const {generateObjectMap}=require('../lib/object-map-provider');
const png=(w=1024,h=1024)=>{const b=Buffer.alloc(80);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b.toString('base64')};
const req=()=>({openAiApiKey:'sk-object-map-test-placeholder',body:{image:'data:image/png;base64,'+png(),model:'untrusted',prompt:'untrusted'}});
test('object-map uses exact-sized Sunburst PNG and validates category IDs',async()=>{
  const original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return Response.json(url.endsWith('/images/edits')?{data:[{b64_json:png()}]}:{output_text:JSON.stringify({objects:[{id:1,category:'Door',label:'door'},{id:1,category:'Floor',label:'duplicate'},{id:99,category:'Wall',label:'invalid'}]})})};
  try{const result=await generateObjectMap(req());assert.equal(calls[0].body.model,'gpt-image-2.6-sunburst');assert.equal(calls[0].body.output_format,'png');assert.equal(calls[0].body.size,'1024x1024');assert.match(calls[0].body.prompt,/No shading/);assert.ok(!calls[0].body.prompt.includes('untrusted'));assert.equal(calls[1].body.store,false);assert.deepEqual(result.legend,[{id:1,category:'Door',label:'door'}]);assert.equal(result.labelsAvailable,true)}finally{global.fetch=original}
});
test('invalid dimensions and changed-size results fail; quota propagates without another call',async()=>{
  const original=global.fetch;let calls=0;
  try{
    const bad=req();bad.body.image='data:image/png;base64,'+png(130,256);await assert.rejects(generateObjectMap(bad),/dimensions/);
    bad.body.image='data:image/png;base64,'+png(1024,608);await assert.rejects(generateObjectMap(bad),/dimensions/);
    global.fetch=async()=>{calls++;return Response.json({data:[{b64_json:png(512,256)}]})};await assert.rejects(generateObjectMap(req()),/changed image dimensions/);assert.equal(calls,1);
    calls=0;global.fetch=async()=>{calls++;return Response.json({error:{message:'Rate limited'}},{status:429})};await assert.rejects(generateObjectMap(req()),error=>error.status===429);assert.equal(calls,1);
  }finally{global.fetch=original}
});
test('label-service failure keeps a usable PNG with an explicit missing-label flag',async()=>{
  const original=global.fetch;global.fetch=async url=>url.endsWith('/images/edits')?Response.json({data:[{b64_json:png()}]}):Response.json({error:'offline'},{status:502});
  try{const result=await generateObjectMap(req());assert.equal(result.image,png());assert.equal(result.labelsAvailable,false);assert.deepEqual(result.legend,[])}finally{global.fetch=original}
});

test('instance instructions separate same-material neighbors and labels preserve concrete names and scene groups',async()=>{
  const original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json(url.endsWith('/images/edits')?{data:[{b64_json:png()}]}:{output_text:JSON.stringify({objects:[{id:2,category:'Other',label:'Dining table',group:'Dining area'},{id:3,category:'Other',label:'Lounge chair',group:'Lounge area'}]})})};
  try{
    const result=await generateObjectMap(req());
    assert.match(calls[0].prompt,/NOT MATERIALS/);assert.match(calls[0].prompt,/Two wooden chairs are TWO objects/);assert.match(calls[0].prompt,/ADJACENCY RULE/);assert.match(calls[0].prompt,/strongly contrasting/);
    assert.deepEqual(result.legend,[{id:2,category:'Furniture',label:'Dining table',group:'Dining area'},{id:3,category:'Furniture',label:'Lounge chair',group:'Lounge area'}]);
    assert.equal(calls[1].input[1].content[0].detail,'high');assert.match(calls[1].input[0].content[0].text,/concrete OBJECT NAME/);
  }finally{global.fetch=original}
});
