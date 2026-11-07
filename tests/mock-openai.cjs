// Test-only preload: node --require ./tests/mock-openai.cjs local-server.js
// Returns a solid red image and never contacts OpenAI.
const {deflateSync}=require('node:zlib');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const kind=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,crc])}
const header=Buffer.alloc(13);header.writeUInt32BE(256,0);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;
const pixels=Buffer.alloc(256*(256*4+1));
for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*(256*4+1)+1+x*4;pixels[i]=255;pixels[i+3]=255}
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const realFetch=global.fetch;
global.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.openai.com/'))return realFetch(url,options);
  if(String(url).endsWith('/images/edits')){
    await new Promise(resolve=>setTimeout(resolve,140));
    return Response.json({data:[{b64_json:png.toString('base64')}]});
  }
  return Response.json({output_text:'Wall'});
};
