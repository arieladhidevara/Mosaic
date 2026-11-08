const {isDevelopmentRequest,DEV_USER,environment,hosted}=require('./dev-auth');
const {AppError,call,db,rpc}=require('./supabase');
const {createHash}=require('node:crypto');
const hashToken=value=>createHash('sha256').update(value).digest('hex');
const cookieName=()=>process.env.NODE_ENV==='development'&&!hosted(process.env)?'mosaic_session':'__Host-mosaic_session';
const refreshName=()=>cookieName()+'_refresh';
function cookies(req){
  const result={};for(const part of String(req.headers.cookie||'').split(';')){const at=part.indexOf('=');if(at<0)continue;try{result[part.slice(0,at).trim()]=decodeURIComponent(part.slice(at+1).trim())}catch{}}
  return result;
}
function setSession(res,data){
  const secure=cookieName().startsWith('__Host-')?'; Secure':'';
  const values=[[cookieName(),data?.access_token,data?Math.min(Number(data.expires_in)||3600,86400):0],[refreshName(),data?.refresh_token,data?30*86400:0]];
  res.setHeader('Set-Cookie',values.map(([name,value,age])=>`${name}=${encodeURIComponent(value||'')}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`));
}
async function verifiedUser(token){
  if(typeof token!=='string'||!token||token.length>12000)throw new AppError(401,'Sign in to Mosaic.','AUTH_REQUIRED');
  const user=await call('/auth/v1/user',{token});
  if(!user?.id||!user.email||!user.email_confirmed_at)throw new AppError(401,'Confirm your email before signing in.','AUTH_REQUIRED');
  return user;
}
async function membership(user,invitation){
  const env=environment();
  let rows=await db(`mosaic_members?user_id=eq.${encodeURIComponent(user.id)}&environment=eq.${env}&select=user_id,email,role,status,environment`);
  if(!rows?.length&&typeof invitation==='string'&&/^[\w-]{40,100}$/.test(invitation)){
    const result=await rpc('mosaic_redeem_invitation',{p_token_hash:hashToken(invitation),p_user_id:user.id,p_environment:env});
    if(result)rows=[result];
  }
  const member=rows?.[0];
  if(!member||member.status!=='active')throw new AppError(403,'An active Mosaic invitation is required.','INVITATION_REQUIRED');
  return {id:user.id,email:member.email,role:member.role,status:member.status,environment:env,auth:'supabase'};
}
async function authenticate(req){
  if(isDevelopmentRequest(req))return {...DEV_USER};
  const token=cookies(req)[cookieName()];return membership(await verifiedUser(token));
}
async function requireUser(req,{admin=false}={}){
  const actor=req.account||await authenticate(req);
  if(admin&&actor.role!=='admin')throw new AppError(403,'Administrator access is required.','ADMIN_REQUIRED');
  req.account=actor;return actor;
}
async function signIn(body,res,origin){
  const email=String(body.email||'').trim().toLowerCase(),password=body.password;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<8||password.length>200)throw new AppError(400,'Enter a valid email and a password of at least eight characters.');
  if(body.action==='signup'){
    if(typeof body.invitation!=='string'||!/^[\w-]{40,100}$/.test(body.invitation)||!await rpc('mosaic_check_invitation',{p_token_hash:hashToken(body.invitation),p_email:email,p_environment:environment()}))throw new AppError(403,'This invitation is invalid or expired.','INVITATION_REQUIRED');
    const redirect=origin?'?redirect_to='+encodeURIComponent(new URL('/?confirmed=1',origin).href):'';
    const data=await call('/auth/v1/signup'+redirect,{method:'POST',body:{email,password}});
    if(!data?.access_token)return {authenticated:false,confirmationRequired:true,message:'Check your email to confirm your account. Return here to sign in, or reopen your invitation link on another device.'};
    const actor=await membership(await verifiedUser(data.access_token),body.invitation);setSession(res,data);return {authenticated:true,user:actor};
  }
  const data=await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  const actor=await membership(await verifiedUser(data.access_token),body.invitation);setSession(res,data);return {authenticated:true,user:actor};
}
async function refresh(req,res){
  const value=cookies(req)[refreshName()];if(!value)throw new AppError(401,'Sign in to Mosaic.','AUTH_REQUIRED');
  const data=await call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:value}});
  const actor=await membership(await verifiedUser(data.access_token));setSession(res,data);return {authenticated:true,user:actor};
}
module.exports={authenticate,requireUser,signIn,refresh,verifiedUser,membership,setSession,cookies,cookieName,refreshName,hashToken};
