const {send,guard}=require('../lib/auth');
const store=require('../lib/data-store');
module.exports=async function(req,res){
  if(!await guard(req,res,req.method==='GET'?'GET':'POST',{admin:true}))return;
  try{
    if(req.method==='GET'){
      const params=new URL(req.url,'http://server.invalid').searchParams,page=Number(params.get('page')||1);
      if(!Number.isInteger(page)||page<1||page>10000)return send(res,400,{error:'Invalid page.'});
      return send(res,200,{environment:req.account.environment,data:await store.adminList(req.account,params.get('view')||'overview',page)});
    }
    const body=req.body||{};
    if(body.action==='invite'){
      const result=await store.createInvitation(req.account,body);
      // The plaintext token is returned once; only its SHA-256 digest is stored.
      return send(res,201,result);
    }
    if(body.action==='revoke')return send(res,200,await store.revokeInvitation(req.account,body.id));
    if(body.action==='reset')return send(res,200,await store.reset(req.account));
    return send(res,400,{error:'Unknown admin action.'});
  }catch(error){return send(res,error.status||503,{error:error.status?error.message:'Admin data is unavailable.',code:error.code})}
};
