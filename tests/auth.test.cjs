const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const policy=require('../lib/dev-auth');
const accounts=require('../lib/accounts');
const {guard}=require('../lib/auth');
const store=require('../lib/data-store');
const session=require('../api/session');
const admin=require('../api/admin');
const edit=require('../api/ai/edit');
const {usageFrom}=require('../lib/generation-tracking');
const keys=['NODE_ENV','MOSAIC_DEV_AUTH','VERCEL','VERCEL_ENV','VERCEL_URL','VERCEL_REGION','VERCEL_DEPLOYMENT_ID','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','MOSAIC_APP_ORIGIN'];
async function env(values,fn){
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);Object.assign(process.env,values);
  try{return await fn()}finally{keys.forEach(k=>{if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]})}
}
function req(overrides={}){return {method:'GET',url:'/api/session',headers:{host:'localhost:8000',origin:'http://localhost:8000'},socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1'},body:{},...overrides}}
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(value){this.body=value;return this}}}
const local={NODE_ENV:'development',MOSAIC_DEV_AUTH:'true'};
const production={NODE_ENV:'production',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-public',SUPABASE_SECRET_KEY:'test-server-secret'};
function productionRequest(body={}){return req({method:'POST',url:'/api/admin',headers:{host:'mosaic.example',origin:'https://mosaic.example',cookie:'__Host-mosaic_session=verified-by-server'},body})}
const userId='11111111-1111-4111-8111-111111111111';
function mockIdentity(role='user',status='active'){
  const original=global.fetch;const urls=[];
  global.fetch=async(url,options)=>{
    urls.push(String(url));
    if(String(url).endsWith('/auth/v1/user'))return Response.json({id:userId,email:'tester@example.com',email_confirmed_at:'2026-11-07T00:00:00Z',user_metadata:{role:'admin'},app_metadata:{role:'admin'}});
    if(String(url).includes('/rest/v1/mosaic_members?'))return Response.json([{user_id:userId,email:'tester@example.com',role,status,environment:'production'}]);
    throw Error('Unexpected request: '+url);
  };
  return {urls,restore:()=>{global.fetch=original}};
}
test('development login requires explicit flags and both loopback sockets',async()=>{
  assert.equal(policy.isDevelopmentRequest(req(),local),true);
  for(const environment of [{},{NODE_ENV:'development'},{MOSAIC_DEV_AUTH:'true'},{NODE_ENV:'production',MOSAIC_DEV_AUTH:'true'},{NODE_ENV:'test',MOSAIC_DEV_AUTH:'true'},{NODE_ENV:'development',MOSAIC_DEV_AUTH:'TRUE'}])assert.equal(policy.isDevelopmentRequest(req(),environment),false);
  for(const field of ['remoteAddress','localAddress'])assert.equal(policy.isDevelopmentRequest(req({socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1',[field]:'192.168.1.2'}}),local),false);
  assert.equal(policy.isDevelopmentRequest(req({socket:undefined}),local),false);
  for(const host of ['localhost.evil.test:8000','example.com','127.0.0.1.evil:8000','localhost:8000@evil.test'])assert.equal(policy.isDevelopmentRequest(req({headers:{host}}),local),false);
});
test('Vercel Preview and Production cannot activate bypass, including misconfigured development flags',()=>{
  for(const key of ['VERCEL','VERCEL_ENV','VERCEL_URL','VERCEL_REGION','VERCEL_DEPLOYMENT_ID'])for(const value of ['production','preview','1','0',''])assert.equal(policy.isDevelopmentRequest(req(),{...local,[key]:value}),false,key+'='+value);
  for(const header of ['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-vercel-id'])assert.equal(policy.isDevelopmentRequest(req({headers:{host:'localhost:8000',[header]:'127.0.0.1'}}),local),false);
});
test('development identity is stable and independent of caller IDs and roles',async()=>env(local,async()=>{
  const actor=await accounts.authenticate(req({body:{userId:'attacker',role:'admin',environment:'production'},headers:{host:'localhost:8000',authorization:'Bearer arbitrary'}}));
  assert.deepEqual(actor,policy.DEV_USER);assert.equal(actor.id,'00000000-0000-4000-8000-000000000001');
}));
test('production and preview requests cannot use local auto-login or forged admin headers',async()=>{
  for(const flags of [{NODE_ENV:'production',MOSAIC_DEV_AUTH:'true'},{...local,VERCEL_ENV:'preview'},{...local,VERCEL:'1'}])await env(flags,async()=>{
    const response=res();await session(req({body:{userId:policy.DEV_USER.id,role:'admin'},headers:{host:'localhost:8000','x-user-role':'admin'}}),response);
    assert.equal(response.statusCode,401);assert.equal(response.body.authenticated,undefined);
  });
});
test('only verified Supabase user plus active database membership grants access',async()=>env(production,async()=>{
  const mock=mockIdentity();
  try{
    const request=productionRequest({userId:policy.DEV_USER.id,role:'admin'}),response=res();
    assert.equal(await guard(request,response,'POST'),true);assert.equal(request.account.id,userId);assert.equal(request.account.role,'user');
    const denied=res();await admin(productionRequest({action:'invite',role:'admin'}),denied);assert.equal(denied.statusCode,403);assert.equal(denied.body.code,'ADMIN_REQUIRED');
    assert(mock.urls.some(u=>u.endsWith('/auth/v1/user')),'Session was not verified with Supabase Auth');
  }finally{mock.restore()}
  const blocked=mockIdentity('admin','suspended');
  try{const response=res();await session({...productionRequest(),method:'GET'},response);assert.equal(response.statusCode,403)}finally{blocked.restore()}
}));
test('invalid Supabase token is rejected before reading admin or analytics data',async()=>env(production,async()=>{
  const original=global.fetch,urls=[];global.fetch=async url=>{urls.push(String(url));return Response.json({error:'invalid token'},{status:401})};
  try{const response=res();await admin(productionRequest(),response);assert.equal(response.statusCode,401);assert.equal(urls.length,1);assert.match(urls[0],/auth\/v1\/user$/)}finally{global.fetch=original}
}));
test('changed-account header only rejects mismatches and cannot authenticate a caller',async()=>env(production,async()=>{
  const identity=mockIdentity();
  try{
    const request=productionRequest();request.headers['x-mosaic-account-id']=policy.DEV_USER.id;
    const denied=res();assert.equal(await guard(request,denied,'POST'),false);assert.equal(denied.statusCode,409);assert.equal(denied.body.code,'ACCOUNT_CHANGED');
    const anonymous=productionRequest();delete anonymous.headers.cookie;anonymous.headers['x-mosaic-account-id']=userId;
    const rejected=res();assert.equal(await guard(anonymous,rejected,'POST'),false);assert.equal(rejected.statusCode,401);
  }finally{identity.restore()}
}));
test('unsafe origin and unsupported method are rejected before authentication',async()=>env(local,async()=>{
  const response=res();await edit(req({method:'POST',headers:{host:'localhost:8000',origin:'https://evil.example'}}),response);assert.equal(response.statusCode,403);
  const method=res();await edit(req({method:'GET'}),method);assert.equal(method.statusCode,405);
}));
test('auto-login does not bypass OpenAI API key validation',async()=>env(local,async()=>{
  const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not call OpenAI')};
  try{
    for(const apiKey of [undefined,'','invalid']){
      const response=res();await edit(req({method:'POST',body:{apiKey,userId:userId,role:'admin'}}),response);assert.equal(response.statusCode,400);assert.match(response.body.error,/OpenAI API key/);
    }
    assert.equal(calls,0);
  }finally{global.fetch=original}
}));
test('generation attribution uses server identity and forwards only the caller BYOK key',async()=>env(local,async()=>{
  const oldFetch=global.fetch,oldStart=store.startGeneration,oldFinish=store.finishGeneration;let start,finish,authorization;
  store.startGeneration=async(actor,values)=>{start={actor,values};return {id:randomUUID()}};store.finishGeneration=async(actor,id,values)=>{finish={actor,id,values}};
  global.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/images/edits');authorization=options.headers.Authorization;return Response.json({data:[{b64_json:'test-image'}],usage:{input_tokens:10,output_tokens:20,total_tokens:30}})};
  const png=Buffer.alloc(80);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(256,16);png.writeUInt32BE(256,20);const image='data:image/png;base64,'+png.toString('base64');
  try{
    const response=res();await edit(req({method:'POST',body:{apiKey:'sk-developer-owned-placeholder',collage:image,mask:image,prompt:'Sensitive prompt',quality:'medium',userId:userId,environment:'production'}}),response);
    assert.equal(response.statusCode,200);assert.equal(authorization,'Bearer sk-developer-owned-placeholder');
    assert.equal(start.actor.environment,'development');assert.equal(start.actor.id,policy.DEV_USER.id);assert.equal(finish.values.total_tokens,30);assert.equal(finish.values.status,'success');
    assert.doesNotMatch(JSON.stringify({start,finish}),/sk-developer|Sensitive prompt|base64/);assert.equal(response.body.usageRecorded,true);
  }finally{global.fetch=oldFetch;store.startGeneration=oldStart;store.finishGeneration=oldFinish}
}));
test('missing usage remains unknown instead of invented zero',()=>{
  assert.deepEqual(usageFrom(undefined),{input_tokens:null,output_tokens:null,total_tokens:null});
  assert.deepEqual(usageFrom({input_tokens:0,output_tokens:-1,total_tokens:NaN}),{input_tokens:0,output_tokens:null,total_tokens:null});
});
test('local records are isolated, deduplicated, redact secrets, and reset without remote calls',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mozai-auth-')),file=path.join(directory,'data.json'),localStore=store.createStore(file),actor={...policy.DEV_USER},oldFetch=global.fetch;
  global.fetch=async()=>{throw Error('Development data must never reach Supabase')};
  try{
    const project=await localStore.createProject(actor),eventId=randomUUID();
    await localStore.event(actor,{id:eventId,type:'image_exported',projectId:project.id,user_id:userId,environment:'production',apiKey:'NEVER_STORE',prompt:'PRIVATE',image:'base64'});
    await localStore.event(actor,{id:eventId,type:'image_exported',projectId:project.id});
    const record=await localStore.startGeneration(actor,{operation:'edit',model:'test-model',quality:'low',preserveOriginalGeometry:false,projectId:project.id});
    await localStore.finishGeneration(actor,record.id,{status:'success',duration_ms:100});
    const created=await localStore.createInvitation(actor,{label:'Local test',days:7,maxUses:1});
    const raw=await fs.readFile(file,'utf8');assert.doesNotMatch(raw,/NEVER_STORE|PRIVATE|base64/);assert(!raw.includes(created.token));assert(raw.includes(accounts.hashToken(created.token)));
    const data=JSON.parse(raw);assert.equal(data.events.length,1);assert.equal(data.events[0].user_id,actor.id);assert.equal(data.generations[0].environment,'development');
    const overview=await localStore.adminList(actor,'overview');assert.equal(overview.exports,1);assert.equal(overview.generations,1);assert.equal(overview.total_tokens,null);
    const invites=await localStore.adminList(actor,'invitations');assert.equal(invites.rows[0].token_hash,undefined);
    await assert.rejects(()=>localStore.ownProject({...actor,id:userId},project.id),/Project access denied/);
    await assert.rejects(()=>localStore.adminList({...actor,role:'user'},'overview'),/Administrator/);
    await assert.rejects(()=>localStore.reset({...actor,auth:'supabase',environment:'production'}),/only for local/);
    await localStore.reset(actor);assert.equal((await localStore.adminList(actor,'overview')).users,1);assert.equal((await localStore.adminList(actor,'overview')).projects,0);
  }finally{global.fetch=oldFetch;await fs.rm(file,{force:true});await fs.rmdir(directory)}
});
test('session cookies are HttpOnly and secure on hosted environments',async()=>{
  for(const values of [production,{...local,VERCEL_ENV:'preview'}])await env(values,async()=>{
    const response=res();accounts.setSession(response,{access_token:'short-lived',refresh_token:'rotating',expires_in:3600});
    for(const cookie of response.headers['Set-Cookie']){assert.match(cookie,/^__Host-mosaic_session/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/; Secure/)}
    accounts.setSession(response,null);for(const cookie of response.headers['Set-Cookie'])assert.match(cookie,/Max-Age=0/);
  });
});
test('production missing Supabase configuration fails closed',async()=>env({NODE_ENV:'production'},async()=>{
  const response=res();await session(productionRequest({action:'login',email:'dev@mosaic.local',password:'not-a-real-secret'}),response);
  assert.equal(response.statusCode,503);assert.equal(response.body.code,'AUTH_NOT_CONFIGURED');assert.equal(response.headers['Set-Cookie'],undefined);
}));
test('invited login redeems only the verified identity and returns no session tokens in JSON',async()=>env(production,async()=>{
  const original=global.fetch;let redeemed;
  global.fetch=async(url,options)=>{
    if(String(url).endsWith('/auth/v1/token?grant_type=password'))return Response.json({access_token:'verified-access',refresh_token:'verified-refresh',expires_in:3600});
    if(String(url).endsWith('/auth/v1/user'))return Response.json({id:userId,email:'invited@example.com',email_confirmed_at:new Date().toISOString()});
    if(String(url).includes('/rest/v1/mosaic_members?'))return Response.json([]);
    if(String(url).endsWith('/rpc/mosaic_redeem_invitation')){redeemed=JSON.parse(options.body);return Response.json({user_id:userId,email:'invited@example.com',role:'user',status:'active',environment:'production'})}
    throw Error('Unexpected call');
  };
  try{
    const token='a'.repeat(43),response=res();await session(productionRequest({action:'login',email:'invited@example.com',password:'test-only-password',invitation:token,userId:policy.DEV_USER.id,role:'admin'}),response);
    assert.equal(response.statusCode,200);assert.equal(response.body.user.id,userId);assert.equal(response.body.user.role,'user');
    assert.equal(redeemed.p_user_id,userId);assert.equal(redeemed.p_token_hash,accounts.hashToken(token));
    assert.doesNotMatch(JSON.stringify(response.body),/verified-access|verified-refresh/);assert.equal(response.headers['Set-Cookie'].length,2);
  }finally{global.fetch=original}
}));
test('signup checks invitations before Supabase and requires email confirmation',async()=>env(production,async()=>{
  const original=global.fetch;let valid=false,signupCalls=0;
  global.fetch=async url=>{
    if(String(url).endsWith('/rpc/mosaic_check_invitation'))return Response.json(valid);
    if(String(url).endsWith('/auth/v1/signup')){signupCalls++;return Response.json({id:userId,email:'invited@example.com'})}
    throw Error('Unexpected call');
  };
  try{
    const body={action:'signup',email:'invited@example.com',password:'test-only-password',invitation:'a'.repeat(43)};
    const rejected=res();await session(productionRequest(body),rejected);assert.equal(rejected.statusCode,403);assert.equal(signupCalls,0);
    valid=true;const confirmed=res();await session(productionRequest(body),confirmed);assert.equal(confirmed.statusCode,200);assert.equal(confirmed.body.confirmationRequired,true);assert.equal(confirmed.headers['Set-Cookie'],undefined);
  }finally{global.fetch=original}
}));
test('refresh rotates auth cookies only after checking active membership again',async()=>env(production,async()=>{
  const original=global.fetch;let refreshValue;
  global.fetch=async(url,options)=>{
    if(String(url).endsWith('/auth/v1/token?grant_type=refresh_token')){refreshValue=JSON.parse(options.body).refresh_token;return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600})}
    if(String(url).endsWith('/auth/v1/user'))return Response.json({id:userId,email:'invited@example.com',email_confirmed_at:new Date().toISOString()});
    if(String(url).includes('/rest/v1/mosaic_members?'))return Response.json([{user_id:userId,email:'invited@example.com',role:'user',status:'active'}]);
    throw Error('Unexpected call');
  };
  try{
    const request=productionRequest({action:'refresh'});request.headers.cookie='__Host-mosaic_session_refresh=old-refresh';const response=res();await session(request,response);
    assert.equal(response.statusCode,200);assert.equal(refreshValue,'old-refresh');assert(response.headers['Set-Cookie'].some(c=>c.includes('new-refresh')));assert.equal(response.body.user.id,userId);
  }finally{global.fetch=original}
}));
