const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scene=fs.readFileSync('scene-versioning.js','utf8');
const premium=fs.readFileSync('premium.js','utf8');
const app=fs.readFileSync('app.js','utf8');
function section(src,start,end){
  const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing '+start);return src.slice(a,b);
}
function image(w=4,h=4){return {width:w,height:h,getContext(){return {fillRect(){},drawImage(){}}}};}
function harness(withObjects=true){
  let next=0;const base=image(),result=image(),mask=image();
  const group={id:'chair',name:'Chair',patchIds:['old'],active:'old',mask};
  const state={master:base,reference:base,groups:withObjects?[group]:[],
    patches:new Map([['old',{id:'old',sourceId:'old-source',mask}]]),
    sources:new Map([['old-source',{canvas:image()}]]),
    selectionGeneration:1,sceneVersionCounters:{harmonize:0,'ai-edit':0}};
  const core={uid:prefix=>prefix+'_'+(++next),composeApprovedCanvas:image,
    groupMask:g=>g.mask,maskPathsFromRaster:()=>[],
    exactMaskBoundingBox:()=>({x:0,y:0,w:4,h:4}),
    compactOptionSource:source=>({canvas:source,crop:{x:0,y:0,width:4,height:4}}),
    shareMaterialOptionMask(){},refreshGroupFootprint(){},
    newGroup(m){
      const g={id:'scene',name:'Scene',patchIds:[],active:null,mask:m};
      state.groups.push(g);return g;
    }};
  const context=vm.createContext({core,state,canvas:{width:4,height:4},
    makeCanvas:image,clone:x=>x,isVisible:g=>!g.objectMapBatch&&!g.mergedInto,
    originalMask:g=>g.mask,alignGeneratedToLockedMask:({generated})=>({image:generated,aligned:false,status:'locked-mask'}),
    render(){},renderGroups(){},console,window:{MosaicObjectMap:{hydrate(){}}}});
  vm.runInContext(section(scene,'async function apply(','// A manually Created selection'),context);
  return {context,state,base,result,group};
}
test('Harmonize preserves Base and earlier Options',async()=>{
  const {context,state,base,result,group}=harness();
  const answer=await context.apply(result,{type:'harmonize',prompt:'Warm'});
  assert.equal(state.master,base);assert.equal(state.reference,base);
  assert.equal(answer.objectCount,1);
  assert.ok(group.patchIds.length>=2);
  assert.ok(group.patchIds.includes('old'),'earlier approved Option stays available');
  assert.equal(state.patches.has('old'),true);
  const added=state.patches.get(group.patchIds.at(-1));
  assert.equal(state.sources.get(added.sourceId).canvas,result);
  assert.equal(state.sources.size,3,'existing Option plus original cropped appearance plus Harmonized Option');
  await context.apply(image(),{type:'harmonize'});
  assert.ok(group.patchIds.length>=3);assert.equal(state.master,base);
});
test('Without Objects the result becomes a reversible Entire image Option',async()=>{
  const {context,state,base,result}=harness(false);
  const answer=await context.apply(result,{type:'harmonize'});
  assert.equal(answer.objectCount,1);
  assert.equal(state.groups.length,1);
  assert.equal(state.groups[0].name,'Entire image');
  assert.equal(state.master,base);
});
test('Project export excludes the archive, Master versions, and old collages',()=>{
  const ctx=vm.createContext({premium:{
    settings:{regionQuality:'medium'},projectPrompt:'Warm',
    serial:2,lastRequest:{prompt:'Test',collage:image()},
    regionSerial:1,showGuides:false,root:{output:image()},masterVersions:[{image:image()}]}});
  vm.runInContext(section(premium,'function exportProjectState(){','function restoreProjectState('),ctx);
  const saved=ctx.exportProjectState();
  for(const name of ['root','masterVersions','originalMaster','initialMaster'])
    assert.equal(Object.hasOwn(saved,name),false);
  assert.equal(saved.lastRequest.prompt,'Test');
  assert.equal(Object.hasOwn(saved.lastRequest,'collage'),false);
});
test('Base upload enters editor directly and no result replaces Base',()=>{
  assert.equal(app.includes('onReferenceLoaded(file);setProjectTitle(fileName(file));continueWithBase(false)'),true);
  assert.equal(scene.includes('state.master=fullImage'),false);
  assert.doesNotMatch(section(premium,'async function harmonizeWithAI(','function getMasterVersions()'),/copyGraph\(/);
});

test('Saving .moz keeps Base once and reconstructs its working dimensions',()=>{
  const source=fs.readFileSync('project-file.js','utf8');
  const base=image(4000,3000),working=image(2400,1800);
  const sandbox=vm.createContext({state:{reference:base,master:working},core:{compactAllOptionMasks(){}}});
  vm.runInContext(section(source,'function projectState(){','async function encodeQueue('),sandbox);
  const saved=sandbox.projectState();
  assert.equal(Object.hasOwn(saved,'master'),false);
  assert.equal(saved.reference,base);
  assert.equal(saved.baseWorkingSize.width,2400);
  assert.equal(saved.baseWorkingSize.height,1800);
  assert.ok(source.includes('Object.assign(state,{master:null,rawMaster:null},saved)'));
});


test('Full-image results wait for initial Base objects and never request a new map',async()=>{
  const original=image(8,8),generated=image(8,8),mask=image(8,8);
  const group={id:'wall',name:'Left wall',patchIds:[],active:null,mask};
  const state={master:original,reference:original,groups:[],patches:new Map(),
    sources:new Map(),selectionGeneration:5,sceneVersionCounters:{}};
  const called=[],pending=[];
  const core={uid:prefix=>prefix+'_'+(called.length+1),groupMask:g=>g.mask,
    composeApprovedCanvas:()=>original,maskPathsFromRaster:()=>[],
    exactMaskBoundingBox:()=>({x:0,y:0,w:8,h:8}),
    compactOptionSource:source=>({canvas:source,crop:{x:0,y:0,width:8,height:8}}),
    shareMaterialOptionMask(){},refreshGroupFootprint(){},
    newGroup(){throw Error('Entire image fallback must not be created while mapping is pending');}};
  const window={MosaicObjectMap:{
    whenReady:()=>{called.push('existing-map-wait');return new Promise(resolve=>pending.push(resolve));},
    hydrate:()=>{called.push('hydrate');return true;}},
    MosaicMaskProgress:{show:()=>called.push('progress-show'),hide:()=>called.push('progress-hide')}};
  const ctx=vm.createContext({state,core,canvas:{width:8,height:8},
    makeCanvas:image,window,clone:x=>x,originalMask:g=>g.mask,
    isVisible:g=>!g.objectMapBatch&&!g.mergedInto,
    alignGeneratedToLockedMask:({generated})=>({image:generated,aligned:false,status:'locked-mask'}),
    render(){},renderGroups(){},console});
  vm.runInContext(section(scene,'async function apply(','// A manually Created selection'),ctx);
  const resultPromise=ctx.apply(generated,{type:'ai-edit'});
  assert.equal(called.includes('existing-map-wait'),true);
  assert.equal(state.groups.length,0,'generation must not create an Entire image Group before mapping');
  state.objectMap={raster:{}};
  state.groups.push(group);
  pending[0]();
  const result=await resultPromise;
  assert.equal(result.objectCount,1);
  assert.equal(group.patchIds.length,2,'existing Object ID receives original + new appearance');
  assert.equal(state.groups.length,1,'no new Group or map is created');
  assert.equal(state.master,original,'Base is never overwritten');
  assert.equal(called.includes('progress-show'),true);
  assert.equal(called.includes('progress-hide'),true);
  assert.doesNotMatch(section(scene,'async function apply(','// A manually Created selection'),
    /segmentFullFrame\(|\/api\/ai\/(?:sam3|object-map)/);
});

test('Original object-map waiter resumes after the first mapping is prepared',async()=>{
  const mapSource=fs.readFileSync('object-map.js','utf8');
  const body=section(mapSource,'const preparedWaiters=new Set();','function invalidateHitIndex(){');
  const state={master:{},objectMap:null,groups:[]};
  const ctx=vm.createContext({state,busy:true,attemptedBase:null,Set,Promise,Error});
  vm.runInContext('let preparedWaiters;'+body.replace('const preparedWaiters=new Set();','preparedWaiters=new Set();'),ctx);
  let resolved=false;
  const request=ctx.whenReady().then(()=>{resolved=true});
  await Promise.resolve();
  assert.equal(resolved,false,'waiting does not trigger new segmentation');
  state.objectMap={raster:{}};
  state.groups.push({mapPrepared:true});
  ctx.notifyPrepared();
  await request;
  assert.equal(resolved,true);
});
