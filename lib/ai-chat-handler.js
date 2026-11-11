'use strict';
/* Gemini consultation is independent of OpenAI image-generation credentials. */
const {send,guard}=require('./auth');
const {input}=require('./image-provider');
const MODEL='gemini-3.5-flash-lite';
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

function imagePart(value,maxBytes){
  const image=input(value,['jpeg','png','webp'],maxBytes);
  const match=/^data:(image\/\w+);base64,(.+)$/.exec(image.url);
  return {inlineData:{mimeType:match[1],data:match[2]}};
}
function failure(message,status=400,code='INVALID_CHAT_REQUEST'){
  return Object.assign(Error(message),{status,code});
}
async function consult(b,key){
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.hasOwn(b,'apiKey'))throw failure('Invalid design consultation request.');
  const message=typeof b.message==='string'?b.message.trim():'';
  if(!message||message.length>4000||!Array.isArray(b.objects)||b.objects.length>100)
    throw failure('Invalid design consultation request.');
  const objects=b.objects.filter(o=>o&&typeof o.id==='string'&&typeof o.label==='string')
    .map(o=>({id:o.id.slice(0,100),label:o.label.slice(0,100),category:String(o.category||'').slice(0,55),
      box:Array.isArray(o.box)?o.box.filter(Number.isFinite).slice(0,4):[],collection:String(o.collection||'').slice(0,70)}));
  const known=new Set(objects.map(o=>o.id));
  const selectedIds=(Array.isArray(b.selectedIds)?b.selectedIds:[]).filter(id=>known.has(id)).slice(0,24);
  const history=b.history??[];
  if(!Array.isArray(history)||history.length>12||history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>1800))
    throw failure('Invalid conversation history.');
  const parts=[{text:JSON.stringify({user_message:message,objects,selected_object_ids:selectedIds,
    pointed_at:b.point&&Number.isFinite(b.point.x)&&Number.isFinite(b.point.y)?{x:Math.max(0,Math.min(1,b.point.x)),y:Math.max(0,Math.min(1,b.point.y))}:null,
    project_design_intent:String(b.projectPrompt||'').slice(0,1200),
    note:'First image is the original Base; the next image, if present, is the current composition. IDs must be used unchanged.'})}];
  try{parts.push(imagePart(b.base,1600000))}catch{throw failure('Upload a Base image before chatting.')}
  if(b.currentImage!=null){try{parts.push(imagePart(b.currentImage,1150000))}catch{throw failure('Invalid current canvas image.')}}
  if(b.references!=null&&(!Array.isArray(b.references)||b.references.length>3))throw failure('Maximum three image references.');
  try{for(const value of b.references||[])parts.push(imagePart(value,650000))}catch{throw failure('Invalid attached reference image.')}
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
    'Additional attached reference images guide materials and style only, not scene geometry.',
    'Live web search is unavailable. Never claim to have searched online or verified product links. Explain this when asked to search.',
    'Return JSON matching the supplied schema. Keep reply under 1100 characters.'
  ].join('\n');

  const payload={systemInstruction:{parts:[{text:instructions}]},contents:[
    ...history.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]})),
    {role:'user',parts}
  ],generationConfig:{maxOutputTokens:2048,responseMimeType:'application/json',responseJsonSchema:schema}};
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000);
  try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent',{
      method:'POST',signal:ctrl.signal,headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===429)throw failure('Gemini free-tier quota reached. Try again later.',429,'GEMINI_QUOTA');
      if([401,403].includes(response.status))throw failure('Gemini connection needs attention. Check the workspace API key.',503,'GEMINI_AUTH');
      throw failure('Gemini is unavailable. Please retry.',502,'GEMINI_UNAVAILABLE');
    }
    const candidate=data.candidates?.[0];
    if(!candidate||candidate.finishReason!=='STOP')throw failure('Gemini could not finish this reply. Please retry.',502,'GEMINI_INCOMPLETE');
    let raw;
    try{raw=JSON.parse(candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join(''))}catch{throw failure('Gemini returned an unreadable reply. Please retry.',502,'GEMINI_INVALID_RESPONSE')}
    if(!raw||typeof raw.reply!=='string'||!raw.reply.trim()||!ALLOWED_ACTIONS.has(raw.action)||!ALLOWED_SCOPES.has(raw.scope))
      throw failure('Gemini returned an incomplete reply. Please retry.',502,'GEMINI_INVALID_RESPONSE');
    return {reply:raw.reply.slice(0,1800),action:raw.action,scope:raw.scope,
      targetIds:[...new Set((Array.isArray(raw.target_ids)?raw.target_ids:[]).filter(id=>known.has(id)))].slice(0,32),
      groupName:String(raw.group_name||'').slice(0,65),editPrompt:String(raw.edit_prompt||'').slice(0,3800),reason:String(raw.reason||'').slice(0,500),
      references:[],provider:'gemini',model:MODEL,
      usage:data.usageMetadata?{input_tokens:data.usageMetadata.promptTokenCount,output_tokens:data.usageMetadata.candidatesTokenCount,total_tokens:data.usageMetadata.totalTokenCount}:null};
  }catch(e){
    if(e.name==='AbortError')throw failure('Gemini consultation timed out. Please retry.',504,'GEMINI_TIMEOUT');
    throw e;
  }finally{clearTimeout(timer)}
}
module.exports=async function handler(req,res){
  if(!await guard(req,res,'POST'))return;
  const key=String(process.env.GEMINI_API_KEY||'').trim();
  if(!key)return send(res,503,{error:'Gemini is not connected for this workspace yet.',code:'GEMINI_NOT_CONFIGURED'});
  try{return send(res,200,await consult(req.body,key))}
  catch(e){return send(res,e.status||502,{error:e.status?e.message:'Gemini consultation failed. Please retry.',code:e.code||'GEMINI_UNAVAILABLE'})}
};
module.exports.consult=consult;
module.exports.config={maxDuration:60};
