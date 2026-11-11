// Isolated local browser and mock provider only; no paid generation.
window.runPerspectiveAlignmentChecks=async function(){
  const core=window.MosaicCore,{state,makeCanvas}=core,$=id=>document.getElementById(id),checks=[];
  const {alignGeneratedToLockedMask,projectPoint}=await import('/geometry-mask.mjs');
  const assert=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(fn())return;await pause(20)}throw Error('Timed out: '+label)};
  const w=640,h=480,frame={x:320,y:240,scale:400};
  const matrix=[1.004,.004,.006,-.002,.998,.003,.008,-.004,1];
  const corners=[{x:120,y:90},{x:520,y:90},{x:520,y:390},{x:120,y:390}];
  const scene=(material=false,transform=null)=>{
    const image=makeCanvas(w,h),x=image.getContext('2d');x.fillStyle='#263648';x.fillRect(0,0,w,h);
    const at=p=>transform?projectPoint(transform,p,frame):p;
    const points=corners.map(at);x.beginPath();points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();
    x.fillStyle=material?'#b7835c':'#d8d6d3';x.fill();
    // A long architectural joint must stay straight after registration.
    const p=at({x:350,y:110}),q=at({x:350,y:370});x.strokeStyle='#4264ba';x.lineWidth=4;x.beginPath();x.moveTo(p.x,p.y);x.lineTo(q.x,q.y);x.stroke();
    return image;
  };
  const mask=makeCanvas(w,h),mx=mask.getContext('2d');mx.fillStyle='#fff';mx.fillRect(120,90,400,300);mx.clearRect(180,180,50,70);
  const before=scene(),generated=scene(true,matrix),originalMask=mask.toDataURL();
  let aligned=alignGeneratedToLockedMask({before,generated,lockedMask:mask,makeCanvas});
  assert(aligned.aligned&&aligned.status==='structural-perspective-aligned','A supported small wall perspective correction was skipped: '+aligned.status);
  assert(mask.toDataURL()===originalMask,'Perspective registration changed the mask');
  const rgba=image=>image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const old=rgba(generated),out=rgba(aligned.image),alpha=rgba(mask),centers=[];
  for(let y=125;y<355;y+=20){let total=0,weight=0;for(let x=342;x<358;x++){
    const i=(y*w+x)*4,blue=Math.max(0,out[i+2]-out[i]-30);total+=x*blue;weight+=blue;
  }assert(weight>0,'Joint disappeared');centers.push(total/weight)}
  assert(Math.max(...centers)-Math.min(...centers)<1.1,'Straight wall joint became wavy');
  for(let i=0;i<alpha.length;i+=4)if(!alpha[i+3])for(let c=0;c<4;c++)assert(out[i+c]===old[i+c],'Pixels outside the old mask or inside its hole changed');
  checks.push('One small perspective correction aligns a wall while keeping its long joint straight and its mask/hole exact');
  const flat=makeCanvas(w,h),fx=flat.getContext('2d');fx.fillStyle='#ddd';fx.fillRect(0,0,w,h);
  const textured=makeCanvas(w,h),tx=textured.getContext('2d');tx.fillStyle='#ac8364';tx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=5){tx.fillStyle=y%10?'#af8565':'#a98063';tx.fillRect(0,y,w,2)}
  aligned=alignGeneratedToLockedMask({before:flat,generated:textured,lockedMask:mask,makeCanvas});
  assert(!aligned.aligned&&aligned.image===textured,'A flat wall material was unnecessarily warped');
  aligned=alignGeneratedToLockedMask({before,generated:scene(true,[1,0,.12,0,1,0,0,0,1]),lockedMask:mask,makeCanvas});
  assert(!aligned.aligned,'Excessive perspective correction was accepted');
  checks.push('Flat/textured walls and excessive drift keep the original generated pixels without stretching');
  const native=window.fetch;let edits=0,sam=0,candidate=generated;
  window.fetch=async(path,options)=>{
    if(path==='/api/ai/sam3'){sam++;throw Error('Appearance alignment must not request SAM')}
    const response=await native(path,options);
    if(path!=='/api/ai/edit')return response;
    edits++;const payload=JSON.parse(options.body),c=payload.crop,data=await response.json(),crop=makeCanvas(c.width,c.height);
    crop.getContext('2d').drawImage(candidate,c.x,c.y,c.width,c.height,0,0,c.width,c.height);
    data.image=crop.toDataURL('image/png').split(',')[1];return Response.json(data,{status:response.status});
  };
  try{
    await window.MosaicAccount.ready();if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open,'key dialog');
    $('apiKeyInput').value='sk-perspective-browser-fixture';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady(),'key');
    state.reference=before;core.setMaster(before,'Wall perspective fixture',false);
    const wall=core.newGroup(mask,'Wall');wall.name='Wall';wall.mapPrepared=true;
    window.MosaicObjectMap.selectObject(wall);await window.MosaicPremium.generateSelection('Warm plaster on this wall');
    await wait(()=>edits===1&&[...state.patches.values()].every(p=>!p.generating),'regional result');
    const patch=state.patches.get(wall.active);assert(patch?.maskAlignmentStatus==='structural-perspective-aligned','Regional edit did not use structural perspective alignment');
    assert(core.groupMask(wall).toDataURL()===originalMask,'Regional generation changed the saved wall mask');
    const accepted=rgba(core.composeApprovedCanvas()),original=rgba(before);
    for(let i=0;i<alpha.length;i+=4)if(!alpha[i+3])for(let c=0;c<4;c++)assert(accepted[i+c]===original[i+c],'Regional edit changed pixels outside the submitted mask');
    assert(!document.querySelector('.geometry-mode-hint').textContent.includes('Mask B'),'Outdated contour-warp instructions remain');
    checks.push('Real regional request/response applies perspective RGB through the old mask, preserving outside pixels and the hole');
    const small=makeCanvas(w,h);small.getContext('2d').fillRect(40,420,100,40);
    const second=core.newGroup(small,'Floor');second.name='Floor';second.mapPrepared=true;
    window.MosaicObjectMap.selectObject(wall);window.MosaicObjectMap.selectObject(second,{append:true});
    const wallOptions=wall.patchIds.length;await window.MosaicPremium.generateSelection('Refine the two selected surfaces');
    await wait(()=>edits===2&&[...state.patches.values()].every(p=>!p.generating)&&!state.groups.some(g=>g.objectMapBatch),'compound result');
    assert(wall.patchIds.length===wallOptions+1&&second.patchIds.length===1,'Compound edit did not create separate options');
    assert(core.groupMask(wall).toDataURL()===originalMask&&core.groupMask(second).toDataURL()===small.toDataURL(),'Compound edit changed original masks');
    checks.push('Compound edits keep each original mask and no longer ask SAM for a silhouette to warp');
    state.reference=before;core.setMaster(before,'Full-image wall fixture',false);
    const fullWall=core.newGroup(mask,'Wall');fullWall.name='Wall';fullWall.mapPrepared=true;
    await window.MosaicSceneVersions.apply(generated,{type:'ai-edit',prompt:'Warm plaster'});
    assert(core.groupMask(fullWall).toDataURL()===originalMask,'Full-image edit changed original wall mask');
    assert(fullWall.patchIds.some(id=>state.patches.get(id)?.maskAlignmentStatus==='structural-perspective-aligned'),'Full-image edit did not use the same perspective correction');
    assert(sam===0,'Appearance alignment called SAM');
    checks.push('Full-image appearance edits share the same limited perspective correction and preserve object identities/masks');
    return {passed:checks.length,checks,edits,sam};
  }finally{window.fetch=native}
};
