/* Mosaic — zero-API architectural image collage prototype.
   Images stay in browser memory. Auto-difference is an assistive heuristic,
   not intent recognition or a geometry-accuracy guarantee. */
const $ = (id) => document.getElementById(id);
const state = {
  master:null, reference:null, sources:new Map(), groups:[], patches:new Map(),
  lastSourceId:null, selectedPatchId:null, tool:'lasso', zoom:1, fitZoom:1,
  lasso:[], drawing:false, lastPoint:null, before:false, autoAlign:true,
  undo:[], redo:[], serial:1, busy:false, panAnchor:null
};
const canvas=$('compositeCanvas'), overlay=$('overlayCanvas'), ctx=canvas.getContext('2d',{willReadFrequently:false}), ox=overlay.getContext('2d');
const uid=(prefix='id')=>`${prefix}_${state.serial++}`;
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const sleep=()=>new Promise(r=>setTimeout(r,25));
const center=(b)=>({x:(b.x+b.w*.5),y:(b.y+b.h*.5)});
let toastTimer;
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3600);}
function message(msg){$('canvasMessage').textContent=msg;}
function labelFromPosition(b){const x=(b.x+b.w/2)/canvas.width,y=(b.y+b.h/2)/canvas.height;const vertical=y<.35?'Upper':y>.68?'Lower':'Middle';const horizontal=x<.37?'left':x>.65?'right':'center';return `${vertical} ${horizontal}`;}
function addPrompt(){const p=`Create one seamless, photorealistic architectural rendering using the two attached images.\n\nIMAGE 1 — REVIT REFERENCE: Use as the guide for camera perspective, architectural geometry, spatial proportions and overall structure.\n\nIMAGE 2 — APPROVED MOSAIC COLLAGE: This is the PRIMARY reference for approved material finishes, furniture, lighting, ornaments and intentional design modifications.\n\nRULES:\n1. Preserve Image 2's selected appearance and all intentionally changed objects, even where they differ from the Revit reference.\n2. Preserve Image 1's architectural geometry in regions not intentionally changed by the collage.\n3. Harmonize only visible seams, material transitions, shadows, reflections and color grading.\n4. Do not add or remove unrequested objects, alter mullion rhythm, change camera position, or redesign approved elements.\n5. Where references conflict, use the collage for intentional design features and Revit for unchanged construction.\n\nOUTPUT: One seamless professional architectural visualization. The images serve as visual guidance rather than hard pixel-locked constraints.`;$('promptPreview').textContent=p;return p;}
async function loadFileToCanvas(file,maxDimension=2400){if(!file||!file.type.startsWith('image/'))throw new Error('Choose an image file.');let image;try{image=await createImageBitmap(file);}catch{image=await new Promise((resolve,reject)=>{let i=new Image(),url=URL.createObjectURL(file);i.onload=()=>{URL.revokeObjectURL(url);resolve(i)};i.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image could not be opened'))};i.src=url})}const scale=Math.min(1,maxDimension/Math.max(image.width,image.height));const c=makeCanvas(Math.round(image.width*scale),Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);if(image.close)image.close();return c;}
function fileName(file){return (file?.name||'Image').replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ').slice(0,27);}
async function importMaster(file){try{const c=await loadFileToCanvas(file);setMaster(c,fileName(file));toast('Master image ready. Add variations to detect edits.')}catch(e){toast(e.message)}}
function setMaster(c,name='Master composition'){
  state.master=c;state.sources.clear();state.groups=[];state.patches.clear();state.lastSourceId=null;state.selectedPatchId=null;state.undo=[];state.redo=[];
  canvas.width=overlay.width=c.width;canvas.height=overlay.height=c.height;
  $('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden');$('projectName').textContent=name;$('projectSize').textContent=`${c.width} × ${c.height}`;
  $('masterTitle').textContent=name;$('masterInfo').textContent=`${c.width} × ${c.height} · canvas base`;$('masterStatus').textContent='✓';$('masterZone').classList.add('ready');
  updateZoomFit();renderGroups();render();message('Drop AI variations to automatically discover regions.');
}
async function importReference(file){try{state.reference=await loadFileToCanvas(file,4000);$('referenceTitle').textContent=fileName(file);$('referenceInfo').textContent=`${state.reference.width} × ${state.reference.height} · stored locally`;$('referenceStatus').textContent='✓';$('referenceZone').classList.add('ready');toast('Reference stored locally and hidden from canvas.')}catch(e){toast(e.message)}}
function showProcessing(bool){state.busy=bool;$('processing').classList.toggle('hidden',!bool)}
async function importVariants(files){if(!state.master){toast('Upload the master image first.');return;}const arr=Array.from(files||[]).filter(f=>f.type.startsWith('image/'));if(!arr.length)return;showProcessing(true);
  for(const file of arr){try{await sleep();const imported=await loadFileToCanvas(file);const c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(imported,0,0,c.width,c.height);
    if(Math.abs(imported.width/imported.height-c.width/c.height)>.012)toast('Different aspect ratio detected. Image fitted to master; check alignment.');
    await ingestVariant(c,fileName(file));
  }catch(e){toast('Import error: '+e.message)}}showProcessing(false);renderGroups();render();}
async function ingestVariant(c,name){const id=uid('source');state.sources.set(id,{id,canvas:c,name});state.lastSourceId=id;
  const parts=detectRegions(state.master,c,+$('sensitivity').value);
  let added=0;for(const part of parts){const m=maskFromComponent(part);const patch={id:uid('patch'),sourceId:id,mask:m,bbox:componentToFullBox(part),name,createdAt:Date.now()};assignGroup(patch);added++}
  if(added){message(`${name}: ${added} candidate region${added!==1?'s':''} found. Switch the active variant in the left panel.`);toast(`${added} regions suggested from ${name}. Refine anything with lasso or brush.`)}
  else{message(`${name}: no strong differences detected. Use Lasso to choose a region manually.`);toast('No strong edits detected. Lasso the area you want and press Enter.')}
  renderGroups();render();}
function componentToFullBox(c){return {x:c.minX/c.dw*canvas.width,y:c.minY/c.dh*canvas.height,w:(c.maxX-c.minX+1)/c.dw*canvas.width,h:(c.maxY-c.minY+1)/c.dh*canvas.height}}
function bboxIoU(a,b){const x=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));const y=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));const inter=x*y,uni=a.w*a.h+b.w*b.h-inter;return uni>0?inter/uni:0}
function assignGroup(patch){let best=null,bestScore=0;
  if($('autoGroup').checked){for(const group of state.groups){const a=patch.bbox,b=group.bbox,iou=bboxIoU(a,b),ca=center(a),cb=center(b),dist=Math.hypot((ca.x-cb.x)/canvas.width,(ca.y-cb.y)/canvas.height);
    const score=iou+.18*Math.max(0,1-dist/.22);if((iou>.18||(iou>.07&&dist<.09))&&score>bestScore){bestScore=score;best=group}}
  }
  if(!best){best={id:uid('group'),name:`Region ${String(state.groups.length+1).padStart(2,'0')} · ${labelFromPosition(patch.bbox)}`,patchIds:[],active:null,bbox:{...patch.bbox}};state.groups.push(best)}
  best.patchIds.push(patch.id);if($('autoActivate').checked||!best.active)best.active=patch.id;
  const all=best.patchIds.map(pid=>state.patches.get(pid)?.bbox||patch.bbox);const minX=Math.min(...all.map(b=>b.x)),minY=Math.min(...all.map(b=>b.y)),maxX=Math.max(...all.map(b=>b.x+b.w)),maxY=Math.max(...all.map(b=>b.y+b.h));best.bbox={x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  state.patches.set(patch.id,patch);state.selectedPatchId=patch.id;
}
function makeLow(c,w,h){const t=makeCanvas(w,h),x=t.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0,w,h);return x.getImageData(0,0,w,h).data}
function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0}
function blurChannel(src,w,h){const dst=new Float32Array(src.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0,k=0;for(let yy=Math.max(0,y-2);yy<=Math.min(h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(w-1,x+2);xx++){v+=src[yy*w+xx];k++}dst[y*w+x]=v/k}return dst}
function morph(src,w,h,mode,r=1){const dst=new Uint8Array(src.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=mode==='dilate'?0:1;for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++){for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){if(mode==='dilate'&&src[yy*w+xx])v=1;if(mode==='erode'&&!src[yy*w+xx])v=0}}dst[y*w+x]=v}return dst}
function detectRegions(master,variation,sensitivity){const DW=300,DH=Math.max(70,Math.round(master.height/master.width*DW)),n=DW*DH;const a=makeLow(master,DW,DH),b=makeLow(variation,DW,DH);
  const shifts=[[],[],[]];for(let i=0;i<n;i+=19){const j=i*4;for(let k=0;k<3;k++)shifts[k].push(b[j+k]-a[j+k])}const offset=shifts.map(median);
  const delta=new Float32Array(n),Aa=new Float32Array(n),Bb=new Float32Array(n),Ca=new Float32Array(n),Cb=new Float32Array(n);
  for(let i=0;i<n;i++){let va=0,vb=0,ec=0;for(let k=0;k<3;k++){va+=a[i*4+k];vb+=b[i*4+k]-offset[k];ec+=Math.pow(b[i*4+k]-offset[k]-a[i*4+k],2)}Aa[i]=va/3;Bb[i]=vb/3;Ca[i]=Math.sqrt(ec/3);}
  const ba=blurChannel(Aa,DW,DH),bb=blurChannel(Bb,DW,DH),bc=blurChannel(Ca,DW,DH);
  const threshold=clamp(59-0.46*(sensitivity-20),19,59);let binary=new Uint8Array(n),count=0;
  for(let y=2;y<DH-2;y++)for(let x=2;x<DW-2;x++){const i=y*DW+x;const toneDiff=Math.abs(ba[i]-bb[i]);const localDiff=bc[i];const gradA=Math.abs(ba[i+1]-ba[i-1])+Math.abs(ba[i+DW]-ba[i-DW]);const gradB=Math.abs(bb[i+1]-bb[i-1])+Math.abs(bb[i+DW]-bb[i-DW]);const edgeChange=Math.abs(gradA-gradB);
    let score=localDiff*.63+toneDiff*.37+edgeChange*.18;delta[i]=score;if(score>threshold){binary[i]=1;count++}}
  // A globally reinterpreted image should not become one gigantic 'intentional' patch.
  if(count/n>.58){const vals=Array.from(delta).sort((x,y)=>x-y);const adaptive=Math.max(threshold,vals[Math.floor(vals.length*.82)]);for(let i=0;i<n;i++)binary[i]=delta[i]>adaptive?1:0;}
  binary=morph(morph(binary,DW,DH,'dilate',1),DW,DH,'erode',1);
  const seen=new Uint8Array(n),components=[],minArea=Math.max(35,Math.round(n*.0007));
  for(let i=0;i<n;i++){if(!binary[i]||seen[i])continue;const q=[i];seen[i]=1;let head=0,minX=DW,minY=DH,maxX=0,maxY=0;
    while(head<q.length){const p=q[head++],x=p%DW,y=Math.floor(p/DW);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=DW||ny<0||ny>=DH)continue;const ni=ny*DW+nx;if(binary[ni]&&!seen[ni]){seen[ni]=1;q.push(ni)}}}
    if(q.length<minArea)continue;const cw=maxX-minX+1,ch=maxY-minY+1;if(cw<5||ch<5)continue;
    components.push({pixels:q,minX,minY,maxX,maxY,dw:DW,dh:DH,area:q.length});
  }
  components.sort((a,b)=>b.area-a.area);
  // Cap noise from repeated AI re-rendering. User can add missed regions manually.
  return components.slice(0,12);
}
function maskFromComponent(comp){const tiny=makeCanvas(comp.dw,comp.dh),tx=tiny.getContext('2d'),data=tx.createImageData(comp.dw,comp.dh);for(const p of comp.pixels){data.data[p*4]=255;data.data[p*4+1]=255;data.data[p*4+2]=255;data.data[p*4+3]=255}tx.putImageData(data,0,0);
  // Slight expansion and feathering to include the edges of the changed material.
  const expanded=makeCanvas(comp.dw,comp.dh),ex=expanded.getContext('2d');ex.filter='blur(1.7px)';ex.drawImage(tiny,0,0);ex.filter='none';
  const out=makeCanvas(canvas.width,canvas.height),o=out.getContext('2d');o.imageSmoothingEnabled=true;o.drawImage(expanded,0,0,out.width,out.height);return out;
}
function render(){if(!state.master)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(state.master,0,0);
  if(!state.before){for(const group of state.groups){if(!group.active)continue;const p=state.patches.get(group.active);if(!p)continue;const source=state.sources.get(p.sourceId);if(!source)continue;const temp=makeCanvas(canvas.width,canvas.height),t=temp.getContext('2d');t.drawImage(source.canvas,0,0);t.globalCompositeOperation='destination-in';t.drawImage(p.mask,0,0);t.globalCompositeOperation='source-over';ctx.drawImage(temp,0,0)}}
  drawOverlay();}
function drawOverlay(){ox.clearRect(0,0,overlay.width,overlay.height);if(state.before)return;
  if(state.selectedPatchId){const p=state.patches.get(state.selectedPatchId);if(p){ox.save();ox.strokeStyle='#afaaff';ox.lineWidth=Math.max(2,3/state.zoom);ox.setLineDash([9/state.zoom,6/state.zoom]);ox.strokeRect(p.bbox.x,p.bbox.y,p.bbox.w,p.bbox.h);ox.restore()}}
  if(state.lasso.length){ox.save();ox.beginPath();state.lasso.forEach((p,i)=>i?ox.lineTo(p.x,p.y):ox.moveTo(p.x,p.y));if(!state.drawing&&state.lasso.length>2)ox.closePath();ox.strokeStyle='#c9c4ff';ox.lineWidth=Math.max(2,3/state.zoom);ox.setLineDash([8/state.zoom,5/state.zoom]);ox.stroke();ox.fillStyle='#a9a4ee24';if(!state.drawing)ox.fill();ox.restore()}}
function renderGroups(){const el=$('groupList');$('groupCount').textContent=state.groups.length;if(!state.groups.length){el.innerHTML='<div class="empty-groups"><span>◌</span><strong>No regions yet</strong><p>Upload an AI variation to automatically detect design changes.</p></div>';return}
  el.innerHTML=state.groups.map(group=>`<div class="region-group" data-group="${group.id}"><div class="group-head" data-action="focus" data-group="${group.id}"><span class="group-icon">▧</span><span class="group-name">${group.name}</span><span class="group-count">${group.patchIds.length} options</span></div><div class="group-options"><div class="variant-row ${group.active===null?'selected':''}" data-action="choose" data-group="${group.id}" data-patch="master"><span class="variant-dot"></span><span class="variant-text">Original master</span></div>${group.patchIds.map((pid,i)=>{const p=state.patches.get(pid);if(!p)return '';return `<div class="variant-row ${group.active===pid?'selected':''}" data-action="choose" data-group="${group.id}" data-patch="${pid}"><span class="variant-dot"></span><span class="variant-text">${escapeHTML(p.name)} <span style="color:#757a88">#${i+1}</span></span><button title="Edit this mask" class="variant-action" data-action="edit" data-patch="${pid}" data-group="${group.id}">✎</button><button title="Remove this variant" class="variant-action" data-action="delete" data-patch="${pid}" data-group="${group.id}">×</button></div>`}).join('')}</div></div>`).join('');}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function groupEvent(e){const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,group=state.groups.find(g=>g.id===target.dataset.group),pid=target.dataset.patch;
  if(action==='focus'){const p=group?.active?state.patches.get(group.active):null;if(p){state.selectedPatchId=p.id;state.lastSourceId=p.sourceId;render();message('Selected '+p.name+'. Use brush or eraser to refine the mask.')}return;}
  if(action==='choose'&&group){group.active=pid==='master'?null:pid;if(pid!=='master'){state.selectedPatchId=pid;state.lastSourceId=state.patches.get(pid)?.sourceId||state.lastSourceId}else state.selectedPatchId=null;renderGroups();render();return}
  if(action==='edit'){state.selectedPatchId=pid;state.lastSourceId=state.patches.get(pid)?.sourceId||state.lastSourceId;selectTool('brush');render();toast('Brush reveals pixels from this variant; eraser hides them.');return}
  if(action==='delete'&&group){group.patchIds=group.patchIds.filter(id=>id!==pid);state.patches.delete(pid);if(group.active===pid)group.active=group.patchIds.at(-1)||null;if(state.selectedPatchId===pid)state.selectedPatchId=null;if(!group.patchIds.length)state.groups=state.groups.filter(g=>g!==group);renderGroups();render();toast('Variant removed.');}
}
function selectTool(t){state.tool=t;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));$('canvasWrap').className='canvas-wrap '+(t==='pan'?'pan':t==='brush'?'brush':t==='eraser'?'eraser':'');if(t!=='lasso')state.lasso=[];drawOverlay()}
function canvasPoint(event){const box=overlay.getBoundingClientRect();return{x:clamp((event.clientX-box.left)/box.width*canvas.width,0,canvas.width),y:clamp((event.clientY-box.top)/box.height*canvas.height,0,canvas.height)}}
function beginEdit(){const p=state.patches.get(state.selectedPatchId);if(!p){toast('Select a variant from a region group first.');return null}state.undo.push({patchId:p.id,image:p.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});if(state.undo.length>10)state.undo.shift();state.redo=[];return p;}
function paint(event,first){const patch=state.patches.get(state.selectedPatchId);if(!patch)return;const p=canvasPoint(event),r=+$('brushSize').value,mc=patch.mask.getContext('2d');mc.save();mc.globalCompositeOperation=state.tool==='eraser'?'destination-out':'source-over';mc.fillStyle='rgba(255,255,255,1)';mc.strokeStyle='#ffffff';mc.lineWidth=r;mc.lineCap='round';mc.lineJoin='round';if(first||!state.lastPoint){mc.beginPath();mc.arc(p.x,p.y,r/2,0,Math.PI*2);mc.fill()}else{mc.beginPath();mc.moveTo(state.lastPoint.x,state.lastPoint.y);mc.lineTo(p.x,p.y);mc.stroke()}mc.restore();state.lastPoint=p;patch.bbox=maskBoundingBox(patch.mask)||patch.bbox;render();}
function maskBoundingBox(mc){const low=makeLow(mc,180,Math.max(60,Math.round(180*mc.height/mc.width))),w=180,h=low.length/(w*4);let minX=w,minY=h,maxX=-1,maxY=-1;for(let i=0;i<w*h;i++)if(low[i*4+3]>35){const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}if(maxX<0)return null;return{x:minX/w*canvas.width,y:minY/h*canvas.height,w:(maxX-minX+1)/w*canvas.width,h:(maxY-minY+1)/h*canvas.height}}
function commitLasso(){if(!state.master||state.lasso.length<3){state.lasso=[];render();return}const source=state.sources.get(state.lastSourceId);if(!source){toast('Add an AI variation before using lasso.');state.lasso=[];render();return}
  // A lasso always creates an independent candidate patch; existing alternatives remain intact.
  let mask=makeCanvas(canvas.width,canvas.height);
  const m=mask.getContext('2d');m.fillStyle='#fff';m.beginPath();state.lasso.forEach((p,i)=>i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y));m.closePath();m.fill();
  const box=maskBoundingBox(mask);if(!box){toast('Selection too small.');return}
  const patch={id:uid('patch'),sourceId:source.id,mask,bbox:box,name:source.name+' · selection'};assignGroup(patch);message('Selection saved as a new variant. Switch options in the left panel.');
  state.lasso=[];renderGroups();render();toast('Selection accepted. The rest of the source is hidden non-destructively.');}
function historyStep(from,to){const entry=from.pop();if(!entry)return;const p=state.patches.get(entry.patchId);if(!p)return;to.push({patchId:p.id,image:p.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});p.mask.getContext('2d').putImageData(entry.image,0,0);p.bbox=maskBoundingBox(p.mask)||p.bbox;state.selectedPatchId=p.id;renderGroups();render();}
function updateZoomFit(){if(!state.master)return;const v=$('viewport');state.fitZoom=Math.min((v.clientWidth-62)/canvas.width,(v.clientHeight-62)/canvas.height,1);setZoom(state.fitZoom)}
function setZoom(z){state.zoom=clamp(z,.08,4);$('canvasWrap').style.width=Math.round(canvas.width*state.zoom)+'px';$('canvasWrap').style.height=Math.round(canvas.height*state.zoom)+'px';canvas.style.width=overlay.style.width='100%';canvas.style.height=overlay.style.height='100%';$('zoomValue').textContent=Math.round(state.zoom*100)+'%';}
function pointerDown(e){if(!state.master||state.busy)return;if(state.tool==='pan'){state.panAnchor={x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};overlay.setPointerCapture(e.pointerId);return;}const p=canvasPoint(e);state.drawing=true;overlay.setPointerCapture(e.pointerId);
  if(state.tool==='lasso'){state.lasso=[p];drawOverlay();return}if(state.tool==='brush'||state.tool==='eraser'){if(!beginEdit()){state.drawing=false;return}state.lastPoint=null;paint(e,true)}}
function pointerMove(e){if(state.tool==='pan'&&state.panAnchor){$('viewport').scrollLeft=state.panAnchor.left-(e.clientX-state.panAnchor.x);$('viewport').scrollTop=state.panAnchor.top-(e.clientY-state.panAnchor.y);return;}if(!state.drawing)return;const p=canvasPoint(e);if(state.tool==='lasso'){if(!state.lasso.length||Math.hypot(p.x-state.lasso.at(-1).x,p.y-state.lasso.at(-1).y)>Math.max(2,2/state.zoom)){state.lasso.push(p);drawOverlay()}}else if(state.tool==='brush'||state.tool==='eraser')paint(e,false)}
function pointerUp(e){if(state.tool==='pan'){state.panAnchor=null;return;}if(!state.drawing)return;state.drawing=false;state.lastPoint=null;if(state.tool==='lasso'){drawOverlay();message('Press Enter to keep the outlined area, or Esc to cancel.')}renderGroups();}
function onKeys(e){if(e.target.matches('input,textarea'))return;if(e.key==='Enter'&&state.lasso.length>2){e.preventDefault();commitLasso()}else if(e.key==='Escape'){state.lasso=[];state.drawing=false;render();message('Selection cancelled.')}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyStep(state.undo,state.redo)}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyStep(state.redo,state.undo)}}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function u16(d,v,o){d.setUint16(o,v,true)}function u32(d,v,o){d.setUint32(o,v>>>0,true)}
function makeZip(files){const enc=new TextEncoder(),locals=[],dirs=[];let offset=0;for(const file of files){const name=enc.encode(file.name),data=file.bytes,crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);u32(v,0x04034b50,0);u16(v,20,4);u16(v,0,6);u16(v,0,8);u16(v,0,10);u16(v,0,12);u32(v,crc,14);u32(v,data.length,18);u32(v,data.length,22);u16(v,name.length,26);u16(v,0,28);local.set(name,30);locals.push(local,data);
  const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);u32(d,0x02014b50,0);u16(d,20,4);u16(d,20,6);u16(d,0,8);u16(d,0,10);u16(d,0,12);u16(d,0,14);u32(d,crc,16);u32(d,data.length,20);u32(d,data.length,24);u16(d,name.length,28);u16(d,0,30);u16(d,0,32);u16(d,0,34);u16(d,0,36);u32(d,0,38);u32(d,offset,42);dir.set(name,46);dirs.push(dir);offset+=local.length+data.length;
  }const dirLen=dirs.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);u32(e,0x06054b50,0);u16(e,0,4);u16(e,0,6);u16(e,files.length,8);u16(e,files.length,10);u32(e,dirLen,12);u32(e,offset,16);return new Blob([...locals,...dirs,end],{type:'application/zip'});}
function asBlob(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed')),'image/png'))}
async function exportZip(){if(!state.master){toast('Upload or create a master image first.');return}if(!state.reference){toast('Add the hidden Revit reference before exporting.');return}
  const btn=$('exportBtn');btn.disabled=true;btn.textContent='Preparing ZIP…';try{const ref=await asBlob(state.reference),comp=await asBlob(canvas),files=[{name:'01_Revit_Reference.png',bytes:new Uint8Array(await ref.arrayBuffer())},{name:'02_Final_Collage.png',bytes:new Uint8Array(await comp.arrayBuffer())},{name:'03_Harmonization_Prompt.txt',bytes:new TextEncoder().encode(addPrompt())}];const blob=makeZip(files),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Mosaic_Harmonization_Package.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Exported Revit reference, collage, and prompt.');}catch(e){toast('Export failed: '+e.message)}finally{btn.disabled=false;btn.innerHTML='<span class="icon">↧</span> Export package'}}
function drawDemoBase(){const c=makeCanvas(1200,740),t=c.getContext('2d');t.fillStyle='#dadbd8';t.fillRect(0,0,1200,740);
  const ceiling=t.createLinearGradient(0,0,0,180);ceiling.addColorStop(0,'#cacdcd');ceiling.addColorStop(1,'#ededed');t.fillStyle=ceiling;t.fillRect(0,0,1200,160);t.fillStyle='#efefeb';t.fillRect(0,159,1200,431);
  t.fillStyle='#d1d1cc';t.beginPath();t.moveTo(0,590);t.lineTo(1200,590);t.lineTo(1200,740);t.lineTo(0,740);t.fill();t.fillStyle='#e8e6e1';t.beginPath();t.moveTo(0,0);t.lineTo(390,95);t.lineTo(390,590);t.lineTo(0,740);t.closePath();t.fill();t.strokeStyle='#b1ada8';t.lineWidth=5;t.beginPath();t.moveTo(390,95);t.lineTo(390,590);t.stroke();
  t.fillStyle='#ddd9d5';t.fillRect(455,185,265,360);t.fillStyle='#9ea6ad';t.fillRect(776,180,380,414);t.fillStyle='#465059';t.fillRect(787,194,358,378);t.fillStyle='#98abb5';t.globalAlpha=.55;t.fillRect(789,196,355,375);t.globalAlpha=1;t.strokeStyle='#4b5963';t.lineWidth=8;[895,1016].forEach(x=>{t.beginPath();t.moveTo(x,190);t.lineTo(x,589);t.stroke()});t.beginPath();t.moveTo(783,382);t.lineTo(1153,382);t.stroke();
  t.strokeStyle='#55575c';t.lineWidth=5;t.beginPath();t.moveTo(645,28);t.lineTo(645,176);t.stroke();t.fillStyle='#4b4d4f';t.beginPath();t.ellipse(645,210,61,40,0,0,Math.PI*2);t.fill();t.fillStyle='#eee7cf';t.beginPath();t.ellipse(645,222,48,12,0,0,Math.PI*2);t.fill();
  t.fillStyle='#9f8e82';t.fillRect(485,487,190,78);t.fillStyle='#817d7c';t.fillRect(499,555,9,42);t.fillRect(657,555,9,42);t.fillStyle='#c2bbb4';t.fillRect(502,445,152,42);
  t.fillStyle='#8d9599';t.fillRect(85,530,275,53);t.fillStyle='#6d777c';t.fillRect(104,576,17,34);t.fillRect(332,576,17,34);t.fillStyle='#aba29b';t.fillRect(104,500,86,30);t.fillRect(244,500,86,30);
  t.fillStyle='#a3a8a5';t.fillRect(0,664,1200,6);t.fillStyle='#f3f0eb';t.font='bold 18px sans-serif';t.fillText('MOSAIC · DEMO SCENE',825,700);return c;}
function demoVariant(base,wood,kind){const c=makeCanvas(base.width,base.height),t=c.getContext('2d');t.drawImage(base,0,0);t.fillStyle=wood;t.beginPath();t.moveTo(0,0);t.lineTo(390,95);t.lineTo(390,590);t.lineTo(0,740);t.closePath();t.fill();
  t.strokeStyle=kind===1?'#765543':'#aea08b';t.lineWidth=2;for(let x=17;x<385;x+=32){t.beginPath();t.moveTo(x,4+x*.15);t.lineTo(x,700-x*.2);t.stroke()}
  t.fillStyle='#eee';t.fillRect(580,165,130,91);t.strokeStyle='#55575c';t.lineWidth=5;t.beginPath();t.moveTo(645,28);t.lineTo(645,176);t.stroke();
  if(kind===1){t.strokeStyle='#303f48';t.lineWidth=15;t.beginPath();t.ellipse(645,218,67,30,0,0,Math.PI*2);t.stroke();t.strokeStyle='#fff0ce';t.lineWidth=5;t.beginPath();t.ellipse(645,221,61,26,0,0,Math.PI*2);t.stroke()}
  else{t.strokeStyle='#333b40';t.lineWidth=14;t.beginPath();t.moveTo(559,220);t.lineTo(730,220);t.stroke();t.strokeStyle='#fff0d7';t.lineWidth=6;t.beginPath();t.moveTo(561,227);t.lineTo(728,227);t.stroke()}
  return c;}
async function loadDemo(){if(state.busy)return;const base=drawDemoBase();state.reference=base;$('referenceTitle').textContent='Demo Revit reference';$('referenceInfo').textContent='1200 × 740 · hidden from canvas';$('referenceStatus').textContent='✓';$('referenceZone').classList.add('ready');setMaster(base,'Demo · Future workspace');showProcessing(true);await sleep();await ingestVariant(demoVariant(base,'#99745a',1),'Option A · Walnut & ring');await sleep();await ingestVariant(demoVariant(base,'#b7a48a',2),'Option B · Oak & linear');showProcessing(false);renderGroups();render();toast('Demo loaded. Try switching detected region options.');}
// Inputs
$('referenceInput').addEventListener('change',async e=>{await importReference(e.target.files[0]);e.target.value='' });
$('masterInput').addEventListener('change',async e=>{await importMaster(e.target.files[0]);e.target.value='' });
$('variantInput').addEventListener('change',async e=>{await importVariants(e.target.files);e.target.value='' });
for(const id of ['addImagesBtn','newVariantBtn'])$(id).addEventListener('click',()=>state.master?$('variantInput').click():toast('Upload a master image first.'));
for(const id of ['demoBtn','welcomeDemo'])$(id).addEventListener('click',loadDemo);
$('welcomeStart').addEventListener('click',()=>$('masterInput').click());
$('exportBtn').addEventListener('click',exportZip);
$('groupList').addEventListener('click',groupEvent);
$('tools').addEventListener('click',e=>{const t=e.target.closest('[data-tool]');if(t)selectTool(t.dataset.tool)});
$('brushSize').addEventListener('input',e=>$('brushValue').textContent=e.target.value);
$('sensitivity').addEventListener('input',e=>{const v=+e.target.value;$('sensitivityLabel').textContent=v<40?'Conservative':v>70?'Sensitive':'Balanced'});
$('undoBtn').addEventListener('click',()=>historyStep(state.undo,state.redo));$('redoBtn').addEventListener('click',()=>historyStep(state.redo,state.undo));
$('clearSelectionBtn').addEventListener('click',()=>{state.lasso=[];render()});
$('zoomIn').addEventListener('click',()=>setZoom(state.zoom*1.25));$('zoomOut').addEventListener('click',()=>setZoom(state.zoom/1.25));$('zoomFit').addEventListener('click',updateZoomFit);
$('beforeBtn').addEventListener('pointerdown',()=>{state.before=true;render()});for(const ev of ['pointerup','pointerleave','pointercancel'])$('beforeBtn').addEventListener(ev,()=>{state.before=false;render()});
$('overlayCanvas').addEventListener('pointerdown',pointerDown);$('overlayCanvas').addEventListener('pointermove',pointerMove);$('overlayCanvas').addEventListener('pointerup',pointerUp);$('overlayCanvas').addEventListener('pointercancel',pointerUp);
window.addEventListener('keydown',onKeys);window.addEventListener('resize',()=>{if(state.master)updateZoomFit()});
for(const id of ['copyPromptBtn','copyPromptSecondary'])$(id).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(addPrompt());toast('Prompt copied.')}catch{toast('Clipboard blocked. Select the prompt from the panel.') }});
const viewport=$('viewport');viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('dropping')});viewport.addEventListener('drop',async e=>{e.preventDefault();viewport.classList.remove('dropping');const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));if(!state.master){if(files[0])await importMaster(files[0]);if(files.length>1)await importVariants(files.slice(1))}else await importVariants(files)});
// File-system independent: assets remain in the current browser tab only.
addPrompt();