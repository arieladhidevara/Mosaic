/* Premium-only, BYOK vision classification of an explicitly masked architectural region. */
const {send,guard,requireAuth}=require('../../lib/auth');
const CATEGORIES=['Wall','Ceiling','Floor','Door','Window','Glazing','Furniture','Millwork','Lighting','Structure','Landscape','Stairs','Other'];
module.exports=async function handler(req,res){
  if(!guard(req,res,'POST')||!requireAuth(req,res))return;
  const body=req.body||{},image=body.image,key=body.apiKey;
  if(typeof key!=='string'||!/^sk-[\w-]{15,300}$/.test(key))return send(res,400,{error:'OpenAI API key required.'});
  if(typeof image!=='string'||image.length>950000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))return send(res,400,{error:'Invalid classification crop.'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const result=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:'gpt-4.1-mini',store:false,max_output_tokens:48,
        input:[{role:'user',content:[
          {type:'input_text',text:'You classify architectural image regions. The selected target is tinted magenta; the surrounding photo supplies context. Classify only the tinted target. Answer with EXACTLY ONE category, matching capitalization, from: '+CATEGORIES.join(', ')+'. Choose Ceiling for ceiling surfaces, Floor for floor surfaces and Wall for wall finishes. Use Other if uncertain. No explanation.'},
          {type:'input_image',image_url:image,detail:'low'}
        ]}]
      })
    });
    const data=await result.json().catch(()=>({}));
    if(!result.ok)return send(res,result.status>=500?502:400,{error:data.error?.message||'OpenAI vision request failed.'});
    const raw=(data.output_text||data.output?.flatMap(o=>o.content||[]).map(c=>c.text||'').join(' ')||'').trim();
    const category=CATEGORIES.find(c=>raw.toLowerCase()===c.toLowerCase())||
      CATEGORIES.find(c=>new RegExp('^'+c+'\\b','i').test(raw))||'Other';
    return send(res,200,{category});
  }catch(error){return send(res,502,{error:error.name==='AbortError'?'Classification timed out.':'Cannot reach OpenAI vision.'})}
  finally{clearTimeout(timeout)}
};
