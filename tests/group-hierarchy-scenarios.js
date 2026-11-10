/* Run only against isolated mock OpenAI; no live account or API key. */
window.runGroupHierarchyChecks=async function(){
  const core=window.MosaicCore,{state,canvas,makeCanvas}=core,manager=window.MosaicObjectManager,$=id=>document.getElementById(id);
  const checks=[],assert=(ok,message)=>{if(!ok)throw Error(message)};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(test,label)=>{for(let i=0;i<600;i++){if(test())return;await pause(20)}throw Error('Timed out: '+label)};
  const native=window.fetch;let aiRequests=0;
  window.fetch=async(url,options)=>{if(String(url).startsWith('/api/ai/'))aiRequests++;return native(url,options)};
  try{
    await window.MosaicAccount.ready();
    if(!$('apiKeyDialog').open)$('apiKeyStatusBtn').click();
    await wait(()=>$('apiKeyDialog').open,'key dialog');
    $('apiKeyInput').value='sk-local-hierarchy-fixture';$('apiKeyForm').requestSubmit();
    await wait(()=>window.MosaicAuth.isReady(),'key');
    const base=makeCanvas(800,500),x=base.getContext('2d');
    x.fillStyle='#224488';x.fillRect(0,0,base.width,base.height);
    const file=await new Promise(resolve=>base.toBlob(blob=>resolve(new File([blob],'Base.png',{type:'image/png'}))));
    const transfer=new DataTransfer();transfer.items.add(file);
    $('referenceInput').files=transfer.files;$('referenceInput').dispatchEvent(new Event('change'));
    await wait(()=>state.reference,'base');
    $('welcomeContinueBtn').click();
    await wait(()=>state.objectMap?.entries?.length>=4&&state.objectCollections?.length>0,'object-map + hierarchy');
    const collections=state.objectCollections;
    assert(collections.length<=15&&collections.every(c=>c.auto),'Initial automatic group cap or flags are incorrect');
    assert(manager.objects().every(o=>collections.some(c=>c.id===o.collectionId)),'Every prepared object must have a parent Group');
    assert(!$('newVariantBtn')&&!document.body.textContent.includes('Add AI variation'),'Removed variation button remains');
    assert(collections.every(c=>(state.collapsedCategories||[]).includes(c.id)),'Auto groups should be collapsed initially');
    checks.push('Object Map creates at most 15 collapsed semantic-spatial groups, without changing individual IDs');

    const originalIds=manager.objects().map(o=>o.objectMapObjectKey);
    assert(new Set(originalIds).size===originalIds.length,'Auto groups lost instance identities');
    const first=collections.find(c=>manager.objects().filter(o=>o.collectionId===c.id).length>1)||collections[0];
    let children=manager.objects().filter(o=>o.collectionId===first.id);
    if(children.length<2){
      const other=manager.objects().find(o=>o.collectionId!==first.id);
      assert(other,'Fixture needs at least 2 objects');
      manager.moveObjects([other.id],first.id);
      children=manager.objects().filter(o=>o.collectionId===first.id);
    }
    const section=()=>document.querySelector('[data-collection="'+first.id+'"]');
    assert(section()&&section().querySelectorAll('.region-group').length===0,'Collapsed group rendered hundreds of child rows');
    section().querySelector('.object-category-head').click();
    assert(section().querySelectorAll('.region-group').length===children.length,'Expanded group does not expose every child');
    assert(section().querySelector('[data-merge-collection]'),'Merged Object action missing');
    checks.push('Groups expand into independent, individually editable parts on demand');

    const before=manager.objects().length,requestsBefore=aiRequests;
    section().querySelector('[data-merge-collection]').click();
    const merged=manager.objects().find(o=>o.isMergedObject&&o.collectionId===first.id);
    assert(merged&&manager.objects().length===before-children.length+1,'Merge did not consolidate into a single Object ID');
    assert(children.every(o=>o.mergedInto===merged.id),'Original sub-parts are not archived behind the consolidated object');
    assert(merged.patchIds.length===1&&merged.active&&state.patches.has(merged.active),'Merged object has no editable Option and mask');
    assert(manager.objects().filter(o=>o.collectionId===first.id).length===1,'Parent group still contains separate live object IDs');
    assert(aiRequests===requestsBefore,'Local merge must not bill an AI generation or Object Map refresh');
    checks.push('Explicit Merge Object consolidates every child mask locally while preserving old Options in project history');
    return {passed:checks.length,checks,groups:state.objectCollections.length,parts:manager.objects().length};
  }finally{window.fetch=native}
};
