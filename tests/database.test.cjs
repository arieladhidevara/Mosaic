const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
test('Phase 2 migration and invitation security in PostgreSQL',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec('create schema auth; create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz); create role anon; create role authenticated; create role service_role bypassrls;');
  const migration=await fs.readFile(path.resolve(__dirname,'../supabase/migrations/202611070001_phase2.sql'),'utf8');
  await pg.exec(migration);await pg.exec(migration);
  const ids={admin:randomUUID(),first:randomUUID(),second:randomUUID(),unconfirmed:randomUUID()};
  for(const [name,id] of Object.entries(ids))await pg.query('insert into auth.users values($1,$2,$3)',[id,name+'@example.com',name==='unconfirmed'?null:new Date()]);
  const scalar=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
  const invite=async({email=null,expired=false,revoked=false,uses=1,environment='production'}={})=>{
    const id=randomUUID(),hash=createHash('sha256').update(randomUUID()).digest('hex');
    await pg.query('insert into public.mosaic_invitations(id,created_by,environment,token_hash,email,max_uses,expires_at,revoked_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,ids.admin,environment,hash,email,uses,new Date(Date.now()+(expired?-1:1)*86400000),revoked?new Date():null]);
    return {id,hash};
  };
  await t.test('bootstrap accepts only a confirmed Supabase Auth user',async()=>{
    await assert.rejects(()=>pg.query("select public.mosaic_bootstrap_admin('unconfirmed@example.com','production')"),/confirm|user/i);
    const id=await scalar("select public.mosaic_bootstrap_admin('ADMIN@example.com','production')");assert.equal(id,ids.admin);
    assert.equal(await scalar('select role from public.mosaic_members where user_id=$1',[ids.admin]),'admin');
  });
  await t.test('tables have RLS and anonymous/authenticated roles cannot read data or redeem invitations',async()=>{
    const tables=['mosaic_members','mosaic_invitations','mosaic_redemptions','mosaic_projects','mosaic_events','mosaic_generations'];
    for(const table of tables){
      assert.equal(await scalar('select relrowsecurity from pg_class where relname=$1',[table]),true);
      for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_table_privilege($1,$2,\'SELECT\')',[role,'public.'+table]),false);
    }
    for(const role of ['anon','authenticated']){
      await pg.exec('set role '+role);
      try{
        await assert.rejects(()=>pg.query('select * from public.mosaic_members'),/permission denied/);
        await assert.rejects(()=>pg.query('select public.mosaic_bootstrap_admin($1,$2)',['first@example.com','production']),/permission denied/);
        await assert.rejects(()=>pg.query('select public.mosaic_redeem_invitation($1,$2,$3)',['a'.repeat(64),ids.first,'production']),/permission denied/);
      }finally{await pg.exec('reset role')}
    }
  });
  await t.test('expiry, revocation, email binding, confirmation, and environment are enforced',async()=>{
    for(const options of [{expired:true},{revoked:true},{email:'different@example.com'},{environment:'preview'}]){
      const invitation=await invite(options);
      assert.equal(await scalar('select public.mosaic_check_invitation($1,$2,$3)',[invitation.hash,'first@example.com','production']),false);
      assert.equal(await scalar('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.first,'production']),null);
    }
    const invitation=await invite();assert.equal(await scalar('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.unconfirmed,'production']),null);
  });
  await t.test('one-use invitation grants a user membership once and cannot create an admin',async()=>{
    const invitation=await invite({email:'first@example.com'});
    const member=await scalar('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.first,'production']);
    assert.equal(member.user_id,ids.first);assert.equal(member.role,'user');
    await pg.query('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.first,'production']);
    assert.equal(await scalar('select redemption_count from public.mosaic_invitations where id=$1',[invitation.id]),1);
    assert.equal(await scalar('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.second,'production']),null);
    const suspended=await invite();await pg.query("update public.mosaic_members set status='suspended' where user_id=$1",[ids.first]);
    assert.equal((await scalar('select public.mosaic_redeem_invitation($1,$2,$3)',[suspended.hash,ids.first,'production'])).status,'suspended');
    await pg.query("update public.mosaic_members set status='active' where user_id=$1",[ids.first]);
  });
  await t.test('shared capacity cannot be exceeded and redemptions are idempotent',async()=>{
    const invitation=await invite({uses:1});
    await pg.query('select public.mosaic_redeem_invitation($1,$2,$3)',[invitation.hash,ids.second,'production']);
    assert.equal(await scalar('select public.mosaic_check_invitation($1,$2,$3)',[invitation.hash,'second@example.com','production']),false);
    assert.equal(await scalar('select redemption_count from public.mosaic_invitations where id=$1',[invitation.id]),1);
  });
  await t.test('events deduplicate, enforce project ownership, and partition production analytics',async()=>{
    const project=randomUUID(),event=randomUUID();
    await pg.query('insert into public.mosaic_projects(id,user_id,environment) values($1,$2,$3)',[project,ids.first,'production']);
    for(let i=0;i<2;i++)await pg.query('select public.mosaic_record_event($1,$2,$3,$4,$5)',[event,ids.first,'production',project,'image_exported']);
    assert.equal(Number(await scalar('select count(*) from public.mosaic_events')),1);
    await assert.rejects(()=>pg.query('select public.mosaic_record_event($1,$2,$3,$4,$5)',[randomUUID(),ids.second,'production',project,'image_exported']),/Project access denied/);
    const overview=await scalar('select public.mosaic_admin_overview($1)',['production']);assert.equal(overview.exports,1);assert.equal(overview.projects,1);assert.equal(overview.total_tokens,null);
    const preview=await scalar('select public.mosaic_admin_overview($1)',['preview']);assert.equal(preview.exports,0);assert.equal(preview.projects,0);
    await assert.rejects(()=>pg.query('select public.mosaic_record_event($1,$2,$3,$4,$5)',[randomUUID(),ids.first,'production',project,'FAKE_EVENT']),/check constraint/);
  });
});
