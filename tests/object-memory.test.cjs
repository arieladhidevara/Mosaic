const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const manager=fs.readFileSync('object-management.js','utf8');
function section(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end));}
function makeCanvas(width,height){
  const data=new Uint8ClampedArray(width*height*4);
  return {width,height,data,getContext(){return {
    drawImage(source,dx,dy){for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&yy>=0&&xx<width&&yy<height)data.set(source.data.slice((y*source.width+x)*4,(y*source.width+x+1)*4),(yy*width+xx)*4);
    }},
    getImageData(x,y,w,h){const out=new Uint8ClampedArray(w*h*4);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)out.set(data.slice(((y+yy)*width+x+xx)*4,((y+yy)*width+x+xx+1)*4),(yy*w+xx)*4);return {data:out};}
  };}};
}
test('prepared objects retain cropped masks and preserve holes and world coordinates',()=>{
  const canvas={width:100,height:80},state={groups:[],patches:new Map()};
  const context=vm.createContext({makeCanvas,canvas,state,title:x=>x});
  vm.runInContext(section(app,'function exactMaskBoundingBox','function maskBoundingBox'),context);
  vm.runInContext(section(app,'function groupMask','function rememberMask'),context);
  vm.runInContext(section(app,'function groupContainsPoint','function findRegionAt'),context);
  context.core={exactMaskBoundingBox:context.exactMaskBoundingBox,newGroup(mask){const group={footprint:mask,patchIds:[]};state.groups.push(group);return group;}};
  vm.runInContext(section(manager,'function ensureObjects','function partForObject'),context);
  const original=makeCanvas(100,80);
  for(let y=20;y<24;y++)for(let x=30;x<36;x++)original.data[(y*100+x)*4+3]=255;
  original.data[(21*100+32)*4+3]=0;
  context.ensureObjects({sourceKey:'map',raster:canvas,entries:[{id:1,key:'one',category:'Other',label:'Lamp',paths:[]}]},()=>original);
  const group=state.groups[0];
  assert.equal(group.footprint,null);
  assert.equal(group.maskCrop.mask.width*group.maskCrop.mask.height,24);
  assert.equal(context.groupContainsPoint(group,{x:30,y:20}),true);
  assert.equal(context.groupContainsPoint(group,{x:32,y:21}),false);
  assert.equal(context.groupContainsPoint(group,{x:36,y:20}),false);
  assert.deepEqual(context.groupMask(group).data,original.data);
  const restored={...group,maskCrop:{...group.maskCrop}};
  assert.deepEqual(context.groupMask(restored).data,original.data);
  restored.footprint=makeCanvas(100,80);
  assert.equal(context.groupContainsPoint(restored,{x:30,y:20}),false);
});
test('undo keeps latest operation and bounds retained pixel memory',()=>{
  const state={undo:Array.from({length:12},()=>({image:{data:{byteLength:20*1024*1024}}}))};
  const context=vm.createContext({state,Set});
  vm.runInContext(section(app,'function trimUndo','function snapshotSelection'),context);
  context.trimUndo();assert.equal(state.undo.length,4);
  state.undo=[{image:{data:{byteLength:200*1024*1024}}}];context.trimUndo();assert.equal(state.undo.length,1);
});


test('refreshing edited group footprints releases full masks without overwriting original Object Map crops',()=>{
  const mask=makeCanvas(100,80);
  for(let y=20;y<24;y++)for(let x=30;x<36;x++)mask.data[(y*100+x)*4+3]=255;
  const originalCrop={mask:makeCanvas(6,4),x:30,y:20};
  const mapped={id:'mapped',patchIds:['p'],active:'p',mapPrepared:true,maskCrop:originalCrop,footprint:null};
  const manual={id:'manual',patchIds:['p'],active:'p',footprint:null};
  const state={patches:new Map([['p',{mask}]]),groups:[mapped,manual]};
  const bbox=source=>{
    let left=source.width,top=source.height,right=-1,bottom=-1;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)
      if(source.data[(y*source.width+x)*4+3]){
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
      }
    return right<0?null:{x:left,y:top,w:right-left+1,h:bottom-top+1};
  };
  const context=vm.createContext({
    makeCanvas,canvas:{width:100,height:80},state,
    groupThumbCache:new WeakMap(),displayedPatchMask:p=>p.mask,
    groupMask:g=>state.patches.get(g.active).mask,
    exactMaskBoundingBox:bbox,maskBoundingBox:bbox,
    window:{MosaicObjects:{scheduleRepair(){}}}
  });
  vm.runInContext(section(app,'function refreshGroupFootprint','function moveOptionToGroup'),context);
  context.refreshGroupFootprint(mapped);
  assert.equal(mapped.footprint,null);
  assert.equal(mapped.maskCrop,originalCrop,'Original Object Map identity must survive switching options');
  context.refreshGroupFootprint(manual);
  assert.equal(manual.footprint,null);
  assert.deepEqual({x:manual.maskCrop.x,y:manual.maskCrop.y,w:manual.maskCrop.mask.width,h:manual.maskCrop.mask.height},
    {x:30,y:20,w:6,h:4});
  assert.equal(manual.maskCrop.mask.data[3],255);
});
