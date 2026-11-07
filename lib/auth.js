/* Same-origin request guard and BYOK validation; no Mosaic login sessions. */
function send(res,status,body){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(body);
}
function sameOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return false;
  try{
    const host=(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
    const url=new URL(origin);
    // Production must use HTTPS; loopback HTTP works for local development.
    const development=(host.startsWith('localhost:')||host.startsWith('127.0.0.1:'))
      && url.protocol==='http:';
    return url.host===host&&(url.protocol==='https:'||development);
  }catch{return false}
}
function guard(req,res,method){
  if(req.method!==method){
    res.setHeader('Allow',method);
    send(res,405,{error:'Method not allowed'});
    return false;
  }
  if(method!=='GET'&&!sameOrigin(req)){
    send(res,403,{error:'Invalid request origin'});
    return false;
  }
  return true;
}
function requireApiKey(req,res){
  let body=req.body||{};
  if(typeof body==='string'){
    try{body=JSON.parse(body)}catch{send(res,400,{error:'Invalid JSON request.'});return false}
  }
  if(typeof body.apiKey!=='string'||!/^sk-[\w-]{15,300}$/.test(body.apiKey)){
    send(res,400,{error:'Enter an OpenAI API key to use AI features.'});
    return false;
  }
  return true;
}
module.exports={send,guard,requireApiKey};
