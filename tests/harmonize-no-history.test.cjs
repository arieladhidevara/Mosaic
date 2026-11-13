const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('scene-versioning.js','utf8');
const premium=fs.readFileSync('premium.js','utf8');
const project=fs.readFileSync('project-file.js','utf8');
function section(content,start,end){
  const a=content.indexOf(start),b=content.indexOf(end,a);
  assert.ok(a>=0&&b>a,'Missing function boundaries: '+start);
  return content.slice(a,b);
}
function setup(){
  const width=2400,height=1600;
  const oldMaster={width,height,name:'master-previous'};
  const generated={width,height,name:'master-generated'};
  const makeGroup=(id,box)=>({id,name:id,patchIds:[],active:null,box,objectId:id});
  const groups=[makeGroup('chair',{x:120,y:260,w:200,h:175}),
    makeGroup('wall',{x:800,y:120,w:410,h:490})];
  const state={master:oldMaster,masterIsBase:false,selectionGeneration:10,groups,
    patches:new Map(),sources:new Map(),sceneVersionCounters:{},sceneVersionHistory:[{old:true}],
    objectMapLocked:false};
  let serial=0,renders=0;
  const core={
    uid:prefix=>prefix+'_'+(++serial),
    composeApprovedCanvas:()=>oldMaster,
    exactMaskBoundingBox:mask=>mask.box,
    maskPathsFromRaster:()=>[],
    compactOptionSource:(image,box,pad)=>({
      canvas:{width:box.w+Math.min(pad,24)*2,height:box.h+Math.min(pad,24)*2,derivedFrom:image.name},
      crop:{x:box.x,y:box.y,width:box.w,height:box.h}
    }),
    shareMaterialOptionMask:()=>{},refreshGroupFootprint:()=>{}
  };
  const env=vm.createContext({state,canvas:{width,height},core,renderGroups:()=>{renders++},
    render:()=>{},isVisible:()=>true,
    originalMask:group=>({width,height,box:group.box}),
    alignGeneratedToLockedMask:({generated})=>({image:generated,aligned:false,status:'locked-mask'}),
    window:{MosaicObjectMap:{imageReady:()=>{throw Error('Object Map should not run')}}}});
  vm.runInContext(section(source,'async function apply(', '// A manually Created selection'),env);
  return {env,state,groups,oldMaster,generated,renderCount:()=>renders};
}
test('Harmonize keeps only cropped per-object source images and one live Master',async()=>{
  const {env,state,groups,generated}=setup();
  const result=await env.apply(generated,{type:'harmonize',prompt:'warm wood'});
  assert.equal(result.objectCount,2);
  assert.equal(state.master,generated,'generation canvas itself becomes live Master');
  assert.equal(state.sources.size,4,'original+harmonized crop per group; no full-size archive sources');
  for(const source of state.sources.values()){
    assert.ok(source.crop,'every saved appearance is cropped');
    assert.ok(source.canvas.width<generated.width);
    assert.ok(source.canvas.height<generated.height);
  }
  assert.equal(groups[0].patchIds.length,2);
  assert.equal(groups[1].patchIds.length,2);
  assert.equal(state.sceneVersionHistory.length,0,'no parallel full-scene history metadata');
});
test('second Harmonize adds Options but no new original-history image',async()=>{
  const {env,state,groups,generated}=setup();
  await env.apply(generated,{type:'harmonize'});
  const next={width:2400,height:1600,name:'next-generation'};
  await env.apply(next,{type:'harmonize'});
  assert.equal(state.master,next);
  assert.equal(state.sources.size,6,'each group has one original crop and two generated crops');
  assert.equal(groups[0].patchIds.length,3);
  assert.equal(groups[1].patchIds.length,3);
});
test('Harmonize no longer copies archive graphs or serializes historical images',()=>{
  const run=section(premium,'async function harmonizeWithAI(','function getMasterVersions()');
  assert.doesNotMatch(run,/copyGraph\(state\.groups/);
  assert.doesNotMatch(run,/cloneCanvas\((?:baseAtRequest|finalImage|sourceVersion)/);
  assert.match(run,/premium\.root=null/);
  const saved=section(premium,'function exportProjectState()','function restoreProjectState(');
  assert.doesNotMatch(saved,/root:premium\.root|expanded:premium\.expanded|previewNode:premium\.previewNode/);
  assert.match(saved,/masterVersions:premium\.masterVersions\.slice\(-1\)/);
  assert.doesNotMatch(section(project,'function projectState()','async function encodeQueue('),/'sceneVersionHistory'/);
});
