const test=require('node:test');
const assert=require('node:assert/strict');
const {normalize}=require('../api/ai/scene-intent');
test('plural all-tables prompt keeps only grounded Object Map IDs',()=>{
  const known=[{id:'table-a'},{id:'chair-b'},{id:'table-c'}];
  const parsed=normalize({scope:'all',label:'table',targetIds:['table-a','table-c','table-a','invented']},known);
  assert.deepEqual(parsed,{scope:'all',label:'table',targetIds:['table-a','table-c']});
});
test('global scene changes do not invent object targets',()=>{
  assert.deepEqual(normalize({scope:'global',label:'',targetIds:[]},[{id:'x'}]),{scope:'global',label:'',targetIds:[]});
});
test('invalid intent is rejected instead of sending arbitrary target IDs',()=>{
  assert.throws(()=>normalize({scope:'all',label:99,targetIds:[]},[]),/Invalid scene intent/);
});
