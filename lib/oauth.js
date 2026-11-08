// Server-owned PKCE flow. No client identity or role is accepted as authentication.
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const accounts=require('./accounts');
const {AppError,call,config}=require('./supabase');
const name=()=>accounts.cookieName()+'_oauth';
function cookie(res,value,age=600){
  const secure=name().startsWith('__Host-')?'; Secure':'';
  const previous=res.getHeader?.('Set-Cookie')||[];
  res.setHeader('Set-Cookie',[...([].concat(previous)),`${name()}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`]);
}
async function start(req,res){
  const settings=await call('/auth/v1/settings');
  if(!settings?.external?.google)throw new AppError(503,'Google sign-in is not available yet. Use email and password, or continue as a guest.','GOOGLE_NOT_CONFIGURED');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  const invitation=typeof req.body.invitation==='string'&&/^[\w-]{40,100}$/.test(req.body.invitation)?req.body.invitation:'';
  cookie(res,Buffer.from(JSON.stringify({state,verifier,invitation,created:Date.now()})).toString('base64url'));
  // This route is POST-only and has already passed the server's same-origin guard.
  const redirect=new URL('/auth-callback.html',req.headers.origin);redirect.searchParams.set('state',state);
  const url=new URL(config().url+'/auth/v1/authorize');
  for(const [key,value] of Object.entries({provider:'google',redirect_to:redirect.href,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256',scopes:'email profile'}))url.searchParams.set(key,value);
  return {url:url.href};
}
async function exchange(req,res){
  let flow;try{flow=JSON.parse(Buffer.from(accounts.cookies(req)[name()]||'','base64url').toString())}catch{}
  const state=String(req.body.state||''),code=req.body.code;
  if(!flow||typeof flow.state!=='string'||state.length!==flow.state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(flow.state))||!Number.isFinite(flow.created)||Date.now()-flow.created>600000||Date.now()<flow.created||typeof flow.verifier!=='string'||typeof code!=='string'||!code||code.length>2048)throw new AppError(400,'This sign-in attempt expired. Return to mozAI and try Google again.','OAUTH_INVALID');
  try{
    const data=await call('/auth/v1/token?grant_type=pkce',{method:'POST',body:{auth_code:code,code_verifier:flow.verifier}});
    const actor=await accounts.membership(await accounts.verifiedUser(data.access_token),flow.invitation);
    accounts.setSession(res,data);return {authenticated:true,user:actor};
  }finally{cookie(res,'',0)}
}
module.exports={start,exchange};
