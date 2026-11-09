const test=require('node:test'),assert=require('node:assert/strict');
const {createPool}=require('../generation-pool');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('three requests start together and the next starts as soon as any slot is free',async()=>{
  const pool=createPool(3),started=[],release=[];
  const tasks=Array.from({length:4},(_,index)=>pool.run(()=>{started.push(index);return new Promise(resolve=>{release[index]=()=>resolve(index)})}));
  await tick();assert.deepEqual(started,[0,1,2]);assert.equal(pool.active,3);assert.equal(pool.pending,1);
  release[1]();await tick();assert.deepEqual(started,[0,1,2,3]);
  release[3]();release[2]();release[0]();assert.deepEqual(await Promise.all(tasks),[0,1,2,3]);
  await tick();assert.equal(pool.active,0);assert.equal(pool.pending,0);
});
test('a rejected request releases capacity and never prevents another task from finishing',async()=>{
  const pool=createPool(1),first=pool.run(()=>{throw Error('fixture failure')});
  const observed=assert.rejects(first,/fixture failure/),second=pool.run(()=>42);
  await observed;assert.equal(await second,42);
  assert.throws(()=>createPool(0),/positive integer/);
});
