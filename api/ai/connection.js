/* The only endpoint allowed to receive a plaintext OpenAI key. Never returns it. */
const {send,guard}=require('../../lib/auth'),keys=require('../../lib/credential-store');
module.exports=async function(req,res){
  if(!['GET','POST','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, DELETE');return send(res,405,{error:'Method not allowed'})}
  if(!await guard(req,res,req.method))return;
  try{
    if(req.method==='GET')return send(res,200,await keys.status(req.account));
    if(req.method==='DELETE')return send(res,200,await keys.remove(req.account));
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{},key=body.apiKey;
    if(typeof key!=='string'||!/^sk-[\w-]{15,300}$/.test(key))return send(res,400,{error:'Enter a valid OpenAI API key starting with sk-.'});
    // Verify the key before persistence without generating an image.
    const response=await fetch('https://api.openai.com/v1/models',{
      headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000),cache:'no-store'
    });
    if(!response.ok)return send(res,[401,403].includes(response.status)?400:503,{
      error:response.status===401?'OpenAI rejected this API key.':response.status===403?'Your OpenAI key cannot list models for verification.':response.status===429?'OpenAI request limit reached. Check billing and limits.':'Could not reach OpenAI.'
    });
    return send(res,200,await keys.save(req.account,key));
  }catch(e){return send(res,e.status||503,{error:e.status?e.message:'Could not verify or save this key.',code:e.code||'KEY_SAVE_FAILED'})}
};