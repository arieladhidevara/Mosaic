'use strict';
/* Project-scoped, BYOK design consultation. No image mutation happens here. */
const {send,guard,loadApiKey}=require('./auth');
const {input}=require('./image-provider');
const ALLOWED_ACTIONS=new Set(['discuss','highlight','select','group','preview','generate']);
const ALLOWED_SCOPES=new Set(['none','region','full','harmonize']);
const schema={
  type:'object',additionalProperties:false,
  required:['reply','action','scope','target_ids','group_name','edit_prompt','reason'],
  properties:{
    reply:{type:'string'},action:{type:'string',enum:[...ALLOWED_ACTIONS]},
    scope:{type:'string',enum:[...ALLOWED_SCOPES]},
    target_ids:{type:'array',items:{type:'string'}},
    group_name:{type:'string'},edit_prompt:{type:'string'},reason:{type:'string'}
  }
};
function outputText(data){
  return data.output_text||data.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'').join('')||'';
}
function citations(data){
  const entries=[];
  for(const output of data.output||[])for(const item of output.content||[])
    for(const a of item.annotations||[]){
      if(a.type==='url_citation'&&typeof a.url==='string'&&/^https:\/\//.test(a.url)&&!entries.some(e=>e.url===a.url))
        entries.push({title:String(a.title||new URL(a.url).hostname).slice(0,140),url:a.url});
    }
  return entries.slice(0,8);
}
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST')||!await loadApiKey(req,res))return;
  const b=req.body||{},message=String(b.message||'').trim();
  if(!message||message.length>4000||!Array.isArray(b.objects)||b.objects.length>100)
    return send(res,400,{error:'Invalid design consultation request.'});
  const objects=b.objects.filter(o=>o&&typeof o.id==='string'&&typeof o.label==='string')
    .slice(0,100).map(o=>({id:o.id.slice(0,100),label:o.label.slice(0,100),
      category:String(o.category||'').slice(0,55),
      box:Array.isArray(o.box)?o.box.filter(Number.isFinite).slice(0,4):[],
      collection:String(o.collection||'').slice(0,70)}));
  const known=new Set(objects.map(o=>o.id));
  const selectedIds=(Array.isArray(b.selectedIds)?b.selectedIds:[])
    .filter(id=>typeof id==='string'&&known.has(id)).slice(0,24);
  const session=typeof b.previousResponseId==='string'&&/^resp_[\w-]{8,200}$/.test(b.previousResponseId)
    ?b.previousResponseId:null;
  // First turn must include Base. Subsequent turns refer to the stored Responses context.
  let base=null;
  try{if(!session)base=input(b.base,['jpeg','png','webp'],1600000)}
  catch{return send(res,400,{error:'A Base image is required to establish this chat session.',resetSession:true})}
  const allowWeb=Boolean(b.searchWeb);
  const content=[{type:'input_text',text:JSON.stringify({
    user_message:message,objects,selected_object_ids:selectedIds,
    pointed_at:b.point&&Number.isFinite(b.point.x)&&Number.isFinite(b.point.y)
      ?{x:Math.max(0,Math.min(1,b.point.x)),y:Math.max(0,Math.min(1,b.point.y))}:null,
    project_design_intent:String(b.projectPrompt||'').slice(0,1200),
    note:'IDs are application-defined and must be used unchanged. User may have modified the scene since the first Base.'
  })}];
  if(base)content.push({type:'input_image',image_url:base.url,detail:'high'});
  // Only attach the updated composition when the client marks it as materially changed.
  if(typeof b.currentImage==='string'&&b.currentImage.length<1600000){
    try{content.push({type:'input_image',image_url:input(b.currentImage,['jpeg','png','webp'],1150000).url,detail:'low'})}
    catch{return send(res,400,{error:'Invalid updated canvas image.'})}
  }
  const instructions=[
    'You are mozAI Design Copilot, an architectural visualization and interior design advisor.',
    'Speak naturally in the user language. Consult and critique first; never generate or edit any image yourself.',
    'You can refer to physical object IDs, request highlights, select objects, group them, or prepare an image-edit plan.',
    'When a user asks what should change, give concrete specific suggestions and action=highlight with target_ids.',
    'If the user points/clicks an object, selected_object_ids and pointed_at describe the subject of phrases like this/that.',
    'When user explicitly asks for a small visual preview, use action=preview; it costs an image API call separately.',
    'When user explicitly approves generating, action=generate and choose scope=region if a few existing objects change.',
    'Choose scope=full for broad coherent scene changes, and scope=harmonize only when blending existing edits.',
    'Do not infer generate from a question, suggestion, or hypothetical. Do not change furniture if asked to preserve it.',
    'Do not invent IDs. Highlight/select/group actions must use known IDs and never implicitly merge masks.',
    'edit_prompt is a precise executable image instruction. For advice only, it can be empty.',
    'Web links: only reference actual web results if web search was enabled; otherwise make no claims of live searching.',
    'Return JSON matching the supplied schema. Keep reply under 1100 characters.'
  ].join('\n');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),60000);
  try{
    const payload={
      model:'gpt-4.1-mini',store:true,max_output_tokens:1100,
      instructions, ...(session?{previous_response_id:session}:{}),
      text:{format:{type:'json_schema',name:'mozai_design_copilot',strict:true,schema}},
      input:[{role:'user',content}],
      ...(allowWeb?{tools:[{type:'web_search'}]}:{})
    };
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:ctrl.signal,
      headers:{Authorization:'Bearer '+req.openAiApiKey,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const invalidSession=Boolean(session)&&[400,404].includes(response.status);
      return send(res,response.status===429?429:502,{error:invalidSession?'Chat session expired. Restart it with your Base.':
        String(data.error?.message||'Design assistant unavailable.').slice(0,250),resetSession:invalidSession});
    }
    const raw=JSON.parse(outputText(data));
    const action=ALLOWED_ACTIONS.has(raw.action)?raw.action:'discuss';
    const scope=ALLOWED_SCOPES.has(raw.scope)?raw.scope:'none';
    return send(res,200,{
      reply:String(raw.reply||'').slice(0,1800),action,scope,
      targetIds:[...new Set((Array.isArray(raw.target_ids)?raw.target_ids:[]).filter(id=>known.has(id)))].slice(0,32),
      groupName:String(raw.group_name||'').slice(0,65),
      editPrompt:String(raw.edit_prompt||'').slice(0,3800),
      reason:String(raw.reason||'').slice(0,500),
      references:citations(data),
      responseId:data.id||null,
      usage:data.usage?{input_tokens:data.usage.input_tokens,output_tokens:data.usage.output_tokens,total_tokens:data.usage.total_tokens}:null
    });
  }catch(e){return send(res,502,{error:e.name==='AbortError'?'Consultation timed out.':'Design consultation failed.'})}
  finally{clearTimeout(timer)}
};
module.exports.config={maxDuration:90};
