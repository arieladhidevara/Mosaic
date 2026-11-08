require('../lib/env').loadLocalEnv();
const {rpc}=require('../lib/supabase');
const email=process.argv[2],environment=process.argv[3];
if(!email||!['development','preview','production'].includes(environment))throw Error('Usage: node scripts/bootstrap-admin.js EMAIL development|preview|production');
rpc('mosaic_bootstrap_admin',{p_email:email,p_environment:environment}).then(()=>console.log('Verified Supabase user granted admin access in '+environment+'.')).catch(()=>{console.error('Admin setup failed. Check server configuration, migration, and confirmed email in Supabase Auth.');process.exitCode=1});
