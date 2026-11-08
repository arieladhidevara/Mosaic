const {trackGeneration}=require('../../lib/generation-tracking');
const {send,guard,requireApiKey}=require('../../lib/auth');
const {generate}=require('../../lib/image-provider');
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST')||!requireApiKey(req,res))return;
  try{return send(res,200,await trackGeneration(req,'harmonize',()=>generate(req,false)))}
  catch(e){return send(res,e.status||400,{error:e.message||'Harmonization failed'})}
};
module.exports.config={maxDuration:300};