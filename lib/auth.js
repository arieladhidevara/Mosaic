/* Same-origin requests, verified application sessions, and independent BYOK checks. */
function send(res,status,body){
  // Correlate server errors without logging images, prompts, emails, passwords or API keys.
  if(status>=500){
    const id=require('node:crypto').randomUUID();
    const code=typeof body?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(body.code)?body.code:'SERVER_ERROR';
    res.setHeader('X-MozAI-Error-ID',id);
    console.error(JSON.stringify({event:'mozai_api_error',id,status,code}));
  }
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(body);
}
function sameOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return false;
  try{
    const host=req.headers.host||'';
    const url=new URL(origin);
    const {localHost,hosted}=require('./dev-auth');
    const development=process.env.NODE_ENV==='development'&&!hosted(process.env)&&localHost(host)&&url.protocol==='http:';
    if(process.env.MOSAIC_APP_ORIGIN&&url.origin!==new URL(process.env.MOSAIC_APP_ORIGIN).origin)return false;
    return !url.username&&!url.password&&url.host===host&&(url.protocol==='https:'||development);
  }catch{return false}
}
async function guard(req,res,method,options={}){
  if(req.method!==method){
    res.setHeader('Allow',method);
    send(res,405,{error:'Method not allowed'});
    return false;
  }
  if(method!=='GET'&&!sameOrigin(req)){
    send(res,403,{error:'Invalid request origin'});
    return false;
  }
  if(!options.public){
    try{
      const actor=await require('./accounts').requireUser(req,{admin:options.admin});
      // Consistency check only: this header can reject a changed account, never authenticate one.
      if(req.headers['x-mosaic-account-id']&&req.headers['x-mosaic-account-id']!==actor.id){send(res,409,{error:'Your account changed. Reload the workspace.',code:'ACCOUNT_CHANGED'});return false}
    }
    catch(error){send(res,error.status||503,{error:error.status?error.message:'Authentication unavailable.',code:error.code||'AUTH_REQUIRED'});return false}
  }
  return true;
}
async function loadApiKey(req,res){
  let body=req.body||{};
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{send(res,400,{error:'Invalid JSON request.'});return false}}
  if(!body||typeof body!=='object'||Array.isArray(body)){send(res,400,{error:'Invalid request.'});return false}
  if(Object.prototype.hasOwnProperty.call(body,'apiKey')){
    send(res,400,{error:'Save your API key in your account profile instead of sending it with each request.'});return false;
  }
  req.body=body;
  try{req.openAiApiKey=await require('./credential-store').reveal(req.account);return true}
  catch(error){send(res,error.status||503,{error:error.message,code:error.code});return false}
}
module.exports={send,guard,loadApiKey};
