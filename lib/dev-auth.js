/* Server-only development identity. No client IDs, roles, proxy headers or tokens. */
const DEV_USER=Object.freeze({id:'00000000-0000-4000-8000-000000000001',email:'dev@mosaic.local',role:'admin',status:'active',environment:'development',auth:'development'});
function loopback(address){return address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1'}
function hosted(env){return ['VERCEL','VERCEL_ENV','VERCEL_URL','VERCEL_REGION','VERCEL_DEPLOYMENT_ID'].some(key=>env[key]!==undefined)}
function localHost(value){
  try{const url=new URL('http://'+value);return !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)}catch{return false}
}
function isDevelopmentRequest(req,env=process.env){
  return env.NODE_ENV==='development'&&env.MOSAIC_DEV_AUTH==='true'&&!hosted(env)
    &&loopback(req.socket?.remoteAddress)&&loopback(req.socket?.localAddress)&&localHost(req.headers?.host)
    &&!Object.keys(req.headers||{}).some(key=>/^(?:forwarded$|x-forwarded-|x-vercel-)/i.test(key));
}
function environment(env=process.env){
  if(hosted(env))return env.VERCEL_ENV==='preview'?'preview':'production';
  return env.NODE_ENV==='development'?'development':'production';
}
module.exports={DEV_USER,loopback,localHost,hosted,isDevelopmentRequest,environment};
