const {trackGeneration}=require('../../lib/generation-tracking');
const {send,guard,loadApiKey}=require('../../lib/auth');
const {generate}=require('../../lib/image-provider');
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST')||!await loadApiKey(req,res))return;
  try{return send(res,200,await trackGeneration(req,'harmonize',()=>generate(req,false)))}
  catch(e){return send(res,e.status||400,{error:e.message||'Harmonization failed'})}
};
module.exports.config={maxDuration:300};