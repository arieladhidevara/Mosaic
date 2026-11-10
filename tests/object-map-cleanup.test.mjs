import test from 'node:test';
import assert from 'node:assert/strict';
import {splitColorInstances} from '../object-map-cleanup.mjs';
import {idsInShape} from '../object-map-utils.mjs';
const fixture=()=>{const width=100,height=100,colors=new Uint8Array(width*height);return {width,height,colors,rect(x,y,w,h,id){for(let yy=y;yy<y+h;yy++)colors.fill(id,yy*width+x,yy*width+x+w)},at(x,y){return y*width+x}}};
test('distant same-color components remain separate objects',()=>{
  const f=fixture();f.rect(5,10,25,30,2);f.rect(70,10,20,25,2);
  const {labels,objects}=splitColorInstances(f.colors,100,100);
  assert.equal(objects.length,2);assert.notEqual(labels[f.at(10,15)],labels[f.at(75,15)]);
});
test('only nearby small fragments attach to the dominant local component',()=>{
  const f=fixture();f.rect(5,10,25,30,2);f.rect(31,20,2,3,2);f.rect(70,80,1,1,2);
  const {labels,objects}=splitColorInstances(f.colors,100,100,{clusterGap:3});
  assert.equal(objects.length,1);assert.equal(labels[f.at(31,20)],labels[f.at(10,15)]);assert.equal(labels[f.at(70,80)],0);
});
test('large nearby objects stay independent and satellite chains cannot bridge distance',()=>{
  const f=fixture();f.rect(5,10,20,25,2);f.rect(27,10,20,25,2);f.rect(5,50,20,25,3);f.rect(26,55,1,2,3);f.rect(28,55,1,2,3);
  const {labels}=splitColorInstances(f.colors,100,100,{clusterGap:2});
  assert.notEqual(labels[f.at(10,15)],labels[f.at(30,15)]);assert.equal(labels[f.at(26,55)],labels[f.at(10,55)]);assert.equal(labels[f.at(28,55)],0);
});
test('remove isolated flecks inside another object without filling true voids or occluders',()=>{
  const f=fixture();f.rect(0,0,100,100,1);f.rect(5,10,20,25,2);f.rect(80,80,1,1,2);f.rect(10,15,5,8,3);f.rect(15,30,3,3,0);
  const {labels}=splitColorInstances(f.colors,100,100);
  assert.equal(labels[f.at(80,80)],labels[f.at(90,90)]);assert.notEqual(labels[f.at(11,16)],labels[f.at(6,11)]);assert.equal(labels[f.at(16,31)],0);
});
test('a small valid visible region survives even when its color has a large background',()=>{
  const f=fixture();f.rect(0,0,100,100,1);f.rect(5,10,30,40,2);f.rect(15,20,4,4,1);
  const {labels}=splitColorInstances(f.colors,100,100);
  assert.ok(labels[f.at(16,21)]);assert.notEqual(labels[f.at(16,21)],labels[f.at(90,90)]);assert.notEqual(labels[f.at(16,21)],labels[f.at(6,11)]);
});
test('shape multi-selection supports instance IDs above the 64-color palette limit',()=>{
  const rgba=new Uint8Array(12);rgba[3]=rgba[7]=255;
  assert.deepEqual(idsInShape(new Uint32Array([300,300,701]),3,1,rgba,3,1),[300]);
});
