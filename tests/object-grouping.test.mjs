import test from 'node:test';
import assert from 'node:assert/strict';
import {objectNameSignature as signature,groupSimilarObjects as group} from '../object-grouping.mjs';
test('matching names ignore counters, positions, plurals and word order',()=>{
  for(const names of [['Chair 1','Chairs 2','Chair left','Chair A'],['Wooden cabinet 1','Cabinet wood 2'],['Shelf #1','Shelves #2'],['Lamp1','Lamp2']])
    assert.equal(new Set(names.map(n=>signature(n).key)).size,1);
  for(const name of ['Object 2','Unnamed object','Region 1','Upper left area'])assert.equal(signature(name),null);
  assert.notEqual(signature('Dining chair').key,signature('Office chair').key);
});
test('repeated names group immediately and future matches join without touching masks',()=>{
  const mask={},objects=[{name:'Chair 1',mask},{name:'Chair right',mask},{name:'Cabinet 1',mask}],collections=[];
  let id=0;const uid=()=>String(++id);
  assert.equal(group(objects,collections,uid),2);assert.equal(collections.length,1);assert.equal(collections[0].name,'Chair');
  assert.equal(objects[0].collectionId,objects[1].collectionId);assert.equal(objects[2].collectionId,undefined);
  objects.push({name:'Chair 3',mask});assert.equal(group(objects,collections,uid),1);assert.equal(collections.length,1);
  assert.equal(group(objects,collections,uid),0);assert.ok(objects.every(o=>o.mask===mask));
});
test('manual groups, explicitly ungrouped objects, removed objects and unnamed objects are preserved',()=>{
  const objects=[{name:'Chair 1',collectionId:'manual'},{name:'Chair 2',autoGroupExcluded:true},{name:'Object 1'},{name:'Object 2'},{name:'Chair 3',objectRemoved:true},{name:'Chair 4',mergedInto:'other'}],collections=[{id:'manual',name:'My seating'}];
  assert.equal(group(objects,collections,()=> 'auto'),0);assert.equal(objects[0].collectionId,'manual');assert.equal(collections.length,1);
  objects.push({name:'Chair 5'});assert.equal(group(objects,collections,()=> 'auto',{includeExcluded:true}),2);
  assert.equal(objects[0].collectionId,'manual');assert.equal(objects[1].collectionId,'auto');
});
