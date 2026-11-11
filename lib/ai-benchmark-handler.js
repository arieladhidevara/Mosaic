'use strict';
/* Admin-only model benchmark. Image responses are transient; only usage metadata is retained. */
const {send,guard,loadApiKey}=require('./auth');
const {generateObjectMap}=require('./object-map-provider');
const {usageFromModel,MODELS}=require('./model-cost');
const store=require('./data-store');
module.exports=async function handler(req,res){
  if(req.method==='GET'){
    if(!await guard(req,res,'GET',{admin:true}))return;
    try{return send(res,200,{rows:await store.listBenchmarks(req.account)});}
    catch(error){return send(res,error.status||503,{error:error.status?error.message:'Benchmark history is unavailable.'});}
  }
  if(!await guard(req,res,'POST',{admin:true})||!await loadApiKey(req,res))return;
  const b=req.body||{};
  if(!MODELS.includes(b.model))return send(res,400,{error:'Unsupported image benchmark model.'});
  if(!['low','medium','high'].includes(b.quality))return send(res,400,{error:'Invalid benchmark quality.'});
  if(typeof b.image!=='string'||b.image.length>4000000)return send(res,400,{error:'Invalid benchmark source image.'});
  const started=Date.now();
  try{
    const result=await generateObjectMap(req,{model:b.model,quality:b.quality,benchmark:true});
    const accounting=usageFromModel(result.usage,b.model);
    const latencyMs=Date.now()-started;
    let usageRecorded=false;
    try{
      await store.recordBenchmark(req.account,{runId:b.runId,model:b.model,quality:b.quality,
        width:result.width,height:result.height,durationMs:latencyMs,usage:accounting});
      usageRecorded=true;
    }catch(error){
      // Never log user images, prompts, API keys, or provider response bodies.
      console.error('[mozAI:benchmark_metadata_failed]',String(error.code||'WRITE_UNAVAILABLE').slice(0,40));
    }
    return send(res,200,{
      model:b.model,quality:b.quality,image:result.image,mimeType:result.mimeType,
      width:result.width,height:result.height,latencyMs,
      usage:accounting,usageSource:result.usage?'openai_response':'unavailable',
      estimatedCostUsd:accounting.estimated_cost_usd,costKnown:accounting.estimated_cost_usd!==null,
      usageRecorded
    });
  }catch(error){return send(res,error.status||502,{error:String(error.message||'Object ID benchmark failed.').slice(0,260)})}
};
module.exports.config={maxDuration:300};
