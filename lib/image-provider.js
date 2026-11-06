const MODEL='gpt-image-2.5-sunburst';
function input(data,allowed=['jpeg','png','webp'],maxBytes=2700000){
  if(typeof data!=='string')throw Error('Missing image');
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if(!m||!allowed.includes(m[1])||m[2].length>Math.ceil(maxBytes*4/3)+8)throw Error('Invalid image format or size');
  const bytes=Buffer.from(m[2],'base64');
  if(bytes.length>maxBytes||bytes.length<64)throw Error('Invalid image size');
  if(m[1]==='png' && bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG');
  if(m[1]==='jpeg' && bytes.subarray(0,2).toString('hex')!=='ffd8')throw Error('Invalid JPEG');
  if(m[1]==='webp' && bytes.toString('ascii',0,4)!=='RIFF')throw Error('Invalid WEBP');
  return {url:data,type:m[1],bytes};
}
function dimensions(obj){
  const b=obj.bytes;
  if(obj.type==='png')return {w:b.readUInt32BE(16),h:b.readUInt32BE(20)};
  if(obj.type==='jpeg'){
    let i=2;
    while(i+9<b.length){
      if(b[i]!==0xff){i++;continue}
      const mark=b[i+1];i+=2;
      if(mark===0xd9||mark===0xda)break;
      if(mark===0x00||mark===0xff||mark===0x01||(mark>=0xd0&&mark<=0xd7))continue;
      if(i+2>b.length)break;
      const n=b.readUInt16BE(i);
      if(n<2||i+n>b.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(mark))return {w:b.readUInt16BE(i+5),h:b.readUInt16BE(i+3)};
      i+=n;
    }
  }
  return null;
}
function compact(text,limit=4000){return typeof text==='string'?text.trim().slice(0,limit):''}
function annotations(value){
  return (Array.isArray(value)?value:[]).slice(0,24).map((a,i)=>({
    index:i+1,color:/^#[0-9a-f]{6}$/i.test(a.color||'')?a.color:'#a6a6a6',
    prompt:compact(a.prompt,240),active:Boolean(a.active)
  }));
}
function validate(req,regional){
  if(Number(req.headers['content-length']||0)>4400000)throw Error('Request is too large. Try a smaller canvas.');
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(typeof b.apiKey!=='string'||!/^sk-[\w-]{15,300}$/.test(b.apiKey))throw Error('Enter a valid OpenAI API key at Premium login.');
  const current=input(b.collage),base=input(b.base);
  const cd=dimensions(current),bd=dimensions(base);
  if(!cd||!bd||cd.w<128||cd.h<128||cd.w>4096||cd.h>4096||bd.w<128||bd.h<128)throw Error('Invalid image dimensions');
  const target=regional?input(b.mask,['png'],3900000):null;
  if(target){const md=dimensions(target);if(!md||md.w!==cd.w||md.h!==cd.h)throw Error('Mask dimensions must match collage dimensions');}
  const guide=regional&&b.guide?input(b.guide,['jpeg','png'],2700000):null;
  const prompt=compact(b.prompt,6000);
  if(!prompt)throw Error('Edit prompt is required');
  return {key:b.apiKey,current,base,mask:target,guide,prompt,intent:compact(b.projectPrompt,3000),regions:annotations(b.regions)};
}
function buildPrompt(p,regional){
  const regionInfo=p.regions.map(a=>`Region ${a.index} (${a.color}) ${a.active?'TARGET':'PRESERVE'}: ${a.prompt}`).join('\n');
  return (regional?
`PRECISION ARCHITECTURAL MASKED EDIT. Image 1: current accepted collage; use as the exact composition and camera reference. Image 2: original Base geometry reference. Image 3 when present: colored region guide. The mask attached to Image 1 marks ONLY the region to modify. Preserve every untouched region, camera, perspective, mullions, proportions, edges and geometry. Fulfill the TARGET region instruction without copying guide colors into the output. Other colored regions and their design decisions must remain unchanged. Preserve established materials and seams as much as possible.`:
`ARCHITECTURAL HARMONIZATION. Image 1: approved current collage; this is the PRIMARY visual composition. Image 2: permanent original Base reference for camera, geometry and spatial proportions. Blend material transitions, shadows, reflection and lighting into a single realistic image while preserving ALL deliberate content/material choices from Image 1. Do not add objects, move walls, revise facade proportions or alter the camera. The result must be aligned to Image 1.`) +
`\nPROJECT INTENT: ${p.intent||'Maintain approved architectural design.'}\nREGION NOTES:\n${regionInfo||'None'}\nTASK:\n${p.prompt}\nOUTPUT: single coherent photorealistic architectural render; no labels, annotations, text or colored outlines.`;
}
async function generate(req,regional){
  const p=validate(req,regional);
  const payload={model:MODEL,images:[{image_url:p.current.url},{image_url:p.base.url}],prompt:buildPrompt(p,regional),size:'auto',quality:'high',output_format:'jpeg',output_compression:83,n:1};
  if(regional){payload.mask={image_url:p.mask.url};if(p.guide)payload.images.push({image_url:p.guide.url})}
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),235000);
  try{
    const response=await fetch('https://api.openai.com/v1/images/edits',{
      method:'POST',headers:{Authorization:'Bearer '+p.key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(compact(data.error?.message,280)||'OpenAI image editing failed');e.status=[400,401,403,429].includes(response.status)?response.status:502;throw e}
    const image=data.data?.[0]?.b64_json;
    if(!image||typeof image!=='string')throw Error('OpenAI did not return an image');
    return {image,mimeType:'image/jpeg',model:MODEL};
  }catch(e){if(e.name==='AbortError')throw Error('AI generation timed out. Retry with a smaller image.');throw e}
  finally{clearTimeout(timeout)}
}
module.exports={generate};