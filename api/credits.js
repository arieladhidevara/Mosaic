const {send,guard}=require('../lib/auth');
module.exports=async function(req,res){
  if(!await guard(req,res,'GET'))return;
  try{return send(res,200,await require('../lib/data-store').demoCredits(req.account))}
  catch{return send(res,503,{error:'Demo credit usage is temporarily unavailable. OpenAI billing is unchanged.',code:'USAGE_UNAVAILABLE'})}
};
