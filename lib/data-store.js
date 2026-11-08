const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {AppError,db,rpc}=require('./supabase');
const {hashToken}=require('./accounts');
const namespace=/^[a-z0-9_-]{1,40}$/.test(process.env.MOSAIC_DEV_DATA_NAMESPACE||'')?process.env.MOSAIC_DEV_DATA_NAMESPACE:'';
const DEFAULT_DATA_FILE=path.resolve(__dirname,'../.mosaic-dev',namespace,'data.json');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS=new Set(['session_started','base_uploaded','master_uploaded','project_opened','project_saved','selection_created','image_exported']);
function createStore(DATA_FILE=DEFAULT_DATA_FILE){
let writes=Promise.resolve();
function isLocal(actor){return actor.auth==='development'&&actor.environment==='development'}
function empty(){return {version:1,users:[],projects:[],events:[],generations:[],invitations:[]}}
async function local(actor,fn){
  if(!isLocal(actor))throw new AppError(403,'Local development data is unavailable.');
  const task=writes.then(async()=>{
    let data;try{data=JSON.parse(await fs.readFile(DATA_FILE,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;data=empty()}
    if(!data.users.some(user=>user.id===actor.id))data.users.push({...actor,created_at:new Date().toISOString()});
    const result=await fn(data);
    await fs.mkdir(path.dirname(DATA_FILE),{recursive:true});const temporary=DATA_FILE+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify(data),{mode:0o600});await fs.rename(temporary,DATA_FILE);return result;
  });writes=task.catch(()=>{});return task;
}
async function seed(actor){if(isLocal(actor))await local(actor,()=>{});return actor}
function row(actor,values){return {...values,user_id:actor.id,environment:actor.environment}}
async function createProject(actor){
  const project=row(actor,{id:randomUUID(),created_at:new Date().toISOString()});
  if(isLocal(actor))await local(actor,data=>data.projects.push(project));
  else await db('mosaic_projects',{method:'POST',body:project});
  return project;
}
async function ownProject(actor,id){
  if(!id)return null;
  if(!UUID.test(id))throw new AppError(400,'Invalid project identifier.');
  const exists=isLocal(actor)?await local(actor,data=>data.projects.some(p=>p.id===id&&p.user_id===actor.id)):
    (await db(`mosaic_projects?id=eq.${id}&user_id=eq.${actor.id}&environment=eq.${actor.environment}&select=id`))?.length;
  if(!exists)throw new AppError(403,'Project access denied.');return id;
}
async function event(actor,body){
  if(!EVENTS.has(body.type)||!UUID.test(body.id||''))throw new AppError(400,'Invalid activity event.');
  const project=await ownProject(actor,body.projectId);
  const record=row(actor,{id:body.id,type:body.type,project_id:project,created_at:new Date().toISOString()});
  if(isLocal(actor))await local(actor,data=>{
    if(!data.events.some(e=>e.id===record.id))data.events.push(record);
    const user=data.users.find(u=>u.id===actor.id);user.last_active_at=record.created_at;
  });
  else await rpc('mosaic_record_event',{p_id:record.id,p_user_id:actor.id,p_environment:actor.environment,p_project_id:project,p_type:record.type});
  return {recorded:true,id:record.id};
}
async function startGeneration(actor,values){
  const projectId=await ownProject(actor,values.projectId);
  const record=row(actor,{id:randomUUID(),project_id:projectId,operation:values.operation,model:values.model,quality:values.quality,
    preserve_original_geometry:values.preserveOriginalGeometry,status:'pending',created_at:new Date().toISOString(),duration_ms:null,
    input_tokens:null,output_tokens:null,total_tokens:null,estimated_cost_usd:null,error_code:null});
  if(isLocal(actor))await local(actor,data=>data.generations.push(record));
  else await db('mosaic_generations',{method:'POST',body:record});
  return record;
}
async function finishGeneration(actor,id,values){
  // Only this server-side pipeline can write generation results or token usage.
  if(isLocal(actor))await local(actor,data=>{const g=data.generations.find(g=>g.id===id&&g.user_id===actor.id);if(g)Object.assign(g,values)});
  else await db(`mosaic_generations?id=eq.${id}&user_id=eq.${actor.id}&environment=eq.${actor.environment}`,{method:'PATCH',body:values});
}
async function demoCredits(actor){
  const policy=require('../demo-credits');
  let used;
  if(isLocal(actor))used=await local(actor,data=>data.generations.filter(g=>g.user_id===actor.id&&g.environment===actor.environment&&g.status==='success').reduce((sum,g)=>sum+(policy.costs[g.quality]||0),0));
  else{
    const counts=await Promise.all(Object.entries(policy.costs).map(async([quality,cost])=>{
      const result=await db(`mosaic_generations?user_id=eq.${encodeURIComponent(actor.id)}&environment=eq.${actor.environment}&status=eq.success&quality=eq.${quality}&select=id&limit=1`,{method:'HEAD',headers:{Prefer:'count=exact'},count:true});
      return result.count*cost;
    }));used=counts.reduce((sum,n)=>sum+n,0);
  }
  return {kind:'demo',version:policy.version,initial:policy.initial,used,remaining:Math.max(0,policy.initial-used),costs:policy.costs,openaiBalance:null};
}
function overview(data){
  const succeeded=data.generations.filter(g=>g.status==='success'),failed=data.generations.filter(g=>g.status==='failed');
  const known=data.generations.filter(g=>g.total_tokens!==null);
  return {users:data.users.length,projects:data.projects.length,generations:data.generations.length,exports:data.events.filter(e=>e.type==='image_exported').length,
    successful_generations:succeeded.length,failed_generations:failed.length,total_tokens:known.length?known.reduce((sum,g)=>sum+g.total_tokens,0):null,
    usage_records:known.length,average_duration_ms:succeeded.length?Math.round(succeeded.reduce((sum,g)=>sum+g.duration_ms,0)/succeeded.length):null};
}
async function adminList(actor,kind,page=1){
  if(actor.role!=='admin')throw new AppError(403,'Administrator access is required.');
  const start=(page-1)*50;
  const fields={users:'user_id,email,role,status,environment,created_at,last_active_at',invitations:'id,label,email,max_uses,redemption_count,expires_at,revoked_at,environment,created_at',
    events:'id,user_id,project_id,type,environment,created_at',generations:'id,user_id,project_id,operation,model,quality,preserve_original_geometry,status,duration_ms,input_tokens,output_tokens,total_tokens,estimated_cost_usd,error_code,environment,created_at'};
  if(kind!=='overview'&&!fields[kind])throw new AppError(400,'Unknown admin view.');
  if(isLocal(actor))return local(actor,data=>{
    if(kind==='overview')return overview(data);
    const all=[...data[kind]].reverse();return {rows:all.slice(start,start+50).map(item=>{const {token_hash,...safe}=item;return safe}),hasMore:all.length>start+50,page};
  });
  if(kind==='overview')return rpc('mosaic_admin_overview',{p_environment:actor.environment});
  const table=kind==='users'?'mosaic_members':'mosaic_'+kind;
  const rows=await db(`${table}?environment=eq.${actor.environment}&select=${fields[kind]}&order=created_at.desc&offset=${start}&limit=51`);
  return {rows:rows.slice(0,50),hasMore:rows.length>50,page};
}
async function createInvitation(actor,body){
  if(actor.role!=='admin')throw new AppError(403,'Administrator access is required.');
  const days=Number(body.days??7),maxUses=Number(body.maxUses??1),email=String(body.email||'').trim().toLowerCase();
  if(!Number.isInteger(days)||days<1||days>30||!Number.isInteger(maxUses)||maxUses<1||maxUses>100||email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new AppError(400,'Invalid invitation settings.');
  const token=randomBytes(32).toString('base64url'),record={id:randomUUID(),created_by:actor.id,environment:actor.environment,token_hash:hashToken(token),
    label:String(body.label||'').trim().slice(0,64),email:email||null,max_uses:maxUses,redemption_count:0,created_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+days*86400000).toISOString(),revoked_at:null};
  if(isLocal(actor))await local(actor,data=>data.invitations.push(record));else await db('mosaic_invitations',{method:'POST',body:record});
  const {token_hash,...safe}=record;return {invitation:safe,token};
}
async function revokeInvitation(actor,id){
  if(actor.role!=='admin'||!UUID.test(id||''))throw new AppError(400,'Invalid invitation.');
  const values={revoked_at:new Date().toISOString()};
  if(isLocal(actor))await local(actor,data=>{const item=data.invitations.find(i=>i.id===id);if(item)Object.assign(item,values)});
  else await db(`mosaic_invitations?id=eq.${id}&environment=eq.${actor.environment}`,{method:'PATCH',body:values});
  return {revoked:true};
}
async function reset(actor){
  if(!isLocal(actor))throw new AppError(403,'Reset is available only for local development data.');
  await local(actor,data=>Object.assign(data,empty()));await seed(actor);return {reset:true};
}
return {DATA_FILE,UUID,EVENTS,seed,createProject,ownProject,event,startGeneration,finishGeneration,demoCredits,adminList,createInvitation,revokeInvitation,reset,overview};
}
module.exports={...createStore(),createStore};
