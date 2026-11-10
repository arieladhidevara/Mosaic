const test=require('node:test');
const assert=require('node:assert/strict');
const {buildPrompt}=require('../lib/image-provider');

function sample(editIntent){
  return {editIntent,chat:true,regions:[],references:[{url:'data:mock'}],context:null,crop:null,
    base:{url:'data:base'},intent:'Architectural interior',prompt:'Make selected sofa more curved',markup:null};
}
test('Shape uses reference imagery only for selected object geometry',()=>{
  const prompt=buildPrompt(sample('shape'),false);
  assert.match(prompt,/SHAPE REFERENCE IMAGES/);
  assert.match(prompt,/TARGETED OBJECT SHAPE EDIT/);
  assert.match(prompt,/leave all other camera, architecture and object geometry unchanged/);
  assert.doesNotMatch(prompt,/MATERIAL AND STYLE REFERENCES ONLY/);
});
test('Material/harmonize references cannot replace architecture',()=>{
  const prompt=buildPrompt(sample(null),false);
  assert.match(prompt,/MATERIAL AND STYLE REFERENCES ONLY/);
  assert.match(prompt,/Never copy their geometry/);
});
test('Remove reconstructs newly visible background',()=>{
  const prompt=buildPrompt(sample('remove'),false);
  assert.match(prompt,/TARGETED OBJECT REMOVAL/);
  assert.match(prompt,/reconstruct all background surfaces/);
});
