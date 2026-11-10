/* Object state is metadata on existing Groups and Options. Smart Select is
   explicitly enabled in the prompt; other object processing stays invisible. */
import './app.js';
import {binary,signature,count,combine,overlap,bounds,sceneOrder} from './object-mask-utils.mjs';
const core=window.MosaicCore,{state,makeCanvas}=core;
const config=window.MosaicObjectConfig||{};
let selection=null,revision=0,timer,applying=false,preview=null,previewFrame,repairTimer,repairRevision=0,worker,workerSerial=0;
let smartSelectEnabled=false,smartModeRevision=0,smartProgress=null;
const maskCache=new Map(),intentCache=new Map(),inflight=new Map(),jobs=new Map(),failures=new Map(),identities=new WeakMap();let identitySerial=0;
const binaryCache=new WeakMap(),originalDrawCache=new WeakMap(),repairClipCache=new WeakMap();
const identity=value=>{if(!value)return '';if(!identities.has(value))identities.set(value,++identitySerial);return identities.get(value)};
const copy=source=>{const out=makeCanvas(source.width,source.height);out.getContext('2d').drawImage(source,0,0);return out};
const data=mask=>{if(mask!==state.selectionMask&&binaryCache.has(mask))return binaryCache.get(mask);const bits=binary(mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,mask.width,mask.height).data);if(mask!==state.selectionMask)binaryCache.set(mask,bits);return bits};
function raster(bits,w=core.canvas.width,h=core.canvas.height){const c=makeCanvas(w,h),x=c.getContext('2d'),frame=x.createImageData(w,h);for(let i=0;i<bits.length;i++)if(bits[i])frame.data.fill(255,i*4,i*4+4);x.putImageData(frame,0,0);return c}
function remember(cache,key,value,max=48){cache.delete(key);cache.set(key,value);while(cache.size>max)cache.delete(cache.keys().next().value);return value}
function mountSmartSelect(form){
  if(!form||form.querySelector('[data-smart-select]'))return;
  const row=document.createElement('div');row.className='smart-select-row';
  const label=document.createElement('label');label.className='smart-select-toggle';
  const input=document.createElement('input');input.type='checkbox';input.dataset.smartSelect='';input.checked=smartSelectEnabled;
  const title=document.createElement('span');title.textContent='Smart Select';label.append(input,title);
  const progress=document.createElement('div');progress.className='smart-select-progress';progress.dataset.smartSelectProgress='';progress.hidden=true;progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Smart Select');progress.append(document.createElement('span'));
  row.append(label,progress);form.insertBefore(row,form.querySelector('.prompt-footer,.dialog-actions,[type="submit"]'));
  const status=document.createElement('div');status.className='smart-select-status';status.dataset.smartSelectStatus='';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const detail=document.createElement('span');detail.dataset.smartSelectDetail='';
  const retry=document.createElement('button');retry.type='button';retry.dataset.smartSelectRetry='';retry.textContent='Retry';retry.hidden=true;
  retry.addEventListener('click',()=>{const prompt=form.querySelector('textarea,input[type="text"]');if(prompt)promptInput({target:prompt})});
  status.append(detail,retry);row.after(status);
}
function clearSmartStatus(){document.querySelectorAll('[data-smart-select-status]').forEach(status=>{status.hidden=true})}
function isCurrentSelection(context){return smartSelectEnabled&&context.mode===smartModeRevision&&context.revision===revision&&context.project===state.selectionGeneration&&context.owner===selection}
function showSmartStatus(context,detail,retry=false){
  if(!isCurrentSelection(context))return;
  const status=(context.form||document.getElementById('quickAreaPromptForm'))?.querySelector('[data-smart-select-status]');if(!status)return;
  status.querySelector('[data-smart-select-detail]').textContent=detail;status.querySelector('[data-smart-select-retry]').hidden=!retry;status.hidden=false;
}
function smartFailure(error){
  if(error?.code==='SAM3_QUOTA'||error?.status===429)return 'Smart Select quota reached. Try again later or keep your drawn selection.';
  if(error?.status===401)return 'Sign in again to use Smart Select.';
  if(error?.code==='OPENAI_KEY_MISSING')return 'Connect AI in your profile to use Smart Select.';
  if(error?.status===503||error?.status===504)return 'Object selection is temporarily unavailable. Try again later.';
  return 'Could not select the object. Retry or adjust your area and prompt.';
}
function clearSmartProgress(){
  smartProgress=null;document.querySelectorAll('[data-smart-select-progress]').forEach(bar=>{bar.hidden=true;bar.closest('form')?.removeAttribute('aria-busy')});window.MosaicMaskProgress?.hide('smart-select');
}
function showSmartProgress(context,detail){
  if(!smartSelectEnabled||context.mode!==smartModeRevision||context.revision!==revision||context.owner!==selection)return;
  smartProgress=context;
  const form=context.form||document.getElementById('quickAreaPromptForm');
  const bar=form?.querySelector('[data-smart-select-progress]');if(bar){bar.hidden=false;form.setAttribute('aria-busy','true')}
  window.MosaicMaskProgress?.show('smart-select','Smart Select',detail);
}
function finishSmartProgress(context){if(smartProgress?.revision===context.revision&&smartProgress?.mode===context.mode)clearSmartProgress()}
function smartSelectChanged(event){
  const input=event.target;if(!input.matches('[data-smart-select]'))return;
  smartSelectEnabled=input.checked;smartModeRevision++;revision++;clearTimeout(timer);clearSmartProgress();clearSmartStatus();restoreOriginal();
  if(smartSelectEnabled&&selection){selection.manual=false;selection.manualIntent=null}
  document.querySelectorAll('[data-smart-select]').forEach(control=>{control.checked=smartSelectEnabled});
  if(smartSelectEnabled){const prompt=input.closest('form')?.querySelector('textarea,input[type="text"]');if(prompt)promptInput({target:prompt})}
}
function currentGroup(){return state.groups.find(g=>g.id===state.draftGroupId||g.patchIds.includes(state.selectionTargetPatchId))}
function reset(){clearSmartProgress();clearSmartStatus();clearTimeout(timer);clearTimeout(repairTimer);revision++;repairRevision++;selection=null;preview=null;cancelAnimationFrame(previewFrame);maskCache.clear();intentCache.clear();inflight.clear();failures.clear();if(worker){worker.terminate();worker=null}for(const job of jobs.values())job.reject(Error('Project changed'));jobs.clear()}
function cancelSelection(){window.MosaicObjectMap?.cancelSelection();clearSmartProgress();clearSmartStatus();revision++;clearTimeout(timer);cancelAnimationFrame(previewFrame);selection=null;preview=null}
function selectionChanged(){
  if(applying)return;
  const mask=state.selectionMask;
  if(!mask||!state.master)return;
  const hash=signature(data(mask));
  if(selection?.hash===hash&&selection.project===state.selectionGeneration&&selection.target===state.selectionTargetPatchId)return;
  const corrected=Boolean(preview&&selection?.project===state.selectionGeneration),manualIntent=corrected?preview.intent:null;
  revision++;clearTimeout(timer);clearSmartProgress();clearSmartStatus();preview=null;
  selection={hash,project:state.selectionGeneration,target:state.selectionTargetPatchId,mask:copy(mask),paths:window.MozMaskGeometry.copyPaths(state.selectionPaths),groupId:currentGroup()?.id||null,manual:corrected,manualIntent};
}
function freeze(){selectionChanged();if(!selection||!count(data(selection.mask)))return null;if(!preview)selection.paths=window.MozMaskGeometry.copyPaths(state.selectionPaths);return {...selection,groupId:currentGroup()?.id||selection.groupId}}
function tint(mask){const out=copy(mask),x=out.getContext('2d');x.globalCompositeOperation='source-in';x.fillStyle='#9d78ef';x.fillRect(0,0,out.width,out.height);return out}
function showMask(mask,context,intent){
  if(!smartSelectEnabled||context.mode!==smartModeRevision||context.project!==state.selectionGeneration||selection!==context.owner||context.revision!==revision||state.maskEditOnly||state.pendingSourceId||state.drawing||state.maskMoveDrag||state.maskVertexDrag||state.lasso.length)return;
  const before=preview?.mask||context.mask;
  applying=true;
  state.selectionMask=copy(mask);state.selectionPaths=core.maskPathsFromRaster(mask);state.selectionPoints=state.selectionPaths.flat();state.selectionOverlayHidden=false;
  const oldGroup=state.groups.find(g=>g.id===context.groupId);
  const group=core.matchingGroup(mask)||(!oldGroup?.patchIds.length?oldGroup:null);
  if(group&&oldGroup&&group!==oldGroup&&!oldGroup.patchIds.length&&!oldGroup.manualName)state.groups=state.groups.filter(g=>g!==oldGroup);
  if(group){state.draftGroupId=group.id;if(!group.patchIds.length){group.footprint=copy(mask);group.area=core.maskBoundingBox(mask);group.maskPaths=window.MozMaskGeometry.copyPaths(state.selectionPaths)}}else{state.draftGroupId=null;state.selectionTargetPatchId=null}
  preview={mask:state.selectionMask,old:tint(before),tint:tint(mask),oldPaths:core.maskPathsFromRaster(before),start:performance.now(),intent};
  selection.hash=signature(data(state.selectionMask));selection.target=state.selectionTargetPatchId;
  core.updateSelectionOutline();core.updateApplyButton();applying=false;
  const animate=()=>{core.render();if(preview&&performance.now()-preview.start<180)previewFrame=requestAnimationFrame(animate)};cancelAnimationFrame(previewFrame);animate();
}
function restoreOriginal(){
  if(!preview||!selection)return;
  applying=true;preview=null;state.selectionMask=copy(selection.mask);state.selectionPaths=window.MozMaskGeometry.copyPaths(selection.paths);state.selectionPoints=state.selectionPaths.flat();selection.hash=signature(data(state.selectionMask));core.updateSelectionOutline();core.render();applying=false;
}
function drawPreview(context,vectors){
  if(!preview||state.selectionOverlayHidden||state.maskEditOnly)return false;
  const t=Math.min(1,(performance.now()-preview.start)/180);
  context.save();context.globalAlpha=.14*(1-t);context.drawImage(preview.old,0,0);context.globalAlpha=.14*t;context.drawImage(preview.tint,0,0);context.restore();
  if(t<1){const old=core.svgNode('g',{opacity:1-t});core.drawVectorPaths(old,preview.oldPaths,{color:'#b493f5',width:.65});vectors.append(old)}
  const next=core.svgNode('g',{opacity:t});core.drawVectorPaths(next,state.selectionPaths,{color:'#b493f5',width:.65});vectors.append(next);return true;
}
function frameContext(mask){
  const image=core.composeApprovedCanvas(),scale=Math.min(1,896/Math.max(image.width,image.height)),w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
  const small=makeCanvas(w,h),x=small.getContext('2d');x.drawImage(image,0,0,w,h);
  const jpeg=small.toDataURL('image/jpeg',.82),colored=tint(mask);x.globalAlpha=.35;x.drawImage(colored,0,0,w,h);x.globalAlpha=1;
  return {image:jpeg,intentImage:small.toDataURL('image/jpeg',.82),width:w,height:h,scaleX:w/image.width,scaleY:h/image.height};
}
function objects(){return state.groups.filter(g=>g.area).slice(0,64).map(g=>({id:g.id,label:g.objectLabel||g.category||g.name,box:g.area}))}
async function segment(frame,label,mask){
  const box=core.exactMaskBoundingBox(mask);if(!box)return null;
  const guidance=[box.x*frame.scaleX,box.y*frame.scaleY,Math.min(frame.width,(box.x+box.w)*frame.scaleX),Math.min(frame.height,(box.y+box.h)*frame.scaleY)];
  const key=mask.width+'x'+mask.height+':'+signature(new TextEncoder().encode(frame.image))+':'+label+':'+guidance.map(v=>v.toFixed(2)).join(',');
  if(maskCache.has(key))return maskCache.get(key);
  if(inflight.has(key))return inflight.get(key);
  const request=(async()=>{
    const answer=await window.MosaicAccount.request('/api/ai/sam3',{method:'POST',body:{mode:'object',image:frame.image,width:frame.width,height:frame.height,label,box:guidance}});
    if(typeof answer.mask!=='string'||!/^data:image\/png;base64,/.test(answer.mask)||answer.mask.length>4000000)return null;
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=answer.mask});
    if(image.width!==frame.width||image.height!==frame.height)return null;
    const result=makeCanvas(mask.width,mask.height),x=result.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(image,0,0,result.width,result.height);
    const check=overlap(data(mask),data(result));
    if(check.b<16||check.b>mask.width*mask.height*.94||check.coverage<.5||check.intersection/Math.max(1,Math.min(check.a,check.b))<.2)return null;
    return remember(maskCache,key,result,Math.max(2,Math.min(32,Math.floor(32000000/(mask.width*mask.height)))));
  })().finally(()=>inflight.delete(key));inflight.set(key,request);return request;
}
async function analyze(context,prompt,display=true){
  const fallback={mask:context.mask,paths:context.paths,intent:context.manualIntent||null,groupId:context.groupId};
  if(!isCurrentSelection(context)||context.manual||state.pendingSourceId||state.maskEditOnly)return fallback;
  if(prompt.trim().length<2){showSmartStatus(context,'Name the object in your prompt to select it.');return fallback}
  try{
    // Restore the saved connection before deciding it is missing. Readiness can
    // still be pending when Smart Select is checked just after opening a project.
    showSmartProgress(context,'Checking AI connection…');
    if(!window.MosaicAuth?.isReady?.()&&!(await window.MosaicAuth?.restore?.())){
      showSmartStatus(context,'Connect AI in your profile to use Smart Select.',true);return fallback;
    }
    if(!isCurrentSelection(context))return fallback;
    showSmartProgress(context,'Finding object…');
    const frame=frameContext(context.mask),known=objects();
    const key=context.mode+':'+signature(new TextEncoder().encode(frame.image))+signature(data(context.mask))+JSON.stringify(known)+prompt.trim();
    let promise=intentCache.get(key);
    if(!promise){promise=(async()=>{
      const intent=await window.MosaicAccount.request('/api/ai/object-intent',{method:'POST',body:{image:frame.intentImage,prompt,objects:known}});
      if(!isCurrentSelection(context)){intentCache.delete(key);return fallback}
      if(intent.kind!=='object'||intent.confidence<.8||!intent.label){intentCache.delete(key);return {...fallback,notice:'No clear object found. Name one object in your prompt.'}}
      showSmartProgress(context,'Selecting object…');
      // A selected existing object can reuse its mask only if the semantic label
      // still matches. A new target noun must go back through SAM.
      const existing=state.groups.find(g=>g.id===context.groupId),same=existing?.objectLabel?.toLowerCase()===intent.label.toLowerCase();
      const mask=same&&!existing.objectMaskUncertain?copy(core.groupMask(existing)):await segment(frame,intent.label,context.mask);
      if(!mask){intentCache.delete(key);return {...fallback,notice:'Could not find that object in this area. Adjust the area or prompt.',retry:true}}
      return {mask,paths:core.maskPathsFromRaster(mask),intent,groupId:same?existing.id:core.matchingGroup(mask)?.id||(!existing?.patchIds.length?context.groupId:null)};
    })().catch(error=>{intentCache.delete(key);return {...fallback,notice:smartFailure(error),retry:true}});remember(intentCache,key,promise,64)}
    const result=await promise;
    if(!isCurrentSelection(context))return fallback;
    if(display&&result.intent)showMask(result.mask,context,result.intent);
    if(result.notice)showSmartStatus(context,result.notice,result.retry);
    else if(result.intent)showSmartStatus(context,'Selected: '+result.intent.label+'.');
    return result;
  }catch(error){showSmartStatus(context,smartFailure(error),true);return fallback}
  finally{finishSmartProgress(context)}
}
function promptInput(event){
  const input=event.target;
  if(!['quickAreaPromptInput','areaPromptInput'].includes(input.id)&&!(input.type==='text'&&input.closest('.region-option-prompt')))return;
  if(!smartSelectEnabled)return;
  const context=freeze();if(!context)return;
  revision++;clearTimeout(timer);clearSmartProgress();clearSmartStatus();restoreOriginal();
  context.owner=selection;context.revision=revision;context.mode=smartModeRevision;context.form=input.closest('form');
  const prompt=input.value;
  timer=setTimeout(()=>void analyze(context,prompt),config.debounceMs??650);
}
async function prepare(prompt){
  if(!smartSelectEnabled)return null;
  clearTimeout(timer);const context=freeze();if(!context)return null;
  context.owner=selection;context.revision=revision;context.mode=smartModeRevision;
  const result=await analyze(context,prompt);
  if(!smartSelectEnabled||context.mode!==smartModeRevision)return {mask:context.mask,paths:context.paths,intent:null,groupId:context.groupId,project:context.project};
  return {...result,project:context.project};
}
function orderedGroups(){return sceneOrder(state.groups)}
function setIdentity(group,mask,label){
  if(!group.objectOriginal){group.objectOriginal={mask:copy(mask),appearance:core.composeApprovedCanvas(),geometryId:signature(data(mask)),repairs:[]}}
  if(label)group.objectLabel=label;
  group.objectId=group.objectId||group.id;
}
function foreground(group){const order=orderedGroups(),index=order.indexOf(group);return order.slice(index+1).map(g=>({group:g,patch:state.patches.get(g.active),mask:g.active?core.groupMask(g):g.objectOriginal?.mask||g.footprint})).filter(item=>item.mask&&item.group.objectLabel)}
function capture(patch,group,objectSelection){
  if(!objectSelection?.intent)return;
  const intent=objectSelection.intent;setIdentity(group,patch.mask,intent.label);
  group.objectBehind=[...new Set(intent.behind||[])].filter(id=>id!==group.id);
  // Surfaces underneath furniture remain behind it even if edited later.
  if(/^(rug|carpet|floor|flooring)$/i.test(intent.label))for(const other of state.groups)if(other!==group&&/table|chair|sofa|bed|cabinet/i.test(other.objectLabel||''))group.objectBehind.push(other.id);
  patch.objectId=group.objectId;patch.objectLabel=intent.label;patch.geometryIntent=intent.geometry;patch.geometryId=signature(data(patch.mask));patch.objectRepairs=[];
  let occluded=new Uint8Array(patch.mask.width*patch.mask.height);
  for(const item of foreground(group))occluded=combine(occluded,data(item.mask));
  patch.objectOccluded=raster(occluded);patch.objectValid=raster(combine(data(patch.mask),occluded,'subtract'));
  // Preserve the geometric support behind an occluder separately from the
  // visible silhouette; otherwise the hole would disappear from the model.
  const box=bounds(data(patch.mask),patch.mask.width,patch.mask.height),support=data(patch.mask).slice();
  if(box)for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const i=y*patch.mask.width+x;if(occluded[i])support[i]=1}
  patch.objectSupport=raster(support);
  scheduleRepair();
}
function generationMask(patch){
  const visual=core.displayedPatchMask(patch);
  if(!smartSelectEnabled||!patch.objectId||patch.geometryIntent==='appearance'||patch.corners?.length)return visual;
  const bits=data(visual),box=bounds(bits,patch.mask.width,patch.mask.height,Math.max(12,Math.round(Math.max(patch.bbox.w,patch.bbox.h)*.12)));
  if(!box)return patch.mask;
  const mask=makeCanvas(patch.mask.width,patch.mask.height),x=mask.getContext('2d');x.fillStyle='#fff';x.fillRect(box.x,box.y,box.w,box.h);
  const group=state.groups.find(g=>g.id===patch.groupId);for(const item of foreground(group)){x.globalCompositeOperation='destination-out';x.drawImage(item.mask,0,0)}
  return mask;
}
function geometryUncertain(before,after,mask){
  if(!before)return true;
  const w=mask.width,h=mask.height,s=Math.min(1,256/Math.max(w,h)),sw=Math.max(1,Math.round(w*s)),sh=Math.max(1,Math.round(h*s));
  const sample=source=>{const c=makeCanvas(sw,sh),x=c.getContext('2d');x.drawImage(source,0,0,sw,sh);return x.getImageData(0,0,sw,sh).data};
  const m=binary(sample(mask)),a=sample(before),b=sample(after);let total=0,changed=0;
  for(let y=1;y<sh-1;y++)for(let x=1;x<sw-1;x++){const i=y*sw+x;if(!m[i]||m[i-1]&&m[i+1]&&m[i-sw]&&m[i+sw])continue;total++;let aa=0,bb=0;for(let c=0;c<3;c++){aa+=Math.abs(a[i*4+c]-a[(i-1)*4+c]);bb+=Math.abs(b[i*4+c]-b[(i-1)*4+c])}if(Math.abs(aa-bb)>90)changed++}
  return !total||changed/total>.25;
}
async function validateGenerated(patch,fullImage,originalMask,before){
  if(!patch.objectId)return {mask:originalMask,valid:true};
  if(!smartSelectEnabled)return {mask:originalMask,valid:false};
  if(patch.corners?.length)return {mask:originalMask,valid:false};
  const group=state.groups.find(g=>g.id===patch.groupId),project=state.selectionGeneration;
  if(patch.geometryIntent==='appearance'&&!geometryUncertain(before,fullImage,originalMask))return {mask:originalMask,valid:true};
  try{
    const scale=Math.min(1,896/Math.max(fullImage.width,fullImage.height)),small=makeCanvas(Math.round(fullImage.width*scale),Math.round(fullImage.height*scale));small.getContext('2d').drawImage(fullImage,0,0,small.width,small.height);
    const frame={image:small.toDataURL('image/jpeg',.85),width:small.width,height:small.height,scaleX:small.width/fullImage.width,scaleY:small.height/fullImage.height};
    const mask=await segment(frame,patch.objectLabel,generationMask(patch));
    if(project!==state.selectionGeneration||state.patches.get(patch.id)!==patch)return {mask:originalMask,valid:false};
    if(mask){const same=overlap(data(mask),data(originalMask)).iou>=.97;return {mask:same?originalMask:mask,valid:true}}
  }catch{/* Uncertain geometry keeps the user's safe mask and may retry later. */}
  if(group)group.objectMaskUncertain=true;
  return {mask:originalMask,valid:false};
}
function generated(patch,mask,valid){
  if(!patch.objectId)return;
  patch.geometryId=signature(data(mask));patch.objectMaskUncertain=!valid;patch.objectRepairs=[];
  const oldSupport=patch.objectSupport||mask;
  patch.objectValid=copy(mask);patch.objectSupport=copy(mask);
  if(patch.objectOccluded){patch.objectValid=raster(combine(data(mask),data(patch.objectOccluded),'subtract'));patch.objectSupport=raster(combine(data(mask),combine(data(oldSupport),data(patch.objectOccluded),'intersect')))}
  const group=state.groups.find(g=>g.id===patch.groupId);if(group)group.objectMaskUncertain=!valid;
  scheduleRepair();
}
function repairWorker(payload){
  if(!worker){worker=new Worker('./object-repair-worker.js');worker.onmessage=({data:answer})=>{const job=jobs.get(answer.id);if(!job)return;jobs.delete(answer.id);answer.error?job.reject(Error(answer.error)):job.resolve(answer.rgba)};worker.onerror=()=>{for(const job of jobs.values())job.reject(Error('Repair worker failed'));jobs.clear();worker.terminate();worker=null}}
  return new Promise((resolve,reject)=>{const id=++workerSerial;const timeout=setTimeout(()=>{jobs.delete(id);reject(Error('Repair timeout'))},120000);jobs.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}});worker.postMessage({...payload,id,config:config.repair||{}})});
}
function token(){return state.selectionGeneration+':'+identity(state.master)+':'+orderedGroups().map(g=>{const p=state.patches.get(g.active);return [g.id,g.active,p&&identity(state.sources.get(p.sourceId)?.canvas),p?.geometryId,identity(p?.mask),JSON.stringify(p?.corners||[])].join('/')}).join('|')}
function scheduleRepair(){clearTimeout(repairTimer);const version=++repairRevision;repairTimer=setTimeout(()=>void repairScene(version),config.repairDebounceMs??100)}
function drawRepairs(target,record,allowed=null){for(const repair of record?.objectRepairs||record?.repairs||[]){if(!repair.image||!repair.mask)continue;const c=copy(repair.image),x=c.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(repair.mask,0,0);if(allowed)x.drawImage(allowed,-repair.x,-repair.y);target.drawImage(c,repair.x,repair.y)}}
function drawBase(target,groups=orderedGroups(),patches=state.patches){
  for(const group of groups)if(group.objectOriginal?.repairs?.length&&group.active){const active=patches.get(group.active);if(!active||active.awaitingResult)continue;const mask=core.displayedPatchMask(active);let cached=repairClipCache.get(group.objectOriginal);if(!cached||cached.mask!==mask){cached={mask,canvas:raster(combine(data(group.objectOriginal.mask),data(mask),'subtract'))};repairClipCache.set(group.objectOriginal,cached)}drawRepairs(target,group.objectOriginal,cached.canvas)}
}
function drawOriginal(target,group){
  if(group.active||!group.objectOriginal?.appearance)return;
  let original=originalDrawCache.get(group.objectOriginal);if(!original){original=copy(group.objectOriginal.appearance);const x=original.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(group.objectOriginal.mask,0,0);originalDrawCache.set(group.objectOriginal,original)}target.drawImage(original,0,0);
}
function drawOptionRepairs(target,group,patch){if(!patch?.objectRepairs?.length||patch.corners?.length)return;const support=patch.objectSupport||patch.mask,valid=patch.objectValid||patch.mask;let cached=repairClipCache.get(patch);if(!cached||cached.support!==support||cached.valid!==valid){cached={support,valid,canvas:raster(combine(data(support),data(valid),'subtract'))};repairClipCache.set(patch,cached)}drawRepairs(target,patch,cached.canvas)}
function invalidated(patch){
  if(!patch?.objectId)return;
  binaryCache.delete(patch.mask);repairClipCache.delete(patch);
  const group=state.groups.find(g=>g.id===patch.groupId);if(group?.objectOriginal)repairClipCache.delete(group.objectOriginal);
  const key=signature(data(patch.mask));if(patch.geometryId!==key){patch.geometryId=key;patch.objectMaskUncertain=true;patch.objectSupport=copy(patch.mask)}
  scheduleRepair();
}
function drawComposition(target,base,groups,patches,sources){
  target.clearRect(0,0,core.canvas.width,core.canvas.height);target.drawImage(base,0,0);const ordered=sceneOrder(groups);drawBase(target,ordered,patches);
  for(const group of ordered){if(!group.active){drawOriginal(target,group);continue}const patch=patches.get(group.active),source=patch&&sources.get(patch.sourceId);if(patch&&source){core.drawPatch(target,patch,source);drawOptionRepairs(target,group,patch)}}
}
async function repairScene(version){
  if(!state.master||version!==repairRevision)return;
  const scene=token(),project=state.selectionGeneration,w=core.canvas.width,h=core.canvas.height;
  const requests=[];
  for(const group of orderedGroups()){
    const patch=state.patches.get(group.active);if(!group.objectOriginal||patch?.awaitingResult||patch?.corners?.length)continue;
    const mask=patch?core.groupMask(group):group.objectOriginal.mask;
    // Master texture hidden by the original object is a reusable base repair.
    if(patch){const missing=combine(data(group.objectOriginal.mask),data(mask),'subtract');if(count(missing))requests.push({record:group.objectOriginal,missing,exclude:combine(data(group.objectOriginal.mask),data(mask)),image:state.master,group,base:true})}
    if(!patch?.objectId)continue;
    const support=data(patch.objectSupport||mask),valid=data(patch.objectValid||mask);
    let missing=combine(support,valid,'subtract'),occlusion=new Uint8Array(w*h);
    for(const item of foreground(group))occlusion=combine(occlusion,data(item.mask));
    missing=combine(missing,occlusion,'subtract');
    if(count(missing))requests.push({record:patch,missing,exclude:Uint8Array.from(valid,v=>v?0:1),image:state.sources.get(patch.sourceId)?.canvas,group});
  }
  for(const request of requests){
    if(version!==repairRevision||scene!==token()||project!==state.selectionGeneration)return;
    const {record,image}=request;if(!image)continue;
    let missing=request.missing;record[request.base?'repairs':'objectRepairs']??=[];
    for(const repair of record.repairs||record.objectRepairs||[]){const restored=makeCanvas(w,h);restored.getContext('2d').drawImage(repair.mask,repair.x,repair.y);missing=combine(missing,data(restored),'subtract')}
    const area=bounds(missing,w,h);if(!area)continue;
    const source=copy(image);drawRepairs(source.getContext('2d'),record);
    // Contextual tiles bound WASM memory while retaining full document resolution.
    for(let yy=area.y;yy<area.y+area.h;yy+=512)for(let xx=area.x;xx<area.x+area.w;xx+=512){
      const tile={x:Math.max(0,xx-64),y:Math.max(0,yy-64),w:Math.min(w,xx+576)-Math.max(0,xx-64),h:Math.min(h,yy+576)-Math.max(0,yy-64)};
      const crop=makeCanvas(tile.w,tile.h),x=crop.getContext('2d');x.drawImage(source,-tile.x,-tile.y);
      const holes=new Uint8Array(tile.w*tile.h),exclude=new Uint8Array(holes.length);
      for(let y=0;y<tile.h;y++)for(let xx2=0;xx2<tile.w;xx2++){const i=y*tile.w+xx2,global=(y+tile.y)*w+xx2+tile.x;holes[i]=+(missing[global]&&xx2+tile.x>=xx&&xx2+tile.x<xx+512&&y+tile.y>=yy&&y+tile.y<yy+512);exclude[i]=request.exclude[global]}
      if(!count(holes))continue;
      const key=identity(image)+':'+signature(holes)+':'+JSON.stringify(tile);
      if(failures.has(key)&&Date.now()-failures.get(key)<60000)continue;
      try{
        const result=await repairWorker({rgba:x.getImageData(0,0,tile.w,tile.h).data,missing:holes,exclude,width:tile.w,height:tile.h});
        if(version!==repairRevision||scene!==token()||project!==state.selectionGeneration)return;
        const repaired=makeCanvas(tile.w,tile.h);repaired.getContext('2d').putImageData(new ImageData(result,tile.w,tile.h),0,0);
        const repair={x:tile.x,y:tile.y,image:repaired,mask:raster(holes,tile.w,tile.h)};
        (request.base?record.repairs:record.objectRepairs).push(repair);drawRepairs(source.getContext('2d'),request.base?{repairs:[repair]}:{objectRepairs:[repair]});core.render();
      }catch{failures.set(key,Date.now())}
    }
  }
}
// Legacy object metadata and repair rendering remain readable in older .moz
// files. Selection now comes exclusively from the saved Base color map.
window.addEventListener('mosaic:projectloaded',()=>{reset();scheduleRepair()});
window.MosaicObjects={reset,cancelSelection,selectionChanged,prepare,capture,generationMask,validateGenerated,generated,drawPreview,orderedGroups,drawBase,drawOriginal,drawOptionRepairs,drawComposition,invalidated,scheduleRepair,isSmartSelectEnabled:()=>smartSelectEnabled,maskKey:mask=>signature(data(mask)),
  // Useful for project codecs and deterministic integration scenarios.
  flushRepairs:async()=>{clearTimeout(repairTimer);await repairScene(++repairRevision)}};
