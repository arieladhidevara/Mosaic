const {scryptSync,randomBytes}=require('node:crypto');
if(!process.stdin.isTTY){console.error('Run this script in an interactive terminal.');process.exit(1)}
process.stdout.write('Choose the existing Mosaic premium password (input hidden): ');
let password='';
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data',value=>{
  for(const char of value){
    if(char==='\r'||char==='\n'){
      process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');
      const salt=randomBytes(24);
      console.log('MOSAIC_PASSWORD_HASH=scrypt:'+salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex'));
      password='';return;
    }
    if(char==='\u0003'){process.stdin.setRawMode(false);process.exit(130)}
    if(char==='\u007f'){password=password.slice(0,-1)}
    else password+=char;
  }
});
