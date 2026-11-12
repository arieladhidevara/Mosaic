/* mozAI Design Copilot: design conversation + shared Object IDs + safe edit routing. */
const core=window.MosaicCore,premium=window.MosaicPremium;
const {state,canvas,makeCanvas}=core,$=id=>document.getElementById(id);
const form=$('compositionChatForm'),chat=$('compositionChat'),prompt=$('compositionChatPrompt'),send=$('chatGenerate'),status=$('chatStatus');
if(!form||!chat)throw Error('Design Copilot requires AI Edit workspace.');
const thread=document.createElement('div');thread.id='copilotThread';thread.className='copilot-thread';thread.setAttribute('role','log');thread.setAttribute('aria-label','Design assistant conversation');chat.insertBefore(thread,form);
const context=document.createElement('div');context.className='copilot-context';context.hidden=true;chat.insertBefore(context,form);
prompt.placeholder='Ask about your design…';send.textContent='↑';send.setAttribute('aria-label','Send message');
prompt.maxLength=4000;
const chatPanel=$('chatPanel');
if(chatPanel)chatPanel.append(chat);
const corner=document.createElement('div');corner.className='canvas-corner-actions';corner.setAttribute('aria-label','Canvas controls');
$('viewport')?.append(corner);
for(const id of ['beforeBtn','zoomValue']){const item=$(id);if(item)corner.append(item)}
for(const tool of document.querySelectorAll('.tool-row .tool'))tool.dataset.tip=tool.querySelector('span')?.textContent.trim()||tool.getAttribute('aria-label')||tool.title||'Tool';
const wrap=$('canvasWrap'),layer=makeCanvas(1,1);layer.id='copilotHighlightLayer';layer.className='copilot-canvas-highlights';wrap.append(layer);
state.copilotSession??=null;
let revision=0,busy=false,highlighted=[],pointed=null,pointerStart=null;
let pendingReview=null,confirmedSelection=null,selectionSerial=0,reviewPointer=null;
let lastSentContext=null;
const baseHashCache=new WeakMap(),fileHashCache=new WeakMap();
const activeGroups=ids=>{const keys=new Set(ids||[]);return state.groups.filter(g=>keys.has(g.id)&&!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved)};
function jpeg(source,maxEdge=940,quality=.77){
  if(!source)return null;
  const scale=Math.min(1,maxEdge/Math.max(source.width,source.height));
  const c=makeCanvas(Math.max(128,Math.round(source.width*scale)),Math.max(128,Math.round(source.height*scale)));
  c.getContext('2d').drawImage(source,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',quality);
}
function objects(){
  return state.groups.filter(g=>!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved).slice(0,100).map(g=>{
    const b=core.exactMaskBoundingBox(core.groupMask(g))||g.area;
    return {id:g.id,label:g.objectName||g.name||g.category||'Object',category:g.category||'Other',
      collection:state.objectCollections?.find(c=>c.id===g.collectionId)?.name||'',
      box:b?[Math.round(b.x),Math.round(b.y),Math.round(b.w),Math.round(b.h)]:[]};
  });
}
// SHA-256 fingerprints detect even small canvas changes without repeatedly
// encoding and uploading the full image when its pixels are unchanged.
async function sha256(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
const textHash=value=>sha256(new TextEncoder().encode(value));
async function imageHash(source){
  const pixels=source.getContext('2d',{willReadFrequently:true})
    .getImageData(0,0,source.width,source.height).data;
  return textHash(source.width+'x'+source.height+':'+await sha256(pixels));
}
function baseHash(source){
  let cache=baseHashCache.get(source);
  if(!cache){cache=imageHash(source);baseHashCache.set(source,cache)}
  return cache;
}
async function fileHash(file){
  let cache=fileHashCache.get(file);
  if(!cache){cache=sha256(await file.arrayBuffer());fileHashCache.set(file,cache)}
  return cache;
}
async function chatRequestBody(message,projectId,forceContext=false){
  const base=state.reference||state.rawBase||state.master;
  const current=core.composeApprovedCanvas();
  const objectsNow=objects(),projectPrompt=String(premium.projectPrompt()||'');
  const attached=files().slice(0,3);
  if(files().length>3)throw Error('Maximum three reference images.');
  const hashes={
    base:await baseHash(base),
    canvas:await imageHash(current),
    objects:await textHash(JSON.stringify({w:canvas.width,h:canvas.height,objects:objectsNow})),
    prompt:await textHash(projectPrompt),
    references:await textHash(JSON.stringify(await Promise.all(attached.map(async file=>({
      name:file.name,type:file.type,bytes:file.size,hash:await fileHash(file)
    })))))
  };
  const full=forceContext||!projectId||!lastSentContext||lastSentContext.projectId!==projectId;
  const changed=key=>full||lastSentContext.hashes[key]!==hashes[key];
  const body={
    message,projectId,forceContext:Boolean(forceContext),
    contextHashes:hashes,
    canvasSize:{width:canvas.width,height:canvas.height},
    confirmedSelectedIds:confirmedSelection&&sameIds(selectionIds(),confirmedSelection.ids)?confirmedSelection.ids:[],
    selectedIds:selectionIds(),
    point:pointed?{x:pointed.x,y:pointed.y,id:pointed.id}:null,
    ...(changed('base')?{base:jpeg(base)}:{}),
    ...(changed('canvas')?{currentImage:jpeg(current,800,.68)}:{}),
    ...(changed('objects')?{objects:objectsNow}:{}),
    ...(changed('prompt')?{projectPrompt}:{}),
    ...(changed('references')?{references:await referenceImages()}: {})
  };
  return {body,receipt:{projectId,hashes}};
}
async function chatWithOptimizedContext(message,projectId){
  // If the server lost context (expired Gemini session, new tab or concurrent
  // workspace changes), rehydrate once with a complete current snapshot.
  for(let attempt=0;attempt<2;attempt++){
    const {body,receipt}=await chatRequestBody(message,projectId,attempt===1);
    try{
      const reply=await window.MosaicAccount.request('/api/ai/chat',{method:'POST',body});
      lastSentContext=receipt;
      return reply;
    }catch(error){
      if(attempt!==0||error.code!=='GEMINI_CONTEXT_REQUIRED')throw error;
      lastSentContext=null;
    }
  }
}
function selectionIds(){
  const mapped=(state.objectSelectionParts||[]).map(p=>state.groups.find(g=>g.objectMapKey===p.mapKey&&g.objectMapObjectKey===p.objectKey)?.id).filter(Boolean);
  return [...new Set([...mapped,...(pointed?.id?[pointed.id]:[])])];
}
function redraw(){
  if(!state.master)return;
  if(layer.width!==canvas.width||layer.height!==canvas.height){layer.width=canvas.width;layer.height=canvas.height}
  const ctx=layer.getContext('2d');ctx.clearRect(0,0,layer.width,layer.height);
  for(const g of activeGroups(highlighted)){
    const mask=core.groupMask(g);if(!mask)continue;
    const tinted=makeCanvas(canvas.width,canvas.height),x=tinted.getContext('2d');
    x.drawImage(mask,0,0);x.globalCompositeOperation='source-in';x.fillStyle='#ab80ff';x.fillRect(0,0,canvas.width,canvas.height);
    ctx.globalAlpha=.18;ctx.drawImage(tinted,0,0);ctx.globalAlpha=1;
  }
}
function highlight(ids){highlighted=[...new Set(ids||[])];redraw()}
const sameIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(id=>b.includes(id));
function select(ids){
  const items=activeGroups([...new Set(ids||[])]);
  core.resetSelection();
  if(!items.length){highlight([]);core.renderGroups();core.render();return false}
  const mask=makeCanvas(canvas.width,canvas.height),ctx=mask.getContext('2d');
  for(const g of items)ctx.drawImage(core.groupMask(g),0,0);
  state.selectionMask=mask;
  state.selectionPaths=items.flatMap(g=>core.maskPathsFromRaster(core.groupMask(g)));
  state.selectionPoints=state.selectionPaths.flat();
  state.selectionOverlayHidden=false;
  state.selectionTargetPatchId=null;
  state.selectedPatchId=null;
  state.draftGroupId=null;
  window.MosaicObjectMap?.adoptSelection(items.map(g=>window.MosaicObjectManager?.partForObject(g)).filter(Boolean));
  core.selectTool('select');core.updateSelectionOutline();core.updateApplyButton();
  core.renderGroups();core.render();highlight(items.map(g=>g.id));return true;
}
function beginReview(message,ids){
  const valid=activeGroups([...new Set(ids||[])]).map(g=>g.id);
  if(!valid.length){status.textContent='No matching objects found. Try selecting them manually.';return false}
  pendingReview={message,ids:valid,serial:++selectionSerial};
  confirmedSelection=null;
  pointed=null;contextUI();
  message.reviewState='pending';
  message.plan.targetIds=[...pendingReview.ids];
  select(pendingReview.ids);
  status.textContent='Review '+pendingReview.ids.length+' selected objects on the canvas.';
  renderThread();
}
function toggleReviewObject(group){
  if(!pendingReview||!group)return;
  const ids=pendingReview.ids,at=ids.indexOf(group.id);
  if(at>=0)ids.splice(at,1);else ids.push(group.id);
  pendingReview.message.plan.targetIds=[...ids];
  select(ids);
  status.textContent=ids.length+' objects selected · click to add/remove, then confirm.';
  renderThread();
}
function confirmReview(message){
  if(!pendingReview||pendingReview.message!==message)return;
  const ids=[...pendingReview.ids];
  if(!ids.length){status.textContent='Select at least one object before confirming.';return}
  confirmedSelection={ids,token:++selectionSerial};
  message.plan.targetIds=[...ids];message.plan.confirmedToken=confirmedSelection.token;
  message.reviewState='confirmed';pendingReview=null;
  select(ids);
  status.textContent=ids.length+' objects confirmed · ready for edit instructions.';
  state.chatMessages.push({role:'assistant',text:'Confirmed '+ids.length+' object'+(ids.length===1?'':'s')+'. Tell me what to change, or click Generate if an edit prompt is ready.'});
  renderThread();
}
function cancelReview(message){
  if(!pendingReview||pendingReview.message!==message)return;
  pendingReview=null;confirmedSelection=null;message.reviewState='cancelled';
  select([]);status.textContent='Selection cancelled.';renderThread();
}
function canGenerate(message){
  const p=message.plan||{};
  if(!p.editPrompt)return false;
  if(p.scope!=='region')return true;
  return Boolean(confirmedSelection&&p.confirmedToken===confirmedSelection.token&&
    sameIds(p.targetIds,confirmedSelection.ids)&&sameIds(selectionIds(),confirmedSelection.ids));
}
function group(ids,name){
  const items=activeGroups(ids),mgr=window.MosaicObjectManager;if(!items.length||!mgr)return false;
  const label=String(name||'AI selection').trim().slice(0,60)||'AI selection';
  let c=state.objectCollections?.find(x=>x.name.toLowerCase()===label.toLowerCase());
  if(!c)c=mgr.createCollection(label);
  mgr.moveObjects(items.map(g=>g.id),c.id);highlight(ids);return true;
}
function objectAt(x,y){
  for(const g of [...state.groups].reverse()){
    if(g.mergedInto||g.objectMapBatch||g.objectRemoved)continue;
    const m=core.groupMask(g);if(m?.getContext('2d',{willReadFrequently:true}).getImageData(Math.floor(x),Math.floor(y),1,1).data[3]>=128)return g;
  }
  return null;
}
function contextUI(){
  context.replaceChildren();context.hidden=!pointed;if(!pointed)return;
  const s=document.createElement('span');s.textContent='Pointing at: '+pointed.label;
  const b=document.createElement('button');b.type='button';b.textContent='×';b.setAttribute('aria-label','Clear pointed object');
  b.onclick=()=>{pointed=null;contextUI()};context.append(s,b);
}
$('overlayCanvas').addEventListener('pointerdown',e=>{pointerStart=state.tool==='select'?{x:e.clientX,y:e.clientY}:null},true);
$('overlayCanvas').addEventListener('pointerup',e=>{
  if(state.tool!=='select'||!state.master||!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>8)return;
  const b=$('overlayCanvas').getBoundingClientRect();
  const x=(e.clientX-b.left)*canvas.width/b.width,y=(e.clientY-b.top)*canvas.height/b.height;pointerStart=null;
  if(x<0||y<0||x>=canvas.width||y>=canvas.height)return;
  const g=objectAt(x,y);pointed={x:x/canvas.width,y:y/canvas.height,id:g?.id||null,label:g?.objectName||g?.name||'selected area'};contextUI();
},true);
// While Assistant selection review is active, clicks toggle existing Object IDs.
 // Intercept before the regular canvas gesture handler, so no masks/Groups are created.
const viewport=$('viewport');
for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])viewport.addEventListener(type,event=>{
  if(!pendingReview||state.tool!=='select'||!event.target?.closest?.('#canvasWrap'))return;
  if(state.before||state.busy||window.MosaicPremium?.isPreviewing())return;
  event.preventDefault();event.stopImmediatePropagation();
  if(type==='pointerdown'){
    if(event.button!==0)return;
    reviewPointer={id:event.pointerId,x:event.clientX,y:event.clientY};
  }else if(type==='pointercancel')reviewPointer=null;
  else if(type==='pointerup'){
    const start=reviewPointer;reviewPointer=null;
    if(!start||start.id!==event.pointerId||Math.hypot(start.x-event.clientX,start.y-event.clientY)>8)return;
    const rect=$('overlayCanvas').getBoundingClientRect();
    const x=(event.clientX-rect.left)*canvas.width/rect.width,y=(event.clientY-rect.top)*canvas.height/rect.height;
    if(x>=0&&y>=0&&x<canvas.width&&y<canvas.height)toggleReviewObject(objectAt(x,y));
  }
},true);
function files(){return [...form.querySelectorAll('input.region-reference-input')].flatMap(i=>[...i.files])}
async function referenceImages(){
  const list=files().slice(0,3),images=[];
  for(const file of list){
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10000000)throw Error('Reference must be JPG/PNG/WebP under 10 MB.');
    const url=URL.createObjectURL(file),img=new Image();img.src=url;
    try{await img.decode()}finally{URL.revokeObjectURL(url)}
    let encoded=jpeg(img,720,.65);
    if(encoded.length>850000)encoded=jpeg(img,520,.65);
    images.push(encoded);
  }
  return images;
}
function addButton(text,action,m){
  const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>void execute(action,m);return b;
}
function renderThread(){
  if(!busy)send.textContent='↑';
  thread.replaceChildren();
  if(!state.chatMessages?.length){const empty=document.createElement('div');empty.className='copilot-empty';const title=document.createElement('strong');title.textContent="Let's work on your design.";empty.append(title,document.createTextNode('Ask about materials, lighting, or a selected object.'));thread.append(empty)}
  for(const m of state.chatMessages||[]){
    if(!m||!['user','assistant'].includes(m.role))continue;
    const el=document.createElement('div');el.className='copilot-message '+m.role;
    const text=document.createElement('div');text.textContent=String(m.text||'');el.append(text);
    if(m.preview){const img=document.createElement('img');img.className='copilot-preview';img.src=m.preview;img.alt='Concept preview';el.append(img)}
    if(Array.isArray(m.references)){
      const refs=document.createElement('div');refs.className='copilot-links';
      for(const ref of m.references.slice(0,8)){
        if(!/^https:\/\//.test(ref.url||''))continue;
        const a=document.createElement('a');a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=ref.title||ref.url;refs.append(a);
      }el.append(refs);
    }
    if(m.role==='assistant'&&m.plan){
      if(m.reviewState==='pending'&&pendingReview?.message===m){
        const hint=document.createElement('div');hint.className='copilot-selection-hint';
        hint.textContent='Selected '+pendingReview.ids.length+' objects · click any object on the canvas to add/remove it.';
        el.append(hint);
        const bar=document.createElement('div');bar.className='copilot-actions';
        bar.append(addButton('Confirm selection','confirm',m),addButton('Cancel','cancel',m));
        el.append(bar);
      }else{
        const bar=document.createElement('div');bar.className='copilot-actions';
        if(m.reviewState==='confirmed'){
          const hint=document.createElement('div');hint.className='copilot-selection-hint';
          hint.textContent='✓ Selection confirmed';el.append(hint);
        }
        if(m.plan.targetIds?.length){bar.append(addButton('Highlight','highlight',m))}
        if(m.plan.targetIds?.length&&!pendingReview)bar.append(addButton('Select','select',m));
        if(m.plan.targetIds?.length>1&&!pendingReview)bar.append(addButton('Group objects','group',m));
        if(canGenerate(m)){
          if(m.plan.scope!=='region')bar.append(addButton('Preview · OpenAI','preview',m));
          bar.append(addButton('Generate · OpenAI','generate',m));
        }
        if(bar.childElementCount)el.append(bar);
      }
    }
    thread.append(el);
  }
  thread.scrollTop=thread.scrollHeight;
}
async function execute(action,m){
  const plan=m.plan||{},ids=plan.targetIds||[];
  if(action==='confirm')return confirmReview(m);
  if(action==='cancel')return cancelReview(m);
  if(action==='highlight')return highlight(ids);
  if(action==='select')return beginReview(m,ids);
  if(action==='group')return group(ids,plan.groupName);
  if(!plan.editPrompt||busy)return;
  if(!canGenerate(m)){status.textContent='Confirm the current selection before generating.';return}
  busy=true;send.disabled=true;
  try{
    if(!await window.MosaicAuth.ensure())throw Error('Connect your OpenAI API key.');
    if(action==='preview'){
      status.textContent='Generating a low-quality concept preview…';
      const img=await premium.generateComposition(plan.editPrompt,files(),core.composeApprovedCanvas(),null,{quality:'low'});
      state.chatMessages.push({role:'assistant',text:'Small concept preview only. Master remains unchanged.',preview:jpeg(img,500,.75)});
      status.textContent='Preview ready · not applied';
    }else if(action==='generate'){
      if(plan.scope==='region'){
        if(!ids.length||!select(ids))throw Error('Select valid target objects first.');
        status.textContent='Generating selected object masks…';
        await premium.generateSelection(plan.editPrompt,null,files());
        state.chatMessages.push({role:'assistant',text:'Masked edit submitted. Original object identities remain locked. Review the generated Options in Groups.'});
      }else{
        status.textContent='Generating full composition…';
        const img=await premium.generateComposition(plan.editPrompt,files(),core.composeApprovedCanvas());
        await window.MosaicSceneVersions.apply(img,{type:plan.scope==='harmonize'?'harmonize':'ai-edit',prompt:plan.editPrompt,onStatus:t=>{status.textContent=t}});
        state.chatMessages.push({role:'assistant',text:'New full-image version created. Review it before further editing.'});
      }
      status.textContent='Generation completed or submitted. Review your options.';
    }
    renderThread();
  }catch(e){status.textContent=e.message||'Generation failed';state.chatMessages.push({role:'assistant',text:'Generation failed: '+(e.message||'Unknown error')});renderThread()}
  finally{busy=false;send.disabled=false}
}
async function submit(event){
  event.preventDefault();event.stopImmediatePropagation();if(busy)return;
  const message=prompt.value.trim();if(!message)return;
  if(!state.master){status.textContent='Upload a Base image first.';return}
  const requestRevision=revision,baseAtStart=state.master;
  busy=true;send.disabled=true;send.textContent='…';
  state.chatMessages.push({role:'user',text:message});prompt.value='';renderThread();status.textContent='Consulting on your design…';
  try{
    // Project identity is resolved from the signed-in account; Gemini interaction IDs stay server-side.
    const projectId=await window.MosaicAccount.projectId();
    const answer=await chatWithOptimizedContext(message,projectId);
    if(requestRevision!==revision||baseAtStart!==state.master)return;
    const plan={action:answer.action,scope:answer.scope,targetIds:answer.targetIds||[],groupName:answer.groupName,editPrompt:answer.editPrompt,reason:answer.reason};
    const m={role:'assistant',text:answer.reply,plan,references:answer.references||[]};
    state.chatMessages.push(m);
    // Semantic selection and region-edit targeting must be user-confirmed.
    if(plan.targetIds.length&&(plan.action==='select'||plan.scope==='region')){
      if(confirmedSelection&&sameIds(plan.targetIds,confirmedSelection.ids)&&!pendingReview&&plan.action!=='select'){
        plan.confirmedToken=confirmedSelection.token;m.reviewState='confirmed';
        select(confirmedSelection.ids);status.textContent='Selection confirmed · edit ready.';
        renderThread();
      }else beginReview(m,plan.targetIds);
    }else{
      highlight(plan.targetIds);renderThread();
      status.textContent=plan.targetIds.length?plan.targetIds.length+' objects highlighted':'Gemini · design advice ready';
      if(plan.action==='group')group(plan.targetIds,plan.groupName);
    }
    // Image calls require the explicit Preview / Generate button below the advice.
  }catch(e){
    if(requestRevision!==revision||baseAtStart!==state.master)return;
    if(e.resetSession)state.copilotSession=null;
    state.chatMessages.push({role:'assistant',text:(e.message||'Consultation failed')+(e.resetSession?' Try sending the message again to re-establish the Base session.':'')});
    status.textContent=e.message||'Consultation failed';renderThread();
  }finally{busy=false;send.disabled=false;send.textContent='↑'}
}
form.addEventListener('submit',e=>void submit(e),true);
const oldReset=window.MosaicWorkspace?.reset;
if(oldReset)window.MosaicWorkspace.reset=function(...args){
  revision++;const v=oldReset(...args);state.copilotSession=null;lastSentContext=null;pointed=null;pendingReview=null;confirmedSelection=null;highlight([]);contextUI();renderThread();return v;
};
window.addEventListener('mosaic:projectloaded',()=>{revision++;state.copilotSession=null;lastSentContext=null;pendingReview=null;confirmedSelection=null;renderThread();redraw();pointed=null;contextUI()});
window.addEventListener('resize',redraw);
window.MosaicDesignCopilot={highlight,select,group,redraw,reviewSelection:()=>pendingReview?{ids:[...pendingReview.ids]}:null,confirmedSelection:()=>confirmedSelection?{ids:[...confirmedSelection.ids]}:null,chatRequestBody};
renderThread();
