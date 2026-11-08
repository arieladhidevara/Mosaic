/* Server-side Supabase REST transport. Service credentials never reach the browser. */
class AppError extends Error{constructor(status,message,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code}}
function config(env=process.env){
  const url=env.SUPABASE_URL?.replace(/\/$/,'');
  const publicKey=env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!publicKey||!secret)throw new AppError(503,'Sign-in is not configured. Contact the project administrator.','AUTH_NOT_CONFIGURED');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'&&!(env.NODE_ENV==='development'&&['127.0.0.1','localhost'].includes(parsed.hostname)))throw new AppError(503,'Invalid Supabase server configuration.');
  return {url,publicKey,secret};
}
async function call(route,{method='GET',body,token,admin=false,headers={},count=false}={}){
  const c=config(),apiKey=admin?c.secret:c.publicKey;
  let response;
  try{response=await fetch(c.url+route,{method,headers:{apikey:apiKey,...(token?{Authorization:'Bearer '+token}:admin&&apiKey.startsWith('eyJ')?{Authorization:'Bearer '+apiKey}:{}),'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),cache:'no-store'})}
  catch{throw new AppError(503,'Authentication or database service is unavailable. Please retry.','SERVICE_UNAVAILABLE')}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    // Do not forward provider payloads, SQL details, credentials or user input.
    if(route.startsWith('/auth/'))throw new AppError(response.status===429?429:401,response.status===429?'Too many attempts. Please try again later.':'Sign-in failed. Check your credentials and confirm your email.','AUTH_REQUIRED');
    throw new AppError(503,'Account data is unavailable. Check the database migration.','DATA_UNAVAILABLE');
  }
  if(count){
    const total=response.headers.get('content-range')?.split('/')[1];
    if(!/^\d+$/.test(total||''))throw new AppError(503,'Usage is temporarily unavailable.','USAGE_UNAVAILABLE');
    return {count:Number(total)};
  }
  return data;
}
const db=(route,options={})=>call('/rest/v1/'+route,{...options,admin:true});
const rpc=(name,body)=>db('rpc/'+name,{method:'POST',body});
module.exports={AppError,config,call,db,rpc};
