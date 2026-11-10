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
  if(typeof req.openAiApiKey!=='string'||!/^sk-[\w-]{15,300}$/.test(req.openAiApiKey))throw Error('Connect your OpenAI key in your profile.');
  const current=input(b.collage),base=input(b.base);
  const context=regional&&b.context?input(b.context):null;
  const cd=dimensions(current),bd=base&&dimensions(base);
  if(context){const d=dimensions(context);if(!d||d.w<128||d.h<128||d.w>4096||d.h>4096)throw Error('Invalid context image dimensions');}
  let crop=null;
  if(context&&b.crop){
    const c=b.crop;
    if(!['x','y','width','height','imageWidth','imageHeight'].every(k=>Number.isSafeInteger(c[k]))||
      c.x<0||c.y<0||c.width<1||c.height<1||c.imageWidth<1||c.imageHeight<1||
      c.imageWidth>4096||c.imageHeight>4096||c.x+c.width>c.imageWidth||c.y+c.height>c.imageHeight)throw Error('Invalid crop context');
    crop={x:c.x,y:c.y,width:c.width,height:c.height,imageWidth:c.imageWidth,imageHeight:c.imageHeight};
  }
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
  const markup=b.markup?input(b.markup):null;
  return {key:req.openAiApiKey,current,base,context,crop,markup,chat:b.mode==='chat',targetObject:compact(b.targetObject,120),mask:target,references,prompt,quality,intent:compact(b.projectPrompt,3000),regions:annotations(b.regions)};
}
function buildPrompt(p,regional,mode='harmonize'){
  const regionInfo=p.regions.map(a=>`Region ${a.index} (${a.color}) ${a.active?'TARGET':'PRESERVE'}: ${a.prompt}`).join('\n');
  const regionalCropRules=regional?'\nCROPPED EDIT: The supplied images represent only a selected portion of a larger design, with surrounding context. Render THIS LOCAL CROP ONLY at its current viewpoint. Preserve alignment of every edge so the result will be composited back into the original full image; do not zoom out or generate a full building scene.': '';
  const objectRules=regional?'\nOBJECT-AWARE EDIT: Identify the existing object inside the mask from the crop and surrounding architecture before editing it. '+(p.targetObject?'The selected object is described as: '+p.targetObject+'. ':'')+'A material or color request modifies that existing object; do not replace it with a flat material swatch or an unrelated panel. A door must remain a recognizable door: preserve its leaf, frame, opening, handle/hardware, panel divisions, depth, perspective and shadows unless the task explicitly asks to change those details. Apply the same object-identity preservation to windows, furniture and other subjects.':'';
  const sceneRules=p.context?'\nSCENE CONTEXT: Image '+(p.base?3:2)+' is the FULL CURRENT COMPOSITION, for understanding what the selected object is and how it belongs in the scene. It is reference only; output only the crop in Image 1. '+(p.crop?'Image 1 covers x='+p.crop.x+', y='+p.crop.y+', width='+p.crop.width+', height='+p.crop.height+' in the full composition of '+p.crop.imageWidth+'x'+p.crop.imageHeight+' pixels.':''):'';
  const referenceRules=p.references.length?
    '\nADDITIONAL REFERENCE IMAGES: The final '+p.references.length+' images are MATERIAL AND STYLE REFERENCES ONLY. Extract surface materials, textures, colors and finish character. Never copy their geometry, room layout, object shapes, architecture, camera, perspective, proportions or framing. When a reference conflicts with Base geometry, Base always wins.': '';
  const preface=mode==='master'?
    'GENERATE THE FIRST MASTER IMAGE FROM BASE. Image 1 is the sole authority for geometry. Lock its camera, perspective, framing, silhouettes, building geometry, structure, dimensions, proportions, doors, windows, facade and spatial layout before applying any appearance changes. Additional images supply material and style only. Do not redesign or borrow geometry from them. Produce a coherent photorealistic render precisely aligned to Image 1.':
    regional?
    'PRECISION ARCHITECTURAL MASKED EDIT. Image 1 is the cropped accepted collage. '+(p.base?'Image 2 is the full original Base, supplied only as an additional geometry reference; do not reproduce its full framing. ':'')+'The attached mask marks the ONLY pixels to change. Preserve all other parts of Image 1 and its camera.':
    p.chat?'FULL COMPOSITION EDIT. Image 1 is the latest visible collage and starting image for the requested changes. Image 2 is the original Base and authority for camera, perspective and architectural geometry. Apply the user task across the composition, preserving approved collage decisions outside the requested changes. Return the entire image aligned to Image 1.':
    'ARCHITECTURAL HARMONIZATION. Image 1 is the accepted current collage and PRIMARY composition. Image 2 is the aligned original Base for camera and geometry. Seamlessly harmonize materials, shadows, seams and lighting while preserving every intentional decision and existing object.';
  const markupRules=p.markup?'\nMARKUP GUIDE: Image '+(2+(p.base&&mode!=='master'?1:0)+(regional&&p.context?1:0))+' is the current composition with user-drawn arrows, text and shapes. These marks explain where and how to apply the task. They are instructions only: remove every mark, arrow, box and label from the generated image.':'';
  return preface+regionalCropRules+objectRules+sceneRules+markupRules+referenceRules+
  `\nPROJECT INTENT: ${p.intent||'Preserve approved architecture.'}\nREGION NOTES:\n${regionInfo||'None'}\nTASK:\n${p.prompt}\nOUTPUT: one professional photorealistic architectural image; no annotations, labels, guides, colored masks, or text.`;
}
async function generate(req,regional,mode=regional?'edit':'harmonize'){
  const p=validate(req,regional);
  const images=mode==='master'?[{image_url:p.base.url}]:[{image_url:p.current.url}];
  if(mode!=='master'&&p.base)images.push({image_url:p.base.url});
  if(regional&&p.context)images.push({image_url:p.context.url});
  if(p.markup)images.push({image_url:p.markup.url});
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
module.exports={generate,input,dimensions,MODEL};
