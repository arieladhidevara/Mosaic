const {hosted}=require('../lib/dev-auth');
if(hosted(process.env)||process.env.NODE_ENV==='production')throw Error('The local launcher cannot run in a deployed or production environment.');
process.env.NODE_ENV='development';require('../lib/env').loadLocalEnv();
// Use the same public SAM 3 Space as mozAI production unless .env.local overrides it.
// This is a public endpoint URL, not a token or credential.
process.env.MOZAI_HF_SAM3_SPACE_URL??='https://arieladhidevara-mozai.hf.space';
if(hosted(process.env))throw Error('Remove hosted deployment flags from the local development environment.');
if(process.argv.includes('--auto-login'))process.env.MOSAIC_DEV_AUTH='true';
else if(process.argv.includes('--real-login'))process.env.MOSAIC_DEV_AUTH='false';
else process.env.MOSAIC_DEV_AUTH??='false';
require('../local-server');
