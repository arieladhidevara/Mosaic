const {test}=require('node:test');
const assert=require('node:assert/strict');
const vault=require('../lib/credential-store');
const a={id:'11111111-1111-4111-8111-111111111111',environment:'production',auth:'supabase'};
const b={...a,id:'22222222-2222-4222-8222-222222222222'};
test('OpenAI BYOK secrets use account-bound AES-GCM, not plaintext or hashes',async()=>{
  const previous=process.env.MOSAIC_KEY_ENCRYPTION_SECRET;
  process.env.MOSAIC_KEY_ENCRYPTION_SECRET='ab'.repeat(32);
  try{
    const key='sk-test-account-key-for-encryption';
    const first=await vault.seal(a,key),second=await vault.seal(a,key);
    assert.notEqual(first,second);
    assert(!first.includes(key));
    assert.equal(await vault.unseal(a,first),key);
    await assert.rejects(vault.unseal(b,first),/cannot be decrypted/i);
    await assert.rejects(vault.unseal(a,first.slice(0,-3)+'xxx'),/cannot be decrypted/i);
  }finally{
    if(previous===undefined)delete process.env.MOSAIC_KEY_ENCRYPTION_SECRET;
    else process.env.MOSAIC_KEY_ENCRYPTION_SECRET=previous;
  }
});