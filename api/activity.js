const {send,guard}=require('../lib/auth');
const store=require('../lib/data-store');
module.exports=async function(req,res){
  if(!await guard(req,res,'POST'))return;
  try{
    const body=req.body||{};
    if(body.action==='project'){
      if(store.UUID.test(body.projectId||'')){
        try{await store.ownProject(req.account,body.projectId);return send(res,200,{project:{id:body.projectId}})}
        catch(error){if(error.status!==403)throw error}
      }
      return send(res,201,{project:await store.createProject(req.account)});
    }
    return send(res,200,await store.event(req.account,body));
  }catch(error){return send(res,error.status||503,{error:error.status?error.message:'Activity could not be recorded.',code:error.code})}
};
