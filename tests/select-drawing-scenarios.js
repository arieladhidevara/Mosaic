// Isolated desktop browser regression for explicit Select vs Create drawings.
window.runSelectDrawingChecks=async function(){
  const core=window.MosaicCore,{state,canvas,overlay,makeCanvas}=core;
  const checks=[],assert=(ok,message)=>{if(!ok)throw Error(message)};
  const capture=Element.prototype.setPointerCapture,release=Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture=()=>{};Element.prototype.releasePointerCapture=()=>{};
  const pointer=(type,x,y)=>{
    const r=overlay.getBoundingClientRect();
    overlay.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerType:'mouse',pointerId:71,
      clientX:r.left+x/canvas.width*r.width,clientY:r.top+y/canvas.height*r.height}));
  };
  const draw=(x1,y1,x2,y2)=>{
    pointer('pointerdown',x1,y1);pointer('pointermove',x2,y2);pointer('pointerup',x2,y2);
  };
  const alpha=(x,y)=>state.selectionMask.getContext('2d').getImageData(x,y,1,1).data[3];
  try{
    const base=makeCanvas(640,480),ctx=base.getContext('2d');
    ctx.fillStyle='#dfd5cf';ctx.fillRect(0,0,640,480);
    state.reference=base;core.setMaster(base,'Select vs Create fixture',false);core.updateZoomFit();
    const wall=makeCanvas(640,480),wallContext=wall.getContext('2d');
    wallContext.fillStyle='#fff';wallContext.fillRect(70,60,480,370);
    const existing=core.newGroup(wall,'Wall');existing.name='Original wall';existing.mapPrepared=true;
    core.selectGroupMask(existing,{showOutline:true});
    core.selectTool('select-rect');core.setMode('new');draw(130,110,245,225);
    assert(state.manualAreaSelection,'Dashed Select did not create a manual selection');
    assert(alpha(170,150)>0&&alpha(330,300)===0,'Select Square snapped to an existing object');
    assert(!state.groups.some(g=>g.createdLocally),'Select created a new foreground object');
    checks.push('Select Square draws its own precise rectangle, not a snapped object');
    core.selectTool('select-ellipse');core.setMode('add');draw(280,170,400,290);
    assert(alpha(170,150)>0&&alpha(330,225)>0,'Select Circle Add did not preserve the previous selection');
    checks.push('Select Circle Add expands selection without modifying original object IDs');
    core.selectTool('select-rect');core.setMode('subtract');draw(145,120,205,175);
    assert(alpha(160,140)===0&&alpha(225,200)>0&&alpha(330,225)>0,'Select Subtract removed the wrong pixels');
    checks.push('Select Square Subtract removes only the drawn area');
    core.selectTool('select-lasso');core.setMode('new');
    pointer('pointerdown',445,100);pointer('pointerup',445,100);
    pointer('pointerdown',545,150);pointer('pointerup',545,150);
    pointer('pointerdown',465,240);pointer('pointerup',465,240);
    pointer('pointerdown',445,100);pointer('pointerup',445,100);
    assert(state.manualAreaSelection&&alpha(485,150)>0,'Dashed Select Line cannot close an area');
    checks.push('Dashed Select Line closes a lasso without Create semantics');
    core.selectTool('rect');draw(270,250,350,350);
    assert(state.groups.some(g=>g.createdLocally),'Create Square stopped creating foreground objects');
    checks.push('Create Square still produces a new independent foreground object');
    return {passed:checks.length,checks};
  }finally{
    Element.prototype.setPointerCapture=capture;Element.prototype.releasePointerCapture=release;
  }
};
