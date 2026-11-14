const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('geometry-edit.js','utf8');
const begin=source.indexOf('function removeCreatedCutout(){');
const end=source.indexOf("$('geometryDiscard').addEventListener(",begin);
assert(begin>=0&&end>begin,'Remove cutout local branch missing');
const compile=new Function('state','core','makeCanvas','toast','renderGroups','render','window','processing','review',
  source.slice(begin,end)+';return removeCreatedCutout;');

function fixture(createdLocally=true){
  const old={id:'cutout_1',sourceId:'rgba_1',bbox:{x:120,y:80,w:64,h:90},editMode:'create'};
  const group={id:'group_1',createdLocally,createdViaAI:true,active:old.id,patchIds:[old.id],objectId:'group_1',objectRemoved:false};
  const state={draftGroupId:group.id,groups:[group],patches:new Map([[old.id,old]]),busy:false,pendingSourceId:null,editingPatchId:null,selectionTargetPatchId:old.id};
  const counts={raster:0,render:0,sidebar:0,reset:0,refresh:0,schedule:0,hitInvalidations:0};
  const core={
    uid:()=>('removed_1'),
    refreshGroupFootprint:()=>counts.refresh++,
    resetSelection:()=>counts.reset++
  };
  const makeCanvas=(w,h)=>{counts.raster++;return {width:w,height:h}};
  const remove=compile(state,core,makeCanvas,()=>{},()=>counts.sidebar++,()=>counts.render++,
    {MosaicDiskCache:{schedule:()=>counts.schedule++},
      MosaicObjectMap:{invalidateHitIndex:()=>counts.hitInvalidations++}},false,null);
  return {old,group,state,counts,remove};
}

test('created PNG cutout is removed with one empty local mask, no model calls or RGB copy',()=>{
  const {old,group,state,counts,remove}=fixture();
  assert.equal(remove(),true);
  const removed=state.patches.get(group.active);
  assert.equal(removed.localCutoutRemoval,true);
  assert.equal(removed.editMode,'remove');
  assert.equal(removed.sourceId,old.sourceId);
  assert.deepEqual({width:removed.mask.width,height:removed.mask.height},{width:1,height:1});
  assert.equal(group.objectRemoved,true);
  assert.deepEqual(group.patchIds,[old.id,removed.id]);
  assert.equal(counts.raster,1);
  assert.equal(counts.refresh,0,'Remove must not recalculate existing Group geometry');
  assert.equal(counts.hitInvalidations,1,'Remove must invalidate stale object picking');
  assert.equal(counts.render,1);
  assert.equal(counts.reset,1);
  assert.equal(counts.schedule,1);
});

test('Remove reuses existing Removed Option after restore, rather than duplicating the mask',()=>{
  const {group,state,old,remove,counts}=fixture();
  remove();const removed=state.patches.get(group.active);
  group.active=old.id;group.objectRemoved=false;
  assert.equal(remove(),true);
  assert.equal(state.patches.get(group.active),removed);
  assert.equal(group.patchIds.length,2);
  assert.equal(counts.raster,1,'second remove allocated another mask');
});

test('original/base-image objects keep existing geometry Remove path',()=>{
  const {state,counts,remove}=fixture(false);
  assert.equal(remove(),false);
  assert.equal(state.patches.size,1);
  assert.equal(counts.raster,0);
  assert.equal(counts.render,0);
});

test('UI preserves removed Create in Groups, avoids drawing it, and offers reversible Options',()=>{
  const app=fs.readFileSync('app.js','utf8');
  assert.match(source,/if\(operation==='remove'&&removeCreatedCutout\(\)\)return/);
  assert.match(app,/if\(!patch \|\| !source \|\| patch\.awaitingResult\|\|patch\.localCutoutRemoval\)return/);
  assert.match(app,/!group\.objectRemoved\|\|group\.createdLocally&&state\.patches\.get\(group\.active\)\?\.localCutoutRemoval/);
  assert.match(app,/group\.objectRemoved=patch\?\.editMode==='remove'/);
  assert.match(app,/if\(active\?\.localCutoutRemoval&&group\.maskCrop\)return group\.maskCrop/);
});
