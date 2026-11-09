function summary(generations=[],events=[]){
  const count=operation=>generations.filter(row=>row.operation===operation).length;
  const event=type=>events.filter(row=>row.type===type).length;
  const known=(field)=>generations.filter(row=>row[field]!==null&&row[field]!==undefined&&Number.isFinite(Number(row[field])));
  const tokens=known('total_tokens'),costs=known('estimated_cost_usd');
  return {edits:generations.length,masking:count('edit'),master:count('master'),harmonize:count('harmonize'),
    success:generations.filter(row=>row.status==='success').length,failed:generations.filter(row=>row.status==='failed').length,
    pending:generations.filter(row=>row.status==='pending').length,
    total_tokens:tokens.length?tokens.reduce((sum,row)=>sum+Number(row.total_tokens),0):null,token_records:tokens.length,
    estimated_cost_usd:costs.length?Math.round(costs.reduce((sum,row)=>sum+Number(row.estimated_cost_usd),0)*1e8)/1e8:null,cost_records:costs.length,
    wand:event('wand_used'),auto_create:event('auto_create_used'),mask_edits:event('mask_edited'),
    selections:event('selection_created'),simplified:event('selection_simplified'),exports:event('image_exported')};
}
function analytics(data,{userId=null,projectId=null,now=new Date()}={}){
  const matches=row=>(!userId||row.user_id===userId)&&(!projectId||row.project_id===projectId);
  const generations=data.generations.filter(matches),events=data.events.filter(matches);
  const daily=[];
  for(let days=29;days>=0;days--){
    const date=new Date(now);date.setUTCDate(date.getUTCDate()-days);
    const key=date.toISOString().slice(0,10);
    daily.push({date:key,...summary(generations.filter(row=>row.created_at?.startsWith(key)),events.filter(row=>row.created_at?.startsWith(key)))});
  }
  const users=data.users.filter(user=>!userId||(user.user_id||user.id)===userId).map(user=>{
    const id=user.user_id||user.id;
    return {id,email:user.email,role:user.role,status:user.status,projects:data.projects.filter(row=>row.user_id===id).length,
      ...summary(generations.filter(row=>row.user_id===id),events.filter(row=>row.user_id===id))};
  });
  return {summary:{...summary(generations,events),users:users.length,projects:data.projects.filter(row=>(!userId||row.user_id===userId)&&(!projectId||row.id===projectId)).length},daily,users};
}
module.exports={summary,analytics};
