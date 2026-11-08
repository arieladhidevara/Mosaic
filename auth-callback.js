const params=new URLSearchParams(location.search),code=params.get('code'),state=params.get('state');
history.replaceState(null,'',location.pathname);
async function finish(){
  let message;
  try{
    if(!code||!state)throw Error('Google sign-in was cancelled or could not be completed. Return to mozAI and try again.');
    const response=await fetch('/api/session',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'oauth_exchange',code,state})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Sign-in failed.');
    message={type:'mozai:oauth',ok:true};document.getElementById('callbackStatus').textContent='You are signed in. Return to your workspace.';
  }catch(error){message={type:'mozai:oauth',ok:false,error:error.message};document.getElementById('callbackStatus').textContent=error.message}
  if(window.opener){window.opener.postMessage(message,location.origin);if(message.ok)window.close()}
  else if(message.ok)location.replace('/');
}
void finish();
