'use strict';
/* Published standard image token rates, USD per million. Estimates only, never a billing ledger. */
const MODELS=['gpt-image-1.5','gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.6-sunburst'];
const RATES={
  'gpt-image-1.5':{image:8,text:5,output:32},
  'gpt-image-2':{image:4,text:2.5,output:15},
  'gpt-image-2.5-sunburst':{image:8,text:5,output:30},
  'gpt-image-2.6-sunburst':{image:8,text:5,output:30}
};
function usageFromModel(usage,model){
  const numeric=v=>Number.isInteger(v)&&v>=0?v:null;
  const image=numeric(usage?.input_tokens_details?.image_tokens);
  const text=numeric(usage?.input_tokens_details?.text_tokens);
  const out=numeric(usage?.output_tokens);
  const input=numeric(usage?.input_tokens);
  const rates=RATES[model];
  const complete=Boolean(rates)&&image!==null&&text!==null&&out!==null&&input===image+text;
  return {input_tokens:input,output_tokens:out,total_tokens:numeric(usage?.total_tokens),
    image_input_tokens:image,text_input_tokens:text,
    estimated_cost_usd:complete?Math.round((image*rates.image+text*rates.text+out*rates.output)/1e6*1e8)/1e8:null};
}
module.exports={MODELS,RATES,usageFromModel};
