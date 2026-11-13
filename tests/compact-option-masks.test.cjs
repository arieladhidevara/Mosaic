const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
function canvas(w,h){
  const data=new Uint8ClampedArray(w*h*4);
  return {width:w,height:h,data,getContext(){
    return {
      drawImage(src,dx=0,dy=0){
        for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
          const px=x+dx,py=y+dy;
          if(px>=0&&py>=0&&px<w&&py<h)data.set(src.data.subarray((y*src.width+x)*4,(y*src.width+x)*4+4),(py*w+px)*4);
        }
      },
      getImageData(x,y,width,height){
        const pixels=new Uint8ClampedArray(width*height*4);
        for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
          const px=x+xx,py=y+yy;
          if(px>=0&&py>=0&&px<w&&py<h)pixels.set(data.subarray((py*w+px)*4,(py*w+px)*4+4),(yy*width+xx)*4);
        }
        return {data:pixels,width,height};
      }
    };
  }};
}
function alpha(c,x,y,value=255){c.data[(y*c.width+x)*4+3]=value;}
function bounds(c){
  let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(c.data[(y*c.width+x)*4+3]){
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  return maxX<0?null:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
}
function harness(){
  const state={drawing:false,editingPatchId:null,patches:new Map(),groups:[]},world={width:64,height:48},changes=[];
  let serial=0;
  const context=vm.createContext({state,canvas:world,makeCanvas:canvas,exactMaskBoundingBox:bounds,uid:p=>p+'_'+(++serial),
    invalidateDisplayedMask:(p,options)=>changes.push({id:p.id,options})});
  const a=app.indexOf('function cloneMask'),b=app.indexOf('const groupCropCache=',a);
  assert.ok(a>0&&b>a);
  vm.runInContext(app.slice(a,b),context);
  return {context,state,changes};
}
test('stores a sparse Option alpha as a tiny crop with world offset, and expands losslessly',()=>{
  const {context,state,changes}=harness(),large=canvas(64,48);
  for(let y=20;y<25;y++)for(let x=29;x<33;x++)alpha(large,x,y);
  alpha(large,30,22,0);
  const patch={id:'chair',mask:large,bbox:{x:29,y:20,w:4,h:5},request:{mask:large}};
  state.patches.set('chair',patch);
  context.compactPatchMask(patch);
  assert.equal(patch.mask.width,4);assert.equal(patch.mask.height,5);
  assert.deepEqual(JSON.parse(JSON.stringify(patch.maskOffset)),{x:29,y:20});
  assert.equal(patch.request.mask,patch.mask);
  assert.ok(patch.maskGeometryId);
  assert.equal(patch.mask.data[(2*4+1)*4+3],0);
  const restored=context.fullPatchMask(patch);
  assert.equal(restored.width,64);assert.equal(restored.height,48);
  assert.equal(restored.data[(22*64+30)*4+3],0);
  assert.equal(restored.data[(24*64+31)*4+3],255);
  assert.equal(restored.data[(0*64+0)*4+3],0);
  assert.ok(changes.every(c=>c.options.geometryChanged===false));
});
test('material Options share cropped pixels and Shape Edit preserves independent geometry',()=>{
  const {context,state}=harness(),group={patchIds:['red','blue','shape']};
  state.groups.push(group);
  const make=()=>{const c=canvas(64,48);alpha(c,31,24);alpha(c,32,24);return c};
  for(const id of ['red','blue']){
    const mask=make();state.patches.set(id,{id,mask,request:{mask}});
  }
  const different=canvas(64,48);alpha(different,31,24);alpha(different,32,25);
  state.patches.set('shape',{id:'shape',mask:different,editMode:'shape'});
  context.compactAllOptionMasks();
  const red=state.patches.get('red'),blue=state.patches.get('blue'),shape=state.patches.get('shape');
  assert.equal(red.mask.width,2);assert.equal(red.mask.height,1);
  assert.equal(red.mask,blue.mask);
  assert.equal(red.maskGeometryId,blue.maskGeometryId);
  assert.notEqual(red.mask,shape.mask);
  context.detachSharedOptionMask(blue);
  assert.notEqual(blue.mask,red.mask);
  assert.equal(blue.maskOffset.x,red.maskOffset.x);
  const expanded=context.expandPatchMask(blue);
  assert.equal(expanded.width,64);assert.equal(expanded.height,48);
  assert.equal(blue.maskOffset,null);
  assert.equal(red.mask.width,2);
  assert.equal(red.mask.data[3],255);
});
test('full-image geometry remains full and generating drafts are not compacted',()=>{
  const {context,state}=harness(),all=canvas(64,48),running=canvas(64,48);
  for(let y=0;y<48;y++)for(let x=0;x<64;x++)alpha(all,x,y);
  alpha(running,4,4);
  const bg={id:'bg',mask:all},draft={id:'draft',mask:running,generating:true};
  state.patches.set('bg',bg);state.patches.set('draft',draft);
  context.compactAllOptionMasks();
  assert.equal(bg.mask,all);assert.equal(bg.maskOffset,undefined);
  assert.equal(draft.mask,running);assert.equal(draft.maskOffset,undefined);
});
test('production rendering paths respect saved world-offset pixels',()=>{
  assert.match(app,/const maskX=\(patch\.maskOffset\?\.x\|\|0\)-x,maskY=/);
  assert.match(app,/function groupMaskCrop[\s\S]*?active\?\.maskOffset[\s\S]*?return \{mask:active\.mask/);
  assert.match(app,/const mask=patch\.corners\?\.length\?displayedPatchMask\(patch\):patch\.mask/);
});
