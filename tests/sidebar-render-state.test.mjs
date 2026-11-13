import test from 'node:test';
import assert from 'node:assert/strict';
import {planSidebarRender} from '../sidebar-render-state.mjs';
const snap=(layout,rows)=>({layout,groups:new Map(Object.entries(rows))});
test('selection and active Option only update matching object nodes',()=>{
  const before=snap('chair|wall',{
    chair:{structure:'visible:red,blue',content:'active:red|focus:false'},
    wall:{structure:'collapsed',content:'active:master|focus:true'}});
  const after=snap('chair|wall',{
    chair:{structure:'visible:red,blue',content:'active:blue|focus:true'},
    wall:{structure:'collapsed',content:'active:master|focus:false'}});
  assert.deepEqual(planSidebarRender(before,after),{full:false,replace:[],update:['chair','wall']});
});
test('new or expanded option updates only its own object subtree',()=>{
  const before=snap('chair|wall',{
    chair:{structure:'collapsed',content:'a'},wall:{structure:'collapsed',content:'b'}});
  const after=snap('chair|wall',{
    chair:{structure:'visible:red,blue',content:'a'},wall:{structure:'collapsed',content:'b'}});
  assert.deepEqual(planSidebarRender(before,after),{full:false,replace:['chair'],update:[]});
});
test('add/remove/group moves rebuild layout once; identical state does nothing',()=>{
  const same=snap('chair|wall',{chair:{structure:'red',content:'red'}});
  assert.deepEqual(planSidebarRender(same,same),{full:false,replace:[],update:[]});
  assert.equal(planSidebarRender(same,snap('chair|wall|table',{})).full,true);
  assert.equal(planSidebarRender(null,same).full,true);
});
