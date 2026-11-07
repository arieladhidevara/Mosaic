/* BYOK Base -> first Master generation, preserving Base geometry. */
const {send,guard,requireApiKey}=require('../../lib/auth');
const {generate}=require('../../lib/image-provider');
module.exports=async function handler(req,res){
  if(!guard(req,res,'POST')||!requireApiKey(req,res))return;
  try{return send(res,200,await generate(req,false,'master'))}
  catch(error){return send(res,error.status||400,{error:error.message||'Master generation failed'})}
};
module.exports.config={maxDuration:300};
