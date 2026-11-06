const {scryptSync,createHmac,timingSafeEqual} = require('node:crypto');
const COOKIE='mosaic_session';
const HOURS=8;
function configured(){return Boolean(process.env.MOSAIC_PASSWORD_HASH && process.env.MOSAIC_SESSION_SECRET?.length>=32)}
function passwordMatches(password){
  const value=process.env.MOSAIC_PASSWORD_HASH || '';
  const [algo,salt,expectedHex]=value.split(':');
  if(algo!=='scrypt'||!/^[0-9a-f]{32,}$/i.test(salt||'')||!/^[0-9a-f]{128}$/i.test(expectedHex||'')||typeof password!=='string'||password.length>256) return false;
  try {
    const expected=Buffer.from(expectedHex,'hex');
    const actual=scryptSync(password,Buffer.from(salt,'hex'),expected.length);
    return timingSafeEqual(actual,expected);
  }catch{return false}
}
function sign(value){return createHmac('sha256',process.env.MOSAIC_SESSION_SECRET).update(value).digest('base64url')}
function tokenFor(username){
  const value=Buffer.from(JSON.stringify({sub:username,exp:Date.now()+HOURS*3600000})).toString('base64url');
  return value+'.'+sign(value);
}
function readSession(req){
  if(!configured())return null;
  const cookies=(req.headers.cookie||'').split(';').map(v=>v.trim());
  const raw=cookies.find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!raw || raw.length>2048)return null;
  const [part,mac,...extra]=raw.split('.');
  if(!part||!mac||extra.length)return null;
  const a=Buffer.from(mac),b=Buffer.from(sign(part));
  if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  try {
    const claims=JSON.parse(Buffer.from(part,'base64url').toString('utf8'));
    return claims.sub===(process.env.MOSAIC_ADMIN_USERNAME||'arieladhidevara')&&claims.exp>Date.now()?claims:null;
  }catch{return null}
}
function cookie(token,maxAge){
  return COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
}
function send(res,status,body){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(body);
}
function sameOrigin(req) {
  const origin=req.headers.origin;
  if(!origin)return false;
  try {const host=(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
    return new URL(origin).host===host && new URL(origin).protocol==='https:';
  }catch{return false}
}
function guard(req,res,method) {
  if(req.method!==method){res.setHeader('Allow',method);send(res,405,{error:'Method not allowed'});return false}
  if(method!=='GET'&&!sameOrigin(req)){send(res,403,{error:'Invalid request origin'});return false}
  return true;
}
function requireAuth(req,res){
  if(!configured()){send(res,503,{error:'Premium login is not configured on the server.'});return null}
  const session=readSession(req);
  if(!session)send(res,401,{error:'Premium session expired. Sign in again.'});
  return session;
}
module.exports={configured,passwordMatches,tokenFor,readSession,cookie,send,guard,requireAuth};