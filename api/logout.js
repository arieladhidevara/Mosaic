const {cookie,send,guard}=require('../lib/auth');
module.exports=function handler(req,res){
  if(!guard(req,res,'POST'))return;
  res.setHeader('Set-Cookie',cookie('',0));
  return send(res,200,{ok:true});
};