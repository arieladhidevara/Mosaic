const test=require('node:test'),assert=require('node:assert/strict');
const {summary,analytics}=require('../lib/admin-analytics');
test('analytics separates users, tools, paid operations and unknown cost coverage',()=>{
  const date='2026-11-08T10:00:00.000Z';
  const generations=[{user_id:'a',project_id:'p',created_at:date,operation:'edit',status:'success',total_tokens:100,estimated_cost_usd:.03},
    {user_id:'a',project_id:'p',created_at:date,operation:'harmonize',status:'failed',total_tokens:null,estimated_cost_usd:null},
    {user_id:'b',project_id:'q',created_at:date,operation:'master',status:'success',total_tokens:500,estimated_cost_usd:.2}];
  const events=['wand_used','wand_used','auto_create_used','mask_edited','selection_created'].map(type=>({user_id:'a',project_id:'p',created_at:date,type}));
  const data={users:[{id:'a',email:'a@example.test'},{id:'b',email:'b@example.test'}],projects:[{id:'p',user_id:'a'},{id:'q',user_id:'b'}],generations,events};
  const global=analytics(data,{now:new Date(date)}),user=analytics(data,{userId:'a',now:new Date(date)});
  assert.equal(global.summary.edits,3);assert.equal(global.summary.estimated_cost_usd,.23);
  assert.equal(user.summary.edits,2);assert.equal(user.summary.masking,1);assert.equal(user.summary.harmonize,1);
  assert.equal(user.summary.wand,2);assert.equal(user.summary.auto_create,1);assert.equal(user.summary.mask_edits,1);
  assert.equal(user.summary.estimated_cost_usd,.03);assert.equal(user.summary.cost_records,1);
  assert.equal(user.daily.length,30);assert.equal(user.daily.at(-1).wand,2);assert.equal(user.daily.at(-1).edits,2);
  assert.equal(user.users.length,1);assert.equal(user.users[0].email,'a@example.test');
  assert.equal(analytics(data,{userId:'a',projectId:'q',now:new Date(date)}).summary.edits,0);
  assert.equal(summary([{operation:'edit',status:'success'}]).estimated_cost_usd,null);
});
test('activity events deduplicate and only admins can read local per-user analytics',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mozai-analytics-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=require('../lib/data-store').createStore(path.join(directory,'data.json'));
  const actor={id:randomUUID(),role:'admin',auth:'development',environment:'development',email:'admin@example.test'};
  const project=await store.createProject(actor),id=randomUUID();
  for(let i=0;i<2;i++)await store.event(actor,{id,type:'wand_used',projectId:project.id});
  await store.event(actor,{id:randomUUID(),type:'auto_create_used',projectId:project.id});
  const result=await store.adminAnalytics(actor);assert.equal(result.summary.wand,1);assert.equal(result.summary.auto_create,1);
  await assert.rejects(store.adminAnalytics({...actor,role:'user'}),/Administrator/);
  await assert.rejects(store.event(actor,{id:randomUUID(),type:'fake',projectId:project.id}),/Invalid/);
});
test('hosted analytics remains readable before migration and scopes every fallback query',async()=>{
  const store=require('../lib/data-store'),{randomUUID}=require('node:crypto');
  const userId=randomUUID(),projectId=randomUUID(),nativeFetch=global.fetch;
  const values={SUPABASE_URL:'https://analytics.example.test',SUPABASE_PUBLISHABLE_KEY:'test-public',SUPABASE_SECRET_KEY:'test-secret'};
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
  global.fetch=async url=>{
    const u=new URL(url);assert.equal(u.hostname,'analytics.example.test');
    if(u.pathname.includes('/rpc/'))return Response.json({code:'PGRST202'},{status:404});
    assert.equal(u.searchParams.get('environment'),'eq.production');assert.equal(u.searchParams.get('user_id'),'eq.'+userId);
    const table=u.pathname.split('/').at(-1);
    if(table!=='mosaic_members')assert.equal(u.searchParams.get(table==='mosaic_projects'?'id':'project_id'),'eq.'+projectId);
    if(table==='mosaic_members')return Response.json([{user_id:userId,email:'scoped@example.test'}]);
    if(table==='mosaic_projects')return Response.json([{id:projectId,user_id:userId}]);
    if(table==='mosaic_generations')return Response.json([{id:randomUUID(),user_id:userId,project_id:projectId,operation:'harmonize',status:'success',estimated_cost_usd:.1,created_at:new Date().toISOString()}]);
    return Response.json([]);
  };
  try{
    const report=await store.adminAnalytics({id:randomUUID(),role:'admin',auth:'supabase',environment:'production'},{userId,projectId});
    assert.equal(report.migration_required,true);assert.equal(report.summary.harmonize,1);assert.equal(report.summary.estimated_cost_usd,.1);
    assert.equal(report.summary.wand,0);assert.equal(report.truncated,false);
  }finally{global.fetch=nativeFetch;for(const key of Object.keys(values)){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}}
});
