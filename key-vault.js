/* Account-scoped browser storage. The server never receives the stored envelope.
   AES-GCM protects the stored bytes; same-origin scripts can still use the key. */
const database='mozai-private-keys',storeName='credentials';
let connection;
function open(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB||!globalThis.crypto?.subtle){reject(Error('Browser storage unavailable'));return}
    const request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'id'});
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null};resolve(request.result)};
    request.onerror=()=>reject(Error('Browser storage unavailable'));
    request.onblocked=()=>reject(Error('Browser storage is busy'));
  });connection.catch(()=>{connection=null});return connection;
}
async function transaction(mode,perform){
  const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,mode);let result;
    const request=perform(tx.objectStore(storeName));request.onsuccess=()=>{result=request.result};
    tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('Browser storage unavailable'));
  });
}
const identity=id=>{if(typeof id!=='string'||id.length<8||id.length>100)throw Error('Verified account required');return id};
const context=id=>new TextEncoder().encode('mozai-openai-key:'+identity(id));
export async function remember(id,value){
  identity(id);
  const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(id)},wrappingKey,new TextEncoder().encode(value));
  await transaction('readwrite',store=>store.put({id,version:1,wrappingKey,iv,ciphertext}));
}
export async function forget(id){await transaction('readwrite',store=>store.delete(identity(id)))}
export async function recall(id){
  const record=await transaction('readonly',store=>store.get(identity(id)));if(!record)return null;
  try{
    if(record.version!==1||record.id!==id)throw Error('Invalid stored key');
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:context(id)},record.wrappingKey,record.ciphertext);
    return new TextDecoder().decode(bytes);
  }catch{await forget(id).catch(()=>{});return null}
}
