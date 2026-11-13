const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const premium=fs.readFileSync('premium.js','utf8');
function section(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing code section');
  return source.slice(a,b);
}
function canvas(w,h){
  const data=new Uint8ClampedArray(w*h*4),c={width:w,height:h,data};
  c.getContext=()=>({
    drawImage(src,dx=0,dy=0){
      for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
        const a=x+dx,b=y+dy;if(a<0||b<0||a>=w||b>=h)continue;
        data.set(src.data.subarray((y*src.width+x)*4,(y*src.width+x)*4+4),(b*w+a)*4);
      }
    },
    getImageData(x,y,width,height){
      const out=new Uint8ClampedArray(width*height*4);
      for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
        const a=x+xx,b=y+yy;if(a<0||b<0||a>=w||b>=h)continue;
        out.set(data.subarray((b*w+a)*4,(b*w+a)*4+4),(yy*width+xx)*4);
      }
      return {data:out,width,height};
    }
  });
  return c;
}
function mark(c,x,y,alpha=255){c.data[(y*c.width+x)*4+3]=alpha;}
function bounds(mask){
  let x0=mask.width,y0=mask.height,x1=-1,y1=-1;
  for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)if(mask.data[(y*mask.width+x)*4+3]){
    x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
  }
  return x1<0?null:{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
}
function harness(){
  const state={patches:new Map(),groups:[]};
  const sandbox=vm.createContext({state,uid:prefix=>prefix+'_test',canvas:{width:16,height:12},makeCanvas:canvas,
    exactMaskBoundingBox:bounds,invalidateDisplayedMask:p=>{p.invalidated=true}});
  vm.runInContext(section(app,'function cloneMask','function groupMask'),sandbox);
  return {sandbox,state};
}
test('material options share one exact mask, without losing alpha holes',()=>{
  const {sandbox,state}=harness(),a=canvas(16,12),b=canvas(16,12),group={patchIds:['red','blue']};
  for(let y=3;y<8;y++)for(let x=4;x<9;x++){mark(a,x,y);mark(b,x,y);}
  mark(a,6,5,0);mark(b,6,5,0);mark(a,7,6,128);mark(b,7,6,128);
  const red={id:'red',mask:a},blue={id:'blue',mask:b,request:{mask:b}};
  state.patches.set('red',red);state.patches.set('blue',blue);
  assert.equal(sandbox.shareMaterialOptionMask(blue,group),a);
  assert.equal(blue.mask,red.mask);
  assert.equal(blue.request.mask,a);
  assert.equal(blue.invalidated,true);
});
test('a changed silhouette is independent, and manual shape edits detach shared pixels',()=>{
  const {sandbox,state}=harness(),a=canvas(16,12),b=canvas(16,12),group={patchIds:['red','blue','shape']};
  mark(a,4,4);mark(b,4,4);
  const red={id:'red',mask:a},blue={id:'blue',mask:b};
  const shape={id:'shape',mask:canvas(16,12),editMode:'shape'};
  mark(shape.mask,5,4);
  state.patches.set('red',red);state.patches.set('blue',blue);state.patches.set('shape',shape);
  sandbox.shareMaterialOptionMask(blue,group);
  assert.notEqual(sandbox.shareMaterialOptionMask(shape,group),a);
  const before=red.mask;
  sandbox.detachSharedOptionMask(blue);
  assert.notEqual(blue.mask,before);
  mark(blue.mask,7,7);
  assert.equal(red.mask.data[(7*16+7)*4+3],0);
  assert.equal(blue.mask.data[(7*16+7)*4+3],255);
});
test('geometry equality rejects same bounds with different silhouettes',()=>{
  const {sandbox}=harness(),a=canvas(16,12),b=canvas(16,12);
  for(const p of [[2,2],[5,5],[2,5],[5,2]]){mark(a,...p);mark(b,...p);}
  mark(a,3,3);mark(b,4,3);
  assert.equal(sandbox.sameMaskGeometry(a,b),false);
});
test('legacy saved Option masks consolidate within each group only',()=>{
  const {sandbox,state}=harness(),one=canvas(16,12),two=canvas(16,12),third=canvas(16,12);
  for(const x of [one,two,third])mark(x,4,4);
  state.groups=[{patchIds:['a','b']},{patchIds:['c']}];
  for(const [key,mask] of [['a',one],['b',two],['c',third]])state.patches.set(key,{id:key,mask});
  sandbox.shareSavedOptionMasks();
  assert.equal(state.patches.get('a').mask,state.patches.get('b').mask);
  assert.notEqual(state.patches.get('a').mask,state.patches.get('c').mask);
});
test('archive snapshot retains mask aliases but not source references',()=>{
  const h=harness(),a=canvas(16,12);mark(a,4,4);
  const groups=[{id:'g',patchIds:['a','b'],footprint:null}];
  const patches=new Map([['a',{id:'a',mask:a,request:{mask:a}}],['b',{id:'b',mask:a,request:{mask:a}}]]);
  const fn=vm.createContext({makeCanvas:canvas,cloneCanvas:source=>{const out=canvas(source.width,source.height);out.getContext('2d').drawImage(source);return out;}});
  vm.runInContext(section(premium,'function copyGraph','function drawComposition'),fn);
  const archived=fn.copyGraph(groups,patches,new Map());
  assert.equal(archived.patches.get('a').mask,archived.patches.get('b').mask);
  assert.notEqual(archived.patches.get('a').mask,a);
  assert.equal(archived.patches.get('a').request.mask,archived.patches.get('b').mask);
});
