'use strict';
/* Server-owned Gemini conversation state, isolated per authorized mozAI project.
   The browser supplies only a project UUID, never a provider interaction ID. */
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {db,AppError}=require('./supabase');
const store=require('./data-store');
const namespace=/^[a-z0-9_-]{1,40}$/.test(process.env.MOSAIC_DEV_DATA_NAMESPACE||'')?process.env.MOSAIC_DEV_DATA_NAMESPACE:'';
const localFile=path.resolve(__dirname,'../.mosaic-dev',namespace,'ai-sessions.json');
let pending=Promise.resolve();
function local(actor){return actor?.auth==='development'&&actor.environment==='development'}
function clean(session){
  const id=typeof session?.id==='string'&&/^[a-zA-Z0-9_-]{5,250}$/.test(session.id)?session.id:null;
  const memory=typeof session?.memory==='string'?session.memory.slice(0,1200):'';
  const lastTargetIds=Array.isArray(session?.lastTargetIds)?[...new Set(session.lastTargetIds.filter(v=>typeof v==='string'&&v.length<=100))].slice(0,24):[];
  return {id,memory,lastTargetIds};
}
async function localRead(){
  try{return JSON.parse(await fs.readFile(localFile,'utf8'))}
  catch(e){if(e.code==='ENOENT')return {};throw e}
}
async function load(actor,projectId){
  if(!store.UUID.test(projectId||''))throw new AppError(400,'Invalid AI project identifier.','INVALID_PROJECT');
  await store.ownProject(actor,projectId);
  if(local(actor)){
    const data=await localRead();const row=data[actor.id+':'+projectId];
    return row?clean(row):null;
  }
  const rows=await db('mosaic_ai_sessions?project_id=eq.'+projectId+'&user_id=eq.'+actor.id+
    '&environment=eq.'+encodeURIComponent(actor.environment)+
    '&select=interaction_id,design_memory,last_target_ids&limit=1');
  const row=rows?.[0];
  return row?clean({id:row.interaction_id,memory:row.design_memory,lastTargetIds:row.last_target_ids}):null;
}
async function save(actor,projectId,session){
  if(!store.UUID.test(projectId||''))throw new AppError(400,'Invalid AI project identifier.','INVALID_PROJECT');
  await store.ownProject(actor,projectId);
  const safe=clean(session);
  if(!safe.id)throw new AppError(400,'Invalid Gemini interaction identifier.','INVALID_AI_SESSION');
  if(local(actor)){
    // Writes are serialized to avoid losing sessions for two projects during local development.
    const task=pending.then(async()=>{
      const data=await localRead();data[actor.id+':'+projectId]=safe;
      await fs.mkdir(path.dirname(localFile),{recursive:true});
      const temp=localFile+'.'+randomUUID()+'.tmp';
      await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});await fs.rename(temp,localFile);
    });
    pending=task.catch(()=>{});return task;
  }
  const row={
    project_id:projectId,user_id:actor.id,environment:actor.environment,
    interaction_id:safe.id,design_memory:safe.memory,last_target_ids:safe.lastTargetIds,
    updated_at:new Date().toISOString()
  };
  await db('mosaic_ai_sessions?on_conflict=project_id',{method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:row});
}
module.exports={load,save,clean};
