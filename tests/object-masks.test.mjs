import test from 'node:test';
import assert from 'node:assert/strict';
import {binary,signature,combine,overlap,gapWidth,validRepair,sceneOrder,matchFlatContext} from '../object-mask-utils.mjs';
test('alpha threshold, exact signatures and two-way matching distinguish nested objects',()=>{
  assert.deepEqual([...binary(Uint8Array.from([0,0,0,127,255,255,255,128]))],[0,1]);
  assert.notEqual(signature(Uint8Array.of(1,0,1)),signature(Uint8Array.of(1,1,0)));
  const big=Uint8Array.of(1,1,1,1),small=Uint8Array.of(0,1,0,0);
  assert.equal(overlap(big,small).twoWay,.25);
  assert.deepEqual([...combine(big,small,'subtract')],[1,0,1,1]);
});
test('gap width measures thickness rather than the length of a thin hole',()=>{
  const mask=new Uint8Array(100*100);for(let y=10;y<90;y++)for(let x=45;x<55;x++)mask[y*100+x]=1;
  assert.equal(gapWidth(mask,100,100),10);
});
test('repair validation rejects transparent output and severe boundary seams',()=>{
  const before=new Uint8ClampedArray(5*5*4).fill(255),mask=new Uint8Array(25);mask[12]=1;
  const bad=before.slice();bad.fill(0,48,52);assert.equal(validRepair(before,bad,mask,5,5),false);
  bad[51]=255;assert.equal(validRepair(before,bad,mask,5,5),false);
  assert.equal(validRepair(before,before,mask,5,5),true);
});
test('physical foreground survives later background edits; cycles terminate stably',()=>{
  const table={id:'table'},rug={id:'rug',objectBehind:['table']},wall={id:'wall',objectBehind:['rug','table']};
  assert.deepEqual(sceneOrder([table,rug,wall]).map(x=>x.id),['wall','rug','table']);
  table.objectBehind=['wall'];assert.equal(sceneOrder([table,rug,wall]).length,3);
});
test('flat texture calibration removes neural hue and contrast drift only inside holes',()=>{
  const rgba=new Uint8ClampedArray(8*8*4),holes=new Uint8Array(64);for(let i=0;i<64;i++)rgba.set([20,160,70,255],i*4);
  const output=rgba.slice();for(const i of [27,28,35,36]){holes[i]=1;output.set([i*5,10+i*3,200,255],i*4)}
  matchFlatContext(rgba,output,holes,8,8);for(let i=0;i<64;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(output[i*4+c]-rgba[i*4+c])<4);
});
