/* mozAI disk-backed image working set.
 * Lossless PNG assets stay in browser IndexedDB; only active images remain
 * decoded. No remote service, credentials, or cross-device sync.
 */
(() => {
  'use strict';
  const core = window.MosaicCore;
  const premium = window.MosaicPremium;
  if (!core || !premium) return;

  const DB = 'mozai-disk-assets-v1';
  const STORE = 'images';
  const MAX_BYTES = 750 * 1024 * 1024;
  const IDLE_DELAY = 15000;
  const SCAN_INTERVAL = 60000;
  const BATCH = 6;
  const RECENT_MS = 10000;
  let dbPromise = null;
  let timer = null;
  let sweeping = null;
  let blocked = 0;
  let projectEpoch = 0;
  let bytes = 0;
  let cacheAvailable = true;
  let initialized = false;
  let ownerAtStart = null;
  let notice = '';
  const recentlyUsed = new WeakMap();

  const hasCanvas = value => !!value && typeof value.toBlob === 'function' &&
    Number.isFinite(value.width) && Number.isFinite(value.height);
  const marker = field => field + 'DiskKey';
  const owner = () => {
    const user = window.MosaicAccount?.current?.();
    return user?.id ? 'user:' + user.id : 'guest';
  };
  const archive = () => premium.exportProjectState?.() || {};
  const history = () => {
    const nodes = [], seen = new Set();
    for(let node = archive().root; node && !seen.has(node); node = node.parent) {
      nodes.push(node); seen.add(node);
    }
    return nodes;
  };
  const throttle = message => {
    if(message === notice) return;
    notice = message;
    console.warn('[mozAI:disk-cache]', message);
  };
  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(Error('IndexedDB unavailable'));
    if (!dbPromise) dbPromise = new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB,1);
      req.onupgradeneeded = () => {
        if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('Disk cache unavailable'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function dbOperation(mode,operation) {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||Error('Disk cache write failed'));
      tx.onabort=()=>reject(tx.error||Error('Disk cache transaction aborted'));
      const req=operation(tx.objectStore(STORE));
      if(req) {
        req.onsuccess=()=>{result=req.result;};
        req.onerror=()=>reject(req.error||Error('Disk cache read failed'));
      }
    });
  }
  const read = id => dbOperation('readonly',store=>store.get(id));
  const write = record => dbOperation('readwrite',store=>store.put(record,record.id));
  const remove = id => dbOperation('readwrite',store=>store.delete(id));
  const list = () => dbOperation('readonly',store=>store.getAll());
  function toBlob(canvas) {
    return new Promise((resolve,reject)=>{
      try {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Cannot encode image for disk cache')),'image/png');
      } catch(error) { reject(error); }
    });
  }
  async function decode(blob) {
    // Canvas pixels are reconstructed exactly from the lossless PNG.
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width=image.width;canvas.height=image.height;
      canvas.getContext('2d').drawImage(image,0,0);
      return canvas;
    } finally { image.close?.(); }
  }
  function dataURI(blob) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error||Error('Could not read stored image'));
      reader.readAsDataURL(blob);
    });
  }
  function pins() {
    const active = new Set();
    const state=core.state;
    for(const group of state.groups) {
      const patch=state.patches.get(group.active);
      if(patch) active.add(patch.sourceId);
    }
    for(const id of [state.pendingSourceId,state.editingPatchId,state.selectedPatchId]) {
      if(!id) continue;
      if(state.sources.has(id)) active.add(id);
      const patch=state.patches.get(id);
      if(patch) active.add(patch.sourceId);
    }
    for(const patch of state.patches.values())
      if(patch.generating || patch.awaitingResult) active.add(patch.sourceId);
    return active;
  }

  async function offload(target,field,{check=()=>false,onEvict=()=>{}}={}) {
    const canvas=target?.[field];
    if(!hasCanvas(canvas) || check() || !cacheAvailable || blocked) return false;
    const epoch=projectEpoch, account=owner();
    try {
      const blob=await toBlob(canvas);
      if(check() || target[field]!==canvas || epoch!==projectEpoch || account!==owner() || blocked) return false;
      if(bytes + blob.size > MAX_BYTES) { throttle('Disk image budget reached; kept remaining assets in RAM.');return false; }
      const id=account+':'+crypto.randomUUID();
      await write({id,owner:account,blob,size:blob.size,createdAt:Date.now()});
      bytes+=blob.size;
      // Do not change the live graph until the lossless file has been persisted.
      if(check() || target[field]!==canvas || epoch!==projectEpoch || account!==owner() || blocked) return false;
      target[marker(field)]=id;
      target[field]=null;
      onEvict();
      return true;
    } catch(error) {
      cacheAvailable = false;
      throttle('Cannot offload images: '+String(error?.message||error));
      return false;
    }
  }
  async function ensure(target,field) {
    if(!target) return null;
    if(hasCanvas(target[field])) {
      recentlyUsed.set(target,Date.now());
      return target[field];
    }
    const key=target[marker(field)];
    if(!key) throw Error('This image is not available in memory or disk cache.');
    const record=await read(key);
    if(!record?.blob || record.owner!==owner())
      throw Error('Image cache is unavailable. Restore a saved .moz project.');
    const canvas=await decode(record.blob);
    // A newer image may have arrived while the disk version was decoding.
    if(!hasCanvas(target[field])) target[field]=canvas;
    recentlyUsed.set(target,Date.now());
    return target[field];
  }
  async function hydrateArchive(node,{all=false,flattened=false}={}) {
    if(!node)return;
    if(flattened){await ensure(node,'output');return;}
    await ensure(node,'base');
    if(all) await ensure(node,'output');
    const active=new Set(node.groups.filter(g=>g.active).map(g=>g.active));
    for(const group of node.groups) {
      if(all || group.active || !group.objectOriginal) {
        if(group.footprint || group.footprintDiskKey)
          await ensure(group,'footprint');
        if(group.objectOriginal) {
          if(group.objectOriginal.mask || group.objectOriginal.maskDiskKey)
            await ensure(group.objectOriginal,'mask');
          if(group.objectOriginal.appearance || group.objectOriginal.appearanceDiskKey)
            await ensure(group.objectOriginal,'appearance');
        }
      }
    }
    for(const [id,patch] of node.patches) {
      if(all || active.has(id)) await ensure(patch,'mask');
    }
    const ids=all ? [...node.sources.keys()] : [...active].map(id=>node.patches.get(id)?.sourceId).filter(Boolean);
    for(const id of new Set(ids)) {
      const source=node.sources.get(id);
      if(source) await ensure(source,'canvas');
    }
  }
  async function fillRegistry(registry) {
    for(const item of registry) {
      if(item.data !== null || !item.diskKey) continue;
      const record=await read(item.diskKey);
      if(!record?.blob || record.owner!==owner())
        throw Error('Missing archived image. Keep a downloaded .moz backup.');
      item.data=await dataURI(record.blob);
      delete item.diskKey;
    }
  }
  function invalidateSource(id) {
    core.releaseSourceTexture?.(id);
  }
  function candidates() {
    const items=[];
    const state=core.state;
    const active=pins();
    for(const [id,source] of state.sources) {
      if(!hasCanvas(source.canvas) || active.has(id)) continue;
      if(Date.now()-(recentlyUsed.get(source)||0)<RECENT_MS) continue;
      items.push({target:source,field:'canvas',check:()=>pins().has(id),onEvict:()=>invalidateSource(id)});
    }
    const snapshot=archive();
    const versions=snapshot.masterVersions||[];
    const dialog=document.getElementById('sourcePreviewDialog');
    for(const version of versions.slice(0,-1)) {
      if(!hasCanvas(version.image))continue;
      items.push({target:version,field:'image',check:()=>Boolean(dialog?.open)||Boolean(document.getElementById('harmonizeDialog')?.open)});
    }
    const previewId=snapshot.previewNode;
    for(const node of history()) {
      if(node.id===previewId) continue;
      const check=()=>archive().previewNode===node.id;
      for(const field of ['base','output']) if(hasCanvas(node[field]))items.push({target:node,field,check});
      for(const [id,source] of node.sources||[])
        if(hasCanvas(source.canvas))items.push({target:source,field:'canvas',check,
          onEvict:()=>{for(const patch of node.patches?.values()||[])
            if(patch.sourceId===id)core.releasePatchTexture?.(patch);}});
      for(const group of node.groups||[]) {
        if(hasCanvas(group.footprint))items.push({target:group,field:'footprint',check});
        const original=group.objectOriginal;
        if(original)for(const field of ['mask','appearance'])
          if(hasCanvas(original[field]))items.push({target:original,field,check});
      }
      for(const patch of node.patches?.values()||[])
        if(hasCanvas(patch.mask))items.push({target:patch,field:'mask',check,
          onEvict:()=>core.releasePatchTexture?.(patch)});
    }
    return items;
  }
  async function sweep() {
    if(sweeping) return sweeping;
    if(blocked || !cacheAvailable || !core.state.master || core.state.busy ||
      window.MosaicSourceEditor?.isEditing?.() ||
      [...core.state.patches.values()].some(p=>p.generating))return;
    sweeping=(async()=>{
      let done=0;
      const items=candidates();
      for(const item of items) {
        if(done>=BATCH || blocked || !cacheAvailable) break;
        if(await offload(item.target,item.field,item))done++;
      }
      if(done && items.length>done) schedule(3500);
    })().finally(()=>{sweeping=null;});
    return sweeping;
  }
  function schedule(delay=IDLE_DELAY) {
    if(timer || blocked || !cacheAvailable) return;
    timer=setTimeout(()=>{timer=null;void sweep();},delay);
  }
  function pause() {blocked++; return ()=>{blocked=Math.max(0,blocked-1);schedule();};}
  async function clearOwner(account=owner()) {
    projectEpoch++;
    clearTimeout(timer);timer=null;
    if(sweeping)await sweeping;
    const records=await list();
    for(const record of records)
      if(record.owner===account) {await remove(record.id);bytes=Math.max(0,bytes-record.size);}
  }
  const stats=()=>({ready:initialized,bytes,maxBytes:MAX_BYTES,available:cacheAvailable});

  async function init() {
    try {
      ownerAtStart=owner();
      const records=await list();
      bytes=records.reduce((sum,entry)=>sum+(Number(entry.size)||0),0);
      initialized=true;
      schedule();
    } catch(error) {
      cacheAvailable=false;
      throttle('IndexedDB cache unavailable: '+String(error?.message||error));
    }
  }
  window.MosaicDiskCache={ensure,hydrateArchive,fillRegistry,pause,sweep,schedule,
    clearOwner,stats};
  window.addEventListener('mosaic:projectloaded',()=>{projectEpoch++;schedule();});
  window.addEventListener('mosaic:projectreset',()=>{projectEpoch++;schedule();});
  document.addEventListener('pointerup',()=>schedule(),{passive:true});
  setInterval(()=>schedule(),SCAN_INTERVAL);
  void window.MosaicAccount?.ready?.().then(init).catch(error=>throttle(String(error)));
})();
