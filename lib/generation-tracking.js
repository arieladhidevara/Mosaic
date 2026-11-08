const store=require('./data-store');
function usageFrom(value){
  const number=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  const input=number(value?.input_tokens),output=number(value?.output_tokens),total=number(value?.total_tokens);
  // Sunburst Images API standard rates per 1M tokens: image input $8,
  // text input $5, image output $30. Missing modality counts = unknown cost.
  const detail=value?.input_tokens_details;
  const imageIn=number(detail?.image_tokens),textIn=number(detail?.text_tokens);
  const estimate=imageIn!==null&&textIn!==null&&output!==null&&input===imageIn+textIn
    ?Math.round((imageIn*8+textIn*5+output*30)/1e6*1e8)/1e8:null;
  return {input_tokens:input,output_tokens:output,total_tokens:total,
    estimated_cost_usd:estimate??(typeof value?.estimated_cost_usd==='number'&&Number.isFinite(value.estimated_cost_usd)?value.estimated_cost_usd:null)};
}
async function trackGeneration(req,operation,generate){
  const body=req.body||{},quality=operation==='master'?'high':body.quality??(operation==='edit'?'medium':'high');
  if(!['low','medium','high'].includes(quality))throw new (require('./supabase').AppError)(400,'Quality must be low, medium or high.');
  const record=await store.startGeneration(req.account,{
    projectId:body.projectId,operation,model:'gpt-image-2.6-sunburst',quality,
    preserveOriginalGeometry:true
  });
  const started=Date.now();
  try{
    const result=await generate();let recorded=true;
    try{await store.finishGeneration(req.account,record.id,{status:'success',duration_ms:Date.now()-started,...usageFrom(result.usage)})}
    catch{recorded=false}
    return {...result,generationId:record.id,usageRecorded:recorded};
  }catch(error){
    const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;
    const code=error.name==='AbortError'?'TIMEOUT':String(error.code||'GENERATION_FAILED').replace(/[^A-Z0-9_]/gi,'').slice(0,32)||'GENERATION_FAILED';
    // Never record user email, image data, prompt, credentials, or raw provider error text.
    console.error('[mozAI:generation_failed]',JSON.stringify({operation,status,code,durationMs:Date.now()-started}));
    try{await store.finishGeneration(req.account,record.id,{status:'failed',duration_ms:Date.now()-started,error_code:code})}catch{}
    throw error;
  }
}
module.exports={trackGeneration,usageFrom};
