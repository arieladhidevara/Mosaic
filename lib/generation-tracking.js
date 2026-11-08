const store=require('./data-store');
function usageFrom(value){
  const number=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  return {input_tokens:number(value?.input_tokens),output_tokens:number(value?.output_tokens),total_tokens:number(value?.total_tokens)};
}
async function trackGeneration(req,operation,generate){
  const body=req.body||{},quality=operation==='master'?'high':body.quality??(operation==='edit'?'medium':'high');
  if(!['low','medium','high'].includes(quality))throw new (require('./supabase').AppError)(400,'Quality must be low, medium or high.');
  const record=await store.startGeneration(req.account,{
    projectId:body.projectId,operation,model:'gpt-image-2.6-sunburst',quality,
    preserveOriginalGeometry:operation==='edit'?Boolean(body.base):true
  });
  const started=Date.now();
  try{
    const result=await generate();let recorded=true;
    try{await store.finishGeneration(req.account,record.id,{status:'success',duration_ms:Date.now()-started,...usageFrom(result.usage)})}
    catch{recorded=false}
    return {...result,generationId:record.id,usageRecorded:recorded};
  }catch(error){
    try{await store.finishGeneration(req.account,record.id,{status:'failed',duration_ms:Date.now()-started,error_code:error.name==='AbortError'?'TIMEOUT':String(error.status||'GENERATION_FAILED')})}catch{}
    throw error;
  }
}
module.exports={trackGeneration,usageFrom};
