const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,'..','image-disk-cache.js'),'utf8');
const portable = fs.readFileSync(path.join(__dirname,'..','project-file.js'),'utf8');

function canvas(width=32,height=24){
  return {width,height,toBlob(cb){cb(new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'}));},
    getContext(){return {drawImage(){}};}};
}
function harness({user={id:'sample'},archived=null}={}){
  const images = new Map(), callbacks = new Map(), notices = [];
  let created=false,sequence=0;
  const state={master:canvas(),reference:canvas(),busy:false,
    sources:new Map(),groups:[],patches:new Map(),pendingSourceId:null,
    editingPatchId:null,selectedPatchId:null};
  const premium={root:archived,masterVersions:[],previewNode:null};
  const indexedDB={open(){
    const req={};
    queueMicrotask(()=>{
      req.result={objectStoreNames:{contains:()=>created},
        createObjectStore(){created=true;},
        transaction(){
          const tx={};
          tx.objectStore=()=>({
            get(key){return perform(()=>images.get(key));},
            getAll(){return perform(()=>[...images.values()]);},
            put(record,key){return perform(()=>{images.set(key,record);return key;});},
            delete(key){return perform(()=>{images.delete(key);});}
          });
          const perform=fn=>{
            const op={};
            queueMicrotask(()=>{
              try{op.result=fn();op.onsuccess?.();tx.oncomplete?.();}
              catch(error){op.error=error;op.onerror?.();tx.onerror?.();}
            });
            return op;
          };
          return tx;
        }
      };
      if(!created)req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  }};
  const document={
    getElementById:()=>({open:false}),
    addEventListener(){},
    createElement(type){ assert.equal(type,'canvas');return canvas();}
  };
  const win={
    indexedDB,
    MosaicCore:{state,releaseSourceTexture(id){notices.push('released:'+id);},
      releasePatchTexture() {notices.push('released archive');}},
    MosaicPremium:{exportProjectState:()=>premium},
    MosaicAccount:{ready:()=>Promise.resolve(),current:()=>user},
    MosaicSourceEditor:{isEditing:()=>false},
    addEventListener(){}
  };
  const context={
    window:win,document,indexedDB,
    console:{warn(...args){notices.push(args.join(' '));}},
    createImageBitmap:async()=>({width:32,height:24,close(){}}),
    crypto:{randomUUID:()=>String(++sequence)},
    FileReader:class {
      readAsDataURL(blob){
        this.result='data:image/png;base64,'+Buffer.from([137,80,78,71]).toString('base64');
        queueMicrotask(()=>this.onload?.());
      }
    },
    Blob,Promise,Date,Error,Number,Set,Map,WeakMap,
    setTimeout(fn,delay){const key=++sequence;callbacks.set(key,{fn,delay});return key;},
    clearTimeout(key){callbacks.delete(key);},
    setInterval(){return ++sequence;}
  };
  vm.runInNewContext(source,context,{filename:'image-disk-cache.js'});
  return {
    state,premium,images,notices,api:win.MosaicDiskCache,
    async ready(){for(let i=0;i<50;i++)await Promise.resolve();},
    async tick(){
      const [key,item]=[...callbacks.entries()][0]||[];
      if(item){callbacks.delete(key);item.fn();}
      for(let i=0;i<50;i++)await Promise.resolve();
    }
  };
}

test('browser disk image manager parses and portable project serializer supports offloaded image markers',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.match(portable,/offloadedImage\(diskKey\)/);
  assert.match(portable,/fillRegistry/);
  assert.match(portable,/key\.endsWith\('DiskKey'\)/);
});

test('inactive option RGB is offloaded without losing active image, and reload restores it',async()=>{
  const h=harness();
  const original=canvas();
  h.state.sources.set('live',{id:'live',canvas:canvas()});
  h.state.sources.set('older',{id:'older',canvas:original});
  h.state.groups.push({active:'patch-live'});
  h.state.patches.set('patch-live',{id:'patch-live',sourceId:'live'});
  h.state.patches.set('patch-old',{id:'patch-old',sourceId:'older'});
  await h.ready();
  await h.api.sweep();
  assert.ok(h.state.sources.get('live').canvas);
  assert.equal(h.state.sources.get('older').canvas,null);
  const key=h.state.sources.get('older').canvasDiskKey;
  assert.ok(h.images.has(key));
  assert.equal(h.notices.includes('released:older'),true);
  const restored=await h.api.ensure(h.state.sources.get('older'),'canvas');
  assert.equal(restored.width,32);
  assert.ok(h.state.sources.get('older').canvas);
});

test('archived graph images and masks can be evicted then losslessly rehydrated',async()=>{
  const node={
    id:'archive-1',parent:null,base:canvas(),output:canvas(),
    groups:[{active:'old-patch',footprint:canvas(),objectOriginal:null}],
    patches:new Map([['old-patch',{id:'old-patch',sourceId:'old-image',mask:canvas()}]]),
    sources:new Map([['old-image',{id:'old-image',canvas:canvas()}]])
  };
  const h=harness({archived:node});
  await h.ready();
  await h.api.sweep();
  assert.equal(node.base,null);
  assert.equal(node.output,null);
  assert.equal(node.patches.get('old-patch').mask,null);
  assert.equal(node.sources.get('old-image').canvas,null);
  await h.api.hydrateArchive(node,{all:true});
  assert.ok(node.base && node.output && node.patches.get('old-patch').mask);
  assert.ok(node.sources.get('old-image').canvas);
});

test('offline PNG registry can be embedded into portable .moz and New Project clears only its user assets',async()=>{
  const h=harness();
  h.state.sources.set('older',{id:'older',canvas:canvas()});
  await h.ready();
  await h.api.sweep();
  const key=h.state.sources.get('older').canvasDiskKey;
  const registry=[{id:0,data:null,diskKey:key}];
  await h.api.fillRegistry(registry);
  assert.match(registry[0].data,/^data:image\/png;base64,/);
  assert.equal(Object.hasOwn(registry[0],'diskKey'),false);
  await h.api.clearOwner('user:sample');
  assert.equal(h.images.size,0);
});
