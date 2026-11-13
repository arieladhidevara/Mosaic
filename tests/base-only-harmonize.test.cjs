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
  assert.deepEqual(group.patchIds.length,2);
  assert.equal(group.patchIds[0],'old');
  assert.equal(state.patches.has('old'),true);
  const added=state.patches.get(group.patchIds[1]);
  assert.equal(state.sources.get(added.sourceId).canvas,result);
  assert.equal(state.sources.size,2);
  await context.apply(image(),{type:'harmonize'});
  assert.equal(group.patchIds.length,3);assert.equal(state.master,base);
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
  assert.equal(premium.includes('function copyGraph('),false);
});

test('Saving .moz keeps Base once and reconstructs its working dimensions',()=>{
  const source=fs.readFileSync('project-file.js','utf8');
  const base=image(4000,3000),working=image(2400,1800);
  const sandbox=vm.createContext({state:{reference:base,master:working}});
  vm.runInContext(section(source,'function projectState(){','async function encodeQueue('),sandbox);
  const saved=sandbox.projectState();
  assert.equal(Object.hasOwn(saved,'master'),false);
  assert.equal(saved.reference,base);
  assert.equal(saved.baseWorkingSize.width,2400);
  assert.equal(saved.baseWorkingSize.height,1800);
  assert.ok(source.includes('Object.assign(state,{master:null,rawMaster:null},saved)'));
});
