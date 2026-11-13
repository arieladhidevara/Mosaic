const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function section(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j)}
test('click selection stores crop and coordinates until an editing action requests a raster',()=>{
  let allocations=0;
  const state={selectionMask:null,selectionGeometry:{groupId:'chair',crop:{mask:{width:30,height:20},x:55,y:40},bounds:{x:55,y:40,w:30,h:20}}};
  const env=vm.createContext({state,canvas:{width:2400,height:1600},
    makeCanvas:(w,h)=>{allocations++;return{width:w,height:h,draws:[],getContext(){return{drawImage(){}}}}},maskBoundingBox:()=>null});
  vm.runInContext(section('function selectionBounds','function selectionContainsPoint'),env);
  assert.deepEqual(JSON.parse(JSON.stringify(env.selectionBounds())),{x:55,y:40,w:30,h:20});
  assert.equal(allocations,0);
  const first=env.ensureSelectionMask();
  assert.equal(allocations,1);assert.equal(first.width,2400);assert.equal(first.height,1600);
  assert.equal(state.selectionGeometry,null);
  assert.equal(env.ensureSelectionMask(),first);assert.equal(allocations,1);
});
test('normal selection path stays lazy but brush and generation materialize',()=>{
  assert.match(source,/resetSelection\(true\);[\s\S]*?state\.selectionGeometry=/);
  assert.match(source,/function showQuickPrompt[\s\S]*?selectionBounds\(\)/);
  assert.match(source,/function applyWandMask\(region, coverage=0\)\{\s*ensureSelectionMask\(\)/);
  assert.match(source,/function selectTool\(tool\)[\s\S]*?state\.selectionGeometry/);
});
