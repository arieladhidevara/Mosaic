'use strict';
/* Admin-only one-model-per-request Object ID benchmark: never modifies the editor. */
const {send,guard,loadApiKey}=require('./auth');
const {generateObjectMap}=require('./object-map-provider');
const {usageFromModel}=require('./model-cost');
const {MODELS}=require('./model-cost');
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST',{admin:true})||!await loadApiKey(req,res))return;
  const b=req.body||{};
  if(!MODELS.includes(b.model))return send(res,400,{error:'Unsupported image benchmark model.'});
  if(!['low','medium','high'].includes(b.quality))return send(res,400,{error:'Invalid benchmark quality.'});
  if(typeof b.image!=='string'||b.image.length>4000000)return send(res,400,{error:'Invalid benchmark source image.'});
  const started=Date.now();
  try{
    const result=await generateObjectMap(req,{model:b.model,quality:b.quality,benchmark:true});
    const accounting=usageFromModel(result.usage,b.model);
    return send(res,200,{
      model:b.model,quality:b.quality,image:result.image,mimeType:result.mimeType,
      width:result.width,height:result.height,
      latencyMs:Date.now()-started,usage:accounting,estimatedCostUsd:accounting.estimated_cost_usd,
      costKnown:accounting.estimated_cost_usd!==null
    });
  }catch(error){return send(res,error.status||502,{error:String(error.message||'Object ID benchmark failed.').slice(0,260)})}
};
module.exports.config={maxDuration:300};
