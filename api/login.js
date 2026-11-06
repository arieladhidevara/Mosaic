const {configured,passwordMatches,tokenFor,cookie,send,guard}=require('../lib/auth');
const attempts=new Map();
module.exports=async function handler(req,res){
  if(!guard(req,res,'POST'))return;
  if(!configured())return send(res,503,{error:'Premium is not configured yet. Set the server environment variables.'});
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
  const now=Date.now(),key=ip.slice(0,100);
  const item=attempts.get(key)||{count:0,until:now+600000};
  if(now>item.until){item.count=0;item.until=now+600000}
  if(item.count>=8)return send(res,429,{error:'Too many attempts. Try again later.'});
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const name=process.env.MOSAIC_ADMIN_USERNAME||'arieladhidevara';
  const valid=typeof body.username==='string'&&body.username===name&&passwordMatches(body.password);
  if(!valid){item.count++;attempts.set(key,item);return send(res,401,{error:'Invalid username or password'})}
  attempts.delete(key);
  res.setHeader('Set-Cookie',cookie(tokenFor(name),8*3600));
  return send(res,200,{ok:true,username:name});
};