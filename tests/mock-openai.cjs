// Test-only preload: node --require ./tests/mock-openai.cjs local-server.js
// Returns a solid red image and never contacts OpenAI.
if(process.env.NODE_ENV==='production'||require('../lib/dev-auth').hosted(process.env))throw Error('Test provider cannot run in production.');
process.env.MOSAIC_DEV_DATA_NAMESPACE??='browser-tests';
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
  let body;try{body=JSON.parse(options?.body||'{}')}catch{}
  if(body?.text?.format?.name==='object_map_categories')return Response.json({output_text:JSON.stringify({objects:[{id:1,category:'Wall',label:'wall'},{id:2,category:'Door',label:'door'},{id:3,category:'Floor',label:'floor'},{id:4,category:'Door',label:'second door'}]})});
  if(String(url).endsWith('/images/edits')){
    await new Promise(resolve=>setTimeout(resolve,140));
    if(body?.prompt?.includes('INSTANCE SEGMENTATION COLOR MAP')){
      const {PALETTE}=await import('../object-map-utils.mjs');
      const [w,h]=body.size.split('x').map(Number),head=Buffer.alloc(13);head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;
      const data=Buffer.alloc(h*(w*4+1));
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let id=x>w*.15&&x<w*.48&&y>h*.2&&y<h*.8?2:x>w*.58&&x<w*.9&&y>h*.25&&y<h*.75?3:1;
        if(x>w*.25&&x<w*.3&&y>h*.4&&y<h*.5)id=0;
        if(x>w*.5&&x<w*.55&&y>h*.3&&y<h*.6)id=2;
        // A distant single-pixel color fleck must not join the left object.
        if(x===Math.round(w*.95)&&y===Math.round(h*.12))id=2;
        const i=y*(w*4+1)+1+x*4;data.set(id?PALETTE[id-1].rgb:[0,0,0],i);data[i+3]=255;
      }
      const map=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
      return Response.json({data:[{b64_json:map.toString('base64')}]});
    }
    return Response.json({data:[{b64_json:png.toString('base64')}]});
  }
  return Response.json({output_text:'Wall'});
};
