const {send,guard}=require('../lib/auth');
const accounts=require('../lib/accounts');
const {seed}=require('../lib/data-store');
module.exports=async function(req,res){
  if(!await guard(req,res,req.method==='GET'?'GET':'POST',{public:true}))return;
  try{
    if(req.method==='GET'){const actor=await accounts.requireUser(req);await seed(actor);return send(res,200,{authenticated:true,user:actor})}
    const body=req.body||{};
    if(body.action==='logout'){
      const token=accounts.cookies(req)[accounts.cookieName()];
      if(token)try{await require('../lib/supabase').call('/auth/v1/logout',{method:'POST',token})}catch{}
      accounts.setSession(res,null);return send(res,200,{authenticated:false});
    }
    if(body.action==='login'||body.action==='signup')return send(res,200,await accounts.signIn(body,res));
    if(body.action==='refresh')return send(res,200,await accounts.refresh(req,res));
    if(body.action==='exchange'){
      const actor=await accounts.membership(await accounts.verifiedUser(body.accessToken),body.invitation);
      if(typeof body.refreshToken!=='string'||body.refreshToken.length>12000)throw Error('Invalid session.');
      accounts.setSession(res,{access_token:body.accessToken,refresh_token:body.refreshToken,expires_in:3600});return send(res,200,{authenticated:true,user:actor});
    }
    return send(res,400,{error:'Unknown authentication action.'});
  }catch(error){return send(res,error.status||400,{error:error.status?error.message:'Unable to authenticate.',code:error.code||'AUTH_REQUIRED'})}
};
