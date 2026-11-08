const fs=require('node:fs');
const path=require('node:path');
function loadLocalEnv(){
  const file=path.resolve(__dirname,'../.env.local');if(!fs.existsSync(file))return;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(!match||process.env[match[1]]!==undefined)continue;
    let value=match[2];if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    process.env[match[1]]=value;
  }
}
module.exports={loadLocalEnv};
