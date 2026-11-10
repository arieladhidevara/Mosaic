/* Run with tests/browser-runner.py against tests/mock-openai.cjs only. */
window.runMarkupEditingChecks=async function(){
  const core=window.MosaicCore,workspace=window.MosaicWorkspace,{state,canvas,makeCanvas}=core,$=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const at=(target,type,x,y)=>{const r=target.getBoundingClientRect();target.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:55,pointerType:'mouse',clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height}))};
  const drag=(target,a,b)=>{at(target,'pointerdown',...a);at(target,'pointermove',...b);at(target,'pointerup',...b)};
  const key=(key,extra={})=>document.body.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key,...extra}));
  const typeText=text=>{const editor=$('markupTextEditor');editor.value=text;editor.dispatchEvent(new Event('input'));editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))};
  const originalCapture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=()=>{};
  try{
    await window.MosaicAccount.ready();document.querySelector('[data-enter-guest]').click();for(const d of document.querySelectorAll('dialog[open]'))d.close();
    const image=makeCanvas(800,500),ctx=image.getContext('2d');ctx.fillStyle='#242735';ctx.fillRect(0,0,800,500);core.setMaster(image,'Markup editing');
    await new Promise(resolve=>requestAnimationFrame(resolve));core.updateZoomFit();
    assert($('markupToolbar').hidden,'Markup toolbar should start hidden');
    assert($('markupColor').value==='#b493f5','Default markup color is not purple');
    $('markupModeButton').click();assert(!$('markupToolbar').hidden&&$('markupModeButton').getAttribute('aria-pressed')==='true','Markup mode did not open');
    document.querySelector('[data-markup="text"]').click();const ink=$('markupCanvas');
    at(ink,'pointerdown',80,70);at(ink,'pointerup',80,70);
    const created=state.markups[0];
    assert(created?.type==='text'&&Math.abs(created.points[0].x-80)<.01&&Math.abs(created.points[0].y-70)<.01,'Text did not appear at the clicked point');
    assert(!$('markupTextEditor').hidden&&document.activeElement===$('markupTextEditor'),'Clicking Text did not open the on-canvas editor');
    typeText('Purple note');assert(state.markups[0].text==='Purple note'&&state.markups[0].color==='#b493f5','On-canvas typing or default color failed');
    checks.push('Markup tools stay hidden until Markup mode; Text appears and accepts typing at the clicked point in purple');

    document.querySelector('[data-tool="select"]').click();assert($('markupToolbar').hidden,'Select did not close the markup toolbar');
    const editorFont=created.fontSize,measure=ink.getContext('2d');measure.font=`600 ${editorFont}px system-ui, sans-serif`;
    const textWidth=measure.measureText('Purple note').width,textHeight=editorFont*1.25;
    drag(core.overlay,[85,75],[115,95]);
    assert(Math.abs(state.markups[0].transform.x-30)<.05&&Math.abs(state.markups[0].transform.y-20)<.05,'Select could not move a text markup');
    const corner=[110+textWidth,90+textHeight];
    drag(core.overlay,corner,[corner[0]+textWidth*.5,corner[1]+textHeight*.5]);
    assert(state.markups[0].transform.scaleX>1.45&&state.markups[0].transform.scaleY>1.45,'Bounding box did not enlarge text');
    const larger=state.markups[0].transform,largeCorner=[110+textWidth*larger.scaleX,90+textHeight*larger.scaleY];
    drag(core.overlay,largeCorner,[110+textWidth,90+textHeight]);
    assert(state.markups[0].transform.scaleX<larger.scaleX&&state.markups[0].transform.scaleY<larger.scaleY,'Bounding box did not shrink text');
    at(core.overlay,'dblclick',120,100);assert(!$('markupTextEditor').hidden,'Double-click did not edit existing text');typeText('Edited note');
    assert(state.markups.length===1&&state.markups[0].text==='Edited note','Text editing created a duplicate');
    key('z',{ctrlKey:true});assert(state.markups[0].text==='Purple note','Undo did not restore text');key('y',{ctrlKey:true});assert(state.markups[0].text==='Edited note','Redo did not restore text edit');
    checks.push('Select moves text; bounding-box handles enlarge and shrink it; double-click edits text with undo/redo');

    for(const [index,tool] of ['line','rect','ellipse','freehand','arrow'].entries()){
      $('markupModeButton').click();document.querySelector(`[data-markup="${tool}"]`).click();$('markupText').value='';
      const x=60+index*130,y=250;drag(ink,[x,y],[x+80,y+70]);const itemIndex=state.markups.length-1,item=state.markups[itemIndex];
      assert(item.type===tool,'Could not create '+tool);document.querySelector('[data-tool="select"]').click();
      drag(core.overlay,[x+40,y+35],[x+55,y+45]);assert(Math.abs(state.markups[itemIndex].transform.x-15)<.05,tool+' cannot move with Select');
      const padding=item.width/2,corner=[x+80+padding+15,y+70+padding+10];
      drag(core.overlay,corner,[corner[0]+24,corner[1]+20]);
      assert(state.markups[itemIndex].transform.scaleX>1.1&&state.markups[itemIndex].transform.scaleY>1.1,tool+' cannot resize with its bounding box');
    }
    checks.push('Select moves and resizes line, box, oval, freehand and arrow markups');

    const last=state.markups.at(-1),before=JSON.stringify(last),history=state.undo.length;
    at(core.overlay,'pointerdown',last.points[0].x+45,last.points[0].y+40);at(core.overlay,'pointermove',last.points[0].x+65,last.points[0].y+55);at(core.overlay,'pointercancel',last.points[0].x+65,last.points[0].y+55);
    assert(JSON.stringify(state.markups.at(-1))===before&&state.undo.length===history,'Cancelled transform changed markup or history');
    key('Delete');assert(state.markups.length===5,'Delete did not remove selected markup');key('z',{ctrlKey:true});assert(state.markups.length===6,'Undo did not restore deleted markup');
    const exported=workspace.visibleImage(),plain=workspace.visibleImage({annotations:false});assert(exported.toDataURL()!==plain.toDataURL(),'Transformed markup is missing from export');
    checks.push('Cancelled transforms preserve markup; Delete and Undo work; export includes transformed annotations');

    const bar=$('compositionChat'),row=$('compositionChatForm').querySelector('.chat-prompt-row'),bounds=bar.getBoundingClientRect();
    assert(bar.closest('.workspace-dock')&&bar.textContent.includes('AI Edit Full Image')&&!$('chatToggle')&&!$('chatMessages'),'Full-image editor is not the compact bottom bar');
    assert(row.querySelector('textarea')&&row.querySelector('.region-reference-button')&&row.querySelector('[type=submit]'),'Full-image bar is missing prompt, + or Generate');
    assert(bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight&&row.getBoundingClientRect().height<90,'Full-image bar overflows the viewport');
    const label=bar.querySelector('.full-image-label').getBoundingClientRect();
    assert(label.width>0&&label.left>=core.overlay.closest('#viewport').getBoundingClientRect().left,'Full-image label is hidden under the tool rail');
    assert(!document.activeElement.closest('input,textarea'),'Text edit left a hidden input focused');
    checks.push('AI Edit Full Image has one prompt row, reference + and Generate, and fits the viewport');
    return {passed:checks.length,checks,viewport:{width:innerWidth,height:innerHeight}};
  }finally{Element.prototype.setPointerCapture=originalCapture}
};

window.runCanvasWorkspaceChecks=async function(){
  const core=window.MosaicCore,workspace=window.MosaicWorkspace,{state,canvas,overlay,makeCanvas}=core;
  const $=id=>document.getElementById(id),checks=[],requests=[];
  const assert=(v,msg)=>{if(!v)throw Error(msg)};
  const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+label)};
  const frame=(color,w=800,h=500)=>{const c=makeCanvas(w,h),t=c.getContext('2d');t.fillStyle=color;t.fillRect(0,0,w,h);return c};
  const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const oldCapture=Element.prototype.setPointerCapture,oldFetch=window.fetch,oldConfirm=window.confirm;
  Element.prototype.setPointerCapture=()=>{};
  window.confirm=()=>true;
  window.fetch=async(url,options)=>{
    if(String(url)==='/api/ai/harmonize'&&options?.body)requests.push(JSON.parse(options.body));
    return oldFetch(url,options);
  };
  const at=(target,type,x,y)=>{
    const r=target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:41,pointerType:'mouse',clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height}));
  };
  const drag=(target,a,b)=>{at(target,'pointerdown',...a);at(target,'pointermove',...b);at(target,'pointerup',...b)};
  const key=(key,extra={},type='keydown')=>document.body.dispatchEvent(new KeyboardEvent(type,{bubbles:true,key,...extra}));
  const selectRect=()=>{core.selectTool('rect');drag(overlay,[100,100],[400,300])};
  const download=async(fn)=>{
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let captured;
    URL.createObjectURL=blob=>{captured=blob;return create(blob)};HTMLAnchorElement.prototype.click=()=>{};
    try{await fn();await wait(()=>Boolean(captured),'download');return captured}
    finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
  };
  const pngCanvas=async blob=>{const image=await createImageBitmap(blob),c=makeCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);image.close();return c};
  try{
    assert(workspace,'Workspace module did not initialize');
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();
    await wait(()=>$('apiKeyDialog').open,'key setup');$('apiKeyInput').value='sk-mozai-composition-validation';$('apiKeyForm').requestSubmit();
    await wait(()=>window.MosaicAuth.isReady(),'test key');
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    state.reference=frame('#334455');core.setMaster(frame('#224488'),'Collage workspace');
    await new Promise(r=>requestAnimationFrame(r));core.updateZoomFit();
    assert($('markupToolbar')&&$('markupToolbar').hidden,'Markup tools should stay hidden until Markup mode');
    $('markupModeButton').click();assert(!$('markupToolbar').hidden,'Markup mode did not reveal the tools');
    assert($('markupToolbar').getBoundingClientRect().top>canvas.getBoundingClientRect().top,'Markup toolbar must be below canvas');
    const ink=$('markupCanvas');
    for(const tool of ['line','rect','ellipse','freehand','text','arrow']){
      $('markupText').value='Warm walnut here';document.querySelector(`[data-markup="${tool}"]`).click();
      if(tool==='text'){
        at(ink,'pointerdown',110,160);at(ink,'pointerup',110,160);
        $('markupTextEditor').value='Warm walnut here';$('markupTextEditor').dispatchEvent(new Event('input'));$('markupTextEditor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      }else drag(ink,[110,160],[240,240]);
      assert(state.markups.at(-1).type===tool,tool+' markup did not commit');
    }
    $('markupExit').click();assert(state.markups.length===6,'Markup count');
    key('z',{ctrlKey:true});assert(state.markups.length===5,'Markup undo');
    key('y',{ctrlKey:true});assert(state.markups.length===6,'Markup redo');
    checks.push('Bottom toolbar: line, box, oval, freehand, text and arrow labels; undo/redo');
    const withInk=workspace.visibleImage(),plain=workspace.visibleImage({annotations:false});
    assert(withInk.toDataURL()!==plain.toDataURL(),'Markup omitted from visible PNG');
    const blob=await download(()=>{$('exportBtn').click()});
    assert(equals((await pngCanvas(blob)).toDataURL(),workspace.visibleImage().toDataURL()),'Export differs from visible annotated canvas');
    checks.push('Save Image exports visible image and markup at original pixel dimensions');
    const source={id:core.uid('pending'),name:'Pending',canvas:frame('#dd9911')};state.sources.set(source.id,source);state.pendingSourceId=source.id;core.render();
    const pending=workspace.visibleImage({annotations:false});
    assert(!equals(pixel(pending,10,10),pixel(state.master,10,10)),'Pending image was omitted');
    const pendingBlob=await download(()=>{$('exportBtn').click()});
    assert(equals((await pngCanvas(pendingBlob)).toDataURL(),workspace.visibleImage().toDataURL()),'PNG omitted visible pending layer');
    state.pendingSourceId=null;state.sources.delete(source.id);core.render();
    checks.push('Save Image includes an uploaded image currently shown in the viewport');

    // Irregular pixels stay transparent outside the mask and editable on paste.
    core.selectTool('lasso');state.lasso=[{x:100,y:100},{x:350,y:120},{x:160,y:320}];core.updateMaskWithLasso();core.hideQuickPrompt();
    const count=state.patches.size;
    key('c',{ctrlKey:true});key('v',{ctrlKey:true});
    assert(state.patches.size===count+1,'Keyboard copy/paste did not create a layer');
    const patch=state.patches.get(state.selectedPatchId),copied=state.sources.get(patch.sourceId).canvas;
    assert(pixel(copied,20,20)[3]===0,'Copied pixels outside selection are opaque');
    assert(pixel(copied,170,160)[3]===255,'Selected pixels were not copied');
    assert(state.tool==='transform','Paste did not enable transform handles');
    const before=JSON.stringify(patch.corners);
    drag(overlay,[patch.corners[0].x,patch.corners[0].y],[patch.corners[0].x+30,patch.corners[0].y+15]);
    assert(JSON.stringify(patch.corners)!==before,'Pasted layer cannot be skewed');
    assert(pixel(core.renderedPatchLayer(patch),20,20)[3]===0,'Skew filled transparent area');
    checks.push('Ctrl+C/V copies exact irregular mask pixels; pasted layer moves and skews');
    key('z',{ctrlKey:true});key('z',{ctrlKey:true});
    assert(!state.patches.has(patch.id),'Undo did not remove pasted layer');
    key('y',{ctrlKey:true});assert(state.patches.has(patch.id),'Redo did not restore pasted layer');
    checks.push('Pasted layer creation and transforms participate in undo/redo');

    core.resetSelection();core.selectTool('select');core.render();
    $('compositionChatPrompt').value='Apply warm walnut material while keeping Base geometry';
    const refFile=await new Promise(r=>frame('#b58c58',256,256).toBlob(b=>r(new File([b],'walnut-reference.png',{type:'image/png'}))));
    const transfer=new DataTransfer();transfer.items.add(refFile);
    const refInput=$('compositionChatForm').querySelector('input[type=file]');refInput.files=transfer.files;refInput.dispatchEvent(new Event('change'));
    const submitted=workspace.visibleImage({annotations:false}).toDataURL();
    $('compositionChatForm').requestSubmit();await wait(()=>Boolean(state.chatResult),'chat result');
    const payload=requests.at(-1);
    assert(payload.mode==='chat'&&payload.base&&payload.collage&&payload.markup,'Chat omitted collage, Base or markup');
    assert(payload.references.length===1,'Chat omitted reference');
    assert(!('apiKey' in payload),'Request exposed a key');
    assert(state.chatResult.underlay.toDataURL()===submitted,'Chat did not snapshot latest collage');
    assert(pixel(workspace.visibleImage(),50,50)[0]===255,'Result was not displayed');
    assert(!$('resultControls').hidden,'Selection controls missing');
    assert($('resultShadeCanvas').getContext('2d').getImageData(10,10,1,1).data[3]>0,'Result tint missing');
    checks.push('Chat → authenticated API → mock provider → canvas; latest collage, Base, markup and references sent');
    key(' ',{code:'Space'});assert(equals(pixel(canvas,50,50),pixel(state.chatResult.underlay,50,50)),'Space did not reveal behind');
    key(' ',{code:'Space'},'keyup');assert(pixel(canvas,50,50)[0]===255,'Space release did not restore result');
    key('r',{code:'KeyR'});assert(equals(pixel(canvas,50,50),pixel(state.chatResult.underlay,50,50)),'R did not reveal behind');
    window.dispatchEvent(new Event('blur'));assert(pixel(canvas,50,50)[0]===255,'Blur left result in peek mode');
    checks.push('Hold Space / R to peek; release or blur restores generated image');
    const groups=state.groups.length;selectRect();
    assert(state.groups.length===groups,'Result selection created an unwanted Group');
    assert($('quickAreaPromptForm').classList.contains('hidden'),'Result selection opened old regional prompt');
    const tint=$('resultShadeCanvas').getContext('2d');
    assert(tint.getImageData(150,150,1,1).data[3]===0&&tint.getImageData(10,10,1,1).data[3]>0,'Tint did not follow selection');
    const resultPNG=await download(()=>{$('exportBtn').click()});
    assert(equals(pixel(await pngCanvas(resultPNG),10,10),[255,0,0,255]),'Save exported old collage instead of generated result');
    checks.push('Result rectangle selection changes tint, skips AI popup, and saves latest generated image');

    // Round-trip while a generated image is waiting for selection.
    const savedBlob=await download(()=>window.MosaicProjects.saveProject());
    const saved=JSON.parse(await savedBlob.text());
    assert(saved.state.markups.length===6&&saved.state.chatResult&&saved.state.chatMessages.length===2,'Project omitted workspace state');
    assert(!JSON.stringify(saved).includes('sk-mozai-composition-validation'),'Project contains API key');
    await window.MosaicProjects.loadProjectFile(new File([savedBlob],'collage.moz',{type:'application/json'}));
    assert(state.chatResult&&state.markups.length===6&&state.chatMessages.length===2,'Workspace round trip failed');
    checks.push('Project saves/restores markup, chat images, selection and uncommitted result without credentials');
    const oldCount=state.patches.size;
    $('resultDone').click();
    assert(!state.chatResult&&state.patches.size===oldCount+1,'Done did not take selection');
    const donePatch=state.patches.get(state.selectedPatchId);
    assert(state.tool==='transform'&&donePatch.name==='Chat selection','Done did not create editable layer');
    assert(pixel(core.renderedPatchLayer(donePatch),10,10)[3]===0,'Done kept whole generated image');
    assert(pixel(core.renderedPatchLayer(donePatch),150,150)[0]===255,'Done omitted chosen area');
    checks.push('Done keeps only selected generated pixels as a movable/skewable layer');

    const latest=workspace.visibleImage({annotations:false});workspace.showResult(frame('#ee2211'),'Second result',latest);
    core.selectTool('ellipse');drag(overlay,[200,100],[500,350]);
    key('c',{ctrlKey:true});key('v',{ctrlKey:true});
    assert(!state.chatResult&&state.tool==='transform','Generated result Ctrl+C/V failed');
    const oval=state.patches.get(state.selectedPatchId);
    assert(pixel(state.sources.get(oval.sourceId).canvas,200,100)[3]===0,'Oval clipboard copied its bounding box');
    checks.push('Generated oval mask copies/pastes with transparency, then exposes transform handles');
    workspace.showResult(frame('#ee2211'),'Freehand',latest);
    core.selectTool('lasso');at(overlay,'pointerdown',100,100);at(overlay,'pointermove',300,100);at(overlay,'pointermove',320,250);at(overlay,'pointermove',120,300);at(overlay,'pointerup',100,100);
    assert(core.exactMaskBoundingBox(state.selectionMask),'Freehand drag did not close into a selection');
    $('resultCancel').click();assert(!state.chatResult,'Cancel left a result active');
    checks.push('Freehand selection closes on pointer release; Cancel restores collage');
    assert(!$('chatToggle')&&!$('chatMessages'),'Full-image edit should only show the compact prompt bar');
    assert($('compositionChat').closest('.workspace-dock')&&$('compositionChat').textContent.includes('AI Edit Full Image'),'Full-image edit bar is not in the bottom dock');
    checks.push('AI Edit Full Image stays in the bottom dock with prompt, reference button and Generate');
    const panel=$('compositionChat').getBoundingClientRect();
    assert(panel.left>=0&&panel.right<=innerWidth&&panel.top>=0&&panel.bottom<=innerHeight,'Chat is outside the window');
    return {passed:checks.length,checks,requests:requests.length,viewport:{width:innerWidth,height:innerHeight}};
  }finally{Element.prototype.setPointerCapture=oldCapture;window.fetch=oldFetch;window.confirm=oldConfirm}
};

window.runCanvasWorkspaceFailureChecks=async function(){
  const core=window.MosaicCore,workspace=window.MosaicWorkspace,premium=window.MosaicPremium,{state,canvas,makeCanvas}=core;
  const $=id=>document.getElementById(id),checks=[],nativeFetch=window.fetch;
  const assert=(v,msg)=>{if(!v)throw Error(msg)};
  const wait=async(fn)=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out')};
  const frame=color=>{const c=makeCanvas(400,300),t=c.getContext('2d');t.fillStyle=color;t.fillRect(0,0,400,300);return c};
  const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  try{
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();await wait(()=>$('apiKeyDialog').open);
    $('apiKeyInput').value='sk-mozai-failure-validation';$('apiKeyForm').requestSubmit();await wait(()=>window.MosaicAuth.isReady());
    for(const d of document.querySelectorAll('dialog[open]'))d.close();
    state.reference=frame('#ff0000');core.setMaster(frame('#0000ff'),'Export views');
    core.toggleComparison(true);
    const compared=workspace.visibleImage();
    assert(pixel(compared,10,10)[0]===255&&pixel(compared,390,10)[2]===255,'Save snapshot omitted comparison split');
    core.toggleComparison(false);checks.push('Save snapshot matches the visible Base/latest comparison');
    window.MosaicSourceEditor.open('master');
    assert(window.MosaicSourceEditor.isEditing(),'Source editor did not open');
    const preview=workspace.visibleImage();
    assert(preview.toDataURL()!==canvas.toDataURL(),'Save snapshot omitted source-editor ghost');
    assert(pixel(preview,200,150)[2]>0&&pixel(preview,200,150)[0]>0,'Source editor snapshot failed to blend current image');
    window.MosaicSourceEditor.cancel();checks.push('Save snapshot includes source-editor position/opacity preview without handles');
    const saved=premium.exportProjectState();
    premium.restoreProjectState({...saved,root:{id:'archive-test',base:frame('#00ff00'),groups:[],patches:new Map(),sources:new Map(),parent:null},previewNode:'archive-test'});core.render();
    assert(pixel(workspace.visibleImage(),200,150)[1]===255,'Save snapshot omitted archive preview');
    premium.restoreProjectState(saved);core.render();checks.push('Save snapshot follows the currently displayed archive image');
    $('compositionChatPrompt').value='Test generation failure';
    const before=canvas.toDataURL();
    window.fetch=async(url,options)=>String(url)==='/api/ai/harmonize'?Response.json({error:'Simulated provider failure'},{status:429}):nativeFetch(url,options);
    $('compositionChatForm').requestSubmit();await wait(()=>$('chatStatus').textContent.includes('Simulated provider failure'));
    assert(!state.chatResult&&canvas.toDataURL()===before&&!state.busy&&!$('chatGenerate').disabled,'Failed generation changed collage or locked retry');
    checks.push('Provider failure leaves collage intact and re-enables Generate for retry');
    let release,received=false,completed=false;const gate=new Promise(r=>{release=r});
    window.fetch=async(url,options)=>{
      const response=await nativeFetch(url,options);
      if(String(url)==='/api/ai/harmonize'){received=true;await gate;completed=true}
      return response;
    };
    $('compositionChatPrompt').value='Test stale result';$('compositionChatForm').requestSubmit();await wait(()=>received);
    const replacement=frame('#118833');core.setMaster(replacement,'New project during generation');release();await wait(()=>completed);
    await new Promise(r=>setTimeout(r,120));
    assert(state.master===replacement&&!state.chatResult&&!state.busy&&!$('chatGenerate').disabled,'Stale result overwrote new project');
    checks.push('Loading a new project during generation discards stale results and clears request UI');
    return {passed:checks.length,checks};
  }finally{window.fetch=nativeFetch}
};
