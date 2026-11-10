const {send,guard,loadApiKey}=require('../../lib/auth');
const {trackGeneration}=require('../../lib/generation-tracking');
const {generateObjectMap}=require('../../lib/object-map-provider');
module.exports=async function(req,res){
  if(!await guard(req,res,'POST')||!await loadApiKey(req,res))return;
  try{req.body.quality='high';return send(res,200,await trackGeneration(req,'edit',()=>generateObjectMap(req)))}
  catch(error){return send(res,error.status||(/^(?:Invalid|Missing) (?:image|PNG|JPEG|WEBP|object-map image)/.test(error.message)?400:502),{error:error.message||'Could not prepare objects.',code:'OBJECT_MAP_FAILED'})}
};
module.exports.config={maxDuration:300};
