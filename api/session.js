const {configured,readSession,send,guard}=require('../lib/auth');
module.exports=function handler(req,res){
  if(!guard(req,res,'GET'))return;
  const session=readSession(req);
  return send(res,200,{authenticated:Boolean(session),configured:configured(),username:session?.sub||null});
};