const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'workspace-ui.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=app.indexOf('function quickPromptOutsideSelection(');
const end=app.indexOf('function showQuickPrompt(',start);
assert(start>=0&&end>start,'Popup placement helper is missing');
const choose=new Function(app.slice(start,end)+';return quickPromptOutsideSelection')();
const clip=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
  Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
const box=(p,w,h)=>({left:p.x,right:p.x+w,top:p.y,bottom:p.y+h});
const viewport={left:20,top:20,right:900,bottom:680},size={width:170,height:130};

test('popup is placed completely outside selections when any side has room',()=>{
  const scenes=[
    {selected:{left:300,top:230,right:490,bottom:390},point:{x:420,y:300}},
    {selected:{left:650,top:200,right:875,bottom:440},point:{x:830,y:280}},
    {selected:{left:280,top:460,right:550,bottom:650},point:{x:440,y:600}},
    {selected:{left:40,top:30,right:300,bottom:250},point:{x:100,y:90}}
  ];
  for(const scene of scenes){
    const p=choose(scene.selected,viewport,size,scene.point),placed=box(p,size.width,size.height);
    assert.equal(clip(placed,scene.selected),0,'popup overlaps selection: '+JSON.stringify(scene));
    assert(placed.left>=viewport.left&&placed.right<=viewport.right);
    assert(placed.top>=viewport.top&&placed.bottom<=viewport.bottom);
  }
});

test('when there is no free side, popup stays on screen and minimizes overlap',()=>{
  const available={left:0,top:0,right:260,bottom:190};
  const selected={left:60,top:65,right:185,bottom:160};
  const form={width:170,height:125};
  const p=choose(selected,available,form),placed=box(p,form.width,form.height);
  assert(placed.left>=available.left&&placed.right<=available.right);
  assert(placed.top>=available.top&&placed.bottom<=available.bottom);
  assert(clip(placed,selected)<form.width*form.height);
});

test('options are collapsed and compact instead of expanding the prompt sideways',()=>{
  assert.match(app,/document\.createElement\('details'\)/);
  assert.match(app,/document\.createElement\('summary'\)/);
  assert.match(app,/rail\.open=false/);
  assert.match(app,/form\.insertBefore\(rail,form\.querySelector\('\.prompt-footer'\)\)/);
  assert.match(css,/width:170px/);
  assert.match(css,/\.quick-area-prompt\.has-group-options\{/);
  assert(!html.includes('Collage + mask'),'redundant helper text remains');
  assert.match(html,/id="quickAreaPromptInput" rows="1"/);
});
