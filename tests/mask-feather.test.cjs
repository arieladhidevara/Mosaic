const test=require('node:test'),assert=require('node:assert/strict');
const {featherAlpha}=require('../mask-feather');
test('feather fades only mask edges inward while preserving texture and holes',()=>{
  const width=50,height=50,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=5;y<45;y++)for(let x=5;x<45;x++){const i=(y*width+x)*4;pixels[i]=91;pixels[i+1]=128;pixels[i+2]=206;pixels[i+3]=255}
  for(let y=23;y<27;y++)for(let x=23;x<27;x++)pixels[(y*width+x)*4+3]=0;
  const before=new Uint8ClampedArray(pixels),alpha=featherAlpha(pixels,width,height,6),at=(x,y)=>alpha[y*width+x];
  assert.deepEqual(pixels,before,'Source pixels must remain unchanged');
  assert.equal(at(4,15),0);assert(at(5,15)>0&&at(5,15)<40);
  assert(at(6,15)>at(5,15));assert(at(8,15)>at(6,15));assert.equal(at(15,15),255);
  assert.equal(at(24,24),0);assert(at(22,24)<100);
});
test('a full-image mask stays opaque and fractional brush alpha is never increased',()=>{
  const data=new Uint8ClampedArray(12*12*4).fill(255);data[(6*12+6)*4+3]=100;
  const alpha=featherAlpha(data,12,12,4);assert.equal(alpha[0],255);assert.equal(alpha[6*12+6],100);
});
