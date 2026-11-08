const MODEL='gpt-image-2.6-sunburst';
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
  if(typeof b.apiKey!=='string'||!/^sk-[\w-]{15,300}$/.test(b.apiKey))throw Error('Enter a valid OpenAI API key in mozAI.');
  const current=input(b.collage),base=regional&&!b.base?null:input(b.base);
  const cd=dimensions(current),bd=base&&dimensions(base);
  if(!cd||cd.w<128||cd.h<128||cd.w>4096||cd.h>4096
    ||(base&&(!bd||bd.w<128||bd.h<128||bd.w>4096||bd.h>4096)))throw Error('Invalid image dimensions');
  const target=regional?input(b.mask,['png'],3900000):null;
  if(target){const md=dimensions(target);if(!md||md.w!==cd.w||md.h!==cd.h)throw Error('Mask dimensions must match collage dimensions');}
  const attachments=Array.isArray(b.references)?b.references:[];
  if(attachments.length>3)throw Error('Maximum 3 reference images per request.');
  const references=attachments.map(value=>input(value,['jpeg','png','webp'],750000));
  if(references.reduce((sum,image)=>sum+image.bytes.length,0)>1750000)throw Error('Reference images too large. Upload smaller images.');
  const prompt=compact(b.prompt,6000);
  if(!prompt)throw Error('Edit prompt is required');
  const quality=b.quality??(regional?'medium':'high');
  if(!['low','medium','high'].includes(quality))throw Error('Quality must be low, medium or high.');
  return {key:b.apiKey,current,base,mask:target,references,prompt,quality,intent:compact(b.projectPrompt,3000),regions:annotations(b.regions)};
}
function buildPrompt(p,regional,mode='harmonize'){
  const regionInfo=p.regions.map(a=>`Region ${a.index} (${a.color}) ${a.active?'TARGET':'PRESERVE'}: ${a.prompt}`).join('\n');
  const regionalCropRules=regional?'\nCROPPED EDIT: The supplied images represent only a selected portion of a larger design, with surrounding context. Render THIS LOCAL CROP ONLY at its current viewpoint. Preserve alignment of every edge so the result will be composited back into the original full image; do not zoom out or generate a full building scene.': '';
  const referenceRules=p.references.length?
    '\nADDITIONAL REFERENCE IMAGES: Images supplied after the composition and optional Base are user-provided material, furniture, lighting or stylistic references. Use them only to inform the requested appearance. Do NOT import their camera angle, composition, room dimensions, facade geometry, or unrequested objects.': '';
  const preface=mode==='master'?
    'GENERATE THE FIRST MASTER IMAGE FROM BASE. Image 1 is the original Base architectural image. Keep its viewpoint, framing, building geometry, structure, proportions, doors, windows, facade and spatial layout. Only alter finishes, lighting, furniture and other attributes explicitly requested. Produce a coherent photorealistic render precisely aligned to Image 1.':
    regional?
    'PRECISION ARCHITECTURAL MASKED EDIT. Image 1 is the cropped accepted collage. '+(p.base?'Image 2 is the full original Base, supplied only as an additional geometry reference; do not reproduce its full framing. ':'')+'The attached mask marks the ONLY pixels to change. Preserve all other parts of Image 1 and its camera.':
    'ARCHITECTURAL HARMONIZATION. Image 1 is the accepted current collage and PRIMARY composition. Image 2 is the aligned original Base for camera and geometry. Seamlessly harmonize materials, shadows, seams and lighting while preserving every intentional decision and existing object.';
  return preface+regionalCropRules+referenceRules+
  `\nPROJECT INTENT: ${p.intent||'Preserve approved architecture.'}\nREGION NOTES:\n${regionInfo||'None'}\nTASK:\n${p.prompt}\nOUTPUT: one professional photorealistic architectural image; no annotations, labels, guides, colored masks, or text.`;
}
async function generate(req,regional,mode=regional?'edit':'harmonize'){
  const p=validate(req,regional);
  const images=mode==='master'?[{image_url:p.base.url}]:[{image_url:p.current.url}];
  if(mode!=='master'&&p.base)images.push({image_url:p.base.url});
  const baseSize=mode==='master'?dimensions(p.base):null;
  const masterSize=baseSize?require('../master-resolution').target(baseSize.w,baseSize.h):null;
  // 2.6 accepts custom sizes on a 16px grid. Cropped edits retain auto sizing.
  const payload={model:MODEL,images,prompt:buildPrompt(p,regional,mode),size:masterSize?masterSize.width+'x'+masterSize.height:'auto',quality:mode==='master'?'high':p.quality,output_format:'jpeg',output_compression:100,n:1};
  if(regional)payload.mask={image_url:p.mask.url};
  for(const reference of p.references)payload.images.push({image_url:reference.url});
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),235000);
  try{
    const response=await fetch('https://api.openai.com/v1/images/edits',{
      method:'POST',headers:{Authorization:'Bearer '+p.key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(compact(data.error?.message,280)||'OpenAI image editing failed');e.status=[400,401,403,429].includes(response.status)?response.status:502;throw e}
    const image=data.data?.[0]?.b64_json;
    if(!image||typeof image!=='string')throw Error('OpenAI did not return an image');
    return {image,mimeType:'image/jpeg',model:MODEL,usage:require('./generation-tracking').usageFrom(data.usage)};
  }catch(e){if(e.name==='AbortError')throw Error('AI generation timed out. Retry with a smaller image.');throw e}
  finally{clearTimeout(timeout)}
}
module.exports={generate};
