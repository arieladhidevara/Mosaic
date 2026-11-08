const {hosted,DEV_USER}=require('../lib/dev-auth');
if(hosted(process.env)||process.env.NODE_ENV==='production')throw Error('Local data reset is disabled in hosted and production environments.');
require('../lib/data-store').reset(DEV_USER).then(()=>console.log('Local development data reset. Production databases and saved .moz files were not accessed.')).catch(()=>{console.error('Unable to reset local development data.');process.exitCode=1});
