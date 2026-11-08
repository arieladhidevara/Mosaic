/* Small BYOK semantic naming step. Keeps raw edit prompts in patch metadata. */
const {send,guard,requireApiKey}=require('../../lib/auth');
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST')||!requireApiKey(req,res))return;
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const key=body.apiKey,prompt=String(body.prompt||'').trim().slice(0,1400);
  const category=String(body.category||'Region').slice(0,60);
  if(typeof key!=='string'||!/^sk-[\w-]{15,300}$/.test(key))return send(res,400,{error:'OpenAI API key required.'});
  if(!prompt)return send(res,400,{error:'Prompt required.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:'gpt-4.1-mini',store:false,max_output_tokens:36,
        input:[{role:'developer',content:[{type:'input_text',
          text:'Name an architectural image editing VARIANT, in 1-4 words. Input is an edit instruction, not the desired label. Infer the resulting material, color, furniture style, lighting condition, or change. Output only a concise noun phrase such as Black, Warm walnut veneer, Blue fabric baffles, No plants, Brighter daylight. Do not include commands like Make it, Change to, Render, Apply, or Edit. Do not repeat long user prompts. No punctuation, quotes, explanation or markup.'}]},
          {role:'user',content:[{type:'input_text',text:'Region: '+category+'\nEdit request: '+prompt}]}]
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return send(res,response.status>=500?502:400,{error:data.error?.message||'Naming model unavailable'});
    const output=String(data.output_text||data.output?.flatMap(x=>x.content||[]).map(c=>c.text||'').join(' ')||'').trim();
    const cleaned=output.replace(/^[\s"'\x60]+|[\s"'\x60.!?;:]+$/g,'').replace(/\s+/g,' ').slice(0,50);
    if(!cleaned||cleaned.split(' ').length>5||/[\n\r]/.test(cleaned))return send(res,200,{name:null});
    return send(res,200,{name:cleaned});
  }catch(e){return send(res,502,{error:e.name==='AbortError'?'Naming timed out':'Cannot reach naming model'})}
  finally{clearTimeout(timeout)}
};
module.exports.config={maxDuration:30};
