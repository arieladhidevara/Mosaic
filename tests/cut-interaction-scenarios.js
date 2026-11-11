// Real editor pointer events, using an isolated local browser with fixture data.
window.runCutInteractionChecks=async function(){
  const core=window.MosaicCore,{state,canvas,overlay,makeCanvas}=core,cut=window.MosaicObjectCreateCut,checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message)};
  const capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=()=>{};
  const at=(type,x,y,extra={})=>{const r=overlay.getBoundingClientRect();overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerType:'mouse',pointerId:71,clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height,...extra}))};
  const click=(x,y)=>{at('pointerdown',x,y);at('pointerup',x,y)};
  const key=value=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true}));
  const setup=()=>{
    const frame=makeCanvas(500,400),x=frame.getContext('2d');x.fillStyle='#5080b0';x.fillRect(0,0,500,400);
    state.reference=frame;core.setMaster(frame,'Cut fixture',false);core.updateZoomFit();
    const mask=makeCanvas(500,400),m=mask.getContext('2d');m.fillStyle='#fff';m.fillRect(100,100,240,200);
    const group=core.newGroup(mask,'Furniture');group.name='Table';group.mapPrepared=true;
    core.selectGroupMask(group,{showOutline:true});core.selectTool('cut');return {group,mask};
  };
  const verify=({group,mask})=>{
    const children=state.groups.filter(g=>g.cutParentId===group.id);
    assert(children.length===2,'Cut must create exactly two object masks');
    const rgba=m=>m.getContext('2d').getImageData(0,0,500,400).data;
    const a=rgba(core.groupMask(children[0])),b=rgba(core.groupMask(children[1])),original=rgba(mask);
    for(let i=3;i<a.length;i+=4){assert(!(a[i]&&b[i]),'Cut masks overlap');assert(Boolean(a[i]||b[i])===Boolean(original[i]),'Cut lost or added object pixels')}
  };
  try{
    let fixture=setup(),before=core.composeApprovedCanvas().toDataURL();
    click(210,60);assert(cut.isCutting()&&!fixture.group.mergedInto,'First click committed the cut');
    assert(document.getElementById('cutStartPoint').style.display!=='none','The first clicked point is invisible');
    at('pointermove',350,200);at('pointermove',210,180);click(210,180);
    assert(cut.isCutting()&&!fixture.group.mergedInto,'Intermediate click committed the cut');
    click(210,340);click(210,340);overlay.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    verify(fixture);assert(!cut.isCutting()&&core.composeApprovedCanvas().toDataURL()===before,'Cut changed pixels or left a draft');
    checks.push('Click points stay pending, hover is preview-only, and double-click splits exactly once without changing pixels');
    fixture=setup();at('pointerdown',210,60);at('pointermove',200,130);at('pointermove',220,240);at('pointerup',210,340);verify(fixture);
    checks.push('Holding and dragging records freehand points and splits on release');
    for(const cancel of ['escape','tool','pointercancel','reset']){
      fixture=setup();click(210,60);click(210,340);
      if(cancel==='escape')key('Escape');else if(cancel==='tool')core.selectTool('select');else if(cancel==='reset')core.resetSelection();else at('pointercancel',210,340);
      assert(!cut.isCutting()&&!fixture.group.mergedInto,'Cancellation committed or retained the cut: '+cancel);
    }
    checks.push('Escape, tool change, pointer cancellation and selection reset discard an unfinished cut');
    fixture=setup();click(210,60);click(210,340);key('Enter');verify(fixture);
    checks.push('Enter also finishes a point-based cut');
    fixture=setup();click(210,60);at('pointermove',210,340);at('pointerup',210,340);
    assert(!fixture.group.mergedInto&&cut.isCutting(),'Hover or unrelated release cut an object');key('Escape');
    at('pointerdown',210,60,{pointerType:'touch',pointerId:99});at('pointerdown',210,150,{pointerType:'touch',pointerId:100});at('pointermove',210,220,{pointerType:'touch',pointerId:100});at('pointerup',210,340,{pointerType:'touch',pointerId:100});
    assert(!fixture.group.mergedInto&&cut.isCutting(),'Second touch changed the active cut');at('pointercancel',210,60,{pointerType:'touch',pointerId:99});
    checks.push('Released mouse movement and a different touch pointer cannot accidentally complete a cut');
    return {passed:checks.length,checks};
  }finally{cut.cancelCut();Element.prototype.setPointerCapture=capture}
};
