/* Markup, composition chat and pixel-accurate clipboard layers. */
const core=window.MosaicCore,premium=window.MosaicPremium;
const {state,canvas,makeCanvas,render,renderGroups,toast}=core;
const $=id=>document.getElementById(id);
const clone=source=>{const out=makeCanvas(source.width,source.height);out.getContext('2d').drawImage(source,0,0);return out};
const copyPaths=paths=>(paths||[]).map(path=>path.map(p=>({...p})));
const wrap=$('canvasWrap'),viewport=$('viewport');
const shade=makeCanvas(1,1),ink=makeCanvas(1,1);
shade.id='resultShadeCanvas';ink.id='markupCanvas';
shade.className='workspace-result-shade';ink.className='workspace-markup';
wrap.append(shade,ink);
state.markups??=[];state.chatMessages??=[];state.chatResult??=null;
let markupTool=null,draft=null,clipboard=null,job=null,epoch=0;
const peekKeys=new Set();

const dock=document.createElement('div');
dock.className='workspace-dock';
dock.innerHTML=`
  <div id="resultControls" class="result-controls" hidden aria-label="Select generated image">
    <span>Select what to keep</span>
    <button type="button" data-result-tool="rect">Rectangle</button>
    <button type="button" data-result-tool="ellipse">Oval</button>
    <button type="button" data-result-tool="lasso">Line / freehand</button>
    <button id="resultDone" type="button" class="workspace-accent">Done</button>
    <button id="resultAll" type="button">Use full image</button>
    <button id="resultCancel" type="button">Cancel</button>
    <small>Hold Space / R to see behind · Ctrl/Cmd+C, V to copy and paste</small>
  </div>
  <div id="markupToolbar" class="markup-toolbar" role="toolbar" aria-label="Markup tools">
    <span class="workspace-dock-label">Markup</span>
    <button type="button" data-markup="arrow" aria-pressed="false" title="Draw an arrow with a text label">↗ <span>Arrow + text</span></button>
    <button type="button" data-markup="text" aria-pressed="false">T <span>Text</span></button>
    <button type="button" data-markup="line" aria-pressed="false">╱ <span>Line</span></button>
    <button type="button" data-markup="rect" aria-pressed="false">▭ <span>Box</span></button>
    <button type="button" data-markup="ellipse" aria-pressed="false">◯ <span>Oval</span></button>
    <button type="button" data-markup="freehand" aria-pressed="false">〰 <span>Freehand</span></button>
    <input id="markupColor" type="color" value="#f5b94c" aria-label="Markup color" title="Markup color"/>
    <label class="markup-width">Size <input id="markupWidth" type="range" min="1" max="12" value="3" aria-label="Markup stroke width"/></label>
    <input id="markupText" type="text" maxlength="180" placeholder="Text / arrow label…" aria-label="Markup label" hidden/>
    <button id="markupClear" type="button" title="Clear markup">Clear</button>
    <button id="markupExit" type="button" hidden>Done</button>
  </div>`;
document.querySelector('.canvas-foot').before(dock);

const chat=document.createElement('aside');
chat.id='compositionChat';chat.className='composition-chat';chat.setAttribute('aria-label','Image chat');
chat.innerHTML=`
  <button id="chatToggle" type="button" class="chat-toggle" aria-expanded="false" aria-controls="chatBody">✦ <span>Image chat</span><span aria-hidden="true">＋</span></button>
  <div id="chatBody" class="composition-chat-body" hidden>
    <p class="chat-intro">Generate from the latest collage. References guide material and style; Base keeps the geometry.</p>
    <div id="chatMessages" class="chat-messages" role="log" aria-label="Image chat history" aria-live="polite"></div>
    <form id="compositionChatForm" autocomplete="off">
      <div class="prompt-input-row"><textarea id="compositionChatPrompt" rows="3" maxlength="6000" placeholder="Describe changes to the whole image…" aria-label="Prompt for the latest collage" required></textarea></div>
      <input class="region-reference-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden/>
      <div class="region-inline-previews reference-previews"></div>
      <div class="chat-form-actions"><button type="button" class="prompt-add-reference region-reference-button" aria-label="Attach reference images" title="Add up to 3 material or style references">+</button><span>Latest collage + prompt</span><button id="chatGenerate" type="submit" class="workspace-accent">Generate ↗</button></div>
    </form>
    <p id="chatStatus" class="chat-status" role="status"></p>
  </div>`;
document.querySelector('.main-panel').append(chat);
const references=premium.bindInlineReferencePrompt($('compositionChatForm'));

function setMarkupTool(tool){
  if(tool&&(!state.master||state.before||premium.isPreviewing()||window.MosaicSourceEditor?.isEditing())){toast('Return to the current canvas to add markup.');return}
  markupTool=tool;draft=null;
  ink.classList.toggle('is-drawing',Boolean(tool));
  $('markupText').hidden=!['text','arrow'].includes(tool);
  $('markupExit').hidden=!tool;
  for(const b of dock.querySelectorAll('[data-markup]'))b.setAttribute('aria-pressed',String(b.dataset.markup===tool));
  if(tool){core.hideQuickPrompt();core.selectTool('select')}
  drawOverlay();
}
function addHistory(entry){state.undo.push(entry);if(state.undo.length>12)state.undo.shift();state.redo=[]}
function restoreHistory(entry,to){
  if(entry.type==='markup'){
    to.push({type:'markup',markups:state.markups});state.markups=entry.markups;return true;
  }
  if(entry.type==='clipboard-layer'){
    const present=state.patches.has(entry.patch.id);
    to.push({...entry,present});
    if(entry.present){
      if(!state.groups.some(g=>g.id===entry.group.id))state.groups.push(entry.group);
      state.patches.set(entry.patch.id,entry.patch);state.sources.set(entry.source.id,entry.source);state.selectedPatchId=entry.patch.id;
    }else{
      state.groups=state.groups.filter(g=>g.id!==entry.group.id);state.patches.delete(entry.patch.id);state.sources.delete(entry.source.id);state.selectedPatchId=null;
    }
    core.resetSelection();return true;
  }
  return false;
}
function drawMark(target,item){
  if(!item?.points?.length)return;
  const a=item.points[0],b=item.points.at(-1),dx=b.x-a.x,dy=b.y-a.y;
  target.save();target.strokeStyle=target.fillStyle=item.color;target.lineWidth=item.width;target.lineCap=target.lineJoin='round';
  target.beginPath();
  if(item.type==='rect')target.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(dx),Math.abs(dy));
  else if(item.type==='ellipse')target.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(dx)/2,Math.abs(dy)/2,0,0,Math.PI*2);
  else if(item.type!=='text')item.points.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));
  target.stroke();
  if(item.type==='arrow'){
    const angle=Math.atan2(dy,dx),size=Math.max(12,item.width*4);
    target.beginPath();target.moveTo(b.x,b.y);
    target.lineTo(b.x-size*Math.cos(angle-.45),b.y-size*Math.sin(angle-.45));
    target.lineTo(b.x-size*Math.cos(angle+.45),b.y-size*Math.sin(angle+.45));target.closePath();target.fill();
  }
  if(item.text){
    const font=Math.max(16,item.width*5),x=a.x+8,y=a.y-8;
    target.font=`600 ${font}px system-ui, sans-serif`;target.textBaseline='bottom';
    const w=target.measureText(item.text).width;
    target.fillStyle='rgba(12,14,18,.8)';target.fillRect(x-5,y-font-3,w+10,font+8);
    target.fillStyle=item.color;target.fillText(item.text,x,y);
  }
  target.restore();
}
function drawMarkups(target){for(const item of state.markups||[])drawMark(target,item)}
function sizeLayers(){for(const layer of [shade,ink])if(layer.width!==canvas.width||layer.height!==canvas.height){layer.width=canvas.width;layer.height=canvas.height}}
function isSelectingResult(){return Boolean(state.chatResult)}
function drawResult(target){
  if(!state.chatResult)return;
  target.clearRect(0,0,canvas.width,canvas.height);
  target.drawImage(peekKeys.size?state.chatResult.underlay:state.chatResult.image,0,0,canvas.width,canvas.height);
}
function drawOverlay(){
  sizeLayers();
  const s=shade.getContext('2d'),i=ink.getContext('2d');s.clearRect(0,0,shade.width,shade.height);i.clearRect(0,0,ink.width,ink.height);
  const result=Boolean(state.chatResult);
  $('resultControls').hidden=!result;
  $('markupToolbar').hidden=!state.master||result;
  shade.hidden=!result||state.before||Boolean(peekKeys.size);
  ink.hidden=state.before||result;
  if(result&&!peekKeys.size){
    s.fillStyle='rgba(0,0,0,.20)';s.fillRect(0,0,shade.width,shade.height);
    if(state.selectionMask){s.globalCompositeOperation='destination-out';s.drawImage(state.selectionMask,0,0);s.globalCompositeOperation='source-over'}
  }
  if(!result){drawMarkups(i);if(draft)drawMark(i,draft)}
  $('resultDone').disabled=!result||!state.selectionMask||!core.maskBoundingBox(state.selectionMask);
}
// Snapshot the image shown in the viewport. Editor handles, selection guides and
// the result-selection tint are UI; user-created markup belongs to the image.
function visibleImage({annotations=true}={}){
  if(!state.master)return state.reference?clone(state.reference):null;
  const out=window.MosaicSourceEditor?.visibleImage?.()||clone(canvas),target=out.getContext('2d');
  if(state.before){
    target.save();target.beginPath();target.rect(0,0,out.width*(state.comparePosition??50)/100,out.height);target.clip();
    target.drawImage(state.reference||state.rawBase||state.rawMaster||state.master,0,0,out.width,out.height);target.restore();
  }
  if(annotations&&!state.before&&!state.chatResult)drawMarkups(target);
  return out;
}
const point=e=>{
  const r=ink.getBoundingClientRect();
  return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};
};
ink.addEventListener('pointerdown',e=>{
  if(!markupTool||e.button!==0)return;
  e.preventDefault();e.stopPropagation();ink.setPointerCapture(e.pointerId);
  const text=['text','arrow'].includes(markupTool)?$('markupText').value.trim():'';
  if(markupTool==='text'&&!text){toast('Enter your text in the markup toolbar first.');$('markupText').focus();return}
  draft={type:markupTool,points:[point(e)],width:Number($('markupWidth').value)/Math.max(.15,state.zoom),color:$('markupColor').value,text};
  drawOverlay();
});
ink.addEventListener('pointermove',e=>{
  if(!draft)return;e.preventDefault();e.stopPropagation();
  const p=point(e);
  if(draft.type==='freehand')draft.points.push(p);else draft.points=[draft.points[0],p];
  drawOverlay();
});
ink.addEventListener('pointerup',e=>{
  if(!draft)return;e.preventDefault();e.stopPropagation();
  if(draft.type!=='freehand')draft.points=[draft.points[0],point(e)];
  if(draft.type==='text'||draft.points.length>1){addHistory({type:'markup',markups:state.markups});state.markups=[...state.markups,draft]}
  draft=null;drawOverlay();
});
ink.addEventListener('pointercancel',()=>{draft=null;drawOverlay()});
for(const b of dock.querySelectorAll('[data-markup]'))b.addEventListener('click',()=>setMarkupTool(markupTool===b.dataset.markup?null:b.dataset.markup));
$('markupExit').addEventListener('click',()=>setMarkupTool(null));
$('markupClear').addEventListener('click',()=>{if(!state.markups.length)return;addHistory({type:'markup',markups:state.markups});state.markups=[];draft=null;drawOverlay()});
for(const b of document.querySelectorAll('[data-tool]'))b.addEventListener('click',()=>{if(markupTool)setMarkupTool(null)});

function selectedPixels(){
  if(state.lasso.length>=3)core.updateMaskWithLasso();
  const mask=state.selectionMask,bbox=mask&&core.exactMaskBoundingBox(mask);
  if(!bbox){toast('Select an area before copying.');return null}
  const image=visibleImage({annotations:false});if(!image)return null;
  image.getContext('2d').globalCompositeOperation='destination-in';image.getContext('2d').drawImage(mask,0,0);
  return {image,mask:clone(mask),bbox,paths:copyPaths(state.selectionPaths),fromResult:Boolean(state.chatResult),width:canvas.width,height:canvas.height};
}
function copySelection(writeSystem=true){
  const pixels=selectedPixels();if(!pixels)return false;clipboard=pixels;
  if(writeSystem&&navigator.clipboard?.write&&window.ClipboardItem){
    // Crop the system clipboard PNG to the selection while preserving alpha.
    const {bbox:b}=pixels,out=makeCanvas(b.w,b.h);out.getContext('2d').drawImage(pixels.image,-b.x,-b.y);
    const blob=new Promise((resolve,reject)=>out.toBlob(value=>value?resolve(value):reject(Error('Cannot copy image.')),'image/png'));
    navigator.clipboard.write([new ClipboardItem({'image/png':blob})]).catch(()=>{});
  }
  toast('Selected pixels copied. Press Ctrl/Cmd+V to paste as a layer.');return true;
}
function dismissResult(){
  state.chatResult=null;peekKeys.clear();core.resetSelection();core.selectTool('select');render();
}
function pasteSelection(inPlace=false){
  if(!clipboard||!state.master)return false;
  if(window.MosaicSourceEditor?.isEditing()||state.pendingSourceId||state.editingPatchId||state.before||premium.isPreviewing()){toast('Finish the current edit before pasting.');return false}
  if(clipboard.width!==canvas.width||clipboard.height!==canvas.height){toast('This selection belongs to a different canvas size. Copy it again.');return false}
  const data=clipboard,offset=inPlace||data.fromResult?0:12;
  if(state.chatResult)dismissResult();
  const source={id:core.uid('clipboard_source'),name:'Copied selection',canvas:clone(data.image)};
  const mask=clone(data.mask),group=core.newGroup(mask);
  const patch={id:core.uid('clipboard_patch'),sourceId:source.id,mask,bbox:{...data.bbox},maskPaths:copyPaths(data.paths),maskPoints:copyPaths(data.paths).flat(),name:data.fromResult?'Chat selection':'Pasted selection',manualName:true,groupId:group.id};
  if(offset){const b=patch.bbox;patch.corners=[{x:b.x+offset,y:b.y+offset},{x:b.x+b.w+offset,y:b.y+offset},{x:b.x+b.w+offset,y:b.y+b.h+offset},{x:b.x+offset,y:b.y+b.h+offset}]}
  state.sources.set(source.id,source);core.assignGroup(patch,group.id);core.resetSelection();
  state.selectedPatchId=patch.id;core.selectTool('transform');
  addHistory({type:'clipboard-layer',present:false,patch,group,source});
  renderGroups();render();toast('Selection pasted. Drag the layer or its corner handles to move and skew.');return true;
}
function showResult(image,prompt,underlay,markups=[]){
  setMarkupTool(null);state.before=false;core.resetSelection();
  state.selectedPatchId=null;state.editingPatchId=null;
  state.chatResult={image,underlay,prompt,markups};peekKeys.clear();core.setMode('new');core.selectTool('rect');render();
  core.message('Select a part of the result, then Done. Hold Space / R to compare with your collage.');
}
for(const b of dock.querySelectorAll('[data-result-tool]'))b.addEventListener('click',()=>core.selectTool(b.dataset.resultTool));
$('resultCancel').addEventListener('click',dismissResult);
$('resultDone').addEventListener('click',()=>{if(copySelection(false))pasteSelection(true)});
$('resultAll').addEventListener('click',()=>{
  if(!state.chatResult)return;
  core.resetSelection();const t=state.selectionMask.getContext('2d');t.fillStyle='#fff';t.fillRect(0,0,canvas.width,canvas.height);
  if(copySelection(false))pasteSelection(true);
});
// Clicking a fresh result with Select starts a rectangle. Existing outlines
// retain the normal point-editing and move interactions.
viewport.addEventListener('pointerdown',e=>{
  if(!state.chatResult||state.tool!=='select'||e.target.closest('form,button,input,textarea,.mask-edit-controls'))return;
  const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;
  const onHandle=(state.selectionPoints||[]).some(p=>Math.hypot(x-p.x,y-p.y)<12/state.zoom);
  const inside=x>=0&&y>=0&&x<canvas.width&&y<canvas.height&&state.selectionMask?.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data[3];
  if(!onHandle&&!inside)core.selectTool('rect');
},true);

function renderMessages(){
  const list=$('chatMessages');list.replaceChildren();
  for(const item of state.chatMessages||[]){
    const row=document.createElement('div');row.className='chat-message chat-message-'+item.role;
    const label=document.createElement('small');label.textContent=item.role==='user'?'You':'mozAI';row.append(label);
    const body=document.createElement('p');body.textContent=item.text;row.append(body);
    if(item.image){
      const b=document.createElement('button'),img=document.createElement('img');b.type='button';b.className='chat-result-thumbnail';
      const scale=Math.min(1,300/item.image.width),thumb=makeCanvas(Math.max(1,Math.round(item.image.width*scale)),Math.max(1,Math.round(item.image.height*scale)));
      thumb.getContext('2d').drawImage(item.image,0,0,thumb.width,thumb.height);
      img.src=thumb.toDataURL('image/jpeg',.75);img.alt='Generated result. Click to select an area.';b.append(img);
      b.addEventListener('click',()=>{
        if(state.before||state.pendingSourceId||state.editingPatchId||window.MosaicSourceEditor?.isEditing()){toast('Finish the current edit before opening this result.');return}
        // Reopening history selects against the current collage.
        const underlay=core.composeApprovedCanvas();
        showResult(item.image,item.text,underlay);
      });row.append(b);
    }
    list.append(row);
  }
  list.scrollTop=list.scrollHeight;
}
$('chatToggle').addEventListener('click',()=>{
  const open=$('chatBody').hidden;$('chatBody').hidden=!open;$('chatToggle').setAttribute('aria-expanded',String(open));
  $('chatToggle').lastElementChild.textContent=open?'−':'＋';
  if(open)$('compositionChatPrompt').focus();
});
async function submitChat(event){
  event?.preventDefault();if(job)return;
  const prompt=$('compositionChatPrompt').value.trim();if(!prompt)return;
  if(!state.master){toast('Upload Base or Master first.');return}
  if(state.pendingSourceId||state.editingPatchId||state.before||premium.isPreviewing()||window.MosaicSourceEditor?.isEditing()){
    toast('Finish the current edit and return to the collage before generating.');return;
  }
  if([...state.patches.values()].some(p=>p.generating||p.awaitingResult)){toast('Wait for the current region generation to finish.');return}
  setMarkupTool(null);core.hideQuickPrompt();
  const source=visibleImage({annotations:false}),underlay=state.chatResult?.underlay||clone(source);
  const notes=[...(state.markups||[])],annotated=notes.length&&!state.chatResult?clone(source):null;
  if(annotated)drawMarkups(annotated.getContext('2d'));
  const files=references.getFiles(),requestEpoch=epoch,token={};job=token;
  state.chatMessages.push({role:'user',text:prompt+(files.length?` · ${files.length} reference image(s)`:'')});renderMessages();
  $('chatGenerate').disabled=true;$('chatGenerate').textContent='Generating…';$('chatStatus').textContent='Generating from the latest collage…';
  const previousBusy=state.busy;state.busy=true;
  try{
    const image=await premium.generateComposition(prompt,files,source,annotated);
    if(requestEpoch!==epoch)return;
    state.chatMessages.push({role:'assistant',text:prompt,image});renderMessages();
    references.clear();$('compositionChatPrompt').value='';
    showResult(image,prompt,underlay,notes);
    $('chatStatus').textContent='Result ready. Select an area on the canvas and click Done.';
  }catch(error){
    if(requestEpoch===epoch){$('chatStatus').textContent=error.message;state.chatMessages.push({role:'assistant',text:'Generation failed: '+error.message});renderMessages();toast(error.message)}
  }finally{
    if(job===token){job=null;state.busy=previousBusy;$('chatGenerate').disabled=false;$('chatGenerate').textContent='Generate ↗'}
  }
}
$('compositionChatForm').addEventListener('submit',submitChat);
$('compositionChatPrompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('compositionChatForm').requestSubmit()}});
const isTyping=e=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]');
window.addEventListener('keydown',e=>{
  if(isTyping(e))return;
  const key=e.key.toLowerCase(),modifier=e.ctrlKey||e.metaKey;
  if(state.chatResult&&!modifier&&(e.code==='Space'||key==='r')){e.preventDefault();e.stopImmediatePropagation();peekKeys.add(e.code);render();return}
  if(e.key==='Escape'&&markupTool){e.preventDefault();e.stopImmediatePropagation();setMarkupTool(null);return}
  if(e.key==='Enter'&&state.chatResult&&!state.lasso.length){e.preventDefault();e.stopImmediatePropagation();$('resultDone').click();return}
  if(modifier&&key==='c'&&state.master&&!window.getSelection()?.toString()&&state.selectionMask&&core.maskBoundingBox(state.selectionMask)){
    e.preventDefault();e.stopImmediatePropagation();copySelection();
  }
  if(modifier&&key==='v'&&clipboard){e.preventDefault();e.stopImmediatePropagation();pasteSelection()}
},true);
window.addEventListener('keyup',e=>{if(peekKeys.delete(e.code))render()},true);
window.addEventListener('blur',()=>{if(peekKeys.size){peekKeys.clear();render()}});
function reset(){
  epoch++;if(job)state.busy=false;job=null;peekKeys.clear();markupTool=null;draft=null;clipboard=null;
  state.markups=[];state.chatMessages=[];state.chatResult=null;
  ink.classList.remove('is-drawing');references.clear();
  $('compositionChatPrompt').value='';$('chatStatus').textContent='';$('chatGenerate').disabled=false;$('chatGenerate').textContent='Generate ↗';
  renderMessages();setMarkupTool(null);
}
window.addEventListener('mosaic:projectloaded',()=>{renderMessages();drawOverlay();if(state.chatResult)core.hideQuickPrompt()});
new ResizeObserver(()=>{if(state.master&&Math.abs(state.zoom-state.fitZoom)<.001)requestAnimationFrame(()=>core.updateZoomFit())}).observe(viewport);
window.MosaicWorkspace={visibleImage,isSelectingResult,drawResult,drawOverlay,restoreHistory,reset,copySelection,pasteSelection,showResult};
drawOverlay();
