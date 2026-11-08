// Local browser test fixture only. Never contacts or seeds a real Supabase project.
const {hosted}=require('../lib/dev-auth');
if(process.env.NODE_ENV==='production'||hosted(process.env))throw Error('Test authentication cannot run in production.');
process.env.SUPABASE_URL='https://mosaic-test.supabase.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable-placeholder';
process.env.SUPABASE_SECRET_KEY='test-server-placeholder';
const roles={admin:'22222222-2222-4222-8222-222222222222',tester:'33333333-3333-4333-8333-333333333333'};
const originalFetch=global.fetch;
global.fetch=async(url,options={})=>{
  if(!String(url).startsWith(process.env.SUPABASE_URL+'/'))return originalFetch(url,options);
  const route=new URL(url),body=options.body?JSON.parse(options.body):{},headers=options.headers||{};
  if(route.pathname==='/auth/v1/token'){
    const role=route.searchParams.get('grant_type')==='refresh_token'?String(body.refresh_token).replace('refresh_',''):String(body.email).split('@')[0];
    if(!roles[role]||(route.searchParams.get('grant_type')==='password'&&body.password!=='test-only-password'))return Response.json({error:'invalid credentials'},{status:401});
    return Response.json({access_token:'token_'+role,refresh_token:'refresh_'+role,expires_in:3600});
  }
  if(route.pathname==='/auth/v1/user'){
    const role=String(headers.Authorization||'').replace('Bearer token_','');
    if(!roles[role])return Response.json({error:'invalid token'},{status:401});
    return Response.json({id:roles[role],email:role+'@example.com',email_confirmed_at:'2026-11-07T00:00:00Z',user_metadata:{role:'admin'}});
  }
  if(route.pathname==='/auth/v1/logout')return Response.json({});
  if(route.pathname==='/rest/v1/mosaic_members'){
    const id=route.searchParams.get('user_id')?.replace('eq.',''),role=Object.keys(roles).find(role=>roles[role]===id);
    return Response.json(role?[{user_id:id,email:role+'@example.com',role:role==='admin'?'admin':'user',status:'active',environment:'development'}]:[]);
  }
  if(route.pathname==='/rest/v1/rpc/mosaic_admin_overview')return Response.json({users:2,projects:0,generations:0,exports:0,total_tokens:null,usage_records:0,successful_generations:0,failed_generations:0,average_duration_ms:null});
  if(route.pathname==='/rest/v1/rpc/mosaic_record_event')return Response.json(null);
  throw Error('Unexpected test Supabase request: '+route.pathname);
};
