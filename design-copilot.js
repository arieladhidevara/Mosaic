/* mozAI Design Copilot: design conversation + shared Object IDs + safe edit routing. */
const core=window.MosaicCore,premium=window.MosaicPremium;
const {state,canvas,makeCanvas}=core,$=id=>document.getElementById(id);
const form=$('compositionChatForm'),chat=$('compositionChat'),prompt=$('compositionChatPrompt'),send=$('chatGenerate'),status=$('chatStatus');
if(!form||!chat)throw Error('Design Copilot requires AI Edit workspace.');
const thread=document.createElement('div');thread.id='copilotThread';thread.className='copilot-thread';thread.setAttribute('role','log');thread.setAttribute('aria-label','Design assistant conversation');chat.insertBefore(thread,form);
const context=document.createElement('div');context.className='copilot-context';context.hidden=true;chat.insertBefore(context,form);
prompt.placeholder='Ask mozAI…';send.textContent='↑';send.setAttribute('aria-label','Send message');
const chatPanel=$('chatPanel');
if(chatPanel)chatPanel.append(chat);
const corner=document.createElement('div');corner.className='canvas-corner-actions';corner.setAttribute('aria-label','Canvas controls');
$('viewport')?.append(corner);
for(const id of ['beforeBtn','zoomValue']){const item=$(id);if(item)corner.append(item)}
for(const tool of document.querySelectorAll('.tool-row .tool'))tool.dataset.tip=tool.querySelector('span')?.textContent.trim()||tool.getAttribute('aria-label')||tool.title||'Tool';
const wrap=$('canvasWrap'),layer=makeCanvas(1,1);layer.id='copilotHighlightLayer';layer.className='copilot-canvas-highlights';wrap.append(layer);
state.copilotSession??=null;
let busy=false,highlighted=[],pointed=null,pointerStart=null;
const activeGroups=ids=>{const keys=new Set(ids||[]);return state.groups.filter(g=>keys.has(g.id)&&!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved)};
function sceneVersion(){
  return [state.master?.width||0,state.master?.height||0,
    state.groups.map(g=>g.id+':'+(g.active||'')).join('|'),
    state.sceneVersionCounters?.['ai-edit']||0,state.sceneVersionCounters?.harmonize||0].join(';');
}
function jpeg(source,maxEdge=940,quality=.77){
  if(!source)return null;
  const scale=Math.min(1,maxEdge/Math.max(source.width,source.height));
  const c=makeCanvas(Math.max(128,Math.round(source.width*scale)),Math.max(128,Math.round(source.height*scale)));
  c.getContext('2d').drawImage(source,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',quality);
}
function objects(){
  return state.groups.filter(g=>!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved).slice(0,100).map(g=>{
    const b=g.area||core.exactMaskBoundingBox(core.groupMask(g));
    return {id:g.id,label:g.objectName||g.name||g.category||'Object',category:g.category||'Other',
      collection:state.objectCollections?.find(c=>c.id===g.collectionId)?.name||'',
      box:b?[Math.round(b.x),Math.round(b.y),Math.round(b.w),Math.round(b.h)]:[]};
  });
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
function select(ids){
  const items=activeGroups(ids);if(!items.length){status.textContent='No matching Object IDs.';return false}
  core.resetSelection();
  if(items.length===1){core.selectGroupMask(items[0]);highlight(ids);return true}
  const mask=makeCanvas(canvas.width,canvas.height),ctx=mask.getContext('2d');
  for(const g of items)ctx.drawImage(core.groupMask(g),0,0);
  state.selectionMask=mask;state.selectionPaths=items.flatMap(g=>core.maskPathsFromRaster(core.groupMask(g)));
  state.selectionPoints=state.selectionPaths.flat();
  window.MosaicObjectMap?.adoptSelection(items.map(g=>window.MosaicObjectManager?.partForObject(g)).filter(Boolean));
  core.updateSelectionOutline();core.renderGroups();core.render();highlight(ids);return true;
}
function group(ids,name){
  const items=activeGroups(ids),mgr=window.MosaicObjectManager;if(!items.length||!mgr)return false;
  const label=String(name||'AI selection').trim().slice(0,60)||'AI selection';
  let c=state.objectCollections?.find(x=>x.name.toLowerCase()===label.toLowerCase());
  if(!c)c=mgr.createCollection(label);
  mgr.moveObjects(items.map(g=>g.id),c.id);highlight(ids);return true;
}
function objectAt(x,y){
  const map=state.objectMap?.raster;
  if(map){
    const px=Math.min(map.width-1,Math.max(0,Math.floor(x/canvas.width*map.width)));
    const py=Math.min(map.height-1,Math.max(0,Math.floor(y/canvas.height*map.height)));
    const id=map.getContext('2d',{willReadFrequently:true}).getImageData(px,py,1,1).data[0];
    const g=state.groups.find(g=>g.objectMapInstanceId===id&&!g.mergedInto&&!g.objectRemoved);if(g)return g;
  }
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
  thread.replaceChildren();
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
      const bar=document.createElement('div');bar.className='copilot-actions';
      if(m.plan.targetIds?.length){bar.append(addButton('Highlight','highlight',m),addButton('Select','select',m))}
      if(m.plan.targetIds?.length>1)bar.append(addButton('Group objects','group',m));
      if(m.plan.editPrompt)bar.append(addButton('Small preview','preview',m),addButton('Generate','generate',m));
      el.append(bar);
    }
    thread.append(el);
  }
  thread.scrollTop=thread.scrollHeight;
}
async function execute(action,m){
  const plan=m.plan||{},ids=plan.targetIds||[];
  if(action==='highlight')return highlight(ids);
  if(action==='select')return select(ids);
  if(action==='group')return group(ids,plan.groupName);
  if(!plan.editPrompt||busy)return;
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
  busy=true;send.disabled=true;send.textContent='…';
  state.chatMessages.push({role:'user',text:message});prompt.value='';renderThread();status.textContent='Consulting on your design…';
  try{
    if(!await window.MosaicAuth.ensure())throw Error('Connect your OpenAI API key.');
    const session=state.copilotSession||{},token=sceneVersion(),first=!session.responseId;
    const answer=await window.MosaicAuth.request('/api/ai/chat',{
      message,previousResponseId:first?null:session.responseId,
      base:first?jpeg(state.reference||state.rawBase||state.master):null,
      currentImage:!first&&session.sceneToken!==token?jpeg(core.composeApprovedCanvas(),800,.68):null,
      objects:objects(),selectedIds:selectionIds(),point:pointed?{x:pointed.x,y:pointed.y}:null,
      references:await referenceImages(),
      projectPrompt:premium.projectPrompt(),
      searchWeb:/\b(search|find references|online|product links|source links)\b/i.test(message)||/cari (referensi|link|produk|website|internet)/i.test(message)
    });
    const plan={action:answer.action,scope:answer.scope,targetIds:answer.targetIds||[],groupName:answer.groupName,editPrompt:answer.editPrompt,reason:answer.reason};
    state.copilotSession={responseId:answer.responseId,sceneToken:token};
    const m={role:'assistant',text:answer.reply,plan,references:answer.references||[]};
    state.chatMessages.push(m);highlight(plan.targetIds);renderThread();
    status.textContent=plan.targetIds.length?plan.targetIds.length+' objects highlighted':'Design advice ready';
    if(plan.action==='select')select(plan.targetIds);
    if(plan.action==='group')group(plan.targetIds,plan.groupName);
    if(plan.action==='generate'||plan.action==='preview')setTimeout(()=>void execute(plan.action,m),0);
  }catch(e){
    if(e.resetSession)state.copilotSession=null;
    state.chatMessages.push({role:'assistant',text:(e.message||'Consultation failed')+(e.resetSession?' Try sending the message again to re-establish the Base session.':'')});
    status.textContent=e.message||'Consultation failed';renderThread();
  }finally{busy=false;send.disabled=false;send.textContent='↑'}
}
form.addEventListener('submit',e=>void submit(e),true);
const oldReset=window.MosaicWorkspace?.reset;
if(oldReset)window.MosaicWorkspace.reset=function(...args){
  const v=oldReset(...args);state.copilotSession=null;pointed=null;highlight([]);contextUI();renderThread();return v;
};
window.addEventListener('mosaic:projectloaded',()=>{renderThread();redraw();pointed=null;contextUI()});
window.addEventListener('resize',redraw);
window.MosaicDesignCopilot={highlight,select,group,redraw};
renderThread();
