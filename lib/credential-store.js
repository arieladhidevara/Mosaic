/* Server-only, account-bound AES-256-GCM OpenAI key storage. */
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {AppError,db}=require('./supabase');
const folder=path.resolve(__dirname,'../.mosaic-dev',/^[a-z0-9_-]{1,40}$/.test(process.env.MOSAIC_DEV_DATA_NAMESPACE||'')?process.env.MOSAIC_DEV_DATA_NAMESPACE:'');
const dev=a=>a?.auth==='development'&&a.environment==='development';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function scope(a){if(!a||!uuid.test(a.id)||!['production','preview','development'].includes(a.environment))throw new AppError(403,'Verified account required.','AUTH_REQUIRED');return a.id+':'+a.environment}
async function secret(a){
  const env=process.env.MOSAIC_KEY_ENCRYPTION_SECRET;
  if(env){
    if(!/^[a-f0-9]{64}$/i.test(env))throw new AppError(503,'Encryption secret invalid.','KEY_STORAGE_UNAVAILABLE');
    return Buffer.from(env,'hex');
  }
  if(!dev(a)||require('./dev-auth').hosted(process.env)||process.env.NODE_ENV==='production')throw new AppError(503,'Secure key storage unavailable.','KEY_STORAGE_UNAVAILABLE');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const file=path.join(folder,'credential-secret');
  try{await fs.writeFile(file,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
  const value=(await fs.readFile(file,'utf8')).trim();
  if(!/^[a-f0-9]{64}$/i.test(value))throw new AppError(503,'Local key storage unavailable.','KEY_STORAGE_UNAVAILABLE');
  return Buffer.from(value,'hex');
}
async function seal(a,key){
  if(typeof key!=='string'||!/^sk-[\w-]{15,300}$/.test(key))throw new AppError(400,'Enter a valid OpenAI key.','INVALID_KEY');
  const iv=crypto.randomBytes(12),enc=crypto.createCipheriv('aes-256-gcm',await secret(a),iv);
  enc.setAAD(Buffer.from(scope(a)));
  const cipher=Buffer.concat([enc.update(key,'utf8'),enc.final()]);
  return 'v1.'+[iv,enc.getAuthTag(),cipher].map(b=>b.toString('base64url')).join('.');
}
async function unseal(a,value){
  try{
    const p=value.split('.');
    if(p.length!==4||p[0]!=='v1')throw Error('invalid envelope');
    const [iv,tag,cipher]=p.slice(1).map(s=>Buffer.from(s,'base64url'));
    if(iv.length!==12||tag.length!==16||!cipher.length)throw Error('invalid bytes');
    const dec=crypto.createDecipheriv('aes-256-gcm',await secret(a),iv);
    dec.setAAD(Buffer.from(scope(a)));dec.setAuthTag(tag);
    const key=Buffer.concat([dec.update(cipher),dec.final()]).toString('utf8');
    if(!/^sk-[\w-]{15,300}$/.test(key))throw Error('invalid key');
    return key;
  }catch{throw new AppError(503,'Saved OpenAI key cannot be decrypted. Reconnect your key.','KEY_DECRYPT_FAILED')}
}
function file(a){scope(a);return path.join(folder,'openai-'+a.id+'.json')}
async function lookup(a){
  scope(a);
  if(dev(a))try{return JSON.parse(await fs.readFile(file(a),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw new AppError(503,'Local secure storage unavailable.')}
  return (await db('mosaic_api_keys?user_id=eq.'+encodeURIComponent(a.id)+'&environment=eq.'+a.environment+'&select=encrypted_key,key_hint,updated_at&limit=1'))?.[0]||null;
}
async function status(a){const r=await lookup(a);return {connected:Boolean(r),keyHint:r?.key_hint||null,updatedAt:r?.updated_at||null}}
async function save(a,key){
  const encrypted_key=await seal(a,key),key_hint=key.slice(-4),updated_at=new Date().toISOString();
  if(dev(a)){
    await fs.mkdir(folder,{recursive:true,mode:0o700});
    const dest=file(a),tmp=dest+'.'+crypto.randomBytes(8).toString('hex');
    await fs.writeFile(tmp,JSON.stringify({encrypted_key,key_hint,updated_at}),{mode:0o600});await fs.rename(tmp,dest);
  }else await db('mosaic_api_keys',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:{user_id:a.id,environment:a.environment,encrypted_key,key_hint,updated_at}});
  return {connected:true,keyHint:key_hint,updatedAt:updated_at};
}
async function remove(a){
  scope(a);
  if(dev(a))try{await fs.unlink(file(a))}catch(e){if(e.code!=='ENOENT')throw e}
  else await db('mosaic_api_keys?user_id=eq.'+encodeURIComponent(a.id)+'&environment=eq.'+a.environment,{method:'DELETE'});
  return {connected:false,keyHint:null,updatedAt:null};
}
async function reveal(a){const row=await lookup(a);if(!row)throw new AppError(400,'Connect an OpenAI key in your profile first.','OPENAI_KEY_MISSING');return unseal(a,row.encrypted_key)}
module.exports={status,save,remove,reveal,seal,unseal};
