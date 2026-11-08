const {send,guard,requireApiKey}=require('../../lib/auth');
module.exports=async function(req,res){
  if(!await guard(req,res,'POST')||!requireApiKey(req,res))return;
  try{
    // A free authentication check, not a balance or image-model access check.
    const response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+req.body.apiKey},signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok){
      const message=response.status===401?'OpenAI rejected this API key. Create a new key and try again.':response.status===403?'This key needs permission to list models for the connection check. Check its permissions in OpenAI.':response.status===429?'OpenAI is limiting requests. Check your billing and limits, then retry.':'Could not connect to OpenAI. Please try again.';
      return send(res,response.status===401||response.status===403?400:503,{error:message});
    }
    return send(res,200,{connected:true,balanceAvailable:false});
  }catch{return send(res,503,{error:'Could not reach OpenAI. Please try again.'})}
};
