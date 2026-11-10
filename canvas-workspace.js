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
let markupMode=false,markupTool=null,draft=null,selectedMarkup=-1,markupDrag=null,textSession=null,clipboard=null,job=null,epoch=0;
const peekKeys=new Set();
const markupModeButton=document.createElement('button');
markupModeButton.id='markupModeButton';markupModeButton.type='button';markupModeButton.className='tool';markupModeButton.setAttribute('aria-pressed','false');markupModeButton.setAttribute('aria-controls','markupToolbar');markupModeButton.title='Markup mode';markupModeButton.innerHTML='✎ <span>Markup</span>';markupModeButton.hidden=true;markupModeButton.disabled=true;
document.querySelector('.layer-toolset').append(markupModeButton);
const textEditor=document.createElement('textarea');
textEditor.id='markupTextEditor';textEditor.className='markup-text-editor';textEditor.hidden=true;textEditor.maxLength=180;textEditor.setAttribute('aria-label','Edit markup text');textEditor.spellcheck=false;wrap.append(textEditor);

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
  <div id="markupToolbar" class="markup-toolbar" role="toolbar" aria-label="Markup tools" hidden>
    <span class="workspace-dock-label">Markup</span>
    <button type="button" data-markup="select" aria-pressed="false" title="Select, move or resize markup">↖ <span>Select</span></button>
    <button type="button" data-markup="arrow" aria-pressed="false" title="Draw an arrow with a text label">↗ <span>Arrow + text</span></button>
    <button type="button" data-markup="text" aria-pressed="false">T <span>Text</span></button>
    <button type="button" data-markup="line" aria-pressed="false">╱ <span>Line</span></button>
    <button type="button" data-markup="rect" aria-pressed="false">▭ <span>Box</span></button>
    <button type="button" data-markup="ellipse" aria-pressed="false">◯ <span>Oval</span></button>
    <button type="button" data-markup="freehand" aria-pressed="false">〰 <span>Freehand</span></button>
    <input id="markupColor" type="color" value="#b493f5" aria-label="Markup color" title="Markup color"/>
    <label class="markup-width">Size <input id="markupWidth" type="range" min="1" max="12" value="3" aria-label="Markup stroke width"/></label>
    <input id="markupText" type="text" maxlength="180" placeholder="Arrow label…" aria-label="Arrow label" hidden/>
    <button id="markupClear" type="button" title="Clear markup">Clear</button>
    <button id="markupExit" type="button">Done</button>
  </div>`;
document.querySelector('.canvas-foot').before(dock);

const chat=document.createElement('aside');
chat.id='compositionChat';chat.className='composition-chat';chat.setAttribute('aria-label','AI Edit');
chat.innerHTML=`
    <form id="compositionChatForm" autocomplete="off">
      <label class="full-image-label" for="compositionChatPrompt">AI Edit</label>
      <div class="chat-prompt-row"><textarea id="compositionChatPrompt" rows="1" maxlength="6000" placeholder="Change all tables to red…" aria-label="Prompt for the full image" required></textarea><button type="button" class="prompt-add-reference region-reference-button" aria-label="Attach reference images" title="Add up to 3 image references">+</button><button id="chatGenerate" type="submit" class="workspace-accent">Generate ↗</button></div>
      <input class="region-reference-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden/>
      <div class="region-inline-previews reference-previews"></div>
    </form>
    <p id="chatStatus" class="chat-status" role="status"></p>`;
dock.append(chat);
const references=premium.bindInlineReferencePrompt($('compositionChatForm'));

function canEditMarkup(){return Boolean(state.master&&!state.before&&!state.chatResult&&!state.pendingSourceId&&!state.editingPatchId&&!state.busy&&!premium.isPreviewing()&&!window.MosaicSourceEditor?.isEditing())}
function setMarkupMode(active){
  if(active&&!canEditMarkup()){toast('Return to the current canvas to add markup.');return}
  finishTextEdit();markupMode=active;markupTool=active?'select':null;draft=null;selectedMarkup=-1;markupDrag=null;
  if(active){core.hideQuickPrompt();core.selectTool('select')}
  drawOverlay();
}
function setMarkupTool(tool){
  if(!canEditMarkup()){toast('Return to the current canvas to add markup.');return}
  finishTextEdit();markupMode=true;markupTool=tool;draft=null;selectedMarkup=-1;core.hideQuickPrompt();core.selectTool('select');drawOverlay();
}
function updateMarkupControls(){
  ink.classList.toggle('is-drawing',markupMode);ink.classList.toggle('is-selecting',markupMode&&markupTool==='select');
  markupModeButton.classList.toggle('active',markupMode);markupModeButton.setAttribute('aria-pressed',String(markupMode));
  $('markupText').hidden=markupTool!=='arrow';
  for(const b of dock.querySelectorAll('[data-markup]'))b.setAttribute('aria-pressed',String(markupMode&&b.dataset.markup===markupTool));
  if(state.tool==='select'){const select=document.querySelector('[data-tool="select"]');select.classList.toggle('active',!markupMode);select.setAttribute('aria-pressed',String(!markupMode))}
}
function addHistory(entry){state.undo.push(entry);if(state.undo.length>12)state.undo.shift();state.redo=[]}
function restoreHistory(entry,to){
  if(entry.type==='markup'){
    to.push({type:'markup',markups:state.markups});state.markups=entry.markups;selectedMarkup=-1;markupDrag=null;return true;
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
  if(item.transform){const t=item.transform;target.transform(t.scaleX,0,0,t.scaleY,t.x,t.y)}
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
    const font=item.fontSize||Math.max(16,item.width*5),x=item.type==='text'?a.x:a.x+8,y=item.type==='text'?a.y:a.y-8-font;
    target.font=`600 ${font}px system-ui, sans-serif`;target.textBaseline='top';
    if(item.type!=='text'){const w=target.measureText(item.text).width;target.fillStyle='rgba(12,14,18,.8)';target.fillRect(x-5,y-3,w+10,font+8)}
    target.fillStyle=item.color;item.text.split('\n').forEach((line,index)=>target.fillText(line,x,y+index*font*1.25));
  }
  target.restore();
}
function drawMarkups(target){for(const item of state.markups||[])drawMark(target,item)}
function markBounds(item,transformed=true){
  const points=item.points;if(!points?.length)return null;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),a=points[0],padding=item.type==='text'?0:(item.width||1)/2;
  let x=Math.min(...xs)-padding,y=Math.min(...ys)-padding,right=Math.max(...xs)+padding,bottom=Math.max(...ys)+padding;
  if(item.text){
    const font=item.fontSize||Math.max(16,item.width*5),ctx=ink.getContext('2d');ctx.font=`600 ${font}px system-ui, sans-serif`;
    const tx=item.type==='text'?a.x:a.x+8,ty=item.type==='text'?a.y:a.y-8-font,lines=item.text.split('\n');
    const tw=Math.max(font*.65,...lines.map(line=>ctx.measureText(line).width)),th=lines.length*font*1.25;
    if(item.type==='text'){x=tx;y=ty;right=tx+tw;bottom=ty+th}
    else{x=Math.min(x,tx-5);y=Math.min(y,ty-3);right=Math.max(right,tx+tw+5);bottom=Math.max(bottom,ty+th+5)}
  }
  const t=transformed&&item.transform||{x:0,y:0,scaleX:1,scaleY:1};
  return {x:x*t.scaleX+t.x,y:y*t.scaleY+t.y,w:Math.max(1,(right-x)*t.scaleX),h:Math.max(1,(bottom-y)*t.scaleY)};
}
const handles=box=>[['nw',box.x,box.y],['n',box.x+box.w/2,box.y],['ne',box.x+box.w,box.y],['e',box.x+box.w,box.y+box.h/2],['se',box.x+box.w,box.y+box.h],['s',box.x+box.w/2,box.y+box.h],['sw',box.x,box.y+box.h],['w',box.x,box.y+box.h/2]];
function drawMarkupSelection(target){
  const item=state.markups[selectedMarkup];if(!item||!canEditMarkup()||state.tool!=='select')return;
  const b=markBounds(item),z=canvas.width/Math.max(1,ink.getBoundingClientRect().width),size=7*z;
  target.save();target.strokeStyle='#b493f5';target.lineWidth=z;target.setLineDash([4*z,3*z]);target.strokeRect(b.x,b.y,b.w,b.h);target.setLineDash([]);
  for(const [,x,y] of handles(b)){target.fillStyle='#211c2c';target.fillRect(x-size/2,y-size/2,size,size);target.strokeRect(x-size/2,y-size/2,size,size)}
  target.restore();
}
function positionTextEditor(){
  if(!textSession)return;
  const item=state.markups[textSession.index];if(!item)return;
  const t=item.transform||{x:0,y:0,scaleX:1,scaleY:1},b=markBounds(item,false),sx=wrap.clientWidth/canvas.width,sy=wrap.clientHeight/canvas.height;
  Object.assign(textEditor.style,{left:(item.points[0].x*t.scaleX+t.x)*sx+'px',top:(item.points[0].y*t.scaleY+t.y)*sy+'px',width:Math.max(72,b.w+12)+'px',height:Math.max((item.fontSize||24)*1.25,b.h)+8+'px',fontSize:(item.fontSize||Math.max(16,item.width*5))+'px',color:item.color,transform:`scale(${sx*t.scaleX},${sy*t.scaleY})`});
}
function finishTextEdit(cancel=false){
  if(!textSession)return;
  const session=textSession;textSession=null;textEditor.hidden=true;
  if(cancel)state.markups=session.before;
  else{
    const item=state.markups[session.index];
    if(item&&!item.text.trim()){state.markups=state.markups.filter((_,index)=>index!==session.index);selectedMarkup=-1}
    if(JSON.stringify(state.markups)!==JSON.stringify(session.before))addHistory({type:'markup',markups:session.before});
  }
  drawOverlay();
}
function editMarkupText(index,before=state.markups){
  const item=state.markups[index];if(!item||item.type!=='text')return;
  textSession={index,before};selectedMarkup=index;textEditor.value=item.text||'';textEditor.hidden=false;positionTextEditor();textEditor.focus({preventScroll:true});textEditor.select();drawOverlay();
}
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
  if(state.tool!=='select'&&markupMode){markupMode=false;markupTool=null;selectedMarkup=-1;draft=null}
  $('markupToolbar').hidden=!state.master||result||!markupMode;
  dock.hidden=!state.master;chat.hidden=!state.master;
  updateMarkupControls();
  shade.hidden=!result||state.before||Boolean(peekKeys.size);
  ink.hidden=state.before||result;
  if(result&&!peekKeys.size){
    s.fillStyle='rgba(0,0,0,.20)';s.fillRect(0,0,shade.width,shade.height);
    if(state.selectionMask){s.globalCompositeOperation='destination-out';s.drawImage(state.selectionMask,0,0);s.globalCompositeOperation='source-over'}
  }
  if(!result){for(let index=0;index<state.markups.length;index++)if(textSession?.index!==index)drawMark(i,state.markups[index]);if(draft)drawMark(i,draft);drawMarkupSelection(i)}
  positionTextEditor();
  $('resultDone').disabled=!result||!state.selectionMask||!core.maskBoundingBox(state.selectionMask);
}
// Snapshot the image shown in the viewport. Editor handles, selection guides and
// the result-selection tint are UI; user-created markup belongs to the image.
function visibleImage({annotations=false}={}){
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
function markupHit(p){
  const tolerance=9/Math.max(.05,state.zoom),current=state.markups[selectedMarkup];
  if(current){const hit=handles(markBounds(current)).map(([handle,x,y])=>({handle,distance:Math.hypot(p.x-x,p.y-y)})).filter(hit=>hit.distance<=tolerance).sort((a,b)=>a.distance-b.distance)[0];if(hit)return {index:selectedMarkup,handle:hit.handle}}
  for(let index=state.markups.length-1;index>=0;index--){
    const item=state.markups[index],b=markBounds(item);
    if(p.x<b.x-tolerance||p.x>b.x+b.w+tolerance||p.y<b.y-tolerance||p.y>b.y+b.h+tolerance)continue;
    if(['text','rect','ellipse'].includes(item.type)||item.text)return {index,handle:'move'};
    const t=item.transform||{x:0,y:0,scaleX:1,scaleY:1},points=item.points.map(a=>({x:a.x*t.scaleX+t.x,y:a.y*t.scaleY+t.y}));
    for(let j=1;j<points.length;j++){
      const a=points[j-1],b=points[j],dx=b.x-a.x,dy=b.y-a.y,f=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      if(Math.hypot(p.x-a.x-f*dx,p.y-a.y-f*dy)<=tolerance+item.width/2)return {index,handle:'move'};
    }
  }
  return null;
}
function moveMarkup(p){
  const drag=markupDrag,{box,original,start,handle}=drag,dx=p.x-start.x,dy=p.y-start.y;
  let x=box.x,y=box.y,w=box.w,h=box.h;
  if(handle==='move'){x+=dx;y+=dy}
  else{
    const min=8/Math.max(.05,state.zoom);
    if(handle.includes('w')){x=Math.min(box.x+dx,box.x+box.w-min);w=box.x+box.w-x}
    if(handle.includes('e'))w=Math.max(min,box.w+dx);
    if(handle.includes('n')){y=Math.min(box.y+dy,box.y+box.h-min);h=box.y+box.h-y}
    if(handle.includes('s'))h=Math.max(min,box.h+dy);
  }
  const sx=w/box.w,sy=h/box.h,t=original.transform||{x:0,y:0,scaleX:1,scaleY:1};
  const item={...original,transform:{scaleX:t.scaleX*sx,scaleY:t.scaleY*sy,x:x+(t.x-box.x)*sx,y:y+(t.y-box.y)*sy}};
  state.markups=state.markups.map((mark,index)=>index===drag.index?item:mark);drag.changed=Math.abs(dx)+Math.abs(dy)>.1;drawOverlay();
}
const consume=e=>{e.preventDefault();e.stopImmediatePropagation()};
viewport.addEventListener('pointerdown',e=>{
  if(e.button!==0||!wrap.contains(e.target)||e.target.closest('input,textarea,button')||!canEditMarkup())return;
  if(!markupMode&&state.tool!=='select')return;
  finishTextEdit();const p=point(e);
  if(!markupMode||markupTool==='select'){
    const hit=markupHit(p);
    if(!hit){selectedMarkup=-1;drawOverlay();if(markupMode)consume(e);return}
    consume(e);ink.setPointerCapture(e.pointerId);selectedMarkup=hit.index;
    const original=state.markups[hit.index];markupDrag={...hit,pointerId:e.pointerId,start:p,original,box:markBounds(original),before:state.markups,changed:false};
    $('markupColor').value=original.color;core.hideQuickPrompt();drawOverlay();return;
  }
  consume(e);selectedMarkup=-1;
  if(markupTool==='text'){
    const before=state.markups,item={type:'text',points:[p],width:3/Math.max(.15,state.zoom),fontSize:24/Math.max(.15,state.zoom),color:$('markupColor').value,text:'Text'};
    state.markups=[...state.markups,item];editMarkupText(state.markups.length-1,before);return;
  }
  ink.setPointerCapture(e.pointerId);
  draft={type:markupTool,points:[p],width:Number($('markupWidth').value)/Math.max(.15,state.zoom),color:$('markupColor').value,text:markupTool==='arrow'?$('markupText').value.trim():''};
  draft.pointerId=e.pointerId;drawOverlay();
},true);
viewport.addEventListener('pointermove',e=>{
  if(markupDrag?.pointerId===e.pointerId){consume(e);moveMarkup(point(e));return}
  if(!draft||draft.pointerId!==e.pointerId)return;consume(e);const p=point(e);
  if(draft.type==='freehand')draft.points.push(p);else draft.points=[draft.points[0],p];drawOverlay();
},true);
function finishMarkupGesture(e,cancel=false){
  if(markupDrag?.pointerId===e.pointerId){
    consume(e);const drag=markupDrag;markupDrag=null;
    if(cancel)state.markups=drag.before;else if(drag.changed)addHistory({type:'markup',markups:drag.before});
  }else if(draft?.pointerId===e.pointerId){
    consume(e);
    if(!cancel){if(draft.type!=='freehand')draft.points=[draft.points[0],point(e)];if(draft.points.length>1){const {pointerId,...item}=draft;addHistory({type:'markup',markups:state.markups});state.markups=[...state.markups,item]}}
    draft=null;
  }else return;
  if(ink.hasPointerCapture(e.pointerId))ink.releasePointerCapture(e.pointerId);drawOverlay();
}
viewport.addEventListener('pointerup',e=>finishMarkupGesture(e),true);
viewport.addEventListener('pointercancel',e=>finishMarkupGesture(e,true),true);
viewport.addEventListener('dblclick',e=>{
  if(!canEditMarkup()||state.tool!=='select'||!wrap.contains(e.target)||e.target.closest('input,textarea,button'))return;
  const hit=markupHit(point(e));if(hit&&state.markups[hit.index].type==='text'){consume(e);finishTextEdit();editMarkupText(hit.index)}
},true);
textEditor.addEventListener('input',()=>{if(!textSession)return;state.markups=state.markups.map((item,index)=>index===textSession.index?{...item,text:textEditor.value}:item);drawOverlay()});
textEditor.addEventListener('blur',()=>finishTextEdit());
textEditor.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'||e.key==='Enter'&&!e.shiftKey){e.preventDefault();finishTextEdit(e.key==='Escape');viewport.focus({preventScroll:true})}});
for(const b of dock.querySelectorAll('[data-markup]'))b.addEventListener('click',()=>setMarkupTool(b.dataset.markup));
markupModeButton.addEventListener('click',()=>setMarkupMode(!markupMode));
$('markupExit').addEventListener('click',()=>setMarkupMode(false));
$('markupClear').addEventListener('click',()=>{finishTextEdit();if(!state.markups.length)return;addHistory({type:'markup',markups:state.markups});state.markups=[];draft=null;selectedMarkup=-1;drawOverlay()});
$('markupColor').addEventListener('change',()=>{if(selectedMarkup<0)return;addHistory({type:'markup',markups:state.markups});state.markups=state.markups.map((item,index)=>index===selectedMarkup?{...item,color:$('markupColor').value}:item);drawOverlay()});
for(const b of document.querySelectorAll('[data-tool]'))b.addEventListener('click',()=>{if(markupMode||textSession)setMarkupMode(false)});

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
  setMarkupMode(false);state.chatResult=null;peekKeys.clear();core.resetSelection();core.selectTool('select');render();
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
  setMarkupMode(false);state.before=false;core.resetSelection();
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

async function submitChat(event){
  event?.preventDefault();if(job)return;
  const prompt=$('compositionChatPrompt').value.trim();if(!prompt)return;
  if(!state.master){toast('Upload a Base image and choose Generate or Use Base first.');return;}
  if(state.pendingSourceId||state.editingPatchId||state.before||premium.isPreviewing()||window.MosaicSourceEditor?.isEditing()){
    toast('Finish the current edit before AI Edit.');return;
  }
  if([...state.patches.values()].some(p=>p.generating||p.awaitingResult)){
    toast('Finish the active region generation before AI Edit.');return;
  }
  setMarkupMode(false);core.hideQuickPrompt();
  const imageBefore=visibleImage({annotations:false}),files=references.getFiles(),requestEpoch=epoch,token={};job=token;
  state.chatMessages.push({role:'user',text:prompt,referenceCount:files.length});
  $('chatGenerate').disabled=true;$('chatGenerate').textContent='Generating…';
  $('chatStatus').textContent='Preparing full-image edit…';
  const wasBusy=state.busy;state.busy=true;
  try{
    if(!await window.MosaicAuth.ensure())throw Error('Connect AI before generating an edit.');
    // Full Image appearance editing keeps immutable original object IDs.
    // Its newly generated RGB is locally segmented and contour-aligned to
    // the saved masks without SAM or a replacement geometry map.
    const editedPrompt=prompt+'\n\nFULL IMAGE EDIT: Return one complete, coherent image at the same camera view. '+
      'Apply the requested changes and preserve all objects, geometry and materials not explicitly changed. '+
      'Existing object silhouettes and mask IDs must remain unchanged; new material pixels will be warped back to their original boundaries.';
    $('chatStatus').textContent='Generating the complete image…';
    const image=await premium.generateComposition(editedPrompt,files,imageBefore);
    if(requestEpoch!==epoch)return;
    const version=await window.MosaicSceneVersions.apply(image,{
      type:'ai-edit',prompt,onStatus:status=>$('chatStatus').textContent=status
    });
    if(requestEpoch!==epoch)return;
    state.chatMessages.push({role:'assistant',text:version.category,
      version:version.category,matched:version.matched,total:version.objectCount});
    references.clear();$('compositionChatPrompt').value='';
    core.resetSelection();
    $('chatStatus').textContent=version.category+' applied with '+
      version.objectCount+' locked object masks · '+version.matched+
      ' auto-aligned · no SAM 3';
    toast(version.category+' applied.');
  }catch(error){
    if(requestEpoch===epoch){
      $('chatStatus').textContent=error.message;
      state.chatMessages.push({role:'assistant',text:'Generation failed: '+error.message});
      toast(error.message);
    }
  }finally{
    if(job===token){job=null;state.busy=wasBusy;$('chatGenerate').disabled=false;
      $('chatGenerate').textContent='Generate ↗';}
  }
}
$('compositionChatForm').addEventListener('submit',submitChat);
$('compositionChatPrompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('compositionChatForm').requestSubmit()}});
const isTyping=e=>e.target?.closest?.('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]');
window.addEventListener('keydown',e=>{
  if(isTyping(e))return;
  const key=e.key.toLowerCase(),modifier=e.ctrlKey||e.metaKey;
  if(state.chatResult&&!modifier&&(e.code==='Space'||key==='r')){e.preventDefault();e.stopImmediatePropagation();peekKeys.add(e.code);render();return}
  if(e.key==='Escape'&&(markupMode||selectedMarkup>=0)){e.preventDefault();e.stopImmediatePropagation();setMarkupMode(false);return}
  if(['Delete','Backspace'].includes(e.key)&&selectedMarkup>=0&&canEditMarkup()){
    e.preventDefault();e.stopImmediatePropagation();addHistory({type:'markup',markups:state.markups});state.markups=state.markups.filter((_,index)=>index!==selectedMarkup);selectedMarkup=-1;drawOverlay();return;
  }
  if(e.key==='Enter'&&state.chatResult&&!state.lasso.length){e.preventDefault();e.stopImmediatePropagation();$('resultDone').click();return}
  if(modifier&&key==='c'&&state.master&&!window.getSelection()?.toString()&&state.selectionMask&&core.maskBoundingBox(state.selectionMask)){
    e.preventDefault();e.stopImmediatePropagation();copySelection();
  }
  if(modifier&&key==='v'&&clipboard){e.preventDefault();e.stopImmediatePropagation();pasteSelection()}
},true);
window.addEventListener('keyup',e=>{if(peekKeys.delete(e.code))render()},true);
window.addEventListener('blur',()=>{if(peekKeys.size){peekKeys.clear();render()}});
function reset(){
  epoch++;if(job)state.busy=false;job=null;peekKeys.clear();markupMode=false;markupTool=null;draft=null;selectedMarkup=-1;markupDrag=null;textSession=null;textEditor.hidden=true;clipboard=null;
  state.markups=[];state.chatMessages=[];state.chatResult=null;
  ink.classList.remove('is-drawing');references.clear();
  $('compositionChatPrompt').value='';$('chatStatus').textContent='';$('chatGenerate').disabled=false;$('chatGenerate').textContent='Generate ↗';
  $('markupColor').value='#b493f5';updateMarkupControls();
}
window.addEventListener('mosaic:projectloaded',()=>{markupMode=false;markupTool=null;selectedMarkup=-1;markupDrag=null;draft=null;textSession=null;textEditor.hidden=true;drawOverlay();if(state.chatResult)core.hideQuickPrompt()});
new ResizeObserver(()=>{if(state.master&&Math.abs(state.zoom-state.fitZoom)<.001)requestAnimationFrame(()=>core.updateZoomFit())}).observe(viewport);
window.MosaicWorkspace={visibleImage,isSelectingResult,drawResult,drawOverlay,restoreHistory,reset,copySelection,pasteSelection,showResult};
drawOverlay();
