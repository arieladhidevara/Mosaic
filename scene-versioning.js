/* Full-image results become named options on every persistent Object ID.
   SAM 3 proposes fresh silhouettes; spatial matching keeps object identities stable.
   Uncertain matches fall back to the prior visible masks (never silently inventing IDs). */
import './app.js';
const core=window.MosaicCore,{state,canvas,makeCanvas,render,renderGroups}=core;
const clone=input=>{const out=makeCanvas(input.width,input.height);out.getContext('2d').drawImage(input,0,0);return out;};
const isVisible=g=>!g.objectMapBatch&&!g.mergedInto;
const originalMask=g=>clone(core.groupMask(g));
async function segmentFullFrame(image,oldGroups,onStatus=()=>{}){
  if(!oldGroups.length)return {masks:new Map(),status:'no-objects'};
  const scale=Math.min(1,768/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const frame=makeCanvas(w,h);frame.getContext('2d').drawImage(image,0,0,w,h);
  onStatus('SAM 3: segmenting the generated scene…');
  const result=await window.MosaicAccount.request('/api/ai/sam3',{method:'POST',
    body:{mode:'auto',image:frame.toDataURL('image/jpeg',.82),width:w,height:h}});
  if(!/^data:image\/png;base64,/.test(result?.labels||''))throw Error('SAM 3 returned no valid object labels.');
  const maskImage=new Image();maskImage.src=result.labels;await maskImage.decode();
  if(maskImage.width!==w||maskImage.height!==h)throw Error('SAM scene segmentation dimensions changed.');
  const decoder=makeCanvas(w,h),dc=decoder.getContext('2d',{willReadFrequently:true});dc.drawImage(maskImage,0,0);
  const pixels=dc.getImageData(0,0,w,h).data,labels=new Uint8Array(w*h),totals=new Uint32Array(65);
  for(let i=0;i<labels.length;i++){labels[i]=pixels[i*4];if(labels[i]<=64)totals[labels[i]]++;}
  const pairs=[];
  for(const item of oldGroups){
    const reference=makeCanvas(w,h),rc=reference.getContext('2d',{willReadFrequently:true});
    rc.imageSmoothingEnabled=false;rc.drawImage(item.mask,0,0,w,h);
    const before=rc.getImageData(0,0,w,h).data,intersections=new Uint32Array(65);let oldCount=0;
    for(let i=0;i<labels.length;i++)if(before[i*4+3]>=128){oldCount++;if(labels[i]&&labels[i]<=64)intersections[labels[i]]++;}
    if(oldCount<4)continue;
    for(let id=1;id<=64;id++){
      const both=intersections[id],newCount=totals[id];
      if(both<12||!newCount)continue;
      const coverage=both/oldCount,purity=both/newCount,iou=both/(oldCount+newCount-both);
      if(coverage>=.28&&purity>=.22)pairs.push({groupId:item.group.id,id,coverage,purity,iou,score:iou+.1*Math.min(coverage,purity)});
    }
  }
  pairs.sort((a,b)=>b.score-a.score);
  const winners=new Map(),used=new Set();
  for(const pair of pairs){
    if(winners.has(pair.groupId)||used.has(pair.id))continue;
    winners.set(pair.groupId,pair);used.add(pair.id);
  }
  const masks=new Map();
  for(const [groupId,match] of winners){
    const small=makeCanvas(w,h),ctx=small.getContext('2d'),rgba=ctx.createImageData(w,h);
    for(let i=0;i<labels.length;i++)if(labels[i]===match.id)rgba.data.fill(255,i*4,i*4+4);
    ctx.putImageData(rgba,0,0);
    const full=makeCanvas(canvas.width,canvas.height),f=full.getContext('2d');
    f.imageSmoothingEnabled=false;f.drawImage(small,0,0,canvas.width,canvas.height);
    masks.set(groupId,{mask:full,confidence:match.iou,segmentId:match.id});
  }
  return {masks,status:'sam3',segments:used.size};
}
async function apply(image,{type='ai-edit',prompt='',onStatus=()=>{},preserveEditing=false}={}){
  if(!state.master)throw Error('Open a Base first.');
  if(image.width!==canvas.width||image.height!==canvas.height)throw Error('Full image must match the current canvas dimensions.');
  const generation=state.selectionGeneration,previous=state.master;
  const before=core.composeApprovedCanvas();
  const groups=state.groups.filter(isVisible);
  const snapshots=groups.map(group=>({group,mask:originalMask(group),choice:group.active}));
  let segmentation;
  try{segmentation=await segmentFullFrame(image,snapshots,onStatus);}
  catch(error){segmentation={masks:new Map(),status:'fallback'};
    onStatus('SAM 3 unavailable · preserving existing masks. '+(error?.message||''));}
  if(generation!==state.selectionGeneration||previous!==state.master)
    throw Error('The working project changed while the new scene was being segmented.');
  const kind=type==='harmonize'?'harmonize':'ai-edit';
  const number=(state.sceneVersionCounters?.[kind]||0)+1;
  const category=(kind==='harmonize'?'Harmonize ':'AI Edit ')+number;
  state.sceneVersionCounters??={harmonize:0,'ai-edit':0};
  state.sceneVersionCounters[kind]=number;
  const sourceId=core.uid('full_scene_source'),oldSourceId=core.uid('previous_scene_source');
  const fullImage=clone(image);
  state.sources.set(sourceId,{id:sourceId,name:category,canvas:fullImage});
  // Keep the previous visible image once, shared by original options.
  const needPrevious=snapshots.some(({group})=>!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster));
  if(needPrevious)state.sources.set(oldSourceId,{id:oldSourceId,name:'Previous scene',canvas:clone(before)});
  const records=[];
  for(const {group,mask,choice} of snapshots){
    if(needPrevious&&!group.patchIds.some(id=>state.patches.get(id)?.isOriginalMaster)){
      const oldId=core.uid('scene_before');
      const paths=core.maskPathsFromRaster(mask);
      state.patches.set(oldId,{id:oldId,groupId:group.id,sourceId:oldSourceId,mask:clone(mask),
        bbox:core.exactMaskBoundingBox(mask),maskPaths:paths,maskPoints:paths.flat(),
        name:'Before full image',manualName:true,isOriginalMaster:true,versionCategory:'Original'});
      group.patchIds.unshift(oldId);
    }
    const proposed=segmentation.masks.get(group.id);
    const fresh=proposed?.mask||mask,paths=core.maskPathsFromRaster(fresh);
    const patchId=core.uid('scene_option');
    state.patches.set(patchId,{id:patchId,groupId:group.id,sourceId,mask:clone(fresh),
      bbox:core.exactMaskBoundingBox(fresh),maskPaths:paths,maskPoints:paths.flat(),
      name:category,versionCategory:category,sceneVersion:category,sceneType:kind,
      manualName:true,createdFromFullImage:true,isMasterVersion:kind==='harmonize',
      objectId:group.objectId||group.id,objectLabel:group.objectLabel||group.objectName||group.name,
      segmentationStatus:proposed?'sam3':'previous-mask-fallback',
      segmentationConfidence:proposed?.confidence||0,prompt});
    group.patchIds.push(patchId);
    group.hasHarmonizedMaster=true;
    if(!preserveEditing||!state.selectionTargetPatchId)group.active=patchId;
    core.refreshGroupFootprint(group);
    records.push({groupId:group.id,patchId,matched:Boolean(proposed),confidence:proposed?.confidence||0});
  }
  state.master=fullImage;state.masterIsBase=false;state.objectMapLocked=true;
  (state.sceneVersionHistory??=[]).push({type:kind,number,category,sourceId,
    prompt,createdAt:new Date().toISOString(),segmentationStatus:segmentation.status,
    records});
  // If no original Object Map exists, at least keep the generated options usable.
  if(!groups.length)window.MosaicObjectMap?.imageReady?.(fullImage);
  renderGroups();render();
  return {category,objectCount:records.length,matched:records.filter(v=>v.matched).length,
    segmentationStatus:segmentation.status};
}
window.MosaicSceneVersions={apply,segmentFullFrame};
