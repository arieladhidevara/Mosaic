/* Mosaic — manual-first, local-only image compositor.
   Each uploaded variation is a temporary top layer until its mask is applied.
   Masks remain editable; only approved patches are combined with the master. */
const $ = id => document.getElementById(id);
const canvas = $('compositeCanvas'), overlay = $('overlayCanvas');
const ctx = canvas.getContext('2d'), ox = overlay.getContext('2d');
const state = {
  reference: null, master: null, sources: new Map(), groups: [], patches: new Map(),
  pendingSourceId: null, queue: [], editingPatchId: null, selectedPatchId: null,
  selectionMask: null, boundaryCanvas: null, selectionMode: 'new', lasso: [], drawing: false,
  pointerStart: null, dragFreehand: false, hoverPoint: null, shapeStart: null, shapeEnd: null,
  tool: 'select', lastPoint: null, lastCanvasPointer: null, pendingRevealOnly: false, brushTargetId: null, before: false, zoom: 1, fitZoom: 1, busy: false,
  undo: [], redo: [], serial: 1, panAnchor: null, transformDrag: null, draftGroupId: null, queuedGroupId: null, hoveredGroupId: null, selectionGeneration: 0
};
const uid = name => `${name}_${state.serial++}`;
const makeCanvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const clamp = (v,a,b) => Math.min(b, Math.max(a,v));
const center = b => ({x:b.x+b.w/2,y:b.y+b.h/2});
let toastTimer;
function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3400)}
function message(s){$('canvasMessage').textContent=s}
function fileName(f){return (f?.name||'Image').replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ').slice(0,32)}
function labelFromPosition(b){let x=(b.x+b.w/2)/canvas.width,y=(b.y+b.h/2)/canvas.height;return `${y<.35?'Upper':y>.68?'Lower':'Middle'} ${x<.37?'left':x>.65?'right':'center'}`}
function promptText(){const p=`Create one seamless photorealistic architectural rendering using the two attached images.\n\nIMAGE 1 — BASE. Preserve its camera perspective, architectural geometry, spatial proportions and original structure where no deliberate change has been made.\n\nIMAGE 2 — MOSAIC COLLAGE. This is the primary source for approved material finishes, furniture, ornaments, lighting fixtures, and intentional geometry changes.\n\nINSTRUCTIONS:\n- Preserve the appearance and deliberate object changes selected in Image 2, even if they differ from Image 1.\n- Preserve Image 1's geometry in unchanged regions.\n- Harmonize collage seams, material transitions, shadows, reflections and color grading.\n- Do not add unrequested objects, change the camera, alter mullion spacing, or reinterpret approved design elements.\n- Prioritize design fidelity and architectural accuracy over artistic reinterpretation.\n\nOUTPUT: One cohesive professional architectural visualization. These images are references, not pixel-locked constraints.\n\nPROJECT DESIGN INTENT:\n${window.MosaicPremium?.projectPrompt() || 'Preserve the approved original design.'}`;$('promptPreview').textContent=p;return p}
async function loadFileToCanvas(file,maxDimension=2400){if(!file||!file.type.startsWith('image/'))throw Error('Choose an image file.');let image;try{image=await createImageBitmap(file)}catch{image=await new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Cannot open this image'))};img.src=url})}
  const scale=Math.min(1,maxDimension/Math.max(image.width,image.height)),c=makeCanvas(Math.round(image.width*scale),Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close?.();return c}
async function importMaster(file){if(!file)return;try{const c=await loadFileToCanvas(file);setMaster(c,fileName(file));toast('Master ready. Add an AI variation and lasso your favorite region.')}catch(e){toast(e.message)}}
function setMaster(c,name){window.MosaicPremium?.onMasterReset();state.master=c;state.sources.clear();state.groups=[];state.patches.clear();state.pendingSourceId=null;state.queue=[];state.editingPatchId=null;state.selectedPatchId=null;state.undo=[];state.redo=[];state.selectionGeneration++;state.hoveredGroupId=null;state.queuedGroupId=null;
  canvas.width=overlay.width=c.width;canvas.height=overlay.height=c.height;setSourcePreview('masterPreview',c);window.MosaicPremium?.onMasterLoaded?.(c);$('selectionDraft').setAttribute('viewBox',`0 0 ${c.width} ${c.height}`);resetSelection();
  $('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden');$('projectName').textContent=name;$('projectSize').textContent=`${c.width} × ${c.height}`;
  $('masterTitle').textContent='Master';$('masterInfo').textContent=`${name} · ${c.width} × ${c.height}`;$('masterStatus').textContent='✓';$('masterZone').classList.add('ready');updateZoomFit();renderGroups();render();message('Upload a new image, draw a lasso and press Enter to keep the selection.')}
async function importReference(file){if(!file)return;try{state.reference=await loadFileToCanvas(file,4000);setSourcePreview('basePreview',state.reference);$('referenceTitle').textContent='Base';$('referenceInfo').textContent=`${fileName(file)} · ${state.reference.width} × ${state.reference.height}`;$('referenceStatus').textContent='✓';$('referenceZone').classList.add('ready');toast('Base image saved locally.');window.MosaicPremium?.onReferenceLoaded(file)}catch(e){toast(e.message)}}
function showProcessing(on){state.busy=on;$('processing').classList.toggle('hidden',!on)}
function clearDraft(){state.lasso=[];state.hoverPoint=null;state.pointerStart=null;state.dragFreehand=false;state.shapeStart=null;state.shapeEnd=null;state.drawing=false}
function clearHover(){window.MosaicRegions?.clearHover()}
function hideQuickPrompt(){document.getElementById('quickAreaPromptForm')?.classList.add('hidden')}
function showQuickPrompt(point=state.lastCanvasPointer){
  if(!window.MosaicAuth?.isReady()||!state.master||!state.selectionMask||!maskBoundingBox(state.selectionMask)||state.pendingSourceId||state.editingPatchId)return;
  const form=$('quickAreaPromptForm'),vp=$('viewport'),r=vp.getBoundingClientRect();
  const x=(point?.clientX??r.left+r.width/2)-r.left+12,y=(point?.clientY??r.top+r.height/2)-r.top+12;
  form.style.left=Math.max(6,Math.min(x,r.width-280))+'px';
  form.style.top=Math.max(6,Math.min(y,r.height-190))+'px';
  form.classList.remove('hidden');
  $('quickAreaPromptInput').value='';
  $('quickAreaPromptInput').focus({preventScroll:true});
}
function setSourcePreview(id,source){const img=$(id);if(!img||!source)return;img.src=source.toDataURL('image/jpeg',.75);img.classList.remove('hidden')}
function resetSelection(){state.selectionMask=state.master?makeCanvas(canvas.width,canvas.height):null;state.boundaryCanvas=null;state.draftGroupId=null;state.pendingRevealOnly=false;hideQuickPrompt();clearDraft();updateApplyButton();clearHover()}
function updateApplyButton(){const pending=Boolean(state.pendingSourceId),editing=Boolean(state.editingPatchId),btn=$('commitBtn');btn.disabled=!(pending||editing);btn.classList.toggle('hidden',!(pending||editing));btn.innerHTML=`✓ ${editing?'Update mask':'Apply'} <kbd>Enter</kbd>`}
function setMode(mode){if(state.selectionMode!==mode)clearDraft();state.selectionMode=mode;document.querySelectorAll('.mode').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode))});drawOverlay();message(`${mode==='new'?'Replace':mode==='add'?'Add to':'Subtract from'} the selection. Draw with Lasso, Rect, Oval or click with Wand.`)}
async function importVariants(files){if(!state.master){toast('Upload a master image first.');return}const arr=Array.from(files||[]).filter(f=>f.type.startsWith('image/'));state.queue.push(...arr);if(arr.length>0&&state.pendingSourceId)toast(`${arr.length} variation${arr.length>1?'s':''} queued. Apply the current selection first.`);await loadNextVariant()}
async function loadNextVariant(){if(state.pendingSourceId||state.busy||!state.queue.length||!state.master)return;showProcessing(true);try{const file=state.queue.shift(),img=await loadFileToCanvas(file),c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(img,0,0,c.width,c.height);if(Math.abs(img.width/img.height-c.width/c.height)>.012)toast('Aspect ratios differ. Check image alignment before masking.');const id=uid('source');state.sources.set(id,{id,name:fileName(file),canvas:c});state.pendingSourceId=id;state.pendingRevealOnly=false;state.editingPatchId=null;state.selectedPatchId=null;state.before=false;resetSelection();setMode('new');selectTool('lasso');message(`Select the area to keep from ${fileName(file)}. Press Enter to keep your selection.`)}catch(e){toast('Import failed: '+e.message)}finally{showProcessing(false);const queued=state.groups.find(g=>g.id===state.queuedGroupId);state.queuedGroupId=null;if(queued&&state.pendingSourceId)selectGroupMask(queued);renderGroups();render()}}
function discardPending(){if(!state.pendingSourceId)return;state.sources.delete(state.pendingSourceId);state.pendingSourceId=null;resetSelection();renderGroups();render();toast('Unapplied image discarded.');loadNextVariant()}
function bboxIoU(a,b){const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)),area=w*h,union=a.w*a.h+b.w*b.h-area;return union>0?area/union:0}

const CATEGORIES=['Wall','Ceiling','Floor','Door','Window','Glazing','Furniture','Millwork','Lighting','Structure','Landscape','Stairs','Other','Region'];
function categoryFromText(value){
  const valueLower=String(value||'').toLowerCase();
  const lookups=[['Ceiling',/\b(ceiling|soffit|baffle)\b/],['Floor',/\b(floor|carpet|terrazzo|flooring)\b/],
    ['Wall',/\b(wall|partition|cladding|facade|façade)\b/],['Door',/\b(door|doorway)\b/],
    ['Window',/\b(window|mullion)\b/],['Glazing',/\b(glass|glazing|storefront|curtain wall)\b/],
    ['Furniture',/\b(furniture|sofa|couch|chair|desk|stool|table|seating)\b/],
    ['Millwork',/\b(millwork|cabinet|counter|joinery)\b/],['Lighting',/\b(light|lighting|downlight|luminaire)\b/],
    ['Structure',/\b(column|beam|truss|structural)\b/],['Landscape',/\b(tree|plant|landscape)\b/],['Stairs',/\b(stairs|staircase|tread|steps)\b/]];
  return lookups.find(([,regex])=>regex.test(valueLower))?.[0]||null;
}
function cloneMask(mask){const c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(mask,0,0);return c}
function groupMask(group){
  if(group.footprint)return group.footprint;
  const c=makeCanvas(canvas.width,canvas.height),g=c.getContext('2d');
  for(const id of group.patchIds){const p=state.patches.get(id);if(p)g.drawImage(p.mask,0,0)}
  group.footprint=c;return c;
}
function rememberMask(group,mask){
  if(!group.footprint)group.footprint=cloneMask(mask);
  else group.footprint.getContext('2d').drawImage(mask,0,0);
  group.area=maskBoundingBox(group.footprint)||group.area;
}
function groupLabel(group){
  const cat=group.category||'Region';
  return cat==='Region'?'Region '+String(state.groups.indexOf(group)+1).padStart(2,'0'):
    cat+' · '+labelFromPosition(group.area||{x:0,y:0,w:canvas.width,h:canvas.height});
}
function newGroup(mask,category='Region'){
  const group={id:uid('group'),category,manualName:false,manualCategory:false,patchIds:[],active:null,
    footprint:cloneMask(mask),area:maskBoundingBox(mask),classificationPending:false};
  state.groups.push(group);group.name=groupLabel(group);return group;
}
function updateGroupCategory(group,category,source='vision'){
  if(!group||!CATEGORIES.includes(category)||category==='Region'||group.manualCategory||(source==='vision'&&group.classificationSource==='prompt'))return;
  group.category=category;group.classificationSource=source;
  if(!group.manualName)group.name=groupLabel(group);
  renderGroups();drawOverlay();
}
function matchingGroup(mask){
  const a=maskBoundingBox(mask);if(!a)return null;
  let best=null,bestScore=.17;
  for(const g of state.groups){
    const b=g.area||maskBoundingBox(groupMask(g));if(!b)continue;
    const iou=bboxIoU(a,b),c=center(a),d=center(b),dist=Math.hypot((c.x-d.x)/canvas.width,(c.y-d.y)/canvas.height);
    const ratio=Math.min(a.w*a.h,b.w*b.h)/Math.max(a.w*a.h,b.w*b.h);
    const score=iou+.10*Math.max(0,1-dist/.17);
    if((iou>.24||(iou>.13&&dist<.07&&ratio>.35))&&score>bestScore){best=g;bestScore=score}
  }
  return best;
}
function identifyGroup(group,mask,login=false){
  if(!window.MosaicPremium?.classifyArea)return;
  if(!login&&!window.MosaicAuth?.isReady())return;
  if(group.classificationPending)return;
  const generation=state.selectionGeneration;
  group.classificationPending=true;renderGroups();
  void (async()=>{
    try{
      if(login&&!await window.MosaicAuth.ensure())return;
      const category=await window.MosaicPremium.classifyArea(mask);
      if(generation!==state.selectionGeneration||!state.groups.includes(group))return;
      updateGroupCategory(group,category,'vision');
    }catch(error){if(login)toast('Identify failed: '+error.message)}
    finally{if(generation===state.selectionGeneration&&state.groups.includes(group)){group.classificationPending=false;renderGroups()}}
  })();
}
function prepareSelectionGroup(){
  if(!state.selectionMask||state.editingPatchId)return;
  if(!maskBoundingBox(state.selectionMask))return;
  let group=state.groups.find(g=>g.id===state.draftGroupId);
  if(!group){
    group=matchingGroup(state.selectionMask);
    if(!group){group=newGroup(state.selectionMask);identifyGroup(group,cloneMask(state.selectionMask))}
    state.draftGroupId=group.id;
  }
  if(group&&!group.patchIds.length){group.footprint=cloneMask(state.selectionMask);group.area=maskBoundingBox(state.selectionMask)}
  renderGroups();
}
function assignGroup(patch){
  let group=state.groups.find(g=>g.id===(patch.groupId||state.draftGroupId))||matchingGroup(patch.mask);
  const category=categoryFromText(patch.prompt);
  if(!group)group=newGroup(patch.mask,category||'Region');
  if(category)updateGroupCategory(group,category,'prompt');
  rememberMask(group,patch.mask);
  state.patches.set(patch.id,patch);group.patchIds.push(patch.id);group.active=patch.id;
  patch.groupId=group.id;state.selectedPatchId=patch.id;return group;
}
function selectGroupMask(group){
  if(!group||!state.master||state.busy||window.MosaicPremium?.isPreviewing())return;
  if(state.editingPatchId){toast('Finish editing the current mask first.');return}
  const mask=groupMask(group);
  if(!maskBoundingBox(mask)){toast('No saved selection for this group.');return}
  resetSelection();state.selectionMask.getContext('2d').drawImage(mask,0,0);
  state.draftGroupId=group.id;state.selectedPatchId=null;
  setMode('new');selectTool('select');updateSelectionOutline();renderGroups();
  message('Selected '+group.name+'. '+(state.pendingSourceId?'Press Enter / Apply to keep the selected part of the new image.':'Click AI Edit, or refine with Add / Subtract.'));
  toast('Reused '+group.name+' mask.');
}
function optionNameFromPrompt(prompt,fallback='New option'){
  let value=String(prompt||'').trim().replace(/\s+/g,' ');
  const apply=value.match(/^apply\s+(.+?)\s+to\s+(?:the|this|that)\s+\w+(?:\s+\w+)*$/i);
  if(apply)value=apply[1];
  const color=value.match(/\b((?:(?:matte|glossy|light|dark|warm|cool)\s+)?(?:black|white|gray|grey|beige|blue|red|green|yellow|bronze|gold|silver|brown))\b(?:\s+(?:finish|paint))?[.!?]*$/i);
  if(color)value=color[1];
  if(!value)return fallback;
  // Display an object/material/finish, not the instruction that produced it.
  value=value.replace(/^(?:please\s+)?(?:make|paint|turn|change|convert|render|replace|set|apply|use|add|give|create|show|make it|change it|switch)\s+(?:the\s+|this\s+|that\s+|it\s+|them\s+|into\s+|to\s+|with\s+|as\s+)*?/i,'');
  const target=value.match(/\b(?:into|to|with|as|using)\s+(.+?)(?:[.!?;,]|\s+(?:while|without|but|and keep|keeping)\b|$)/i);
  if(target)value=target[1];
  value=value.replace(/^(?:(?:it|this|that|the|a|an|some|material|finish|color|colour)\s+)+/i,'');
  value=value.split(/\s+(?:while|without|keeping|but|and preserve|and keep)\b/i)[0];
  value=value.replace(/[.!?;,]+$/,'').trim().slice(0,42);
  return value?value[0].toUpperCase()+value.slice(1):fallback;
}

// Non-destructive four-corner warp. The source pixels and original mask stay intact.
const patchTextures = new WeakMap();
const copyCorners = points => points?.map(p => ({x:p.x,y:p.y})) || null;
function patchDisplayBounds(patch){
  const q=patchCorners(patch),xs=q.map(p=>p.x),ys=q.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
function patchCorners(patch) {
  if(patch.corners?.length===4)return patch.corners;
  const {x,y,w,h}=patch.bbox;
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}
function patchTexture(patch, source) {
  const b=patch.bbox, key=[b.x,b.y,b.w,b.h].join('/');
  const cached=patchTextures.get(patch);
  if(cached && cached.source===source.canvas && cached.mask===patch.mask && cached.key===key)return cached;
  const pad=Math.max(4,Math.ceil(canvas.width/250)+2);
  const x=Math.max(0,Math.floor(b.x)-pad),y=Math.max(0,Math.floor(b.y)-pad);
  const right=Math.min(canvas.width,Math.ceil(b.x+b.w)+pad),bottom=Math.min(canvas.height,Math.ceil(b.y+b.h)+pad);
  const image=makeCanvas(Math.max(1,right-x),Math.max(1,bottom-y)),tc=image.getContext('2d');
  tc.drawImage(source.canvas,-x,-y);
  tc.globalCompositeOperation='destination-in';
  tc.drawImage(patch.mask,-x,-y);
  const out={image,x,y,key,mask:patch.mask,source:source.canvas};
  patchTextures.set(patch,out);return out;
}
function bilinear(quad,u,v){
  const [tl,tr,br,bl]=quad;
  return {x:tl.x*(1-u)*(1-v)+tr.x*u*(1-v)+br.x*u*v+bl.x*(1-u)*v,
    y:tl.y*(1-u)*(1-v)+tr.y*u*(1-v)+br.y*u*v+bl.y*(1-u)*v};
}
function affineTriangle(target,texture,s0,s1,s2,d0,d1,d2){
  const sx1=s1.x-s0.x,sy1=s1.y-s0.y,sx2=s2.x-s0.x,sy2=s2.y-s0.y;
  const det=sx1*sy2-sx2*sy1;if(Math.abs(det)<1e-8)return;
  const dx1=d1.x-d0.x,dy1=d1.y-d0.y,dx2=d2.x-d0.x,dy2=d2.y-d0.y;
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
  const c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  target.save();target.beginPath();target.moveTo(d0.x,d0.y);target.lineTo(d1.x,d1.y);target.lineTo(d2.x,d2.y);target.closePath();target.clip();
  target.setTransform(a,b,c,d,d0.x-a*s0.x-c*s0.y,d0.y-b*s0.x-d*s0.y);
  target.drawImage(texture,0,0);target.restore();
}
function drawPatch(target,patch,source){
  if(!patch || !source || patch.awaitingResult)return;
  const t=patchTexture(patch,source);
  if(!patch.corners){target.drawImage(t.image,t.x,t.y);return}
  const q=patchCorners(patch),b=patch.bbox;
  // Parallelograms need just one draw; arbitrary 4-point skew gets a piecewise affine mesh.
  const affine=Math.hypot(q[0].x+q[2].x-q[1].x-q[3].x,q[0].y+q[2].y-q[1].y-q[3].y)<.05;
  if(affine){
    const a=(q[1].x-q[0].x)/b.w,bb=(q[1].y-q[0].y)/b.w;
    const c=(q[3].x-q[0].x)/b.h,d=(q[3].y-q[0].y)/b.h;
    const sx=b.x-t.x,sy=b.y-t.y;
    target.save();target.transform(a,bb,c,d,q[0].x-a*sx-c*sy,q[0].y-bb*sx-d*sy);
    target.drawImage(t.image,0,0);target.restore();return;
  }
  const uvSource=(u,v)=>({x:b.x+u*b.w-t.x,y:b.y+v*b.h-t.y});
  const steps=8;
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const u=x/steps,v=y/steps,un=(x+1)/steps,vn=(y+1)/steps;
    const A=uvSource(u,v),B=uvSource(un,v),C=uvSource(un,vn),D=uvSource(u,vn);
    const a=bilinear(q,u,v),bb=bilinear(q,un,v),c=bilinear(q,un,vn),d=bilinear(q,u,vn);
    affineTriangle(target,t.image,A,B,C,a,bb,c);
    affineTriangle(target,t.image,A,C,D,a,c,d);
  }
}
function convexCorners(q){
  let sign=0;
  for(let i=0;i<4;i++){
    const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)<1)return false;
    if(sign && cross*sign<0)return false;
    sign=Math.sign(cross);
  }
  return true;
}
function inQuad(p,q){let inside=false;for(let i=0,j=3;i<4;j=i++){
  const a=q[i],b=q[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside}
function quadCenter(q){return {x:q.reduce((s,p)=>s+p.x,0)/4,y:q.reduce((s,p)=>s+p.y,0)/4}}
function transformHit(p,patch,handlesOnly=false){
  const q=patchCorners(patch),radius=(18/state.zoom),middle=quadCenter(q);
  for(let i=0;i<4;i++)if(Math.hypot(p.x-q[i].x,p.y-q[i].y)<radius)return {kind:'corner',index:i};
  if(Math.hypot(p.x-middle.x,p.y-middle.y)<radius)return {kind:'move'};
  return !handlesOnly&&inQuad(p,q)?{kind:'move'}:null;
}
function activeTransformPatch(){
  const patch=state.patches.get(state.selectedPatchId);
  return patch&&state.groups.some(g=>g.active===patch.id)?patch:null;
}
function beginTransform(e,p){
  if(state.pendingSourceId||state.editingPatchId||window.MosaicPremium?.isPreviewing())return false;
  let patch=activeTransformPatch(),hit=patch&&transformHit(p,patch);
  if(!hit){
    for(const group of [...state.groups].reverse()){
      const other=state.patches.get(group.active);if(!other)continue;
      const found=transformHit(p,other);if(!found)continue;
      patch=other;hit=found;state.selectedPatchId=patch.id;renderGroups();break;
    }
  }
  if(!patch||!hit)return false;
  const initial=copyCorners(patchCorners(patch));
  state.transformDrag={patchId:patch.id,hit,start:p,initial,moved:false};
  overlay.setPointerCapture(e.pointerId);
  overlay.style.cursor=hit.kind==='corner'?'crosshair':'grabbing';
  drawOverlay();return true;
}
function moveTransform(p){
  const drag=state.transformDrag;if(!drag)return;
  const patch=state.patches.get(drag.patchId);if(!patch)return;
  const dx=p.x-drag.start.x,dy=p.y-drag.start.y,arr=copyCorners(drag.initial);
  if(drag.hit.kind==='corner'){
    const index=drag.hit.index;
    arr[index]={x:clamp(drag.initial[index].x+dx,0,canvas.width),y:clamp(drag.initial[index].y+dy,0,canvas.height)};
    if(!convexCorners(arr))return;
  }else{
    const xs=arr.map(q=>q.x),ys=arr.map(q=>q.y);
    const tx=clamp(dx,-Math.min(...xs),canvas.width-Math.max(...xs));
    const ty=clamp(dy,-Math.min(...ys),canvas.height-Math.max(...ys));
    for(const q of arr){q.x+=tx;q.y+=ty}
  }
  if(!drag.moved && Math.hypot(dx,dy)<=.25)return;
  if(!drag.moved){
    state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
    if(state.undo.length>12)state.undo.shift();state.redo=[];drag.moved=true;
  }
  patch.corners=arr;render();
}
function endTransform(){
  const drag=state.transformDrag;state.transformDrag=null;overlay.style.cursor='';
  if(drag?.moved){message('Layer moved. Drag corners to skew; Undo to revert.');}
  drawOverlay();
}
function resetPatchTransform(){
  const patch=activeTransformPatch();if(!patch||!patch.corners||window.MosaicPremium?.isPreviewing())return;
  state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
  if(state.undo.length>12)state.undo.shift();state.redo=[];
  patch.corners=null;render();toast('Layer transform reset.');
}

function render(){if(!state.master)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(state.before?(window.MosaicPremium?.originalImage()||state.master):state.master,0,0);
  if(!state.before){if(window.MosaicPremium?.drawArchivePreview(ctx)){drawOverlay();return}for(const group of state.groups){if(!group.active)continue;const patch=state.patches.get(group.active),source=patch&&state.sources.get(patch.sourceId);if(!patch||!source)continue;drawPatch(ctx,patch,source)}
    const pending=state.sources.get(state.pendingSourceId);
    if(pending){
      if(state.pendingRevealOnly&&state.selectionMask){
        const temp=makeCanvas(canvas.width,canvas.height),tc=temp.getContext('2d');
        tc.drawImage(pending.canvas,0,0);tc.globalCompositeOperation='destination-in';tc.drawImage(state.selectionMask,0,0);
        ctx.drawImage(temp,0,0);
      }else{ctx.save();ctx.globalAlpha=.84;ctx.drawImage(pending.canvas,0,0);ctx.restore()}
    }}
  drawOverlay()}
function boundaryFromMask(){if(!state.selectionMask)return null;const w=Math.min(540,canvas.width),h=Math.max(1,Math.round(canvas.height/canvas.width*w)),t=makeCanvas(w,h),tc=t.getContext('2d',{willReadFrequently:true});tc.drawImage(state.selectionMask,0,0,w,h);const px=tc.getImageData(0,0,w,h).data;const outline=makeCanvas(w,h),oc=outline.getContext('2d',{willReadFrequently:true}),out=oc.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,filled=px[i*4+3]>110;if(!filled)continue;const left=x===0||px[(i-1)*4+3]<110,right=x===w-1||px[(i+1)*4+3]<110,up=y===0||px[(i-w)*4+3]<110,down=y===h-1||px[(i+w)*4+3]<110;if(!(left||right||up||down))continue;const j=i*4,light=(Math.floor((x+y)/3)%2)===0;out.data[j]=light?255:22;out.data[j+1]=light?255:22;out.data[j+2]=light?255:24;out.data[j+3]=255}oc.putImageData(out,0,0);return outline}
function updateSelectionOutline(){state.boundaryCanvas=boundaryFromMask();drawOverlay()}
function drawOverlay(){ox.clearRect(0,0,overlay.width,overlay.height);drawDraftPreview();if(state.before||window.MosaicPremium?.isPreviewing())return;
  window.MosaicPremium?.drawRegionGuides(ox);
  // Selection is invisible after completion. A thin purple contour appears only on region hover.
  const chosen=state.tool==='transform' && !state.pendingSourceId && !state.editingPatchId && activeTransformPatch();
  if(chosen){
    const q=patchCorners(chosen),m=quadCenter(q);
    ox.save();ox.beginPath();q.forEach((p,i)=>i?ox.lineTo(p.x,p.y):ox.moveTo(p.x,p.y));ox.closePath();
    ox.strokeStyle='#c1b3ff';ox.lineWidth=2/state.zoom;ox.setLineDash([8/state.zoom,5/state.zoom]);ox.stroke();ox.setLineDash([]);
    for(let i=0;i<4;i++){const p=q[i],r=7/state.zoom;ox.fillStyle='#f5f0ff';ox.strokeStyle='#6555bd';ox.lineWidth=2/state.zoom;ox.fillRect(p.x-r,p.y-r,r*2,r*2);ox.strokeRect(p.x-r,p.y-r,r*2,r*2)}
    ox.beginPath();ox.arc(m.x,m.y,9/state.zoom,0,Math.PI*2);ox.fillStyle='#6153b8';ox.fill();ox.strokeStyle='#fff';ox.stroke();
    ox.beginPath();ox.moveTo(m.x-4/state.zoom,m.y);ox.lineTo(m.x+4/state.zoom,m.y);ox.moveTo(m.x,m.y-4/state.zoom);ox.lineTo(m.x,m.y+4/state.zoom);ox.lineWidth=1.6/state.zoom;ox.stroke();
    ox.restore();
  }
  // The SVG draft layer draws unfinished shapes beyond the image bounds.

}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function renderGroups(){
  const list=$('groupList');$('groupCount').textContent=state.groups.length;
  $('pendingBanner').classList.toggle('hidden',!state.pendingSourceId);
  if(state.pendingSourceId){const source=state.sources.get(state.pendingSourceId);$('pendingName').textContent='● Editing: '+(source?.name||'New variation')}
  if(!state.groups.length){
    list.innerHTML='<div class="empty-groups"><span>◌</span><strong>No regions yet</strong><p>Select an area, then describe the change.</p></div>';
    return;
  }
  list.innerHTML=state.groups.map(g=>{
    const order=g.patchIds.slice().reverse().sort((a,b)=>Number(Boolean(state.patches.get(a)?.isOriginalMaster))-Number(Boolean(state.patches.get(b)?.isOriginalMaster)));
    const optionRow=(pid)=>{
      const p=state.patches.get(pid);if(!p)return '';
      const isMaster=p.isMasterVersion||p.isOriginalMaster;
      return `<div class="variant-row ${g.active===pid?'selected':''}" data-action="choose" data-group="${g.id}" data-patch="${pid}" ${isMaster?'data-master-version="true"':''}><span class="variant-dot"></span><span class="variant-text">${escapeHTML(p.name)}</span><button class="variant-action" title="Edit mask" data-action="edit" data-group="${g.id}" data-patch="${pid}">✎</button><button class="variant-action" title="Delete option" data-action="delete" data-group="${g.id}" data-patch="${pid}">×</button></div>`;
    };
    const originalRow=g.hasHarmonizedMaster?'':`<div class="variant-row ${g.active===null?'selected':''}" data-action="choose" data-group="${g.id}" data-patch="master"><span class="variant-dot"></span><span class="variant-text">Original Master</span></div>`;
    return `<div class="region-group" data-group="${g.id}"><div class="group-head" data-action="focus" data-group="${g.id}"><span class="group-icon">▧</span><span class="group-name">${escapeHTML(g.name)}</span><span class="group-count">${g.patchIds.length} options</span><button type="button" class="variant-action group-add-option" data-region-action="add-option" title="Add an option to this region" aria-label="Add region option">＋</button></div><div class="group-options">${order.map(optionRow).join('')}${originalRow}</div></div>`;
  }).join('');
  window.MosaicRegions?.decorate();window.MosaicPremium?.decorateActive?.();
}
function editExisting(pid){if(state.pendingSourceId){toast('Apply or discard your new image before editing saved variants.');return}const patch=state.patches.get(pid);if(!patch)return;state.editingPatchId=pid;state.selectedPatchId=pid;resetSelection();state.selectionMask.getContext('2d').drawImage(patch.mask,0,0);setMode('add');selectTool('lasso');updateSelectionOutline();updateApplyButton();message('Editing a saved mask. Draw New, Add or Subtract, then Enter to update.')}
function groupEvent(e){if(window.MosaicRegions?.handleGroupEvent(e))return;if(window.MosaicPremium?.handleGroupEvent(e))return;const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,group=state.groups.find(g=>g.id===target.dataset.group),pid=target.dataset.patch;
  if(action==='focus'&&group){if(group.active){state.editingPatchId=null;state.selectedPatchId=group.active;resetSelection();selectTool('transform');renderGroups();render()}return}
  if(action==='edit'){editExisting(pid);return}
  if(action==='choose'&&group){if(state.pendingSourceId){toast('Apply or discard the new image first.');return}state.editingPatchId=null;resetSelection();group.active=pid==='master'?null:pid;state.selectedPatchId=group.active;if(group.active)selectTool('transform');renderGroups();render();return}
  if(action==='delete'&&group){if(state.pendingSourceId){toast('Finish the new image before removing variants.');return}group.patchIds=group.patchIds.filter(x=>x!==pid);state.patches.delete(pid);if(group.active===pid)group.active=group.patchIds.at(-1)||null;if(state.editingPatchId===pid)state.editingPatchId=null;if(state.selectedPatchId===pid)state.selectedPatchId=null;if(!group.patchIds.length)state.groups=state.groups.filter(g=>g.id!==group.id);resetSelection();renderGroups();render();toast('Variant removed.')}}
function selectTool(tool){clearDraft();hideQuickPrompt();state.tool=tool;if(state.pendingSourceId&&tool==='reveal'){state.pendingRevealOnly=true;render()}$('resetTransformBtn').classList.toggle('hidden',tool!=='transform');
  $('viewport').classList.toggle('is-selecting',['lasso','rect','ellipse','wand','reveal','erase'].includes(tool));
  $('wandOptions').classList.toggle('hidden',tool!=='wand');
  $('brushOptions').classList.toggle('hidden',tool!=='reveal'&&tool!=='erase');
  overlay.style.cursor='';
  if(tool==='select')message('Select: click an existing region to choose it or generate a new option.');
  else if(tool==='wand')message('Magic Wand: click a connected color area. Adjust tolerance; New / Add / Subtract also work.');
  else if(tool==='lasso')message('Lasso: click corners or drag. You can trace outside the image; Mosaic clips the final mask to its edges.');
  else if(tool==='pan')message('Pan: drag to move around the canvas.');
  else if(tool==='rect'||tool==='ellipse')message('Drag to select; holding Shift constrains to a square or circle. Selection clips to image edges.');
document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool))});$('canvasWrap').className=`canvas-wrap${state.master?'':' hidden'} ${tool==='pan'?'pan':tool==='transform'?'transform':tool==='reveal'?'brush':tool==='erase'?'eraser':''}`;drawOverlay()}
function canvasPoint(e,clipped=true){const rect=overlay.getBoundingClientRect(), x=(e.clientX-rect.left)/rect.width*canvas.width,y=(e.clientY-rect.top)/rect.height*canvas.height;return {x:clipped?clamp(x,0,canvas.width):x,y:clipped?clamp(y,0,canvas.height):y}}
function pointInImage(p){return p.x>=0&&p.y>=0&&p.x<canvas.width&&p.y<canvas.height}
function draftPath(){
  if(state.lasso.length){
    const points=[...state.lasso];
    if(state.hoverPoint&&!state.dragFreehand)points.push(state.hoverPoint);
    return points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ');
  }
  if(state.shapeStart&&state.shapeEnd){
    const b=shapeBounds(state.shapeStart,state.shapeEnd,state.constrainShape);
    if(b.w<=0||b.h<=0)return '';
    if(state.tool==='rect')return 'M '+b.x+' '+b.y+' h '+b.w+' v '+b.h+' h '+(-b.w)+' Z';
    const cx=b.x+b.w/2,cy=b.y+b.h/2,rx=b.w/2,ry=b.h/2;
    return 'M '+(cx-rx)+' '+cy+' a '+rx+' '+ry+' 0 1 0 '+(rx*2)+' 0 a '+rx+' '+ry+' 0 1 0 '+(-rx*2)+' 0 Z';
  }
  return '';
}
function drawDraftPreview(){
  const path=$('selectionDraftPath'),dots=$('selectionDraftPoints');
  if(!path||!dots)return;
  path.setAttribute('d',draftPath());
  path.setAttribute('stroke',state.selectionMode==='subtract'?'#ff968e':'#e4e2ff');
  const isShape=Boolean(state.shapeStart&&state.shapeEnd);
  path.setAttribute('fill',isShape?(state.selectionMode==='subtract'?'#ff968e24':'#b1aaff27'):'none');
  dots.replaceChildren();
  if(state.lasso.length&&!state.dragFreehand){
    for(const p of state.lasso){
      const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);
      c.setAttribute('r',Math.max(3,3.5/state.zoom));
      c.setAttribute('fill','#17191f');
      c.setAttribute('stroke',state.selectionMode==='subtract'?'#ff968e':'#e4e2ff');
      c.setAttribute('stroke-width',Math.max(1,1.5/state.zoom));
      dots.appendChild(c);
    }
  }
}
function applyMagicWand(p){
  if(!state.selectionMask||!pointInImage(p)){message('Click inside the image to select a connected color region.');return}
  render();
  const max=1400,scale=Math.min(1,max/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const sample=makeCanvas(w,h),sc=sample.getContext('2d',{willReadFrequently:true});
  sc.drawImage(canvas,0,0,w,h);
  let pixels;
  try{pixels=sc.getImageData(0,0,w,h).data}catch{toast('Magic Wand cannot read these image pixels.');return}
  const sx=clamp(Math.floor(p.x*w/canvas.width),0,w-1),sy=clamp(Math.floor(p.y*h/canvas.height),0,h-1);
  const seed=sy*w+sx,si=seed*4,r=pixels[si],g=pixels[si+1],b=pixels[si+2];
  const tolerance=+$('wandTolerance').value*2.55;
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  const selected=sample.createImageData(w,h);
  let start=0,end=1,count=0;queue[0]=seed;seen[seed]=1;
  while(start<end){
    const i=queue[start++],j=i*4;
    const diff=.299*Math.abs(pixels[j]-r)+.587*Math.abs(pixels[j+1]-g)+.114*Math.abs(pixels[j+2]-b);
    if(diff>tolerance)continue;
    selected.data[j]=selected.data[j+1]=selected.data[j+2]=selected.data[j+3]=255;count++;
    const x=i%w,y=(i-x)/w;
    const add=n=>{if(!seen[n]){seen[n]=1;queue[end++]=n}};
    if(x>0)add(i-1);if(x<w-1)add(i+1);if(y>0)add(i-w);if(y<h-1)add(i+w);
  }
  if(!count){toast('No pixels matched. Increase tolerance.');return}
  const region=makeCanvas(w,h);region.getContext('2d').putImageData(selected,0,0);
  snapshotSelection();
  const mc=state.selectionMask.getContext('2d');
  mc.save();
  if(state.selectionMode==='new')mc.clearRect(0,0,canvas.width,canvas.height);
  mc.globalCompositeOperation=state.selectionMode==='subtract'?'destination-out':'source-over';
  mc.imageSmoothingEnabled=false;
  mc.drawImage(region,0,0,canvas.width,canvas.height);
  mc.restore();
  state.pendingRevealOnly=Boolean(state.pendingSourceId);updateSelectionOutline();prepareSelectionGroup();render();showQuickPrompt();
  message('Magic Wand selected '+Math.round(count/(w*h)*100)+'% of image. Change tolerance or use Add/Subtract to refine.');
}
function snapshotSelection(){if(!state.selectionMask)return;state.undo.push({type:'selection',image:state.selectionMask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});if(state.undo.length>12)state.undo.shift();state.redo=[]}
function snapshotPatch(p){state.undo.push({type:'patch',patchId:p.id,image:p.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});if(state.undo.length>12)state.undo.shift();state.redo=[]}
function commitMaskPath(trace){if(!state.selectionMask)return;const m=state.selectionMask.getContext('2d');snapshotSelection();m.save();
  if(state.selectionMode==='new')m.clearRect(0,0,canvas.width,canvas.height);
  m.globalCompositeOperation=state.selectionMode==='subtract'?'destination-out':'source-over';m.fillStyle='#ffffff';m.beginPath();trace(m);m.closePath();m.fill();m.restore();
  state.pendingRevealOnly=Boolean(state.pendingSourceId);updateSelectionOutline();prepareSelectionGroup();render();message('Selection ready. Use Generate to edit this area, or refine with Add/Subtract.');showQuickPrompt()}
function updateMaskWithLasso(){const points=state.lasso.filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>.01);
  if(points.length<3||!state.selectionMask)return false;
  commitMaskPath(m=>points.forEach((p,i)=>i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y)));
  clearDraft();drawOverlay();return true}
function shapeBounds(start,end,constrain){let dx=end.x-start.x,dy=end.y-start.y;
  if(constrain){const side=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx)*side;dy=Math.sign(dy)*side}
  return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),w:Math.abs(dx),h:Math.abs(dy)}}
function traceShape(target,b,tool){target.beginPath();if(tool==='rect')target.rect(b.x,b.y,b.w,b.h);
  else target.ellipse(b.x+b.w/2,b.y+b.h/2,b.w/2,b.h/2,0,0,Math.PI*2);target.closePath()}
function updateMaskWithShape(start,end,tool,constrain){const bounds=shapeBounds(start,end,constrain);if(bounds.w<2/state.zoom||bounds.h<2/state.zoom)return;
  commitMaskPath(m=>traceShape(m,bounds,tool))}
function maskBoundingBox(mask){const w=Math.min(250,mask.width),h=Math.max(1,Math.round(w*mask.height/mask.width)),t=makeCanvas(w,h),tx=t.getContext('2d',{willReadFrequently:true});tx.drawImage(mask,0,0,w,h);const d=tx.getImageData(0,0,w,h).data;let minX=w,minY=h,maxX=-1,maxY=-1;for(let i=0;i<w*h;i++)if(d[i*4+3]>80){const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}return maxX<0?null:{x:minX/w*canvas.width,y:minY/h*canvas.height,w:(maxX-minX+1)/w*canvas.width,h:(maxY-minY+1)/h*canvas.height}}
function applySelection(){if(state.lasso.length){if(!updateMaskWithLasso()){toast('Add at least three lasso points, then click the first point or double-click to close.');return}}if(!state.selectionMask)return;const bbox=maskBoundingBox(state.selectionMask);if(!bbox){toast('Draw or brush a selection first.');return}
  if(state.pendingSourceId){const src=state.sources.get(state.pendingSourceId),mask=makeCanvas(canvas.width,canvas.height);mask.getContext('2d').drawImage(state.selectionMask,0,0);const patch={id:uid('patch'),sourceId:src.id,mask,bbox,name:optionNameFromPrompt(src.name,src.name),manualName:false},group=assignGroup(patch);state.pendingSourceId=null;state.editingPatchId=null;resetSelection();state.undo=[];state.redo=[];toast(`Saved as ${group.name}. Similar masks become alternatives.`);message('Selection saved. Upload another image or switch variants on the left.');renderGroups();render();window.MosaicPremium?.onPatchApplied();loadNextVariant();return}
  if(state.editingPatchId){const patch=state.patches.get(state.editingPatchId);if(!patch)return;snapshotPatch(patch);const t=patch.mask.getContext('2d');t.clearRect(0,0,canvas.width,canvas.height);t.drawImage(state.selectionMask,0,0);patch.bbox=bbox;const region=state.groups.find(g=>g.patchIds.includes(patch.id));if(region)rememberMask(region,patch.mask);patchTextures.delete(patch);state.editingPatchId=null;state.selectedPatchId=patch.id;resetSelection();toast('Mask updated. Other layers were not changed.');renderGroups();render()}}
function findRegionAt(point){
  if(!state.master||!pointInImage(point))return null;
  for(const group of state.groups.slice().reverse()){
    const alpha=groupMask(group).getContext('2d',{willReadFrequently:true}).getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data[3];
    if(alpha>100)return group;
  }
  return null;
}
function nearestBrushPatch(point,erase=false){
  const candidates=state.groups.map(group=>state.patches.get(group.active)).filter(p=>p&&state.sources.has(p.sourceId)&&!p.awaitingResult);
  for(const p of candidates.slice().reverse()){
    const x=clamp(Math.floor(point.x),0,canvas.width-1),y=clamp(Math.floor(point.y),0,canvas.height-1);
    if(p.mask.getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data[3]>100)return p;
  }
  if(erase)return null;
  return candidates.map(p=>{
    const b=patchDisplayBounds(p);
    const dx=Math.max(b.x-point.x,0,point.x-b.x-b.w),dy=Math.max(b.y-point.y,0,point.y-b.y-b.h);
    return {p,d:Math.hypot(dx,dy)};
  }).sort((a,b)=>a.d-b.d)[0]?.p||null;
}
function paint(e,first){const point=canvasPoint(e),r=+$('brushSize').value;
  const mask=state.pendingSourceId||state.editingPatchId?state.selectionMask:state.patches.get(state.brushTargetId||state.selectedPatchId)?.mask;
  if(!mask){if(first)toast('Upload a variation or select a saved region first.');return}
  const mc=mask.getContext('2d');mc.save();mc.globalCompositeOperation=state.tool==='erase'?'destination-out':'source-over';mc.fillStyle='#fff';mc.strokeStyle='#fff';mc.lineWidth=r;mc.lineCap='round';mc.lineJoin='round';if(first||!state.lastPoint){mc.beginPath();mc.arc(point.x,point.y,r/2,0,Math.PI*2);mc.fill()}else{mc.beginPath();mc.moveTo(state.lastPoint.x,state.lastPoint.y);mc.lineTo(point.x,point.y);mc.stroke()}mc.restore();state.lastPoint=point;
  if(mask===state.selectionMask){state.boundaryCanvas=null;state.pendingRevealOnly=true;render()}else{const patch=state.patches.get(state.brushTargetId||state.selectedPatchId);patch.bbox=maskBoundingBox(mask)||patch.bbox;patchTextures.delete(patch);render()}}
function historyStep(from,to){const entry=from.pop();if(!entry)return;if(entry.type==='transform'){const p=state.patches.get(entry.patchId);if(!p)return;to.push({type:'transform',patchId:p.id,corners:copyCorners(p.corners)});p.corners=copyCorners(entry.corners);render();return}const mask=entry.type==='selection'?state.selectionMask:state.patches.get(entry.patchId)?.mask;if(!mask)return;to.push({...entry,image:mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});mask.getContext('2d').putImageData(entry.image,0,0);if(entry.type==='selection')updateSelectionOutline();else{const p=state.patches.get(entry.patchId);p.bbox=maskBoundingBox(mask)||p.bbox;patchTextures.delete(p);render()}}
function updateZoomFit(){if(!state.master)return;const v=$('viewport'),margin=window.innerWidth<=730?72:124;state.fitZoom=Math.max(.08,Math.min((v.clientWidth-margin)/canvas.width,(v.clientHeight-margin)/canvas.height,1));setZoom(state.fitZoom)}
function setZoom(z){state.zoom=clamp(z,.08,4);$('canvasWrap').style.width=Math.round(canvas.width*state.zoom)+'px';$('canvasWrap').style.height=Math.round(canvas.height*state.zoom)+'px';canvas.style.width=overlay.style.width='100%';canvas.style.height=overlay.style.height='100%';$('zoomValue').textContent=Math.round(state.zoom*100)+'%'}
function canMask(){return Boolean(state.pendingSourceId||state.editingPatchId||(['lasso','rect','ellipse','wand'].includes(state.tool)&&window.MosaicPremium?.canSelectArea()))}
function pointerDown(e){if(!state.master||state.busy||state.before||e.button!==0&&e.pointerType==='mouse')return;
  if(state.tool==='transform'){const p=canvasPoint(e);beginTransform(e,p);return}
  if(state.tool==='pan'){state.panAnchor={x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};e.currentTarget.setPointerCapture(e.pointerId);return}
  state.lastCanvasPointer={clientX:e.clientX,clientY:e.clientY};
  if(state.tool==='select'){
    const region=findRegionAt(canvasPoint(e));
    if(region){selectGroupMask(region);showQuickPrompt(state.lastCanvasPointer);message('Selected '+region.name+'. '+(state.pendingSourceId?'Press Enter to keep this area.':'Generate an option or refine the selection.'))}
    else{hideQuickPrompt();message('Click a saved region, or draw one using Lasso / Rect / Oval / Wand.')}
    return;
  }
  if(state.tool==='reveal'||state.tool==='erase'){
    if(!state.pendingSourceId&&!state.editingPatchId){
      const picked=nearestBrushPatch(canvasPoint(e),state.tool==='erase');
      if(!picked){toast('No editable image near this brush. Upload an image or choose a variant.');return}
      state.brushTargetId=picked.id;state.selectedPatchId=picked.id;
      snapshotPatch(picked);
    }else{state.brushTargetId=null;snapshotSelection()}
    state.pendingRevealOnly=true;state.drawing=true;state.lastPoint=null;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    paint(e,true);return;
  }
  if(!state.pendingSourceId&&!state.editingPatchId&&['lasso','rect','ellipse','wand'].includes(state.tool)){
    if(window.MosaicPremium?.canSelectArea()&&['lasso','rect','ellipse','wand'].includes(state.tool)){state.selectedPatchId=null}
    else if(state.selectedPatchId){const originalTool=state.tool;editExisting(state.selectedPatchId);selectTool(originalTool)}
    else{toast('Upload a variation to begin masking.');return}}
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool));
  if(state.tool==='wand'){applyMagicWand(p);return}
  state.drawing=true;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  if(state.tool==='lasso'){state.pointerStart=p;state.dragFreehand=false;state.hoverPoint=p;if(!state.lasso.length)state.lasso=[p];drawOverlay()}
  else if(state.tool==='rect'||state.tool==='ellipse'){state.shapeStart=p;state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='reveal'||state.tool==='erase'){snapshotSelection();state.lastPoint=null;paint(e,true)}
}
function pointerMove(e){window.MosaicRegions?.onPointerMove(e);if(state.tool==='transform'){if(state.transformDrag){moveTransform(canvasPoint(e))}else{const patch=activeTransformPatch(),hit=patch&&transformHit(canvasPoint(e),patch);overlay.style.cursor=hit?(hit.kind==='corner'?'crosshair':'move'):'default'}return}if(state.tool==='pan'&&state.panAnchor){$('viewport').scrollLeft=state.panAnchor.left-(e.clientX-state.panAnchor.x);$('viewport').scrollTop=state.panAnchor.top-(e.clientY-state.panAnchor.y);return}
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool));
  if(state.tool==='lasso'){if(!state.drawing){if(state.lasso.length){state.hoverPoint=p;drawOverlay()}return}
    const threshold=5/state.zoom;
    if(!state.dragFreehand&&state.pointerStart&&Math.hypot(p.x-state.pointerStart.x,p.y-state.pointerStart.y)>threshold){
      state.dragFreehand=true;const last=state.lasso.at(-1);if(Math.hypot(state.pointerStart.x-last.x,state.pointerStart.y-last.y)>0.5/state.zoom)state.lasso.push(state.pointerStart)}
    if(state.dragFreehand){const last=state.lasso.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>2/state.zoom)state.lasso.push(p)}
    state.hoverPoint=p;drawOverlay();return}
  if(!state.drawing)return;
  if(state.tool==='rect'||state.tool==='ellipse'){state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='reveal'||state.tool==='erase')paint(e,false)}
function pointerUp(e){if(state.tool==='transform'){endTransform();return}if(state.tool==='pan'){state.panAnchor=null;return}if(!state.drawing)return;
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool)),tool=state.tool;state.lastCanvasPointer={clientX:e.clientX,clientY:e.clientY};state.drawing=false;state.lastPoint=null;
  if(tool==='lasso'){if(state.dragFreehand){const last=state.lasso.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>0.1/state.zoom)state.lasso.push(p);updateMaskWithLasso()}
    else if(state.pointerStart){const first=state.lasso[0],nearFirst=state.lasso.length>=3&&Math.hypot(p.x-first.x,p.y-first.y)<=10/state.zoom;
      if(nearFirst)updateMaskWithLasso();
      else if(Math.hypot(p.x-state.lasso.at(-1).x,p.y-state.lasso.at(-1).y)>0.5/state.zoom){state.lasso.push(p);state.hoverPoint=p;drawOverlay()}}
    state.pointerStart=null;state.dragFreehand=false}
  else if(tool==='rect'||tool==='ellipse'){if(state.shapeStart)updateMaskWithShape(state.shapeStart,p,tool,e.shiftKey);state.shapeStart=null;state.shapeEnd=null;drawOverlay()}
  else if(tool==='reveal'||tool==='erase'){if(state.pendingSourceId||state.editingPatchId){updateSelectionOutline();prepareSelectionGroup()}state.brushTargetId=null;render()}
  renderGroups()}
function pointerCancel(){if(state.tool==='transform'){endTransform();return}if(state.tool==='pan')state.panAnchor=null;
  if(state.drawing){state.drawing=false;state.lastPoint=null;state.pointerStart=null;state.shapeStart=null;state.shapeEnd=null;if(state.dragFreehand)state.lasso=[];state.dragFreehand=false;drawOverlay()}}
function onKeys(e){if(e.target.matches('input,textarea')||e.repeat&&e.key==='Enter')return;
  if(e.key==='Enter'){
    if(state.lasso.length>=3){e.preventDefault();const completed=updateMaskWithLasso();if(completed&&state.pendingSourceId&&!window.MosaicAuth?.isReady())applySelection();return}
    if(state.pendingSourceId||state.editingPatchId){e.preventDefault();applySelection();return}
    if(window.MosaicAuth?.isReady()&&maskBoundingBox(state.selectionMask||makeCanvas(1,1))){e.preventDefault();showQuickPrompt()}
  }
  else if(e.key==='Escape'){e.preventDefault();if(state.lasso.length||state.shapeStart){clearDraft();drawOverlay();message('Unfinished shape canceled.')}else{resetSelection();render();message('Selection cleared.')}}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyStep(state.undo,state.redo)}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyStep(state.redo,state.undo)}
  else if(e.key==='['){setMode('subtract')}else if(e.key===']'){setMode('add')}}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return(crc^0xffffffff)>>>0}
const u16=(d,v,o)=>d.setUint16(o,v,true),u32=(d,v,o)=>d.setUint32(o,v>>>0,true);
function makeZip(files){const enc=new TextEncoder(),locals=[],dirs=[];let offset=0;for(const file of files){const name=enc.encode(file.name),data=file.bytes,crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);u32(v,0x04034b50,0);u16(v,20,4);u16(v,0,6);u16(v,0,8);u16(v,0,10);u16(v,0,12);u32(v,crc,14);u32(v,data.length,18);u32(v,data.length,22);u16(v,name.length,26);u16(v,0,28);local.set(name,30);locals.push(local,data);
 const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);u32(d,0x02014b50,0);u16(d,20,4);u16(d,20,6);u16(d,0,8);u16(d,0,10);u16(d,0,12);u16(d,0,14);u32(d,crc,16);u32(d,data.length,20);u32(d,data.length,24);u16(d,name.length,28);u16(d,0,30);u16(d,0,32);u16(d,0,34);u16(d,0,36);u32(d,0,38);u32(d,offset,42);dir.set(name,46);dirs.push(dir);offset+=local.length+data.length}const dirLen=dirs.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);u32(e,0x06054b50,0);u16(e,0,4);u16(e,0,6);u16(e,files.length,8);u16(e,files.length,10);u32(e,dirLen,12);u32(e,offset,16);return new Blob([...locals,...dirs,end],{type:'application/zip'})}
const asBlob=c=>new Promise((res,rej)=>c.toBlob(blob=>blob?res(blob):rej(Error('PNG export failed')),'image/png'));
async function exportZip(){if(!state.master){toast('Upload a master image first.');return}if(state.pendingSourceId||state.editingPatchId){toast('Apply or discard the current selection before exporting.');return}
 const btn=$('exportBtn');btn.disabled=true;btn.textContent='Preparing ZIP…';try{const ref=await asBlob(state.reference||state.master),wasBefore=state.before;state.before=false;render();const comp=await asBlob(canvas);state.before=wasBefore;render();const files=[{name:'01_Base.png',bytes:new Uint8Array(await ref.arrayBuffer())},{name:'02_Final_Collage.png',bytes:new Uint8Array(await comp.arrayBuffer())},{name:'03_Harmonization_Prompt.txt',bytes:new TextEncoder().encode(window.MosaicPremium?.exportPrompt() || promptText())}],blob=makeZip(files),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Mosaic_Harmonization_Package.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Exported Base + collage + prompt.')}catch(e){toast('Export failed: '+e.message)}finally{btn.disabled=false;btn.innerHTML='<span class="icon">↧</span> Export package'}}
// File inputs and editing controls.
$('referenceInput').addEventListener('change',async e=>{await importReference(e.target.files[0]);e.target.value=''});
$('masterInput').addEventListener('change',async e=>{await importMaster(e.target.files[0]);e.target.value=''});
$('variantInput').addEventListener('change',async e=>{await importVariants(e.target.files);e.target.value=''});
for(const id of ['addImagesBtn','newVariantBtn'])$(id).addEventListener('click',()=>state.master?$('variantInput').click():toast('Upload a master first.'));
$('quickMasterBtn').addEventListener('click',()=>$('masterInput').click());$('quickRevitBtn').addEventListener('click',()=>$('referenceInput').click());
$('welcomeStart').addEventListener('click',()=>$('referenceInput').click());$('welcomeRevit').addEventListener('click',()=>$('masterInput').click());
for(const button of document.querySelectorAll('[data-initial-drop]')){
  button.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();button.classList.add('is-dragover')});
  button.addEventListener('dragleave',e=>{e.preventDefault();e.stopPropagation();button.classList.remove('is-dragover')});
  button.addEventListener('drop',async e=>{
    e.preventDefault();e.stopPropagation();button.classList.remove('is-dragover');
    const files=Array.from(e.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(!files.length)return;
    if(button.dataset.initialDrop==='master')await importMaster(files[0]);
    else await importReference(files[0]);
    if(files.length>1)await importVariants(files.slice(1));
  });
}
$('quickAreaDismiss').addEventListener('click',hideQuickPrompt);
$('quickAreaPromptInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('quickAreaPromptForm').requestSubmit()}});
$('quickAreaPromptForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!window.MosaicAuth?.isReady())return hideQuickPrompt();
  const prompt=$('quickAreaPromptInput').value.trim();if(!prompt)return;
  hideQuickPrompt();window.MosaicPremium?.generateSelection?.(prompt);
});
$('discardPendingBtn').addEventListener('click',discardPending);$('exportBtn').addEventListener('click',exportZip);
$('groupList').addEventListener('click',groupEvent);
$('tools').addEventListener('click',e=>{const tool=e.target.closest('[data-tool]'),mode=e.target.closest('[data-mode]');if(tool)selectTool(tool.dataset.tool);if(mode)setMode(mode.dataset.mode)});
$('brushSize').addEventListener('input',e=>$('brushValue').textContent=e.target.value);
$('wandTolerance').addEventListener('input',e=>{$('wandValue').textContent=e.target.value});
$('commitBtn').addEventListener('click',applySelection);
$('undoBtn').addEventListener('click',()=>historyStep(state.undo,state.redo));$('redoBtn').addEventListener('click',()=>historyStep(state.redo,state.undo));
$('clearSelectionBtn').addEventListener('click',()=>{resetSelection();render();message('Selection cleared.')});
$('resetTransformBtn').addEventListener('click',resetPatchTransform);
$('inspectorToggle').addEventListener('click',()=>{
  const panel=$('inspectorPanel'),collapsed=panel.classList.toggle('is-collapsed'),toggle=$('inspectorToggle');
  document.querySelector('.workspace').classList.toggle('inspector-collapsed',collapsed);
  toggle.textContent=collapsed?'›':'−';
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Expand guide':'Minimize guide');
  toggle.title=collapsed?'Expand guide':'Minimize guide';
  const wasFit=state.master&&Math.abs(state.zoom-state.fitZoom)<.001;
  if(wasFit)requestAnimationFrame(updateZoomFit);
});
$('zoomIn').addEventListener('click',()=>setZoom(state.zoom*1.25));$('zoomOut').addEventListener('click',()=>setZoom(state.zoom/1.25));$('zoomFit').addEventListener('click',updateZoomFit);
const compare=$('beforeBtn');let compareTap=false;
compare.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||window.matchMedia('(hover: none)').matches){compareTap=true;return}compareTap=false;state.before=true;compare.classList.add('comparing');render()});
compare.addEventListener('click',()=>{if(compareTap){state.before=!state.before;compare.classList.toggle('comparing',state.before);render();compareTap=false}});
for(const type of ['pointerup','pointercancel','pointerleave'])compare.addEventListener(type,()=>{if(!compareTap){state.before=false;compare.classList.remove('comparing');render()}});
window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse'&&!compareTap&&state.before){state.before=false;compare.classList.remove('comparing');render()}});
// Touch and mouse drawing both use Pointer Events.
for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])$('viewport').addEventListener(type,{pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerCancel}[type]);
$('viewport').addEventListener('dblclick',e=>{if(state.tool==='lasso'&&state.lasso.length>=3){e.preventDefault();updateMaskWithLasso()}});
window.addEventListener('keydown',onKeys);window.addEventListener('resize',()=>state.master&&updateZoomFit());
for(const id of ['copyPromptBtn','copyPromptSecondary'])$(id).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(promptText());toast('Prompt copied.')}catch{toast('Clipboard unavailable. Select prompt from the panel.')}});
const viewport=$('viewport');viewport.addEventListener('pointerleave',()=>window.MosaicRegions?.clearHover());viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('dropping')});viewport.addEventListener('dragleave',()=>viewport.classList.remove('dropping'));viewport.addEventListener('drop',async e=>{e.preventDefault();viewport.classList.remove('dropping');const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));if(!state.master){if(files[0])await importReference(files[0]);if(files.length>1)await importVariants(files.slice(1))}else await importVariants(files)});
window.MosaicCore = {state,canvas,overlay,ctx,makeCanvas,uid,toast,message,promptText,loadFileToCanvas,setMaster,render,renderGroups,drawPatch,selectTool,maskBoundingBox,assignGroup,resetSelection,updateMaskWithLasso,updateZoomFit,escapeHTML,categoryFromText,updateGroupCategory,optionNameFromPrompt,prepareSelectionGroup,groupMask,selectGroupMask,CATEGORIES,showQuickPrompt,hideQuickPrompt};
promptText();