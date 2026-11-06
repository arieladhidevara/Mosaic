const {send,guard,requireAuth}=require('../../lib/auth');
const {generate}=require('../../lib/image-provider');
module.exports=async function handler(req,res){
  if(!guard(req,res,'POST')||!requireAuth(req,res))return;
  try{return send(res,200,await generate(req,false))}
  catch(e){return send(res,e.status||400,{error:e.message||'Harmonization failed'})}
};
module.exports.config={maxDuration:300};