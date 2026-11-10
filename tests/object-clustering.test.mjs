import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterSceneObjects,MAX_SCENE_GROUPS} from '../object-clustering.mjs';
const options={width:1000,height:700};

test('automatic grouping uses semantic context AND proximity, not just category',()=>{
  const objects=[
    {id:'table-left',box:{x:100,y:100,w:80,h:80},category:'Furniture',label:'Table',suggestedGroup:'Dining area'},
    {id:'chair-left',box:{x:190,y:110,w:35,h:55},category:'Furniture',label:'Chair',suggestedGroup:'Dining area'},
    {id:'lamp-left',box:{x:145,y:75,w:20,h:30},category:'Lighting',label:'Pendant',suggestedGroup:'Dining area'},
    {id:'table-right',box:{x:780,y:120,w:60,h:60},category:'Furniture',label:'Table',suggestedGroup:'Dining area'},
    {id:'chair-right',box:{x:865,y:130,w:35,h:55},category:'Furniture',label:'Chair',suggestedGroup:'Dining area'}
  ];
  const groups=clusterSceneObjects(objects,options);
  assert.ok(groups.some(g=>g.ids.includes('table-left')&&g.ids.includes('chair-left')),'Nearby dining items must share a top-level group');
  assert.ok(groups.some(g=>g.ids.includes('table-right')&&g.ids.includes('chair-right')),'Second dining set must cluster independently');
  assert.ok(!groups.some(g=>g.ids.includes('table-left')&&g.ids.includes('table-right')),'Remote furniture must not be grouped by name alone');
  assert.deepEqual(groups.flatMap(g=>g.ids).sort(),objects.map(o=>o.id).sort());
});

test('up to 15 large groups with every original Object ID preserved',()=>{
  const objects=Array.from({length:100},(_,i)=>({
    id:'part-'+i,box:{x:(i%10)*96+10,y:Math.floor(i/10)*60+4,w:18,h:18},
    category:['Furniture','Lighting','Door','Wall'][i%4],label:'Piece '+i
  }));
  const groups=clusterSceneObjects(objects,{width:1000,height:700});
  assert.ok(groups.length>1);
  assert.ok(groups.length<=MAX_SCENE_GROUPS);
  assert.equal(new Set(groups.flatMap(g=>g.ids)).size,objects.length,'Clustering may never merge child identities');
  assert.deepEqual(groups.flatMap(g=>g.ids).sort(),objects.map(o=>o.id).sort());
  assert.ok(groups.every(g=>g.name&&g.ids.length));
});

test('group names and membership are deterministic regardless of input order',()=>{
  const objects=Array.from({length:32},(_,i)=>({id:'object-'+i,
    box:{x:(i%8)*110+10,y:Math.floor(i/8)*100+20,w:60,h:40},
    category:i%2?'Door':'Furniture',label:'Item '+i
  }));
  const a=clusterSceneObjects(objects,options);
  const b=clusterSceneObjects(objects.slice().reverse(),options);
  assert.deepEqual(a,b);
});

test('manual group slots reduce automatic cluster cap without losing objects',()=>{
  const objects=Array.from({length:60},(_,i)=>({
    id:'child-'+i,box:{x:(i%12)*80+5,y:Math.floor(i/12)*125+5,w:14,h:17},
    category:'Other',label:'Component '+i
  }));
  for(const maxGroups of [1,2,8,14,15]){
    const groups=clusterSceneObjects(objects,{...options,maxGroups});
    assert.ok(groups.length<=maxGroups);
    assert.equal(groups.flatMap(g=>g.ids).length,objects.length);
  }
  assert.deepEqual(clusterSceneObjects([],options),[]);
});

test('separate object identities survive grouping even when labels match',()=>{
  const items=[
    {id:'left',box:{x:1,y:1,w:70,h:40},category:'Door',label:'Door 1'},
    {id:'right',box:{x:87,y:5,w:70,h:40},category:'Door',label:'Door 2'}
  ];
  const groups=clusterSceneObjects(items,options);
  assert.equal(groups.length,1);
  assert.deepEqual(new Set(groups[0].ids),new Set(['left','right']));
});
