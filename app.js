/* Mosaic — manual-first, local-only image compositor.
   Each uploaded variation is a temporary top layer until its mask is applied.
   Masks remain editable; only approved patches are combined with the master. */
const $ = id => document.getElementById(id);
const canvas = $('compositeCanvas'), overlay = $('overlayCanvas');
const ctx = canvas.getContext('2d'), ox = overlay.getContext('2d');
const MaskGeometry=window.MozMaskGeometry;
const state = {
  reference: null, master: null, rawBase: null, rawMaster: null, masterIsBase: false, alignmentTransforms: null, sources: new Map(), groups: [], patches: new Map(),
  pendingSourceId: null, queue: [], editingPatchId: null, selectedPatchId: null,
  selectionMask: null, boundaryCanvas: null, selectionPoints: [], selectionPaths: [], selectionTargetPatchId: null, maskVertexDrag: null, maskMoveDrag: null, maskEditOnly: false, selectionMode: 'new', lasso: [], drawing: false,
  pointerStart: null, dragFreehand: false, hoverPoint: null, shapeStart: null, shapeEnd: null,
  tool: 'select', lastPoint: null, lastCanvasPointer: null, pendingRevealOnly: false, brushTargetId: null, before: false, zoom: 1, fitZoom: 1, busy: false,
  undo: [], redo: [], serial: 1, panAnchor: null, transformDrag: null, draftGroupId: null, queuedGroupId: null, hoveredGroupId: null, selectionGeneration: 0, selectionOverlayHidden: false, forceNewSelectionGroup: false,
  projectTitle:'Untitled composition',projectTitleManual:false,brushSize:36,brushIntensity:100,focusedGroupId:null,comparePosition:50,autoObjectSelect:false,featherEnabled:false,objectMap:null,objectMapSelection:null
};
const uid = name => `${name}_${state.serial++}`;
const makeCanvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const clamp = (v,a,b) => Math.min(b, Math.max(a,v));
const center = b => ({x:b.x+b.w/2,y:b.y+b.h/2});
let toastTimer;
let quickPromptPosition=null;
const optionChoiceVersions=new WeakMap();
const groupChoiceVersion=group=>optionChoiceVersions.get(group)||0;
let activeMaskVertex=null,hoverMaskEdge=null,maskEditVersion=0;
function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3400)}
function message(s){$('canvasMessage').textContent=s}
function setProjectTitle(name,manual=false){
  const value=String(name||'').trim().slice(0,80);
  if(manual&&value){state.projectTitle=value;state.projectTitleManual=true}
  else if(!state.projectTitleManual&&value)state.projectTitle=value;
  $('projectName').textContent=state.projectTitle||'Untitled composition';
}
function fileName(f){return (f?.name||'Image').replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ').slice(0,32)}
function labelFromPosition(b){let x=(b.x+b.w/2)/canvas.width,y=(b.y+b.h/2)/canvas.height;return `${y<.35?'Upper':y>.68?'Lower':'Middle'} ${x<.37?'left':x>.65?'right':'center'}`}
function promptText(){const p=`Create one seamless photorealistic architectural rendering using the two attached images.\n\nIMAGE 1 — BASE. Preserve its camera perspective, architectural geometry, spatial proportions and original structure where no deliberate change has been made.\n\nIMAGE 2 — MOSAIC COLLAGE. This is the primary source for approved material finishes, furniture, ornaments, lighting fixtures, and intentional geometry changes.\n\nINSTRUCTIONS:\n- Preserve the appearance and deliberate object changes selected in Image 2, even if they differ from Image 1.\n- Preserve Image 1's geometry in unchanged regions.\n- Harmonize collage seams, material transitions, shadows, reflections and color grading.\n- Do not add unrequested objects, change the camera, alter mullion spacing, or reinterpret approved design elements.\n- Prioritize design fidelity and architectural accuracy over artistic reinterpretation.\n\nOUTPUT: One cohesive professional architectural visualization. These images are references, not pixel-locked constraints.\n\nPROJECT DESIGN INTENT:\n${window.MosaicPremium?.projectPrompt() || 'Preserve the approved original design.'}`;$('promptPreview').textContent=p;return p}
async function loadFileToCanvas(file,maxDimension=2400){if(!file||!file.type.startsWith('image/'))throw Error('Choose an image file.');let image;try{image=await createImageBitmap(file)}catch{image=await new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Cannot open this image'))};img.src=url})}
  const scale=Math.min(1,maxDimension/Math.max(image.width,image.height)),c=makeCanvas(Math.round(image.width*scale),Math.round(image.height*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close?.();return c}
async function importMaster(file){if(!file)return;if(state.rawMaster&&!state.masterIsBase){toast('Master is already uploaded. Open its preview or generate a new version.');return}
  if(state.masterIsBase&&state.groups.length&&!window.confirm('Upload Master and replace the current Base-only draft and its Groups?'))return;
  try{const c=await loadFileToCanvas(file);setMaster(c,fileName(file));void window.MosaicAccount?.track('master_uploaded');toast('Master ready. Add another image and select a region to keep.')}catch(e){toast(e.message)}}
function setMaster(c,name,prepareObjects=true){if(!prepareObjects)window.MosaicObjectMap?.holdImage(c);window.MosaicWorkspace?.reset();window.MosaicObjects?.reset();void window.MosaicAccount?.startProject(!state.reference);window.MosaicPremium?.onMasterReset();state.master=c;state.sceneVersionCounters={harmonize:0,'ai-edit':0};state.sceneVersionHistory=[];state.sceneTargetSelections=[];state.objectMapLocked=false;state.before=false;state.focusedGroupId=null;window.MosaicAutoRegions?.reset?.();window.MosaicSlimWand?.reset?.();state.rawMaster=c;state.masterIsBase=false;state.alignmentTransforms=null;state.sources.clear();state.groups=[];state.objectCollections=[];state.patches.clear();state.pendingSourceId=null;state.queue=[];state.editingPatchId=null;state.selectedPatchId=null;state.undo=[];state.redo=[];state.selectionGeneration++;state.hoveredGroupId=null;state.queuedGroupId=null;
  canvas.width=overlay.width=c.width;canvas.height=overlay.height=c.height;setSourcePreview('masterPreview',c);window.MosaicPremium?.onMasterLoaded?.(c,name);$('selectionDraft').setAttribute('viewBox',`0 0 ${c.width} ${c.height}`);resetSelection();
  $('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden');setProjectTitle(name);$('projectSize').textContent=`${c.width} × ${c.height}`;
  $('masterTitle').textContent='Master';$('masterInfo').textContent=`${name} · ${c.width} × ${c.height}`;$('masterStatus').textContent='✓';$('masterZone').classList.add('ready');updateZoomFit();renderGroups();render();updateSourceActions();message('Upload a variation, select the area you want, then click Apply.');
  // Generate the object map when a Base or Master enters the editor.
  // Internal Master swaps may opt out via prepareObjects=false.
  if(prepareObjects)window.MosaicObjectMap?.imageReady(c);
}
async function importReference(file){if(!file)return;if(state.reference){toast('Base is locked. Click Base to preview it.');return}try{state.reference=await loadFileToCanvas(file,4000);state.rawBase=state.reference;void window.MosaicAccount?.startProject(true);void window.MosaicAccount?.track('base_uploaded');state.alignmentTransforms=null;setSourcePreview('basePreview',state.reference);setSourcePreview('welcomeBaseThumb',state.reference);$('referenceTitle').textContent='Base';$('referenceInfo').textContent=`${fileName(file)} · ${state.reference.width} × ${state.reference.height}`;$('referenceStatus').textContent='✓';$('referenceZone').classList.add('ready');toast('Base image saved locally.');window.MosaicPremium?.onReferenceLoaded(file);updateSourceActions()}catch(e){toast(e.message)}}
function continueWithBase(notify=true,targetSize=null){
  if(!state.reference||state.master)return;
  const base=state.reference,max=2400,scale=Math.min(1,max/Math.max(base.width,base.height));
  const working=makeCanvas(targetSize?.width||Math.max(1,Math.round(base.width*scale)),targetSize?.height||Math.max(1,Math.round(base.height*scale)));
  working.getContext('2d').drawImage(base,0,0,working.width,working.height);
  setMaster(working,'Base · Working Draft',!(notify===false&&targetSize));
  state.masterIsBase=true;
  state.rawMaster=null;
  $('masterZone').classList.remove('ready');
  $('masterStatus').textContent='＋';
  $('masterInfo').textContent='Upload or generate Master';
  $('masterPreview').classList.add('hidden');
  window.MosaicPremium?.onBaseContinue?.(working);
  updateSourceActions();
  message('Base-only editor ready. Select an area to edit.');
  if(notify)toast('Editing with Base only.');
}
function upgradeBaseDraft(target){
  if(!target||!state.masterIsBase||state.groups.length||state.patches.size||state.sources.size||state.pendingSourceId||state.maskMoveDrag||state.maskVertexDrag||window.MosaicSourceEditor?.isEditing())return false;
  if(Math.max(canvas.width,canvas.height)>=Math.max(target.width,target.height)||[...state.undo,...state.redo].some(entry=>entry.type!=='selection'))return false;
  const oldWidth=canvas.width,oldHeight=canvas.height,sx=target.width/oldWidth,sy=target.height/oldHeight;
  const point=p=>p?{...p,x:p.x*sx,y:p.y*sy}:p,paths=items=>(items||[]).map(path=>path.map(point));
  const resize=source=>{if(!source)return null;const out=makeCanvas(target.width,target.height);out.getContext('2d').drawImage(source,0,0,out.width,out.height);return out};
  const history=items=>items.map(entry=>{const input=makeCanvas(oldWidth,oldHeight);input.getContext('2d').putImageData(entry.image,0,0);const output=resize(input);return {...entry,paths:paths(entry.paths),points:(entry.points||[]).map(point),image:output.getContext('2d').getImageData(0,0,output.width,output.height)}});
  state.undo=history(state.undo);state.redo=history(state.redo);state.master=resize(state.master);state.selectionMask=resize(state.selectionMask);
  setSelectionPaths(paths(state.selectionPaths));state.lasso=state.lasso.map(point);state.shapeStart=point(state.shapeStart);state.shapeEnd=point(state.shapeEnd);state.hoverPoint=point(state.hoverPoint);
  canvas.width=overlay.width=target.width;canvas.height=overlay.height=target.height;state.selectionGeneration++;
  $('selectionDraft').setAttribute('viewBox',`0 0 ${target.width} ${target.height}`);$('projectSize').textContent=target.width+' × '+target.height;
  window.MosaicPremium?.onBaseContinue?.(state.master);updateSelectionOutline();updateZoomFit();render();return true;
}
function showProcessing(on){state.busy=on;$('processing').classList.toggle('hidden',!on)}
function clearDraft(){state.lasso=[];state.hoverPoint=null;state.pointerStart=null;state.dragFreehand=false;state.shapeStart=null;state.shapeEnd=null;state.drawing=false}
function clearHover(){window.MosaicRegions?.clearHover()}
function hideQuickPrompt(){document.getElementById('quickAreaPromptForm')?.classList.add('hidden')}
function showQuickPrompt(point=state.lastCanvasPointer,keepText=false,focusInput=true){
  if(window.MosaicWorkspace?.isSelectingResult())return;
  if(!state.master||!state.selectionMask||!maskBoundingBox(state.selectionMask)||state.pendingSourceId||state.editingPatchId)return;
  const form=$('quickAreaPromptForm'),vp=$('viewport'),r=vp.getBoundingClientRect();
  refreshQuickOptions();
  // The prompt is position:fixed, so work in actual screen coordinates.
  // The previous code clamped to the left/top of the viewport, which could
  // put the prompt hundreds of pixels away from the clicked mask.
  const margin=10,gap=12;
  const left=Math.max(0,r.left)+margin,right=Math.min(window.innerWidth,r.right)-margin;
  const top=Math.max(0,r.top)+margin,bottom=Math.min(window.innerHeight,r.bottom)-margin;
  form.style.maxWidth=Math.max(120,right-left)+'px';
  form.style.maxHeight=Math.max(120,bottom-top)+'px';
  form.classList.remove('hidden');
  const bounds=form.getBoundingClientRect(),w=bounds.width,h=bounds.height;
  // Keyboard completion and programmatic selection fall back to the actual
  // selection on canvas rather than an arbitrary corner of the viewport.
  const selection=maskBoundingBox(state.selectionMask);
  const canvasRect=overlay.getBoundingClientRect();
  const selectedX=canvasRect.left+(selection.x+selection.w/2)/canvas.width*canvasRect.width;
  const selectedY=canvasRect.top+(selection.y+selection.h/2)/canvas.height*canvasRect.height;
  const pointerX=Number.isFinite(point?.clientX)?point.clientX:selectedX;
  const pointerY=Number.isFinite(point?.clientY)?point.clientY:selectedY;
  const x=Math.max(left,Math.min(right,Math.max(left,pointerX)));
  const y=Math.max(top,Math.min(bottom,Math.max(top,pointerY)));
  // Prefer just below/right of the cursor, then flip above/left near edges.
  // Clamp only as a final safeguard if the viewport is smaller than the form.
  const wantedX=x+gap+w<=right?x+gap:x-gap-w;
  const wantedY=y+gap+h<=bottom?y+gap:y-gap-h;
  form.style.left=Math.max(left,Math.min(quickPromptPosition?r.left+quickPromptPosition.x:wantedX,Math.max(left,right-w)))+'px';
  form.style.top=Math.max(top,Math.min(quickPromptPosition?r.top+quickPromptPosition.y:wantedY,Math.max(top,bottom-h)))+'px';
  if(!keepText){window.MosaicPremium?.clearReferenceFiles?.('quick');$('quickAreaPromptInput').value=''}
  if(focusInput&&!window.matchMedia('(max-width:850px)').matches)$('quickAreaPromptInput').focus({preventScroll:true});
}
function setSourcePreview(id,source){const img=$(id);if(!img||!source)return;img.src=source.toDataURL('image/jpeg',.75);img.classList.remove('hidden')}
function updateSourceActions(){
  const firstImageOnly=Boolean(state.reference&&!state.master);
  const needsRealMaster=Boolean(state.reference&&(!state.master||state.masterIsBase));
  $('generateMasterBtn').classList.toggle('hidden',!needsRealMaster);
  const generating=Boolean(window.MosaicPremium?.isMasterGenerating?.());
  $('generateMasterBtn').disabled=generating;
  $('generateMasterBtn').textContent=generating?'Generating Master…':'✦ Generate Master from Base';
  $('welcomeBasePromptForm').classList.toggle('hidden',!firstImageOnly);
  $('welcomeContinueBtn').classList.toggle('hidden',!firstImageOnly);
  $('welcomeTitle').textContent=firstImageOnly?'Base uploaded. What next?':'Start with an image.';
  $('welcomeDescription').textContent=firstImageOnly
    ?'Generate a Master from this Base, or choose Use Base to edit directly.'
     :'Upload one Base image to start.';
  $('editBaseBtn').classList.toggle('hidden',!state.reference);
  $('editMasterBtn').classList.toggle('hidden',!state.master);
  $('editPendingBtn').disabled=!state.pendingSourceId;
  if(state.master){$('welcome').classList.add('hidden');$('canvasWrap').classList.remove('hidden')}
  window.MosaicSources?.refresh?.();
}
function resetSelection(){window.MosaicObjects?.cancelSelection?.();$('selectionOutlineVectors')?.replaceChildren();state.selectionPaths=[];state.maskMoveDrag=null;state.maskEditOnly=false;activeMaskVertex=null;hoverMaskEdge=null;maskEditVersion++;state.selectionPoints=[];state.selectionTargetPatchId=null;state.maskVertexDrag=null;state.selectionMask=state.master?makeCanvas(canvas.width,canvas.height):null;state.boundaryCanvas=null;state.draftGroupId=null;state.selectionOverlayHidden=false;state.forceNewSelectionGroup=false;state.pendingRevealOnly=false;hideQuickPrompt();clearDraft();updateApplyButton();clearHover()}
function updateApplyButton(){
  const pending=Boolean(state.pendingSourceId),editing=Boolean(state.editingPatchId),btn=$('commitBtn');
  btn.disabled=!(pending||editing)||!Boolean(state.selectionMask&&maskBoundingBox(state.selectionMask));
  btn.classList.toggle('hidden',!(pending||editing));
  btn.textContent=editing?'✓ Update mask':'✓ Apply';
}
function updateSelectionModes(){
  const panel=document.querySelector('.selection-modes'),editing=['lasso','rect','ellipse'].includes(state.tool);
  const existing=Boolean(state.selectionMask&&maskBoundingBox(state.selectionMask));
  panel.classList.toggle('hidden',!editing);
  panel.querySelector('[data-mode="new"]').hidden=existing;
  if(editing&&existing&&state.selectionMode==='new')state.selectionMode='add';
  if(editing&&!existing&&state.selectionMode!=='new')state.selectionMode='new';
  panel.querySelectorAll('.mode').forEach(button=>{
    button.classList.toggle('active',button.dataset.mode===state.selectionMode);
    button.setAttribute('aria-pressed',String(button.dataset.mode===state.selectionMode));
  });
}
function setMode(mode){
  if(!['new','add','subtract'].includes(mode))return;
  if(mode==='new'&&state.selectionMask&&maskBoundingBox(state.selectionMask)&&['lasso','rect','ellipse'].includes(state.tool)){
    toast('Clear the current selection to create a new object.');return;
  }
  if(state.selectionMode!==mode)clearDraft();
  state.selectionMode=mode;updateSelectionModes();drawOverlay();
  message(`${mode==='new'?'New object':mode==='add'?'Add to':'Subtract from'} the selection. Draw with Line, Rectangle or Oval.`);
}
async function importVariants(files){if(!state.master){toast('Upload a master image first.');return}const arr=Array.from(files||[]).filter(f=>f.type.startsWith('image/'));state.queue.push(...arr);if(arr.length>0&&state.pendingSourceId)toast(`${arr.length} variation${arr.length>1?'s':''} queued. Apply the current selection first.`);await loadNextVariant()}
async function loadNextVariant(){if(state.pendingSourceId||state.busy||!state.queue.length||!state.master)return;showProcessing(true);try{const file=state.queue.shift(),img=await loadFileToCanvas(file),c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(img,0,0,c.width,c.height);if(Math.abs(img.width/img.height-c.width/c.height)>.012)toast('Aspect ratios differ. Check image alignment before masking.');const id=uid('source');state.sources.set(id,{id,name:fileName(file),canvas:c});state.pendingSourceId=id;state.pendingRevealOnly=false;state.editingPatchId=null;state.selectedPatchId=null;state.before=false;resetSelection();setMode('new');selectTool('lasso');message(`Select the area to keep from ${fileName(file)}, then click Apply to commit it.`)}catch(e){toast('Import failed: '+e.message)}finally{showProcessing(false);const queued=state.groups.find(g=>g.id===state.queuedGroupId);state.queuedGroupId=null;if(queued&&state.pendingSourceId){
  if(maskBoundingBox(groupMask(queued)))selectGroupMask(queued);
  else{state.draftGroupId=queued.id;setMode('new');selectTool('lasso');message('Draw the area for '+queued.name+', then click Apply.')}
}renderGroups();render()}}
function discardPending(){if(!state.pendingSourceId)return;state.sources.delete(state.pendingSourceId);state.pendingSourceId=null;resetSelection();renderGroups();render();toast('Unapplied image discarded.');loadNextVariant()}
function bboxIoU(a,b){const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)),area=w*h,union=a.w*a.h+b.w*b.h-area;return union>0?area/union:0}

const CATEGORIES=['Wall','Ceiling','Floor','Door','Window','Glazing','Furniture','Millwork','Lighting','Structure','Landscape','Stairs','Other','Region'];
function categoryFromText(value){
  const valueLower=String(value||'').toLowerCase();
  const lookups=[['Ceiling',/\b(ceiling|soffit|baffle)\b/],['Floor',/\b(floor|carpet|terrazzo|flooring)\b/],
    ['Wall',/\b(wall|partition|cladding|facade|façade)\b/],['Door',/\b(door|doorway)\b/],
    ['Window',/\b(window|mullion)\b/],['Glazing',/\b(glass|glazing|storefront|curtain wall)\b/],
    ['Furniture',/\b(furniture|sofa|couch|chair|desk|stool|table|seating)\b/],
    ['Millwork',/\b(millwork|cabinet|counter|joinery)\b/],['Lighting',/\b(light|lighting|downlight|luminaire)\b/],
    ['Structure',/\b(column|beam|truss|structural)\b/],['Landscape',/\b(tree|plant|landscape)\b/],['Stairs',/\b(stairs|staircase|tread|steps)\b/]];
  return lookups.find(([,regex])=>regex.test(valueLower))?.[0]||null;
}
function cloneMask(mask){const c=makeCanvas(canvas.width,canvas.height);c.getContext('2d').drawImage(mask,0,0);return c}
function groupMask(group){
  // A region reuses the *visible, transformed* mask of its active option.
  // Do not reuse an original mask left behind after moving/skewing an option.
  const active=state.patches.get(group.active);
  if(active?.editMode==='remove')return makeCanvas(canvas.width,canvas.height);
  if(active?.geometryObjectMask&&!active.corners)return active.geometryObjectMask;
  if(active)return displayedPatchMask(active);
  if(group.objectOriginal)return group.objectOriginal.mask;
  if(group.footprint)return group.footprint;
  if(group.maskCrop){
    const result=makeCanvas(canvas.width,canvas.height),crop=group.maskCrop;
    result.getContext('2d').drawImage(crop.mask,crop.x,crop.y);
    return result;
  }
  const result=makeCanvas(canvas.width,canvas.height),c=result.getContext('2d');
  for(const id of group.patchIds){
    const patch=state.patches.get(id);
    if(patch)c.drawImage(displayedPatchMask(patch),0,0);
  }
  group.footprint=result;
  return result;
}
function rememberMask(group,mask){
  groupThumbCache.delete(group);
  if(!group.footprint)group.footprint=cloneMask(groupMask(group));
  group.maskCrop=null;
  group.footprint.getContext('2d').drawImage(mask,0,0);
  group.area=maskBoundingBox(group.footprint)||group.area;
}
function groupLabel(group){
  const cat=group.category||'Region';
  return cat==='Region'?'Object '+String(state.groups.indexOf(group)+1).padStart(2,'0'):
    cat+' · '+labelFromPosition(group.area||{x:0,y:0,w:canvas.width,h:canvas.height});
}
function newGroup(mask,category='Region'){
  const group={id:uid('group'),category,manualName:false,manualCategory:false,patchIds:[],active:null,
    footprint:cloneMask(mask),area:maskBoundingBox(mask),classificationPending:false};
  state.groups.push(group);group.name=groupLabel(group);return group;
}
function updateGroupCategory(group,category,source='vision'){
  if(!group||!CATEGORIES.includes(category)||category==='Region'||group.manualCategory||(source==='vision'&&group.classificationSource==='prompt'))return;
  group.category=category;group.classificationSource=source;
  if(!group.manualName)group.name=group.objectName||groupLabel(group);
  renderGroups();drawOverlay();
}
function matchingGroup(mask,threshold=.85){
  // Compare normalized low-resolution coverage, rather than scanning full 4K
  // masks N x N times during Auto Create. Require substantial overlap in BOTH
  // directions, so a small object inside a larger surface stays separate.
  const width=Math.min(192,canvas.width);
  const height=Math.max(1,Math.round(width*canvas.height/canvas.width));
  const sample=source=>{
    const c=makeCanvas(width,height),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(source,0,0,width,height);
    const pixels=ctx.getImageData(0,0,width,height).data;
    const selected=new Uint8Array(width*height);
    let area=0,minX=width,minY=height,maxX=-1,maxY=-1;
    for(let i=0;i<selected.length;i++){
      if(pixels[i*4+3]<120)continue;
      selected[i]=1;area++;
      const x=i%width,y=(i-x)/width;
      minX=Math.min(minX,x);minY=Math.min(minY,y);
      maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    }
    return {selected,area,box:maxX>=0?{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}:null};
  };
  const a=sample(mask);
  if(!a.area)return null;
  let best=null,bestScore=threshold;
  for(const group of state.groups){
    if(!group.area||group.objectMapBatch||group.mergedInto)continue;
    const b=sample(groupMask(group));
    if(!b.area||!bboxIoU(a.box,b.box))continue;
    let intersection=0;
    for(let i=0;i<a.selected.length;i++)if(a.selected[i]&&b.selected[i])intersection++;
    const score=Math.min(intersection/a.area,intersection/b.area);
    if(score>=bestScore){best=group;bestScore=score}
  }
  return best;
}

function releaseDraftGroupForNewSelection(){
  if(state.selectionMode!=='new'||state.editingPatchId)return;
  window.MosaicObjects?.cancelSelection();
  const draft=state.groups.find(group=>group.id===state.draftGroupId);
  const keepEmptyDraft=Boolean(draft&&!draft.patchIds.length&&(draft.manualName||state.queuedGroupId===draft.id));
  if(draft&&!draft.patchIds.length&&!keepEmptyDraft&&!draft.mapPrepared)state.groups=state.groups.filter(group=>group!==draft);
  if(!keepEmptyDraft)state.draftGroupId=null;
}
function createBlankRegion(){
  if(window.MosaicObjectManager){window.MosaicObjectManager.createCollection();return}
  if(!state.master){toast('Upload Master or continue with Base before creating Groups.');return}
  resetSelection();state.selectedPatchId=null;state.queuedGroupId=null;
  setMode('new');selectTool('lasso');renderGroups();
  message('Draw an area, then generate or apply an image to save it as a Group.');
}
function autoClassifyGroup(group){
  if(!group||group.manualCategory||group.category!=='Region'||group.classificationPending)return;
  if(!window.MosaicAuth?.isReady?.()||!window.MosaicPremium?.classifyArea)return;
  const snapshot=cloneMask(groupMask(group));
  if(!maskBoundingBox(snapshot))return;
  group.classificationPending=true;renderGroups();
  void window.MosaicPremium.classifyArea(snapshot).then(category=>{
    if(state.groups.includes(group)&&!group.manualCategory&&group.category==='Region')updateGroupCategory(group,category,'vision');
  }).catch(()=>{/* Manual category selection stays available if classification fails. */})
    .finally(()=>{group.classificationPending=false;if(state.groups.includes(group))renderGroups()});
}
function prepareSelectionGroup(){
  if(window.MosaicWorkspace?.isSelectingResult())return;
  if(window.MosaicObjectMap?.hasSelection()){renderGroups();return}
  if(!state.selectionMask||state.editingPatchId||!maskBoundingBox(state.selectionMask))return;
  if(!state.selectionTargetPatchId){
    let group=state.groups.find(g=>g.id===state.draftGroupId&&!g.patchIds.length)||(!state.forceNewSelectionGroup&&matchingGroup(state.selectionMask));
    if(!group)group=newGroup(state.selectionMask);
    if(!group.patchIds.length){group.footprint=cloneMask(state.selectionMask);group.area=maskBoundingBox(group.footprint);group.maskPaths=MaskGeometry.copyPaths(state.selectionPaths)}
    state.draftGroupId=group.id;
    autoClassifyGroup(group);
  }
  renderGroups();
}
function assignGroup(patch,targetGroupId=state.draftGroupId){
  let group=state.groups.find(g=>g.id===(patch.groupId||targetGroupId))||matchingGroup(patch.mask);
  const category=categoryFromText(patch.prompt);
  if(!group)group=newGroup(patch.mask,category||'Region');
  if(category)updateGroupCategory(group,category,'prompt');
  rememberMask(group,patch.mask);
  state.patches.set(patch.id,patch);group.patchIds.push(patch.id);group.active=patch.id;if(state.queuedGroupId===group.id)state.queuedGroupId=null;
  patch.groupId=group.id;state.selectedPatchId=patch.id;refreshGroupFootprint(group);autoClassifyGroup(group);return group;
}
function refreshGroupFootprint(group){
  groupThumbCache.delete(group);
  const patches=group.patchIds.map(id=>state.patches.get(id)).filter(Boolean);
  if(!patches.length&&group.mapPrepared){group.area=maskBoundingBox(groupMask(group));return}
  const union=makeCanvas(canvas.width,canvas.height),c=union.getContext('2d');
  for(const patch of patches)c.drawImage(displayedPatchMask(patch),0,0);
  group.footprint=union;
  group.area=maskBoundingBox(groupMask(group));
  if(group.objectOriginal)window.MosaicObjects?.scheduleRepair();
}
function moveOptionToGroup(patchId,targetGroupId){
  const patch=state.patches.get(patchId),to=state.groups.find(g=>g.id===targetGroupId),from=state.groups.find(g=>g.patchIds.includes(patchId));
  if(!patch||!to||!from||to===from)return false;
  from.patchIds=from.patchIds.filter(id=>id!==patchId);
  to.patchIds.push(patchId);patch.groupId=to.id;
  if(from.active===patchId)from.active=from.patchIds.at(-1)||null;
  to.active=patchId;
  if(state.draftGroupId===from.id)state.draftGroupId=to.id;
  refreshGroupFootprint(from);refreshGroupFootprint(to);
  renderGroups();render();toast('Moved '+patch.name+' to '+to.name+'.');return true;
}
function selectGroupMask(group,{showOutline=false,append=false}={}){
  hideQuickPrompt();
  if(append){appendGroupSelection(group);return}
  if(!group||!state.master||state.busy||window.MosaicPremium?.isPreviewing())return;
  if(state.editingPatchId){toast('Finish editing the current mask first.');return}
  const mask=groupMask(group);
  if(!maskBoundingBox(mask)){toast('No saved selection for this group.');return}
  resetSelection();state.selectionMask.getContext('2d').drawImage(mask,0,0);
  const active=state.patches.get(group.active);
  setSelectionPaths(active?patchSelectionPaths(active):group.maskPaths?.length?group.maskPaths:maskPathsFromRaster(mask));
  state.selectionTargetPatchId=state.pendingSourceId?null:active?.id||null;
  state.draftGroupId=group.id;state.selectedPatchId=active?.id||null;state.selectionOverlayHidden=!showOutline;
  if(window.MosaicObjectManager)window.MosaicObjectMap?.adoptSelection([window.MosaicObjectManager.partForObject(group)]);
  setMode('new');selectTool('select');state.pendingRevealOnly=Boolean(state.pendingSourceId);updateSelectionOutline();updateApplyButton();renderGroups();render();
  message('Ready to edit '+group.name+'. '+(state.pendingSourceId?'Click Apply to keep this area from the imported image.':'Ctrl+click another object to multi-select, or use AI Edit.'));
  if(!showOutline)window.MosaicRegions?.clearHover?.();
  toast('Reused '+group.name+' mask.');
}
function focusGroupInSidebar(group){
  if(!group)return;
  state.focusedGroupId=group.id;
  // Expand the relevant top-level assembly when its part is selected on canvas.
  if(group.collectionId&&(state.collapsedCategories||[]).includes(group.collectionId)){
    state.collapsedCategories=state.collapsedCategories.filter(id=>id!==group.collectionId);
    renderGroups();
  }
  const list=$('groupList'),section=[...list.querySelectorAll('.region-group')].find(row=>row.dataset.group===group.id);
  if(section)section.scrollIntoView({block:'nearest'});
}
function chooseGroupOption(group,patchId,{showPrompt=false,showOutline=false}={}){
  if(!group||state.pendingSourceId||state.busy)return;
  if(patchId!==null&&(!group.patchIds.includes(patchId)||!state.patches.has(patchId)))return;
  optionChoiceVersions.set(group,groupChoiceVersion(group)+1);
  state.editingPatchId=null;group.active=patchId;group.objectRemoved=state.patches.get(patchId)?.editMode==='remove';refreshGroupFootprint(group);window.MosaicObjects?.scheduleRepair();
  selectGroupMask(group,{showOutline});
  if(showPrompt)showQuickPrompt(state.lastCanvasPointer,true,false);
}
function refreshQuickOptions(){
  const form=$('quickAreaPromptForm');let rail=$('quickGroupOptions');
  if(!rail){rail=document.createElement('aside');rail.id='quickGroupOptions';rail.className='quick-group-options';rail.setAttribute('aria-label','Options for selected object');form.append(rail)}
  const group=state.groups.find(group=>group.id===state.draftGroupId||group.patchIds.includes(state.selectionTargetPatchId));
  const ready=group?.patchIds.map(id=>state.patches.get(id)).filter(patch=>patch&&!patch.hideUntilReady)||[];
  rail.replaceChildren();rail.hidden=!ready.length;form.classList.toggle('has-group-options',Boolean(ready.length));
  if(!ready.length)return;
  const heading=document.createElement('small');heading.textContent='Options';rail.append(heading);
  const choices=[...(!group.hasHarmonizedMaster?[null]:[]),...ready];
  choices.forEach((patch,index)=>{
    const button=document.createElement('button');button.type='button';button.className='quick-option';
    button.dataset.option=patch?.id||'original';button.setAttribute('aria-pressed',String(group.active===(patch?.id||null)));
    button.title=patch?.name||'Original Master';button.setAttribute('aria-label','Choose '+button.title);
    const thumb=patch&&patchThumbnail(patch);
    if(thumb){const image=document.createElement('img');image.src=thumb;image.alt='';button.append(image)}
    const label=document.createElement('span');label.textContent=patch?String(index+(group.hasHarmonizedMaster?1:0)):'Original';button.append(label);
    button.onclick=()=>chooseGroupOption(group,patch?.id||null,{showPrompt:true,showOutline:false});
    rail.append(button);
  });
}
// Ctrl/Cmd-click unions existing selections, without modifying a saved Group.
// A new draft Group is created for the merged shape so Generate saves one option.
function appendGroupSelection(group){
  if(window.MosaicObjectMap?.selectObject){window.MosaicObjectMap.selectObject(group,{append:true});return}
  if(!group||!state.master||state.busy||state.pendingSourceId||state.editingPatchId)return;
  const additional=groupMask(group);
  if(!maskBoundingBox(additional))return;
  const current=state.selectionMask;
  const hasCurrent=Boolean(current&&maskBoundingBox(current));
  if(!hasCurrent){selectGroupMask(group,{showOutline:true});return}
  snapshotSelection();
  const old=state.groups.find(g=>g.id===state.draftGroupId);
  if(old&&!old.patchIds.length&&!old.manualName)state.groups=state.groups.filter(g=>g!==old);
  const combined=makeCanvas(canvas.width,canvas.height),ctx=combined.getContext('2d');
  ctx.drawImage(current,0,0);ctx.drawImage(additional,0,0);
  state.selectionMask=combined;
  state.selectionTargetPatchId=null;state.selectedPatchId=null;
  state.draftGroupId=null;state.selectionOverlayHidden=false;state.forceNewSelectionGroup=true;
  setSelectionPaths(maskPathsFromRaster(combined));
  setMode('new');selectTool('select');updateSelectionOutline();prepareSelectionGroup();updateApplyButton();
  renderGroups();render();
  message('Multiple masks combined. Generate once to edit all selected areas together.');
}
function optionNameFromPrompt(prompt,fallback='New option'){
  let value=String(prompt||'').trim().replace(/\s+/g,' ');
  if(!value)return fallback;
  value=value.replace(/^(?:please\s+|can you\s+|could you\s+|i want you to\s+|i would like to\s+)+/i,'');
  value=value.split(/(?:[.!?;]|\s+(?:while|without changing|but keep|and keep|keeping the|preserving the|do not change|don't change)\b)/i)[0].trim();
  const finish=(text)=>{
    const result=String(text||'').trim().replace(/[.,;:!?]+$/,'').split(/\s+/).slice(0,5).join(' ').slice(0,44);
    return result?result[0].toUpperCase()+result.slice(1):fallback;
  };
  const remove=value.match(/\b(?:remove|delete|erase|eliminate|hide|get rid of)\s+(?:all\s+|the\s+)?([a-z][\w\s-]{1,50})/i);
  if(remove)return finish('No '+remove[1].replace(/\s+(?:from|on|in|at|behind|outside|inside|next to)\b.*$/i,''));
  const apply=value.match(/\b(?:apply|put|use)\s+(.+?)\s+(?:to|on|for)\s+(?:the|this|that)\s+(?:wall|ceiling|floor|facade|roof|doors?|windows?|panels?|area|surface|room|furniture)\b/i);
  let candidate=apply?apply[1]:value;
  if(!apply){
    const transformed=value.match(/\b(?:change|replace|convert|switch|turn|swap|transform|paint|make|set)\b[^.!?;]{0,70}?\b(?:with|into|to|as)\s+([^.!?;,]{1,65})/i);
    if(transformed)candidate=transformed[1];
  }
  candidate=candidate.replace(/^(?:please\s+)?(?:make|paint|turn|change|convert|render|replace|set|apply|use|add|give|create|show|switch|update|put|have|increase|enhance|improve)\s+/i,'');
  candidate=candidate.replace(/^(?:this|that|it|the|a|an|some|all|my|our|its|them)\s+/i,'');
  candidate=candidate.replace(/^(?:wall|floor|ceiling|door|window|roof|facade|furniture|sofa|chair|cabinet|millwork|image|render|material)s?\s+(?:to\s+|into\s+|with\s+|in\s+|be\s+)?/i,'');
  candidate=candidate.replace(/^it\s+/i,'').replace(/\s+(?:and|plus)\s+keep\b.*$/i,'');
  const material=candidate.match(/\b((?:(?:warm|cool|light|dark|natural|white|black|grey|gray|beige|blue|red|green|yellow|brown|brushed|polished|matte|glossy|textured|pale|rich|perforated|subtle)\s+){0,3}(?:walnut|oak|ash|pine|wood|terrazzo|concrete|marble|stone|limestone|granite|glass|glazing|aluminum|aluminium|metal|steel|bronze|copper|brick|carpet|tile|plaster|fabric|leather|veneer|louvers?|baffles?)(?:\s+(?:wood\s+)?(?:veneer|panels?|tiles?|slats?|cladding|flooring|ceiling|finish|baffles?|louvers?|siding|fabric))?)\b/i);
  if(material)return finish(material[1]);
  const color=candidate.match(/\b((?:(?:matte|glossy|light|dark|warm|cool|soft|pale|deep)\s+)?(?:black|white|gray|grey|beige|blue|red|green|yellow|bronze|gold|silver|brown|orange|pink|purple))\b(?:\s+(?:sofa|chairs?|panels?|baffles?|walls?|floor|ceiling|doors?))?/i);
  if(color)return finish(color[0]);
  const lighting=candidate.match(/\b((?:soft|warm|cool|bright|natural|diffused|indirect|linear|recessed|ambient)\s+(?:daylight|lighting|lights?|downlights?|cove lighting))\b/i);
  if(lighting)return finish(lighting[1]);
  if(/\b(?:increase|enhance|brighten)\b.*\b(?:daylight|lighting|light)\b/i.test(value))return 'Brighter lighting';
  if(/\b(?:photorealistic|ultra-realistic|realistic)\b/i.test(candidate))return 'Photorealistic';
  candidate=candidate.replace(/\s+(?:to|for|from|under|behind|outside|inside)\s+(?:the|this|that)\s+(?:image|scene|room|region|area|wall|ceiling|floor)\b.*$/i,'');
  return finish(candidate);
}

// Non-destructive four-corner warp. The source pixels and original mask stay intact.
const patchTextures = new WeakMap();
const visibleMaskCache = new WeakMap();
const maskHandleCache = new WeakMap();
function invalidateDisplayedMask(patch){
  window.MosaicObjects?.invalidated(patch);
  visibleMaskCache.delete(patch);
  patchTextures.delete(patch);
  maskHandleCache.delete(patch);
  optionThumbCache.delete(patch);
}
function renderedPatchLayer(patch){
  const output=makeCanvas(canvas.width,canvas.height);
  const source=state.sources.get(patch.sourceId);
  if(source)drawPatch(output.getContext('2d'),patch,source);
  return output;
}
function displayedPatchMask(patch){
  if(!patch.corners?.length)return patch.mask;
  const signature=[patch.bbox.x,patch.bbox.y,patch.bbox.w,patch.bbox.h,
    ...patch.corners.flatMap(p=>[p.x,p.y])].join('/');
  const cached=visibleMaskCache.get(patch);
  if(cached&&cached.mask===patch.mask&&cached.signature===signature)return cached.canvas;
  const result=makeCanvas(canvas.width,canvas.height);
  // Use the SAME affine / four-corner mesh as the visible option. The stored
  // source mask remains non-destructive and can always be reset or undone.
  const surrogate={bbox:patch.bbox,mask:patch.mask,corners:patch.corners};
  drawPatch(result.getContext('2d'),surrogate,{canvas:patch.mask});
  visibleMaskCache.set(patch,{mask:patch.mask,signature,canvas:result});
  return result;
}
const copyCorners = points => points?.map(p => ({x:p.x,y:p.y})) || null;
function patchDisplayBounds(patch){
  const q=patchCorners(patch),xs=q.map(p=>p.x),ys=q.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}
function patchCorners(patch) {
  if(patch.corners?.length===4)return patch.corners;
  const {x,y,w,h}=patch.bbox;
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}
function displayedMaskPoint(point,patch){
  if(!patch.corners?.length)return {...point};
  const b=patch.bbox;
  return bilinear(patch.corners,(point.x-b.x)/b.w,(point.y-b.y)/b.h);
}
function patchControlPoints(patch){
  let points=patch.maskPoints;
  if(!Array.isArray(points)||!points.length){
    points=maskHandleCache.get(patch);
    if(!points){
      // Older projects contain raster masks only. Recover handles on their
      // actual boundary instead of displaying the bounding rectangle.
      const b=patch.bbox,q=[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}];
      const d=patch.mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
      const distances=q.map(()=>Infinity);points=[];
      for(let y=Math.max(0,Math.floor(b.y));y<Math.min(canvas.height,Math.ceil(b.y+b.h));y++)for(let x=Math.max(0,Math.floor(b.x));x<Math.min(canvas.width,Math.ceil(b.x+b.w));x++){
        if(d[(y*canvas.width+x)*4+3]<=80)continue;
        q.forEach((corner,i)=>{const distance=(x-corner.x)**2+(y-corner.y)**2;if(distance<distances[i]){distances[i]=distance;points[i]={x,y}}});
      }
      points=points.filter(Boolean);maskHandleCache.set(patch,points);
    }
  }
  return points.map(point=>({original:point,...displayedMaskPoint(point,patch)}));
}
function patchTexture(patch, source) {
  const b=patch.bbox, key=[b.x,b.y,b.w,b.h,Boolean(state.featherEnabled)].join('/');
  const cached=patchTextures.get(patch);
  if(cached && cached.source===source.canvas && cached.mask===patch.mask && cached.key===key)return cached;
  const pad=Math.max(4,Math.ceil(canvas.width/250)+2);
  const x=Math.max(0,Math.floor(b.x)-pad),y=Math.max(0,Math.floor(b.y)-pad);
  const right=Math.min(canvas.width,Math.ceil(b.x+b.w)+pad),bottom=Math.min(canvas.height,Math.ceil(b.y+b.h)+pad);
  const image=makeCanvas(Math.max(1,right-x),Math.max(1,bottom-y)),tc=image.getContext('2d');
  tc.drawImage(source.canvas,-x,-y);
  tc.globalCompositeOperation='destination-in';
  if(!state.featherEnabled||source.canvas===patch.mask||patch.isMasterVersion){tc.drawImage(patch.mask,-x,-y)}
  else{
    const feather=makeCanvas(image.width,image.height),fc=feather.getContext('2d',{willReadFrequently:true});
    fc.drawImage(patch.mask,-x,-y);
    const pixels=fc.getImageData(0,0,feather.width,feather.height);
    const radius=Math.min(24,Math.max(4,Math.max(canvas.width,canvas.height)*.006),Math.min(b.w,b.h)/3);
    const alpha=window.MozMaskFeather.featherAlpha(pixels.data,feather.width,feather.height,radius);
    for(let i=0;i<alpha.length;i++)pixels.data[i*4+3]=alpha[i];
    fc.putImageData(pixels,0,0);tc.drawImage(feather,0,0);
  }
  const out={image,x,y,key,mask:patch.mask,source:source.canvas};
  patchTextures.set(patch,out);return out;
}
function bilinear(quad,u,v){
  const [tl,tr,br,bl]=quad;
  return {x:tl.x*(1-u)*(1-v)+tr.x*u*(1-v)+br.x*u*v+bl.x*(1-u)*v,
    y:tl.y*(1-u)*(1-v)+tr.y*u*(1-v)+br.y*u*v+bl.y*(1-u)*v};
}
function unwarpPatchSelection(selection,patch){
  if(!patch.corners?.length)return selection;
  const output=makeCanvas(canvas.width,canvas.height),target=output.getContext('2d');
  const quad=patchCorners(patch),b=patch.bbox,steps=8;
  const original=(u,v)=>({x:b.x+u*b.w,y:b.y+v*b.h});
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const u=x/steps,v=y/steps,nu=(x+1)/steps,nv=(y+1)/steps;
    const a=bilinear(quad,u,v),bb=bilinear(quad,nu,v),c=bilinear(quad,nu,nv),d=bilinear(quad,u,nv);
    const A=original(u,v),B=original(nu,v),C=original(nu,nv),D=original(u,nv);
    affineTriangle(target,selection,a,bb,c,A,B,C);
    affineTriangle(target,selection,a,c,d,A,C,D);
  }
  return output;
}
function pointToOriginalMask(point,patch){
  if(!patch?.corners?.length)return point;
  const q=patchCorners(patch),b=patch.bbox;
  // Solve the inverse bilinear four-corner mapping using Newton iterations.
  const ext=patchDisplayBounds(patch);
  let u=clamp((point.x-ext.x)/Math.max(1,ext.w),0,1);
  let v=clamp((point.y-ext.y)/Math.max(1,ext.h),0,1);
  for(let i=0;i<14;i++){
    const at=bilinear(q,u,v),fx=at.x-point.x,fy=at.y-point.y;
    const dux=(q[1].x-q[0].x)*(1-v)+(q[2].x-q[3].x)*v;
    const duy=(q[1].y-q[0].y)*(1-v)+(q[2].y-q[3].y)*v;
    const dvx=(q[3].x-q[0].x)*(1-u)+(q[2].x-q[1].x)*u;
    const dvy=(q[3].y-q[0].y)*(1-u)+(q[2].y-q[1].y)*u;
    const det=dux*dvy-duy*dvx;
    if(Math.abs(det)<1e-6)break;
    const stepU=(fx*dvy-fy*dvx)/det,stepV=(fy*dux-fx*duy)/det;
    u-=stepU;v-=stepV;
    if(Math.max(Math.abs(stepU),Math.abs(stepV))<1e-5)break;
  }
  return {x:b.x+u*b.w,y:b.y+v*b.h};
}
function affineTriangle(target,texture,s0,s1,s2,d0,d1,d2,padding=0){
  const sx1=s1.x-s0.x,sy1=s1.y-s0.y,sx2=s2.x-s0.x,sy2=s2.y-s0.y;
  const det=sx1*sy2-sx2*sy1;if(Math.abs(det)<1e-8)return;
  const dx1=d1.x-d0.x,dy1=d1.y-d0.y,dx2=d2.x-d0.x,dy2=d2.y-d0.y;
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
  const c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  const middle={x:(d0.x+d1.x+d2.x)/3,y:(d0.y+d1.y+d2.y)/3};
  const clip=[d0,d1,d2].map(p=>{const length=Math.hypot(p.x-middle.x,p.y-middle.y)||1;return {x:p.x+(p.x-middle.x)*padding/length,y:p.y+(p.y-middle.y)*padding/length}});
  target.save();target.beginPath();clip.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));target.closePath();target.clip();
  target.setTransform(a,b,c,d,d0.x-a*s0.x-c*s0.y,d0.y-b*s0.x-d*s0.y);
  target.drawImage(texture,0,0);target.restore();
}
function drawPatch(target,patch,source){
  if(!patch || !source || patch.awaitingResult)return;
  const t=patchTexture(patch,source);
  if(!patch.corners){target.drawImage(t.image,t.x,t.y);return}
  const q=patchCorners(patch),b=patch.bbox;
  // Parallelograms need just one draw; arbitrary 4-point skew gets a piecewise affine mesh.
  const affine=Math.hypot(q[0].x+q[2].x-q[1].x-q[3].x,q[0].y+q[2].y-q[1].y-q[3].y)<.05;
  if(affine){
    const a=(q[1].x-q[0].x)/b.w,bb=(q[1].y-q[0].y)/b.w;
    const c=(q[3].x-q[0].x)/b.h,d=(q[3].y-q[0].y)/b.h;
    const sx=b.x-t.x,sy=b.y-t.y;
    target.save();target.transform(a,bb,c,d,q[0].x-a*sx-c*sy,q[0].y-bb*sx-d*sy);
    target.drawImage(t.image,0,0);target.restore();return;
  }
  const uvSource=(u,v)=>({x:b.x+u*b.w-t.x,y:b.y+v*b.h-t.y});
  const steps=8;
  for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
    const u=x/steps,v=y/steps,un=(x+1)/steps,vn=(y+1)/steps;
    const A=uvSource(u,v),B=uvSource(un,v),C=uvSource(un,vn),D=uvSource(u,vn);
    const a=bilinear(q,u,v),bb=bilinear(q,un,v),c=bilinear(q,un,vn),d=bilinear(q,u,vn);
    affineTriangle(target,t.image,A,B,C,a,bb,c);
    affineTriangle(target,t.image,A,C,D,a,c,d);
  }
}
function convexCorners(q){
  let sign=0;
  for(let i=0;i<4;i++){
    const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)<1)return false;
    if(sign && cross*sign<0)return false;
    sign=Math.sign(cross);
  }
  return true;
}
function inQuad(p,q){let inside=false;for(let i=0,j=3;i<4;j=i++){
  const a=q[i],b=q[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside}
function quadCenter(q){return {x:q.reduce((s,p)=>s+p.x,0)/4,y:q.reduce((s,p)=>s+p.y,0)/4}}
function transformHit(p,patch,handlesOnly=false){
  const points=patchControlPoints(patch),radius=9/state.zoom;
  for(const point of points)if(Math.hypot(p.x-point.x,p.y-point.y)<radius)return {kind:'corner',point:point.original};
  if(handlesOnly||!pointInImage(p))return null;
  const alpha=displayedPatchMask(patch).getContext('2d',{willReadFrequently:true}).getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data[3];
  return alpha>0?{kind:'move'}:null;
}
function activeTransformPatch(){
  const patch=state.patches.get(state.selectedPatchId);
  return patch&&state.groups.some(g=>g.active===patch.id)?patch:null;
}
function deselectCanvasRegion(){
  state.selectedPatchId=null;state.queuedGroupId=null;
  resetSelection();overlay.style.cursor='default';
  $('resetTransformBtn').classList.add('hidden');
  renderGroups();render();
}
function beginTransform(e,p){
  if(state.pendingSourceId||state.editingPatchId||window.MosaicPremium?.isPreviewing())return false;
  let patch=activeTransformPatch(),hit=patch&&transformHit(p,patch);
  if(!hit){
    for(const group of [...state.groups].reverse()){
      const other=state.patches.get(group.active);if(!other)continue;
      const found=transformHit(p,other);if(!found)continue;
      patch=other;hit=found;state.selectedPatchId=patch.id;renderGroups();break;
    }
  }
  if(!patch||!hit){deselectCanvasRegion();return false}
  const initial=copyCorners(patchCorners(patch));
  state.transformDrag={patchId:patch.id,hit,start:p,initial,moved:false};
  $('resetTransformBtn').classList.remove('hidden');
  overlay.setPointerCapture(e.pointerId);
  overlay.style.cursor=hit.kind==='corner'?'crosshair':'grabbing';
  drawOverlay();return true;
}
function moveTransform(p){
  const drag=state.transformDrag;if(!drag)return;
  const patch=state.patches.get(drag.patchId);if(!patch)return;
  const dx=p.x-drag.start.x,dy=p.y-drag.start.y,arr=copyCorners(drag.initial);
  if(drag.hit.kind==='corner'){
    // Drive the existing four-corner warp from the user's actual mask vertex.
    // Bilinear weights keep the vertex under the pointer without changing the
    // stored image, mask, or the transform format used by older projects.
    const b=patch.bbox,u=(drag.hit.point.x-b.x)/b.w,v=(drag.hit.point.y-b.y)/b.h;
    const weights=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v],sum=weights.reduce((total,w)=>total+w*w,0);
    arr.forEach((point,i)=>{point.x=clamp(point.x+dx*weights[i]/sum,0,canvas.width);point.y=clamp(point.y+dy*weights[i]/sum,0,canvas.height)});
    if(!convexCorners(arr))return;
  }else{
    const xs=arr.map(q=>q.x),ys=arr.map(q=>q.y);
    const tx=clamp(dx,-Math.min(...xs),canvas.width-Math.max(...xs));
    const ty=clamp(dy,-Math.min(...ys),canvas.height-Math.max(...ys));
    for(const q of arr){q.x+=tx;q.y+=ty}
  }
  if(!drag.moved && Math.hypot(dx,dy)*state.zoom<3)return;
  if(!drag.moved){
    state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
    trimUndo();state.redo=[];drag.moved=true;
  }
  patch.corners=arr;
  if(state.tool==='select'){state.selectionMask=cloneMask(displayedPatchMask(patch));setSelectionPaths(patchSelectionPaths(patch));state.boundaryCanvas=state.selectionMask}
  render();
}
function endTransform(){
  const drag=state.transformDrag;state.transformDrag=null;overlay.style.cursor='';
  if(drag?.moved){
    const patch=state.patches.get(drag.patchId),group=state.groups.find(g=>g.patchIds.includes(drag.patchId));
    if(patch)invalidateDisplayedMask(patch);
    if(group)refreshGroupFootprint(group);
    message('Layer and selection moved together. Drag corners to skew; Undo to revert.');
    renderGroups();
  }
  drawOverlay();if(state.tool==='select'&&drag&&!drag.moved)showQuickPrompt(state.lastCanvasPointer);
}
function resetPatchTransform(){
  const patch=activeTransformPatch();if(!patch||!patch.corners||window.MosaicPremium?.isPreviewing())return;
  state.undo.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
  trimUndo();state.redo=[];
  patch.corners=null;invalidateDisplayedMask(patch);const group=state.groups.find(g=>g.patchIds.includes(patch.id));if(group)refreshGroupFootprint(group);renderGroups();render();toast('Layer and selection transform reset.');
}

// Approved output: latest Master first, then exactly one active patch per region.
function drawApprovedComposition(target){
  if(!state.master)return;
  target.clearRect(0,0,canvas.width,canvas.height);
  target.drawImage(state.master,0,0,canvas.width,canvas.height);
  window.MosaicObjects?.drawBase(target);
  for(const group of window.MosaicObjects?.orderedGroups()||state.groups){
    if(!group.active){window.MosaicObjects?.drawOriginal(target,group);continue;}
    const patch=state.patches.get(group.active),source=patch&&state.sources.get(patch.sourceId);
    if(patch&&source&&!patch.awaitingResult){
      const preview=state.maskVertexDrag?.patchId===patch.id&&state.maskVertexDrag.preview;
      if(preview)target.drawImage(preview,0,0);else drawPatch(target,patch,source);
      window.MosaicObjects?.drawOptionRepairs(target,group,patch);
    }
  }
}
function composeApprovedCanvas(){
  if(!state.master)return null;
  const output=makeCanvas(canvas.width,canvas.height);
  drawApprovedComposition(output.getContext('2d'));
  return output;
}
function render(){
  if(!state.master)return;
  renderComparison();
  if(state.before){
    drawApprovedComposition(ctx);
    window.MosaicWorkspace?.drawResult(ctx);
    drawOverlay();return;
  }
  if(window.MosaicPremium?.drawArchivePreview(ctx)){drawOverlay();return}
  drawApprovedComposition(ctx);
  const pending=state.sources.get(state.pendingSourceId);
  if(pending){
    if(state.pendingRevealOnly&&state.selectionMask){
      const temp=makeCanvas(canvas.width,canvas.height),tc=temp.getContext('2d');
      tc.drawImage(pending.canvas,0,0);tc.globalCompositeOperation='destination-in';
      tc.filter=state.featherEnabled?'blur(1.8px)':'none';tc.drawImage(state.selectionMask,0,0);tc.filter='none';ctx.drawImage(temp,0,0);
    }else{ctx.save();ctx.globalAlpha=.84;ctx.drawImage(pending.canvas,0,0);ctx.restore()}
  }
  window.MosaicWorkspace?.drawResult(ctx);
  drawOverlay();
  window.MosaicSlimWand?.imageChanged?.();
}
function svgNode(tag,attributes={}){
  const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}
function vectorLayer(id){
  let layer=$(id);if(!layer){layer=svgNode('g',{id});$('selectionDraft').prepend(layer)}
  layer.replaceChildren();return layer;
}
function drawVectorPaths(layer,paths,{color='#fff',fill='none',width=.95,dashed=false}={}){
  const d=paths.filter(path=>path.length>=3).map(path=>path.map((point,index)=>(index?'L':'M')+point.x+' '+point.y).join(' ')+' Z').join(' ');
  const attributes={d,fill,'fill-rule':'evenodd',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke','stroke-linejoin':'round'};
  if(dashed){attributes.stroke='#fff';attributes['stroke-dasharray']='4 6'}
  layer.append(svgNode('path',attributes));
}
function updateSelectionOutline(){window.MosaicObjects?.selectionChanged();state.boundaryCanvas=!state.selectionOverlayHidden&&state.selectionMask&&maskBoundingBox(state.selectionMask)?state.selectionMask:null;updateSelectionModes();drawOverlay()}
function drawOverlay(){ox.clearRect(0,0,overlay.width,overlay.height);drawDraftPreview();window.MosaicPremium?.positionCanvasProgress?.();window.MosaicWorkspace?.drawOverlay();window.MosaicObjectMap?.drawSelection();
  const pointerRect=vectorLayer('pointerRectVectors');
  if(state.pointerBoxStart&&state.pointerBoxEnd){
    const a=state.pointerBoxStart,b=state.pointerBoxEnd;
    const minX=Math.max(0,Math.min(a.x,b.x)),maxX=Math.min(canvas.width,Math.max(a.x,b.x));
    const minY=Math.max(0,Math.min(a.y,b.y)),maxY=Math.min(canvas.height,Math.max(a.y,b.y));
    if(maxX>minX&&maxY>minY)drawVectorPaths(pointerRect,[[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}]],
      {fill:'rgba(165,115,236,.18)',dashed:true});
  }
  const vectors=vectorLayer('selectionOutlineVectors');
  vectors.classList.toggle('is-quiet',Boolean(state.selectionOverlayHidden));
  vectorLayer('regionGuideVectors');
  if(state.before||window.MosaicPremium?.isPreviewing()){maskAddButton.hidden=maskRemoveButton.hidden=true;clearHover();return}
  if(!window.MosaicWorkspace?.isSelectingResult())window.MosaicPremium?.drawRegionGuides();
  if(!state.selectionOverlayHidden&&state.boundaryCanvas&&!window.MosaicObjects?.drawPreview(ox,vectors))drawVectorPaths(vectors,ensureSelectionPaths(),{fill:state.tool==='select'?'rgba(151,109,231,.22)':'none',dashed:true});
  const chosen=state.tool==='transform' && !state.pendingSourceId && !state.editingPatchId && activeTransformPatch();
  if(chosen){
    drawVectorPaths(vectors,patchSelectionPaths(chosen),{dashed:true});
    for(const p of patchControlPoints(chosen)){const r=3/state.zoom;vectors.append(svgNode('rect',{x:p.x-r,y:p.y-r,width:r*2,height:r*2,fill:'#f5f0ff',stroke:'#6555bd','stroke-width':1,'vector-effect':'non-scaling-stroke'}))}
  }else if(state.boundaryCanvas&&!state.selectionOverlayHidden&&state.tool!=='select'){
    for(const point of state.selectionPoints||[])vectors.append(svgNode('circle',{cx:point.x,cy:point.y,r:2.5/state.zoom,fill:'#e4e2ff'}));
  }
  // The SVG draft layer draws unfinished shapes beyond the image bounds.
  updateMaskPointControls();refreshBrushCursor();
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
// Small thumbnails show an actual cutout on transparency, not a full render.
// Cache completed option thumbs to avoid expensive full-image work during UI redraws.
const optionThumbCache=new WeakMap();
function cutoutThumbnail(image,mask){
  if(!image||!mask)return '';
  const b=maskBoundingBox(mask);if(!b)return '';
  const width=52,height=42,pad=3,scale=Math.min((width-pad*2)/b.w,(height-pad*2)/b.h);
  const dw=b.w*scale,dh=b.h*scale,dx=(width-dw)/2,dy=(height-dh)/2;
  const thumb=makeCanvas(width,height),t=thumb.getContext('2d');
  t.imageSmoothingEnabled=true;t.imageSmoothingQuality='high';
  t.drawImage(image,b.x,b.y,b.w,b.h,dx,dy,dw,dh);
  t.globalCompositeOperation='destination-in';
  t.filter='blur(.8px)';
  t.drawImage(mask,b.x,b.y,b.w,b.h,dx,dy,dw,dh);
  t.filter='none';t.globalCompositeOperation='source-over';
  return thumb.toDataURL('image/png');
}
function patchThumbnail(patch){
  if(!patch)return '';
  const src=state.sources.get(patch.sourceId),mask=displayedPatchMask(patch);
  if(!src?.canvas||!mask||patch.awaitingResult)return '';
  const signature=[patch.bbox?.x,patch.bbox?.y,patch.bbox?.w,patch.bbox?.h,
    ...(patch.corners||[]).flatMap(p=>[p.x,p.y])].join('/');
  const cached=optionThumbCache.get(patch);
  if(cached&&cached.source===src.canvas&&cached.mask===patch.mask&&cached.signature===signature)return cached.data;
  const image=patch.corners?.length?renderedPatchLayer(patch):src.canvas;
  const data=cutoutThumbnail(image,mask);
  optionThumbCache.set(patch,{source:src.canvas,mask:patch.mask,signature,data});
  return data;
}
const groupThumbCache=new WeakMap();
function groupThumbnail(group){
  const active=state.patches.get(group.active);
  if(active){
    const url=patchThumbnail(active);
    if(url)return url;
  }
  const identity=group.footprint||group.maskCrop||group.objectOriginal?.mask;
  const cached=groupThumbCache.get(group);
  if(cached&&cached.image===state.master&&cached.mask===identity)return cached.url;
  const url=cutoutThumbnail(state.master,groupMask(group));
  groupThumbCache.set(group,{image:state.master,mask:identity,url});
  return url;
}
function renderGroups(){
  const list=$('groupList');
  // Async AI status/semantic naming refreshes the Groups panel while people
  // type an inline prompt. Preserve the actual form node, its attached files,
  // paste handlers and caret instead of destroying it with innerHTML.
  const liveForm=list.querySelector('.region-option-prompt');
  const liveGroup=liveForm?.closest('.region-group[data-group]')?.dataset.group;
  const liveFocus=liveForm?.contains(document.activeElement)?document.activeElement:null;
  const caret=liveFocus&&typeof liveFocus.selectionStart==='number'
    ?[liveFocus.selectionStart,liveFocus.selectionEnd]:null;
  if(liveForm)liveForm.remove();
  const visibleGroups=state.groups.filter(group=>!group.objectMapBatch&&!group.mergedInto);
  const collections=state.objectCollections||[],categories=new Map(collections.map(c=>[c.id,[]]));
  for(const group of visibleGroups){const key=collections.some(c=>c.id===group.collectionId)?group.collectionId:'';if(!categories.has(key))categories.set(key,[]);categories.get(key).push(group)}
  $('groupCount').textContent=collections.length;updateSourceActions();
  $('pendingBanner').classList.toggle('hidden',!state.pendingSourceId);
  if(state.pendingSourceId){const source=state.sources.get(state.pendingSourceId);$('pendingName').textContent='● Editing: '+(source?.name||'New variation')}
  if(!visibleGroups.length&&!collections.length){
    list.innerHTML='<div class="empty-groups"><span>◌</span><strong>No objects yet</strong><p>Continue with Base to prepare objects, or draw a mask. Use + to create a Group.</p></div>';
    return;
  }
  const renderGroup=g=>{
    const readyIds=g.patchIds.filter(id=>state.patches.get(id)&&!state.patches.get(id).hideUntilReady);
    const order=readyIds.slice().reverse().sort((a,b)=>Number(b===g.active)-Number(a===g.active)||Number(Boolean(state.patches.get(a)?.isOriginalMaster))-Number(Boolean(state.patches.get(b)?.isOriginalMaster)));
    const optionRow=(pid)=>{
      const p=state.patches.get(pid);if(!p)return '';
      const isMaster=p.isMasterVersion||p.isOriginalMaster;
      const thumb=patchThumbnail(p);
      return `<div class="variant-row ${g.active===pid?'selected':''} ${state.maskEditOnly&&state.selectionTargetPatchId===pid?'mask-editing':''}" data-action="choose" data-group="${g.id}" data-patch="${pid}" ${isMaster?'data-master-version="true"':''}><span class="variant-dot"></span>${thumb?`<img class="option-cutout" src="${thumb}" alt="" loading="lazy">`:''}<span class="variant-text">${escapeHTML(p.name)}</span><span class="option-actions" aria-label="Option actions"><button type="button" class="variant-action" title="Edit selection mask" data-action="edit-mask" data-group="${g.id}" data-patch="${pid}">Edit</button><button type="button" class="variant-action" title="Rename option" data-region-action="rename-option" data-group="${g.id}" data-patch="${pid}">Rename</button><button type="button" class="variant-action" title="Delete option" data-action="delete" data-group="${g.id}" data-patch="${pid}">Delete</button><button type="button" class="variant-action" title="Regenerate this option (Pro)" data-region-action="regen-option" data-group="${g.id}" data-patch="${pid}">${p.generating?'Generating…':'✦ Regen'}</button></span></div>`;
    };
    const versionCategories=new Map();
    for(const pid of order){
      const patch=state.patches.get(pid);
      const category=patch?.versionCategory||(patch?.isOriginalMaster?'Original':patch?.isMasterVersion?'Master versions':'Options');
      if(!versionCategories.has(category))versionCategories.set(category,[]);
      versionCategories.get(category).push(pid);
    }
    const optionCategories=[...versionCategories].map(([category,ids])=>
      `<section class="option-version-category" data-version-category="${escapeHTML(category)}"><div class="option-version-heading"><span>${escapeHTML(category)}</span><span>${ids.length}</span></div>${ids.map(optionRow).join('')}</section>`).join('');
    const originalRow=g.hasHarmonizedMaster||!readyIds.length?'':`<div class="variant-row ${g.active===null?'selected':''}" data-action="choose" data-group="${g.id}" data-patch="master"><span class="variant-dot"></span><span class="variant-text">Original Master</span></div>`;
    const groupThumb=groupThumbnail(g);
    return `<div class="region-group" data-group="${g.id}"><div class="group-head" data-action="focus" data-group="${g.id}"><span class="group-icon">${groupThumb?`<img class="group-cutout" src="${groupThumb}" alt="" loading="lazy">`:'▧'}</span><span class="group-heading-copy"><small>${g.collectionId?'Part':'Object'} ${String(state.groups.indexOf(g)+1).padStart(2,'0')}</small><span class="group-name">${escapeHTML(g.name)}</span></span><span class="group-count">${readyIds.length}</span><span class="group-head-actions"><button type="button" class="variant-action group-add-option" data-region-action="add-option" title="Add an option to this region" aria-label="Add region option">＋</button></span></div><div class="group-options">${optionCategories}${originalRow}${readyIds.length?'':`<small class="group-pending-options">${g.patchIds.length?'Generating edit…':'Select an area and Generate to add an option'}</small>`}</div></div>`;
  };
  const collapsed=new Set(state.collapsedCategories||[]);
  list.innerHTML=[...categories].map(([id,groups])=>{
    const collection=collections.find(c=>c.id===id),isCollapsed=collapsed.has(id),objects=groups.slice().sort((a,b)=>Number(b.id===state.focusedGroupId)-Number(a.id===state.focusedGroupId));
    const name=collection?collection.name:'Ungrouped objects';
    return `<section class="object-category ${collection?.auto?'auto-cluster':''}" data-collection="${escapeHTML(id)}"><div class="object-collection-heading"><button type="button" class="object-category-head" data-action="toggle-category" data-category="${escapeHTML(id)}" aria-expanded="${!isCollapsed}"><span class="category-chevron" aria-hidden="true">${isCollapsed?'&#9656;':'&#9662;'}</span><strong>${escapeHTML(name)}</strong><span>${groups.length} ${groups.length===1?'part':'parts'}</span></button>${collection&&groups.length>1?`<button type="button" class="merge-collection" data-merge-collection="${escapeHTML(id)}" title="Consolidate all parts into one Object ID and mask">Merge Object</button>`:''}</div>${collection&&!isCollapsed?`<div class="object-category-controls"><input class="collection-name" aria-label="Group name" data-collection-name="${escapeHTML(collection.id)}" value="${escapeHTML(collection.name)}"><button type="button" class="remove-collection" data-remove-collection="${escapeHTML(collection.id)}" title="Remove group; keep its objects">&#215;</button></div>`:''}<div class="object-category-items" ${isCollapsed?'hidden':''}>${isCollapsed?'':objects.map(renderGroup).join('')}${objects.length?'':'<small class="empty-collection">Add objects using their group menu or a multi-selection.</small>'}</div></section>`;
  }).join('');
  if(liveForm&&liveGroup){
    const section=[...list.querySelectorAll('.region-group[data-group]')]
      .find(group=>group.dataset.group===liveGroup);
    const slot=section?.querySelector('.group-options');
    if(slot){
      slot.prepend(liveForm);
      if(liveFocus){
        liveFocus.focus({preventScroll:true});
        if(caret)try{liveFocus.setSelectionRange(...caret)}catch{/* Not a text input. */}
      }
    }
  }
  window.MosaicRegions?.decorate();window.MosaicObjectManager?.decorate();window.MosaicPremium?.decorateActive?.();updateSourceActions();
  refreshQuickOptions();
}
function editExisting(pid){if(state.pendingSourceId){toast('Apply or discard your new image before editing saved variants.');return}const patch=state.patches.get(pid);if(!patch)return;state.editingPatchId=pid;state.selectedPatchId=pid;resetSelection();state.selectionPoints=patchControlPoints(patch).map(({x,y})=>({x,y}));state.selectionMask.getContext('2d').drawImage(displayedPatchMask(patch),0,0);setMode('add');selectTool('lasso');updateSelectionOutline();updateApplyButton();message('Editing a saved mask. Refine it, then click Update mask to commit changes.')}
function groupEvent(e){if(window.MosaicRegions?.handleGroupEvent(e))return;if(window.MosaicPremium?.handleGroupEvent(e))return;const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,group=state.groups.find(g=>g.id===target.dataset.group),pid=target.dataset.patch;
  if(action==='toggle-category'){const collapsed=new Set(state.collapsedCategories||[]);if(collapsed.has(target.dataset.category))collapsed.delete(target.dataset.category);else collapsed.add(target.dataset.category);state.collapsedCategories=[...collapsed];renderGroups();return}
  if(action==='focus'&&group){hideQuickPrompt();selectGroupMask(group);return}
  if(action==='edit-mask'&&group){hideQuickPrompt();selectGroupMask(group,{showOutline:true});state.maskEditOnly=true;state.selectionOverlayHidden=false;updateSelectionOutline();renderGroups();render();return}
  if(action==='edit-image'){window.MosaicSourceEditor?.openOption(pid);return}
  if(action==='edit'){editExisting(pid);return}
  if(action==='choose'&&group){
    if(state.pendingSourceId){toast('Apply or discard the new image first.');return}
    hideQuickPrompt();state.editingPatchId=null;
    if((e.ctrlKey||e.metaKey)&&pid!=='master'){
      optionChoiceVersions.set(group,groupChoiceVersion(group)+1);
      group.active=pid;refreshGroupFootprint(group);
      appendGroupSelection(group);showQuickPrompt();renderGroups();render();return;
    }
    chooseGroupOption(group,pid==='master'?null:pid);return;
  }
  if(action==='delete'&&group){if(state.pendingSourceId){toast('Finish the new image before removing variants.');return}group.patchIds=group.patchIds.filter(x=>x!==pid);state.patches.delete(pid);if(group.active===pid)group.active=group.patchIds.at(-1)||null;if(state.editingPatchId===pid)state.editingPatchId=null;if(state.selectedPatchId===pid)state.selectedPatchId=null;if(!group.patchIds.length)state.groups=state.groups.filter(g=>g.id!==group.id);else refreshGroupFootprint(group);resetSelection();renderGroups();render();toast('Variant removed.')}}
function selectTool(tool){if(window.MosaicSourceEditor?.isEditing())return;clearHover();clearDraft();hideQuickPrompt();state.tool=tool;if(state.pendingSourceId&&tool==='reveal'){state.pendingRevealOnly=true;render()}$('resetTransformBtn').classList.toggle('hidden',tool!=='transform'||!activeTransformPatch());
  $('viewport').classList.toggle('is-selecting',['lasso','rect','ellipse','wand','reveal','erase'].includes(tool));
  $('wandOptions').classList.toggle('hidden',tool!=='wand');
  updateSelectionModes();
  $('brushOptions').classList.toggle('hidden',tool!=='reveal'&&tool!=='erase');
  $('brushIntensityOptions').classList.toggle('hidden',tool!=='reveal'&&tool!=='erase');
  overlay.style.cursor='';
  if(tool==='select'&&state.boundaryCanvas)ensureSelectionPaths();
  if(tool==='select')message('Select: tap an object, or drag a rectangle to select overlapping object masks.');
  else if(tool==='cut')message('Cut: select an object first, then draw one line all the way through it.');
  else if(tool==='wand')message('Wand: click to select one prepared object. Ctrl/Cmd-click adds another object.');
  else if(tool==='lasso')message('Line: click each corner, then click the first point or press Enter to close.');
  else if(tool==='zoom')message('Zoom: click to zoom in. Shift-click to zoom out.');
  else if(tool==='pan')message('Pan: drag to move around the canvas.');
  else if(tool==='rect'||tool==='ellipse')message('Create a new foreground object. Holding Shift constrains proportions.');
document.querySelectorAll('.tool').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool))});$('canvasWrap').className=`canvas-wrap${state.master?'':' hidden'} ${tool==='pan'?'pan':tool==='zoom'?'zoom':tool==='transform'?'transform':tool==='reveal'?'brush':tool==='erase'?'eraser':''}`;drawOverlay();window.MosaicSlimWand?.onToolChange?.(tool)}
function canvasPoint(e,clipped=true){const rect=overlay.getBoundingClientRect(), x=(e.clientX-rect.left)/rect.width*canvas.width,y=(e.clientY-rect.top)/rect.height*canvas.height;return {x:clipped?clamp(x,0,canvas.width):x,y:clipped?clamp(y,0,canvas.height):y}}
function pointInImage(p){return p.x>=0&&p.y>=0&&p.x<canvas.width&&p.y<canvas.height}
function renderMaskPaths(paths){
  const mask=makeCanvas(canvas.width,canvas.height),m=mask.getContext('2d');m.fillStyle='#fff';m.beginPath();
  for(const path of paths){if(path.length<3)continue;path.forEach((p,i)=>i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y));m.closePath()}
  m.fill('evenodd');return mask;
}
function maskPathsFromRaster(mask,points=[]){
  const w=mask.width,h=mask.height;
  const sample=makeCanvas(w,h),ctx=sample.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.drawImage(mask,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h).data;
  if(points.length>=3&&points.length<=512){
    const probe=makeCanvas(w,h),c=probe.getContext('2d');c.scale(w/canvas.width,h/canvas.height);c.fillStyle='#fff';c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fill();
    const candidate=c.getImageData(0,0,w,h).data;let changed=0,total=0;
    for(let i=3;i<pixels.length;i+=4){const a=pixels[i]>110,b=candidate[i]>110;if(a||b)total++;if(a!==b)changed++}
    if(total&&changed/total<.012)return [copyCorners(points)];
  }
  const paths=MaskGeometry.traceMask(pixels,w,h,canvas.width/w,canvas.height/h,0);
  // Remove redundant points on the same straight edge without moving the
  // contour or rounding any pixel corners.
  return paths.map(path=>path.filter((point,index)=>{
    const before=path[(index+path.length-1)%path.length],after=path[(index+1)%path.length];
    return Math.abs((point.x-before.x)*(after.y-point.y)-(point.y-before.y)*(after.x-point.x))>1e-8;
  })).filter(path=>path.length>=3);
}
function setSelectionPaths(paths){
  state.selectionPaths=MaskGeometry.copyPaths(paths);state.selectionPoints=state.selectionPaths.flat();
  activeMaskVertex=null;hoverMaskEdge=null;maskEditVersion++;
}
function ensureSelectionPaths(){
  if(!state.selectionPaths?.length&&state.boundaryCanvas)setSelectionPaths(maskPathsFromRaster(state.selectionMask,state.selectionPoints));
  return state.selectionPaths||[];
}
function patchSelectionPaths(patch){
  if(!patch.maskPaths?.length)patch.maskPaths=maskPathsFromRaster(patch.mask,patch.maskPoints||[]);
  return patch.maskPaths.map(path=>path.map(point=>displayedMaskPoint(point,patch)));
}
function selectionVertexAt(point){
  if(!state.boundaryCanvas)return -1;
  ensureSelectionPaths();return state.selectionPoints.findIndex(vertex=>Math.hypot(point.x-vertex.x,point.y-vertex.y)<=8/state.zoom);
}
function vertexDescriptor(index){
  for(let pathIndex=0;pathIndex<state.selectionPaths.length;pathIndex++){
    if(index<state.selectionPaths[pathIndex].length)return {pathIndex,index};index-=state.selectionPaths[pathIndex].length;
  }
  return null;
}
function snapshotPointEdit(){const patch=state.patches.get(state.selectionTargetPatchId);if(patch)snapshotPatch(patch);else snapshotSelection()}
function selectedImagePatch(){
  const patch=state.patches.get(state.selectionTargetPatchId);
  return patch&&!patch.awaitingResult&&!state.maskEditOnly&&!state.pendingSourceId?patch:null;
}
function attachGeneratedSelection(patch,group){
  if(state.maskEditOnly||state.selectionTargetPatchId||(state.draftGroupId&&state.draftGroupId!==group?.id)||!state.selectionMask)return;
  const sample=mask=>{const c=makeCanvas(128,128),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(mask,0,0,128,128);return x.getImageData(0,0,128,128).data};
  const a=sample(state.selectionMask),b=sample(displayedPatchMask(patch));
  for(let i=3;i<a.length;i+=4)if((a[i]>0)!==(b[i]>0))return;
  state.selectionTargetPatchId=patch.id;state.draftGroupId=group.id;
}
function placementSnapshot(patch){return {sourceId:patch.sourceId,mask:cloneMask(patch.mask),maskPaths:MaskGeometry.copyPaths(patch.maskPaths),maskPoints:copyCorners(patch.maskPoints),bbox:{...patch.bbox},corners:copyCorners(patch.corners)}}
function snapshotPlacement(patch){state.undo.push({type:'placement',patchId:patch.id,placement:placementSnapshot(patch)});trimUndo();state.redo=[]}
function warpImagePaths(layer,fromPaths,toPaths,mask=state.selectionMask){
  const output=makeCanvas(canvas.width,canvas.height),target=output.getContext('2d');
  const areas=fromPaths.map(path=>path.reduce((sum,p,i)=>{const q=path[(i+1)%path.length];return sum+p.x*q.y-q.x*p.y},0));
  const winding=Math.sign(areas.reduce((largest,area)=>Math.abs(area)>Math.abs(largest)?area:largest,0))||1;
  fromPaths.forEach((path,pathIndex)=>{
    if(Math.sign(areas[pathIndex])!==winding)return;
    const destination=toPaths[pathIndex];if(!destination||destination.length!==path.length)return;
    for(const [a,b,c] of MaskGeometry.triangulate(path))affineTriangle(target,layer,path[a],path[b],path[c],destination[a],destination[b],destination[c],1);
  });
  target.globalCompositeOperation='destination-in';target.drawImage(mask,0,0);return output;
}
function deformSelectionMask(mask,fromPaths,toPaths,paths){
  const support=renderMaskPaths(paths),output=warpImagePaths(mask,fromPaths,toPaths,support);
  const bounds=items=>{let left=canvas.width,top=canvas.height,right=0,bottom=0;for(const path of items)for(const p of path){left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y)}const x=clamp(Math.floor(left),0,canvas.width-1),y=clamp(Math.floor(top),0,canvas.height-1);return {x,y,w:Math.max(1,Math.min(canvas.width,Math.ceil(right))-x),h:Math.max(1,Math.min(canvas.height,Math.ceil(bottom))-y)}};
  const a=bounds(fromPaths),b=bounds(paths),source=mask.getContext('2d').getImageData(a.x,a.y,a.w,a.h).data;
  let opacity=0;for(let i=3;i<source.length;i+=4)opacity=Math.max(opacity,source[i]);
  const ctx=output.getContext('2d'),pixels=ctx.getImageData(b.x,b.y,b.w,b.h),shape=support.getContext('2d').getImageData(b.x,b.y,b.w,b.h).data;
  for(let i=3;i<pixels.data.length;i+=4)if(shape[i]&&!pixels.data[i]){pixels.data[i-3]=pixels.data[i-2]=pixels.data[i-1]=255;pixels.data[i]=Math.round(shape[i]*opacity/255)}
  ctx.putImageData(pixels,b.x,b.y);return output;
}
function commitImagePlacement(patch,layer){
  const source=state.sources.get(patch.sourceId),id=uid('placed_source');
  state.sources.set(id,{id,name:source?.name||patch.name,canvas:layer});patch.sourceId=id;
  patch.mask=cloneMask(state.selectionMask);patch.maskPaths=MaskGeometry.copyPaths(state.selectionPaths);patch.maskPoints=patch.maskPaths.flat();
  patch.bbox=exactMaskBoundingBox(patch.mask)||patch.bbox;patch.corners=null;invalidateDisplayedMask(patch);
  const group=state.groups.find(g=>g.patchIds.includes(patch.id));if(group)refreshGroupFootprint(group);
}
function saveSelectionGeometry(pixels=true){
  const patch=state.patches.get(state.selectionTargetPatchId);
  if(patch){
    if(pixels)patch.mask=unwarpPatchSelection(state.selectionMask,patch);
    patch.maskPaths=state.selectionPaths.map(path=>path.map(point=>pointToOriginalMask(point,patch)));patch.maskPoints=patch.maskPaths.flat();
    if(!patch.corners&&pixels)patch.bbox=exactMaskBoundingBox(patch.mask)||patch.bbox;
    invalidateDisplayedMask(patch);const group=state.groups.find(g=>g.patchIds.includes(patch.id));if(group)refreshGroupFootprint(group);
  }else{
    const group=state.groups.find(g=>g.id===state.draftGroupId);
    if(group&&!group.patchIds.length&&pixels){group.footprint=cloneMask(state.selectionMask);group.area=maskBoundingBox(group.footprint)}
  }
}
function beginMaskVertexDrag(event,point){
  if(window.MosaicPremium?.isPreviewing())return false;
  const index=selectionVertexAt(point);if(index<0)return false;
  const image=selectedImagePatch();
  state.maskVertexDrag={vertex:vertexDescriptor(index),start:point,paths:MaskGeometry.copyPaths(state.selectionPaths),mask:cloneMask(state.selectionMask),moved:false,
    patchId:image?.id||null,layer:image?renderedPatchLayer(image):null,sourceCanvas:image?state.sources.get(image.sourceId)?.canvas:null};
  activeMaskVertex=null;hoverMaskEdge=null;updateMaskPointControls();
  overlay.setPointerCapture(event.pointerId);event.preventDefault();hideQuickPrompt();return true;
}
function moveMaskVertex(point){
  const drag=state.maskVertexDrag;if(!drag)return;
  const original=drag.paths[drag.vertex.pathIndex][drag.vertex.index],dx=point.x-drag.start.x,dy=point.y-drag.start.y;
  if(Math.hypot(dx,dy)*state.zoom<3)return;
  const paths=MaskGeometry.moveVertex(drag.paths,drag.vertex.pathIndex,drag.vertex.index,{x:clamp(original.x+dx,0,canvas.width),y:clamp(original.y+dy,0,canvas.height)});
  const mask=deformSelectionMask(drag.mask,drag.paths,paths,paths);if(!maskBoundingBox(mask))return;
  if(!drag.moved){if(!drag.layer){snapshotPointEdit();drag.undoEntry=state.undo.at(-1)}drag.moved=true}
  state.selectionMask=mask;setSelectionPaths(paths);
  if(drag.layer)drag.preview=warpImagePaths(drag.layer,drag.paths,paths);
  updateSelectionOutline();updateApplyButton();render();
}
function endMaskVertexDrag(cancel=false){
  const drag=state.maskVertexDrag;state.maskVertexDrag=null;if(!drag)return;
  if(cancel){
    state.selectionMask=drag.mask;setSelectionPaths(drag.paths);
    if(drag.moved&&state.undo.at(-1)===drag.undoEntry)state.undo.pop();
  }else{
    if(drag.moved){
      void window.MosaicAccount?.track('mask_edited');
      const image=drag.patchId&&state.patches.get(drag.patchId);
      if(image){
        const layer=state.sources.get(image.sourceId)?.canvas===drag.sourceCanvas?drag.layer:renderedPatchLayer(image);
        snapshotPlacement(image);commitImagePlacement(image,warpImagePaths(layer,drag.paths,state.selectionPaths));
      }else saveSelectionGeometry();
    }
    activeMaskVertex=drag.vertex;
  }
  updateSelectionOutline();updateApplyButton();renderGroups();render();
  hideQuickPrompt();
}
function beginSelectionMove(event,point){
  if(!state.boundaryCanvas||!pointInImage(point))return false;
  if(state.selectionMask.getContext('2d').getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data[3]===0)return false;
  ensureSelectionPaths();state.maskMoveDrag={start:point,mask:cloneMask(state.selectionMask),paths:MaskGeometry.copyPaths(state.selectionPaths),bounds:exactMaskBoundingBox(state.selectionMask),moved:false};
  overlay.setPointerCapture(event.pointerId);event.preventDefault();hideQuickPrompt();return true;
}
function moveSelection(point){
  const drag=state.maskMoveDrag;if(!drag)return;
  const b=drag.bounds,dx=clamp(point.x-drag.start.x,-b.x,canvas.width-b.x-b.w),dy=clamp(point.y-drag.start.y,-b.y,canvas.height-b.y-b.h);
  if(!drag.moved&&Math.hypot(dx,dy)*state.zoom<3)return;
  if(!drag.moved){snapshotPointEdit();drag.undoEntry=state.undo.at(-1);drag.moved=true}
  const mask=makeCanvas(canvas.width,canvas.height);mask.getContext('2d').drawImage(drag.mask,dx,dy);state.selectionMask=mask;
  setSelectionPaths(drag.paths.map(path=>path.map(p=>({x:p.x+dx,y:p.y+dy}))));updateSelectionOutline();render();
}
function endSelectionMove(cancel=false){
  const drag=state.maskMoveDrag;state.maskMoveDrag=null;if(!drag)return;
  if(cancel){state.selectionMask=drag.mask;setSelectionPaths(drag.paths);if(drag.moved&&state.undo.at(-1)===drag.undoEntry)state.undo.pop()}
  else if(drag.moved){saveSelectionGeometry();void window.MosaicAccount?.track('mask_edited')}
  updateSelectionOutline();updateApplyButton();renderGroups();render();if(!cancel&&!drag.moved)showQuickPrompt(state.lastCanvasPointer,true);
}
const maskPointControls=$('maskEditControls'),maskAddButton=document.createElement('button'),maskRemoveButton=document.createElement('button');
const brushCursor=document.createElement('div');brushCursor.className='brush-cursor';brushCursor.setAttribute('aria-hidden','true');brushCursor.hidden=true;document.body.append(brushCursor);
let brushPointer=null;
function refreshBrushCursor(){
  if(!brushPointer||!['reveal','erase'].includes(state.tool)||state.before||window.MosaicSourceEditor?.isEditing()){brushCursor.hidden=true;return}
  const point=canvasPoint({clientX:brushPointer.x,clientY:brushPointer.y},false);if(!pointInImage(point)){brushCursor.hidden=true;return}
  const size=Number($('brushSize').value)*state.zoom;brushCursor.style.width=size+'px';brushCursor.style.height=size+'px';
  brushCursor.style.left=brushPointer.x+'px';brushCursor.style.top=brushPointer.y+'px';brushCursor.style.opacity=String(.5+Number($('brushIntensity').value)/200);brushCursor.hidden=false;
}
maskAddButton.type=maskRemoveButton.type='button';maskAddButton.id='maskAddPoint';maskRemoveButton.id='maskRemovePoint';
maskAddButton.className='mask-point-control mask-point-add';maskRemoveButton.className='mask-point-control mask-point-remove';
maskAddButton.textContent='+';maskRemoveButton.textContent='-';maskAddButton.setAttribute('aria-label','Add point on this line');maskRemoveButton.setAttribute('aria-label','Remove selected point');
maskAddButton.title='Add a point here';maskRemoveButton.title='Remove this point';maskAddButton.hidden=maskRemoveButton.hidden=true;maskPointControls.append(maskAddButton,maskRemoveButton);
let pointControlPress=null;
function offsetPointControl(point,normal=null){
  const gap=24/state.zoom,pad=12/state.zoom;
  const offsets=normal?[{x:normal.x*gap,y:normal.y*gap},{x:-normal.x*gap,y:-normal.y*gap}]:[{x:gap,y:-gap},{x:gap,y:gap},{x:-gap,y:-gap},{x:-gap,y:gap}];
  return offsets.map(offset=>({x:point.x+offset.x,y:point.y+offset.y})).find(p=>p.x>=pad&&p.y>=pad&&p.x<=canvas.width-pad&&p.y<=canvas.height-pad)||{x:clamp(point.x+gap,pad,canvas.width-pad),y:clamp(point.y+gap,pad,canvas.height-pad)};
}
function positionPointControl(button,point){button.style.left=point.x/canvas.width*100+'%';button.style.top=point.y/canvas.height*100+'%';button.hidden=false}
function updateMaskPointControls(){
  maskAddButton.hidden=maskRemoveButton.hidden=true;
  if(state.tool!=='select'||state.selectionOverlayHidden||!state.boundaryCanvas||state.maskVertexDrag||state.before||window.MosaicPremium?.isPreviewing()||window.MosaicSourceEditor?.isEditing())return;
  if(activeMaskVertex){
    const path=state.selectionPaths[activeMaskVertex.pathIndex],point=path?.[activeMaskVertex.index];
    if(point){maskRemoveButton.disabled=path.length<=3;maskRemoveButton.title=path.length<=3?'Keep at least 3 points':'Remove this point';positionPointControl(maskRemoveButton,offsetPointControl(point))}
  }
  if(hoverMaskEdge){
    const point=offsetPointControl(hoverMaskEdge.point,hoverMaskEdge.normal);
    if(state.selectionPoints.every(p=>Math.hypot(p.x-point.x,p.y-point.y)*state.zoom>15))positionPointControl(maskAddButton,point);
  }
}
function updateMaskEdgeHover(point){
  if(!state.boundaryCanvas){hoverMaskEdge=null;updateMaskPointControls();return}
  ensureSelectionPaths();
  if(hoverMaskEdge){const button=offsetPointControl(hoverMaskEdge.point,hoverMaskEdge.normal);if(Math.hypot(point.x-button.x,point.y-button.y)*state.zoom<26){updateMaskPointControls();return}}
  const edge=MaskGeometry.closestEdge(state.selectionPaths,point);
  hoverMaskEdge=edge&&edge.distance*state.zoom<=8&&state.selectionPoints.every(p=>Math.hypot(p.x-edge.point.x,p.y-edge.point.y)*state.zoom>18)?edge:null;
  updateMaskPointControls();
}
for(const button of [maskAddButton,maskRemoveButton]){
  button.addEventListener('pointerdown',event=>{event.stopPropagation();if(event.button!==0)return;pointControlPress={button,x:event.clientX,y:event.clientY,version:maskEditVersion}});
  button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    const keyboard=event.detail===0&&document.activeElement===button,press=pointControlPress;pointControlPress=null;
    if(!keyboard&&(!press||press.button!==button||press.version!==maskEditVersion||Math.hypot(event.clientX-press.x,event.clientY-press.y)>4))return;
    if(button.disabled)return;
    let paths,selected=null,pixels=true;
    if(button===maskAddButton&&hoverMaskEdge){
      const edge=hoverMaskEdge;paths=MaskGeometry.insertVertex(state.selectionPaths,edge.pathIndex,edge.index,edge.point);selected=null;pixels=false;
    }else if(button===maskRemoveButton&&activeMaskVertex){
      const vertex=activeMaskVertex;if(state.selectionPaths[vertex.pathIndex].length<=3)return;
      paths=MaskGeometry.removeVertex(state.selectionPaths,vertex.pathIndex,vertex.index);
    }
    if(!paths)return;
    const from=MaskGeometry.copyPaths(state.selectionPaths),to=MaskGeometry.copyPaths(from);
    if(pixels&&activeMaskVertex){
      const vertex=activeMaskVertex,path=from[vertex.pathIndex],a=path[(vertex.index+path.length-1)%path.length],b=path[(vertex.index+1)%path.length],p=path[vertex.index];
      const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const projected={x:a.x+t*dx,y:a.y+t*dy};to[vertex.pathIndex][vertex.index]=projected;
      if(Math.hypot(projected.x-p.x,projected.y-p.y)<1e-7)pixels=false;
    }
    const mask=pixels?deformSelectionMask(state.selectionMask,from,to,paths):state.selectionMask;
    if(pixels&&!maskBoundingBox(mask))return;
    const image=pixels?selectedImagePatch():null;
    if(image){
      const layer=renderedPatchLayer(image);snapshotPlacement(image);state.selectionMask=mask;setSelectionPaths(paths);commitImagePlacement(image,warpImagePaths(layer,from,to,mask));
    }else{snapshotPointEdit();state.selectionMask=mask;setSelectionPaths(paths);saveSelectionGeometry(pixels)}
    activeMaskVertex=selected;
    void window.MosaicAccount?.track('mask_edited');
    updateSelectionOutline();updateApplyButton();renderGroups();render();
  });
}
function draftPath(){
  if(state.lasso.length){
    const points=[...state.lasso];
    if(state.hoverPoint&&!state.dragFreehand)points.push(state.hoverPoint);
    return points.map((p,i)=>(i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ');
  }
  if(state.shapeStart&&state.shapeEnd){
    const b=shapeBounds(state.shapeStart,state.shapeEnd,state.constrainShape);
    if(b.w<=0||b.h<=0)return '';
    if(state.tool==='rect')return 'M '+b.x+' '+b.y+' h '+b.w+' v '+b.h+' h '+(-b.w)+' Z';
    const cx=b.x+b.w/2,cy=b.y+b.h/2,rx=b.w/2,ry=b.h/2;
    return 'M '+(cx-rx)+' '+cy+' a '+rx+' '+ry+' 0 1 0 '+(rx*2)+' 0 a '+rx+' '+ry+' 0 1 0 '+(-rx*2)+' 0 Z';
  }
  return '';
}
function drawDraftPreview(){
  const path=$('selectionDraftPath'),dots=$('selectionDraftPoints');
  if(!path||!dots)return;
  path.setAttribute('d',draftPath());
  path.setAttribute('stroke',state.selectionMode==='subtract'?'#ff968e':'#e4e2ff');
  const isShape=Boolean(state.shapeStart&&state.shapeEnd);
  path.setAttribute('fill',isShape?(state.selectionMode==='subtract'?'#ff968e24':'#b1aaff27'):'none');
  dots.replaceChildren();
  if(state.lasso.length&&!state.dragFreehand){
    for(const p of state.lasso){
      const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);
      c.setAttribute('r',2.5/state.zoom);
      c.setAttribute('fill','#17191f');
      c.setAttribute('stroke',state.selectionMode==='subtract'?'#ff968e':'#e4e2ff');
      c.setAttribute('stroke-width',1/state.zoom);
      dots.appendChild(c);
    }
  }
}

function applyWandMask(region, coverage=0){
  if(!state.selectionMask||!region||!region.width||!region.height){
    toast('AI Wand could not select that object. Try pointing farther inside it.');return;
  }
  if(coverage>.9){toast('AI Wand selected too much of the image. Click a smaller object.');return}
  if(state.maskEditOnly&&state.selectionTargetPatchId)snapshotPointEdit();else snapshotSelection();
  const mc=state.selectionMask.getContext('2d');
  mc.save();
  if(state.selectionMode==='new'){
    if(!state.maskEditOnly){state.selectionTargetPatchId=null;releaseDraftGroupForNewSelection()}
    state.selectionPoints=[];mc.clearRect(0,0,canvas.width,canvas.height);
  }
  mc.globalCompositeOperation=state.selectionMode==='subtract'?'destination-out':'source-over';
  mc.imageSmoothingEnabled=false;
  mc.drawImage(region,0,0,canvas.width,canvas.height);
  mc.restore();
  state.selectionOverlayHidden=false;
  if(state.selectionMode==='add'&&!state.selectionTargetPatchId)state.forceNewSelectionGroup=true;
  state.selectionPaths=[];state.selectionPoints=[];activeMaskVertex=null;hoverMaskEdge=null;maskEditVersion++;
  state.pendingRevealOnly=Boolean(state.pendingSourceId);
  finishMaskSelection();
  message('AI Wand selected an object. Refine the mask or enter a prompt to Generate.');
  return true;
}
function trimUndo(){
  let bytes=0;
  const retainedMasks=new Set();
  for(let i=state.undo.length-1;i>=0;i--){
    const entry=state.undo[i];
    bytes+=entry.image?.data?.byteLength||0;
    for(const part of entry.objectSelection||[]){
      if(retainedMasks.has(part.mask))continue;
      retainedMasks.add(part.mask);
      bytes+=part.mask.width*part.mask.height*4;
    }
    if(i<state.undo.length-1&&(bytes>96*1024*1024||state.undo.length-i>12)){
      state.undo.splice(0,i+1);break;
    }
  }
}
function snapshotSelection(){if(!state.selectionMask)return;state.undo.push({type:'selection',objectSelection:window.MosaicObjectMap?.snapshotSelection(),paths:MaskGeometry.copyPaths(state.selectionPaths),points:copyCorners(state.selectionPoints),image:state.selectionMask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});trimUndo();state.redo=[]}
function snapshotPatch(p){state.undo.push({type:'patch',patchId:p.id,paths:MaskGeometry.copyPaths(p.maskPaths),points:copyCorners(p.maskPoints),image:p.mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});trimUndo();state.redo=[]}
function finishMaskSelection(){
  window.MosaicObjectMap?.selectionCompleted();
  void window.MosaicAccount?.track('selection_created');
  if(state.maskEditOnly||state.selectionMode!=='new')void window.MosaicAccount?.track('mask_edited');
  const editingSavedOption=state.maskEditOnly&&Boolean(state.selectionTargetPatchId);
  state.selectionOverlayHidden=false;updateSelectionOutline();ensureSelectionPaths();
  const selected=state.objectSelectionParts||[];
  if(editingSavedOption){
    saveSelectionGeometry();
    if(selected.length===1)window.MosaicObjectMap?.adoptSelection([{...selected[0],mask:cloneMask(state.selectionMask),paths:MaskGeometry.copyPaths(state.selectionPaths)}]);
    state.maskEditOnly=false;
  }else if(state.selectionMode!=='new'&&!state.pendingSourceId&&!state.editingPatchId&&selected.length===1){
    // A prepared object with no AI Option still owns its edited selection.
    // Add/Subtract must not lose pixels outside its initial instance mask.
    const group=state.groups.find(item=>item.id===state.draftGroupId&&!item.active);
    if(group){
      group.footprint=cloneMask(state.selectionMask);group.maskCrop=null;
      group.area=maskBoundingBox(group.footprint);
      group.maskPaths=MaskGeometry.copyPaths(state.selectionPaths);
      window.MosaicObjectMap?.adoptSelection([{...selected[0],mask:cloneMask(state.selectionMask),paths:MaskGeometry.copyPaths(state.selectionPaths)}]);
    }
  }
  prepareSelectionGroup();updateApplyButton();
  if(state.tool!=='wand')selectTool('select');render();
  if(!state.maskEditOnly&&!state.pendingSourceId)showQuickPrompt(state.lastCanvasPointer,true);
}
function commitMaskPath(trace,points=[],polygon=false){
  if(!state.selectionMask)return;
  if(state.selectionMode!=='new'&&state.selectionTargetPatchId&&!state.pendingSourceId&&!state.editingPatchId)state.maskEditOnly=true;
  const m=state.selectionMask.getContext('2d');if(state.maskEditOnly&&state.selectionTargetPatchId)snapshotPointEdit();else snapshotSelection();m.save();
  if(state.selectionMode==='new'){if(!state.maskEditOnly){state.selectionTargetPatchId=null;releaseDraftGroupForNewSelection()}m.clearRect(0,0,canvas.width,canvas.height)}
  if(state.selectionMode==='add'&&!state.selectionTargetPatchId)state.forceNewSelectionGroup=true;
  const raw=makeCanvas(canvas.width,canvas.height),r=raw.getContext('2d');r.fillStyle='#fff';r.beginPath();trace(r);r.closePath();r.fill();
  const hard=r.getImageData(0,0,raw.width,raw.height);for(let i=3;i<hard.data.length;i+=4)hard.data[i]=hard.data[i]>=128?255:0;r.putImageData(hard,0,0);
  if(['lasso','rect','ellipse'].includes(state.tool)&&state.selectionMode==='new'&&!state.pendingSourceId&&!state.editingPatchId&&!state.maskEditOnly){
    m.restore();
    window.MosaicObjectCreateCut?.create(raw);
    return;
  }
  // Add/Subtract edits the current mask's exact pixels, not a fresh object or
  // an automatic expansion to every overlapping object.
  const region=state.selectionMode==='new'?window.MosaicObjectMap?.refineMask(raw,state.tool)||raw:raw;
  m.globalCompositeOperation=state.selectionMode==='subtract'?'destination-out':'source-over';m.drawImage(region,0,0);m.restore();
  if(region===raw&&state.selectionMode==='new'&&polygon&&points.length>=3)setSelectionPaths([points]);else{state.selectionPaths=[];state.selectionPoints=[];activeMaskVertex=null;hoverMaskEdge=null;maskEditVersion++}
  state.pendingRevealOnly=Boolean(state.pendingSourceId);finishMaskSelection();message(state.pendingSourceId?'Click Apply to keep the selected part of the new image.':'Selection ready. Drag its points to refine it, or describe an AI edit.')}
function updateMaskWithLasso(){const points=state.lasso.filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>.01);
  if(points.length<3||!state.selectionMask)return false;
  commitMaskPath(m=>points.forEach((p,i)=>i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y)),state.dragFreehand?[]:points,true);
  clearDraft();drawOverlay();return true}
function shapeBounds(start,end,constrain){let dx=end.x-start.x,dy=end.y-start.y;
  if(constrain){const side=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx)*side;dy=Math.sign(dy)*side}
  return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),w:Math.abs(dx),h:Math.abs(dy)}}
function traceShape(target,b,tool){target.beginPath();if(tool==='rect')target.rect(b.x,b.y,b.w,b.h);
  else target.ellipse(b.x+b.w/2,b.y+b.h/2,b.w/2,b.h/2,0,0,Math.PI*2);target.closePath()}
function updateMaskWithShape(start,end,tool,constrain){const bounds=shapeBounds(start,end,constrain);if(bounds.w<2/state.zoom||bounds.h<2/state.zoom)return;
  const {x,y,w,h}=bounds;
  const points=tool==='rect'?[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]:[{x:x+w/2,y},{x:x+w,y:y+h/2},{x:x+w/2,y:y+h},{x,y:y+h/2}];
  commitMaskPath(m=>traceShape(m,bounds,tool),points,tool==='rect')}
function exactMaskBoundingBox(mask){
  const {width:w,height:h}=mask,data=mask.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  return maxX<0?null:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
}
function maskBoundingBox(mask){const w=Math.min(250,mask.width),h=Math.max(1,Math.round(w*mask.height/mask.width)),t=makeCanvas(w,h),tx=t.getContext('2d',{willReadFrequently:true});tx.drawImage(mask,0,0,w,h);const d=tx.getImageData(0,0,w,h).data;let minX=w,minY=h,maxX=-1,maxY=-1;for(let i=0;i<w*h;i++)if(d[i*4+3]>0){const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}return maxX<0?null:{x:minX/w*canvas.width,y:minY/h*canvas.height,w:(maxX-minX+1)/w*canvas.width,h:(maxY-minY+1)/h*canvas.height}}
function applySelection(){if(state.lasso.length){if(!updateMaskWithLasso()){toast('Add at least three line points, then click the first point or double-click to close.');return}}if(!state.selectionMask)return;const bbox=maskBoundingBox(state.selectionMask);if(!bbox){toast('Draw or brush a selection first.');return}
  if(state.pendingSourceId){const src=state.sources.get(state.pendingSourceId),mask=makeCanvas(canvas.width,canvas.height);mask.getContext('2d').drawImage(state.selectionMask,0,0);const patch={id:uid('patch'),sourceId:src.id,mask,bbox,maskPaths:MaskGeometry.copyPaths(state.selectionPaths),maskPoints:copyCorners(state.selectionPoints),name:optionNameFromPrompt(src.name,src.name),manualName:false},group=assignGroup(patch);state.pendingSourceId=null;state.editingPatchId=null;resetSelection();state.undo=[];state.redo=[];toast(`Saved as ${group.name}. Masks need 85% overlap to share a Group.`);message('Selection saved. Upload another image or switch options in Groups.');renderGroups();render();window.MosaicPremium?.onPatchApplied();loadNextVariant();return}
  if(state.editingPatchId){
    const patch=state.patches.get(state.editingPatchId);if(!patch)return;
    snapshotPatch(patch);
    const sourceMask=unwarpPatchSelection(state.selectionMask,patch);
    const t=patch.mask.getContext('2d');t.clearRect(0,0,canvas.width,canvas.height);
    t.drawImage(sourceMask,0,0);
    patch.maskPaths=state.selectionPaths.map(path=>path.map(point=>pointToOriginalMask(point,patch)));
    patch.maskPoints=patch.maskPaths.flat();
    // Keep the source rectangle fixed while corners define the visible warp.
    if(!patch.corners)patch.bbox=bbox;
    invalidateDisplayedMask(patch);
    const region=state.groups.find(g=>g.patchIds.includes(patch.id));
    if(region)refreshGroupFootprint(region);
    state.editingPatchId=null;state.selectedPatchId=patch.id;resetSelection();
    toast('Selection updated at its current position.');renderGroups();render();
  }}
function groupContainsPoint(group,point){
  if(!group.active&&!group.objectOriginal&&!group.footprint&&group.maskCrop){
    const crop=group.maskCrop,x=Math.floor(point.x)-crop.x,y=Math.floor(point.y)-crop.y;
    return x>=0&&y>=0&&x<crop.mask.width&&y<crop.mask.height&&crop.mask.getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data[3]>0;
  }
  return groupMask(group).getContext('2d',{willReadFrequently:true}).getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data[3]>0;
}
function findRegionAt(point){
  if(!state.master||!pointInImage(point))return null;
  for(const group of state.groups.filter(g=>!g.mergedInto&&!g.objectMapBatch&&!g.objectRemoved).slice().reverse()){
    if(groupContainsPoint(group,point))return group;
  }
  return null;
}
function nearestBrushPatch(point,erase=false){
  const candidates=state.groups.map(group=>state.patches.get(group.active)).filter(p=>p&&state.sources.has(p.sourceId)&&!p.awaitingResult);
  for(const p of candidates.slice().reverse()){
    const x=clamp(Math.floor(point.x),0,canvas.width-1),y=clamp(Math.floor(point.y),0,canvas.height-1);
    if(displayedPatchMask(p).getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data[3]>0)return p;
  }
  if(erase)return null;
  return candidates.map(p=>{
    const b=patchDisplayBounds(p);
    const dx=Math.max(b.x-point.x,0,point.x-b.x-b.w),dy=Math.max(b.y-point.y,0,point.y-b.y-b.h);
    return {p,d:Math.hypot(dx,dy)};
  }).sort((a,b)=>a.d-b.d)[0]?.p||null;
}
function paint(e,first){
  const visiblePoint=canvasPoint(e),r=+$('brushSize').value;
  const patch=state.pendingSourceId||state.editingPatchId?null:state.patches.get(state.brushTargetId||state.selectedPatchId);
  const mask=patch?.mask||state.selectionMask;
  if(!mask){if(first)toast('Upload a variation or select a saved region first.');return}
  const point=patch?pointToOriginalMask(visiblePoint,patch):visiblePoint;
  const previous=state.lastPoint?(patch?pointToOriginalMask(state.lastPoint,patch):state.lastPoint):null;
  let radius=r;
  if(patch?.corners?.length){
    const q=patchCorners(patch),b=patch.bbox;
    const polyArea=Math.abs(q.reduce((sum,p,i)=>sum+p.x*q[(i+1)%4].y-p.y*q[(i+1)%4].x,0)/2);
    radius=r/Math.sqrt(Math.max(.05,polyArea/Math.max(1,b.w*b.h)));
  }
  const mc=mask.getContext('2d');
  mc.save();mc.globalAlpha=Number($('brushIntensity').value)/100;mc.globalCompositeOperation=state.tool==='erase'?'destination-out':'source-over';
  mc.fillStyle='#fff';mc.strokeStyle='#fff';mc.lineWidth=radius;mc.lineCap='round';mc.lineJoin='round';
  if(first||!previous){mc.beginPath();mc.arc(point.x,point.y,radius/2,0,Math.PI*2);mc.fill()}
  else{mc.beginPath();mc.moveTo(previous.x,previous.y);mc.lineTo(point.x,point.y);mc.stroke()}
  mc.restore();state.lastPoint=visiblePoint;
  if(!patch){state.selectionPaths=[];state.selectionPoints=[];state.boundaryCanvas=null;state.pendingRevealOnly=true;updateApplyButton();render();return}
  patch.maskPaths=null;patch.maskPoints=[];
  if(!patch.corners)patch.bbox=maskBoundingBox(mask)||patch.bbox;
  invalidateDisplayedMask(patch);
  render();
}
function historyStep(from,to){
  const entry=from.pop();if(!entry)return;
  if(window.MosaicWorkspace?.restoreHistory(entry,to)){renderGroups();render();return}
  if(entry.type==='placement'){
    const patch=state.patches.get(entry.patchId);if(!patch)return;
    to.push({type:'placement',patchId:patch.id,placement:placementSnapshot(patch)});Object.assign(patch,entry.placement);invalidateDisplayedMask(patch);
    const group=state.groups.find(g=>g.patchIds.includes(patch.id));if(group)refreshGroupFootprint(group);
    if(state.selectionTargetPatchId===patch.id){state.selectionMask=cloneMask(displayedPatchMask(patch));setSelectionPaths(patchSelectionPaths(patch));updateSelectionOutline()}
    renderGroups();render();return;
  }
  if(entry.type==='transform'){
    const patch=state.patches.get(entry.patchId);if(!patch)return;
    to.push({type:'transform',patchId:patch.id,corners:copyCorners(patch.corners)});
    patch.corners=copyCorners(entry.corners);
    invalidateDisplayedMask(patch);
    const group=state.groups.find(g=>g.patchIds.includes(patch.id));
    if(group)refreshGroupFootprint(group);
    if(state.selectionTargetPatchId===patch.id){state.selectionMask=cloneMask(displayedPatchMask(patch));setSelectionPaths(patchSelectionPaths(patch));updateSelectionOutline()}
    renderGroups();render();return;
  }
  const mask=entry.type==='selection'?state.selectionMask:state.patches.get(entry.patchId)?.mask;
  if(!mask)return;
  const points=entry.type==='selection'?state.selectionPoints:state.patches.get(entry.patchId)?.maskPoints;
  const paths=entry.type==='selection'?state.selectionPaths:state.patches.get(entry.patchId)?.maskPaths;
  to.push({...entry,...(entry.type==='selection'?{objectSelection:window.MosaicObjectMap?.snapshotSelection()}:{}),paths:MaskGeometry.copyPaths(paths),points:copyCorners(points),image:mask.getContext('2d').getImageData(0,0,canvas.width,canvas.height)});
  if(entry.type==='selection'){setSelectionPaths(entry.paths||[]);if(!state.selectionPaths.length)state.selectionPoints=copyCorners(entry.points)||[]}
  else{const patch=state.patches.get(entry.patchId);patch.maskPaths=MaskGeometry.copyPaths(entry.paths);patch.maskPoints=copyCorners(entry.points)||[]}
  mask.getContext('2d').putImageData(entry.image,0,0);
  if(entry.type==='selection'){window.MosaicObjectMap?.adoptSelection(entry.objectSelection||[]);updateSelectionOutline();ensureSelectionPaths();drawOverlay();return}
  const patch=state.patches.get(entry.patchId);
  if(patch){
    if(!patch.corners)patch.bbox=maskBoundingBox(mask)||patch.bbox;
    invalidateDisplayedMask(patch);
    const group=state.groups.find(g=>g.patchIds.includes(patch.id));
    if(group)refreshGroupFootprint(group);
    if(state.selectionTargetPatchId===patch.id){state.selectionMask=cloneMask(displayedPatchMask(patch));setSelectionPaths(patchSelectionPaths(patch));updateSelectionOutline()}
  }
  renderGroups();render();
}
function updateZoomFit(){if(!state.master)return;const v=$('viewport'),style=getComputedStyle(v),width=v.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=v.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);state.fitZoom=Math.max(.01,Math.min(width/canvas.width,height/canvas.height,4));setZoom(state.fitZoom);v.scrollLeft=0;v.scrollTop=0}
function setZoom(z){state.zoom=clamp(z,.01,4);$('canvasWrap').style.width=Math.round(canvas.width*state.zoom)+'px';$('canvasWrap').style.height=Math.round(canvas.height*state.zoom)+'px';canvas.style.width=overlay.style.width='100%';canvas.style.height=overlay.style.height='100%';$('zoomValue').textContent='Fit';drawOverlay()}
function zoomAt(zoom,clientX,clientY){
  const v=$('viewport'),before=overlay.getBoundingClientRect();
  const x=(clientX-before.left)/before.width,y=(clientY-before.top)/before.height;
  setZoom(zoom);const after=overlay.getBoundingClientRect();
  v.scrollLeft+=after.left+x*after.width-clientX;v.scrollTop+=after.top+y*after.height-clientY;
}
function canCreateSelection(){return Boolean(state.master&&!state.pendingSourceId&&!state.editingPatchId&&!state.busy&&!state.before&&!window.MosaicPremium?.isPreviewing?.())}
function canMask(){return Boolean(state.pendingSourceId||state.editingPatchId||(['lasso','rect','ellipse','wand'].includes(state.tool)&&canCreateSelection()))}
function pointerDown(e){if(e.target.closest('form,button,input,textarea,select'))return;if(!state.master||state.busy||state.before||e.button!==0&&e.pointerType==='mouse')return;
  if(state.tool==='zoom'){e.preventDefault();zoomAt(state.zoom*(e.shiftKey||e.altKey?1/1.4:1.4),e.clientX,e.clientY);return}
  if(state.tool==='transform'){const p=canvasPoint(e,false);beginTransform(e,p);return}
  if(state.tool==='pan'){state.panAnchor={x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};e.currentTarget.setPointerCapture(e.pointerId);return}
  state.lastCanvasPointer={clientX:e.clientX,clientY:e.clientY};
  if(state.tool==='select'){
    state.pointerBoxStart=canvasPoint(e,false);
    state.pointerBoxEnd=state.pointerBoxStart;
    state.pointerBoxPointerId=e.pointerId;
    state.pointerBoxModifier={append:e.ctrlKey||e.metaKey,subtract:e.altKey};
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    return;
  }
  if(state.tool==='cut'){
    const ok=window.MosaicObjectCreateCut?.beginCut?.(canvasPoint(e,false));
    if(ok){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}
    return;
  }
  if(state.tool==='reveal'||state.tool==='erase'){
    if(state.pendingSourceId&&state.tool==='erase'&&!maskBoundingBox(state.selectionMask)){const mc=state.selectionMask.getContext('2d');mc.fillStyle='#fff';mc.fillRect(0,0,canvas.width,canvas.height)}
    if(!state.pendingSourceId&&!state.editingPatchId){
      const picked=nearestBrushPatch(canvasPoint(e),state.tool==='erase');
      if(picked){state.brushTargetId=picked.id;state.selectedPatchId=picked.id;snapshotPatch(picked)}
      else if(canCreateSelection()){
        state.brushTargetId=null;state.selectedPatchId=null;state.selectionTargetPatchId=null;
        state.selectionOverlayHidden=false;snapshotSelection();
      }else{toast('Return to the current composition to edit a mask.');return}
    }else{state.brushTargetId=null;snapshotSelection()}
    state.pendingRevealOnly=true;state.drawing=true;state.lastPoint=null;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    paint(e,true);return;
  }
  if(!state.pendingSourceId&&!state.editingPatchId&&['lasso','rect','ellipse','wand'].includes(state.tool)){
    if(canCreateSelection()){state.selectedPatchId=null}
    else if(state.selectedPatchId){const originalTool=state.tool;editExisting(state.selectedPatchId);selectTool(originalTool)}
    else{toast('Return to the current composition to create a selection.');return}}
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool));
  if((e.ctrlKey||e.metaKey)&&['wand','lasso','rect','ellipse'].includes(state.tool)&&!state.lasso.length&&state.selectionMode!=='subtract')setMode('add');
  if(state.tool==='wand'){e.preventDefault();window.MosaicSlimWand?.selectAt?.(p,{append:e.ctrlKey||e.metaKey,subtract:e.altKey});return}
  state.drawing=true;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  if(state.tool==='lasso'){state.pointerStart=p;state.dragFreehand=false;state.hoverPoint=p;if(!state.lasso.length)state.lasso=[p];drawOverlay()}
  else if(state.tool==='rect'||state.tool==='ellipse'){state.shapeStart=p;state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='reveal'||state.tool==='erase'){snapshotSelection();state.lastPoint=null;paint(e,true)}
}
function pointerMove(e){
  if(e.target.closest('#quickAreaPromptForm')){brushCursor.hidden=true;return}
  if(['reveal','erase'].includes(state.tool)){brushPointer={x:e.clientX,y:e.clientY};refreshBrushCursor()}
  if(e.target.closest('.mask-edit-controls'))return;
  if(state.maskVertexDrag){moveMaskVertex(canvasPoint(e));return}
  if(state.maskMoveDrag){moveSelection(canvasPoint(e));return}
  if(state.transformDrag){moveTransform(canvasPoint(e));return}
  if(state.tool==='select'){
    const p=canvasPoint(e,false);
    if(state.pointerBoxStart){state.pointerBoxEnd=p;drawOverlay();return;}
    overlay.style.cursor='default';
    window.MosaicSlimWand?.hoverAt?.(p);
    return;
  }
  if(state.tool==='cut'){if(window.MosaicObjectCreateCut?.isCutting?.())window.MosaicObjectCreateCut.moveCut(canvasPoint(e,false));return;}
  // A lasso can finish via Enter or clicking its starting point. Remember the
  // latest pointer *move*, not only pointerdown/up, for prompt anchoring.
  if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))
    state.lastCanvasPointer={clientX:e.clientX,clientY:e.clientY};
  if(state.tool==='wand'){window.MosaicSlimWand?.hoverAt?.(canvasPoint(e,false));return}
  window.MosaicRegions?.onPointerMove(e);if(state.tool==='transform'){if(state.transformDrag){moveTransform(canvasPoint(e))}else{const patch=activeTransformPatch(),hit=patch&&transformHit(canvasPoint(e,false),patch);overlay.style.cursor=hit?(hit.kind==='corner'?'crosshair':'move'):'default'}return}if(state.tool==='pan'&&state.panAnchor){$('viewport').scrollLeft=state.panAnchor.left-(e.clientX-state.panAnchor.x);$('viewport').scrollTop=state.panAnchor.top-(e.clientY-state.panAnchor.y);return}
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool));
  if(state.tool==='lasso'){if(state.lasso.length){if(state.drawing&&state.pointerStart&&Math.hypot(p.x-state.pointerStart.x,p.y-state.pointerStart.y)>4/state.zoom)state.dragFreehand=true;if(state.drawing&&state.dragFreehand&&Math.hypot(p.x-state.lasso.at(-1).x,p.y-state.lasso.at(-1).y)>1/state.zoom)state.lasso.push(p);state.hoverPoint=p;drawOverlay()}return}
  if(!state.drawing)return;
  if(state.tool==='rect'||state.tool==='ellipse'){state.shapeEnd=p;state.constrainShape=e.shiftKey;drawOverlay()}
  else if(state.tool==='reveal'||state.tool==='erase')paint(e,false)}
function pointerUp(e){
  if(state.tool==='select'&&state.pointerBoxStart){
    const start=state.pointerBoxStart,end=canvasPoint(e,false),mods=state.pointerBoxModifier||{};
    state.pointerBoxStart=null;state.pointerBoxEnd=null;state.pointerBoxPointerId=null;
    if(Math.hypot((end.x-start.x)*state.zoom,(end.y-start.y)*state.zoom)>8){
      const bounds={x:Math.max(0,Math.min(start.x,end.x)),y:Math.max(0,Math.min(start.y,end.y)),
        right:Math.min(canvas.width,Math.max(start.x,end.x)),bottom:Math.min(canvas.height,Math.max(start.y,end.y))};
      const raw=makeCanvas(canvas.width,canvas.height),c=raw.getContext('2d');
      c.fillStyle='#fff';c.fillRect(bounds.x,bounds.y,Math.max(0,bounds.right-bounds.x),Math.max(0,bounds.bottom-bounds.y));
      resetSelection();setMode('new');
      const hasExistingObjects=state.groups.some(g=>!g.mergedInto&&!g.objectRemoved&&!g.objectMapBatch);
      if(!hasExistingObjects&&!state.objectMap?.raster){
        toast('No objects yet. Run Object Map or draw a new object with Create.');
        drawOverlay();return;
      }
      const snapped=window.MosaicObjectMap?.refineMask?.(raw,'rect')||raw;
      state.selectionMask.getContext('2d').drawImage(snapped,0,0);
      window.MosaicObjectMap?.selectionCompleted?.();
      state.selectionPaths=maskPathsFromRaster(state.selectionMask);state.selectionPoints=[];
      state.selectionOverlayHidden=false;updateSelectionOutline();renderGroups();render();
      if(maskBoundingBox(state.selectionMask))showQuickPrompt({clientX:e.clientX,clientY:e.clientY});
      else toast('No object found in the rectangle. Try a larger box.');
    }else{
      const point=end,group=findRegionAt(point);
      if(group){if(mods.append)appendGroupSelection(group);else selectGroupMask(group,{showOutline:true});
        focusGroupInSidebar(group);showQuickPrompt({clientX:e.clientX,clientY:e.clientY});}
      else if(state.objectMap?.raster)window.MosaicSlimWand?.selectAt?.(point,mods);
      else{resetSelection();render();message('Upload a Base and prepare objects, or use Create to draw one.');}
    }
    drawOverlay();return;
  }
  if(state.tool==='cut'){
    if(window.MosaicObjectCreateCut?.isCutting?.()){window.MosaicObjectCreateCut.moveCut(canvasPoint(e,false));window.MosaicObjectCreateCut.endCut();}
    return;
  }
  if(state.maskVertexDrag){endMaskVertexDrag();return}if(state.maskMoveDrag){endSelectionMove();return}if(state.transformDrag){endTransform();return}if(state.tool==='transform'){if(state.transformDrag)endTransform();return}if(state.tool==='pan'){state.panAnchor=null;return}if(!state.drawing)return;
  const p=canvasPoint(e,!['lasso','rect','ellipse'].includes(state.tool)),tool=state.tool;state.lastCanvasPointer={clientX:e.clientX,clientY:e.clientY};state.drawing=false;state.lastPoint=null;
  if(tool==='lasso'){if(state.dragFreehand){const last=state.lasso.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>0.1/state.zoom)state.lasso.push(p);updateMaskWithLasso()}
    else if(state.pointerStart){const first=state.lasso[0],nearFirst=state.lasso.length>=3&&Math.hypot(p.x-first.x,p.y-first.y)<=10/state.zoom;
      if(nearFirst)updateMaskWithLasso();
      else if(Math.hypot(p.x-state.lasso.at(-1).x,p.y-state.lasso.at(-1).y)>0.5/state.zoom){state.lasso.push(p);state.hoverPoint=p;drawOverlay()}}
    state.pointerStart=null;state.dragFreehand=false}
  else if(tool==='rect'||tool==='ellipse'){if(state.shapeStart)updateMaskWithShape(state.shapeStart,p,tool,e.shiftKey);state.shapeStart=null;state.shapeEnd=null;drawOverlay()}
  else if(tool==='reveal'||tool==='erase'){
    void window.MosaicAccount?.track('mask_edited');
    if(state.pendingSourceId||state.editingPatchId||!state.brushTargetId){updateSelectionOutline();ensureSelectionPaths();prepareSelectionGroup();updateApplyButton()}
    else{
      const patch=state.patches.get(state.brushTargetId);
      const group=patch&&state.groups.find(g=>g.patchIds.includes(patch.id));
      if(group)refreshGroupFootprint(group);
    }
    const selected=state.patches.get(state.selectionTargetPatchId);
    if(selected){state.selectionMask=cloneMask(displayedPatchMask(selected));setSelectionPaths(patchSelectionPaths(selected));updateSelectionOutline()}
    state.brushTargetId=null;render();
  }
  renderGroups()}
function pointerCancel(){if(state.pointerBoxStart){state.pointerBoxStart=null;state.pointerBoxEnd=null;drawOverlay();return}
  if(state.tool==='cut'){window.MosaicObjectCreateCut?.cancelCut?.();return}
  if(state.maskVertexDrag){endMaskVertexDrag(true);return}if(state.maskMoveDrag){endSelectionMove(true);return}if(state.transformDrag){endTransform();return}if(state.tool==='transform'){endTransform();return}if(state.tool==='pan')state.panAnchor=null;
  if(state.drawing){
    if((state.tool==='reveal'||state.tool==='erase')&&!state.pendingSourceId&&!state.editingPatchId){
      const patch=state.patches.get(state.brushTargetId);
      const group=patch&&state.groups.find(g=>g.patchIds.includes(patch.id));
      if(group)refreshGroupFootprint(group);
      state.brushTargetId=null;
    }
    state.drawing=false;state.lastPoint=null;state.pointerStart=null;state.shapeStart=null;state.shapeEnd=null;if(state.dragFreehand)state.lasso=[];state.dragFreehand=false;drawOverlay()}}
function onKeys(e){if(e.key==='Escape'&&state.before){e.preventDefault();toggleComparison(false);return}if(e.target.matches('input,textarea,select,[contenteditable="true"]')||e.repeat&&e.key==='Enter')return;
  if(e.key==='Enter'){
    if(state.lasso.length>=3){e.preventDefault();updateMaskWithLasso();return}
    // Enter closes a draft shape; only clicking Apply commits an imported image.
    if(state.pendingSourceId||state.editingPatchId){e.preventDefault();message('Selection ready. Click Apply to commit the patch.');return}
    if(maskBoundingBox(state.selectionMask||makeCanvas(1,1))){e.preventDefault();showQuickPrompt()}
  }
  else if(e.key==='Escape'){e.preventDefault();if(state.lasso.length||state.shapeStart){clearDraft();drawOverlay();message('Unfinished shape canceled.')}else{resetSelection();render();message('Selection cleared.')}}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();historyStep(state.undo,state.redo)}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();historyStep(state.redo,state.undo)}
  else if(e.key==='['){setMode('subtract')}else if(e.key===']'){setMode('add')}}
const asBlob=c=>new Promise((res,rej)=>c.toBlob(blob=>blob?res(blob):rej(Error('PNG export failed')),'image/png'));
async function exportImage(){
  const source=window.MosaicWorkspace?.visibleImage()||(state.master?canvas:state.reference);
  if(!source){toast('Upload or generate an image first.');return}
  const btn=$('exportBtn'),label=btn.innerHTML;btn.disabled=true;
  try{
    const blob=await asBlob(source),url=URL.createObjectURL(blob),a=document.createElement('a');
    const name=($('projectName').textContent||'Current image').replace(/[^a-z0-9_-]+/gi,'_').slice(0,64);
    a.href=url;a.download='mozAI_'+name+'.png';document.body.appendChild(a);a.click();a.remove();void window.MosaicAccount?.track('image_exported');
    setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Current image saved as PNG.');
  }catch(error){toast('Save image failed: '+error.message)}
  finally{btn.disabled=false;btn.innerHTML=label}
}
// File inputs and editing controls.
$('referenceInput').addEventListener('change',async e=>{await importReference(e.target.files[0]);e.target.value=''});
$('masterInput').addEventListener('change',async e=>{await importMaster(e.target.files[0]);e.target.value=''});
$('variantInput').addEventListener('change',async e=>{await importVariants(e.target.files);e.target.value=''});
$('addRegionBtn').addEventListener('click',createBlankRegion);
$('quickMasterBtn').addEventListener('click',()=>$('masterInput').click());$('quickRevitBtn').addEventListener('click',()=>$('referenceInput').click());
$('welcomeStart').addEventListener('click',()=>$('referenceInput').click());$('welcomeRevit').addEventListener('click',()=>$('masterInput').click());
$('welcomeContinueBtn').addEventListener('click',continueWithBase);
for(const button of document.querySelectorAll('[data-initial-drop]')){
  button.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();button.classList.add('is-dragover')});
  button.addEventListener('dragleave',e=>{e.preventDefault();e.stopPropagation();button.classList.remove('is-dragover')});
  button.addEventListener('drop',async e=>{
    e.preventDefault();e.stopPropagation();button.classList.remove('is-dragover');
    const files=Array.from(e.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));if(!files.length)return;
    if(button.dataset.initialDrop==='master')await importMaster(files[0]);
    else await importReference(files[0]);
    if(files.length>1)await importVariants(files.slice(1));
  });
}
$('quickAreaDismiss').addEventListener('click',hideQuickPrompt);
const promptDragHandle=$('quickAreaDragHandle');
let promptDrag=null;
function moveQuickPrompt(left,top){
  const form=$('quickAreaPromptForm'),v=$('viewport').getBoundingClientRect(),margin=8;
  form.style.maxWidth=Math.max(160,Math.min(window.innerWidth,v.right)-Math.max(0,v.left)-margin*2)+'px';
  form.style.maxHeight=Math.max(120,Math.min(window.innerHeight,v.bottom)-Math.max(0,v.top)-margin*2)+'px';
  const box=form.getBoundingClientRect();
  const x=clamp(left,Math.max(margin,v.left+margin),Math.max(margin,Math.min(window.innerWidth,v.right)-box.width-margin));
  const y=clamp(top,Math.max(margin,v.top+margin),Math.max(margin,Math.min(window.innerHeight,v.bottom)-box.height-margin));
  form.style.left=x+'px';form.style.top=y+'px';quickPromptPosition={x:x-v.left,y:y-v.top};
}
promptDragHandle.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();event.stopPropagation();
  const box=$('quickAreaPromptForm').getBoundingClientRect();
  promptDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top};
  promptDragHandle.setPointerCapture(event.pointerId);promptDragHandle.classList.add('is-dragging');
});
promptDragHandle.addEventListener('pointermove',event=>{
  if(!promptDrag||event.pointerId!==promptDrag.id)return;event.stopPropagation();
  moveQuickPrompt(promptDrag.left+event.clientX-promptDrag.x,promptDrag.top+event.clientY-promptDrag.y);
});
for(const type of ['pointerup','pointercancel'])promptDragHandle.addEventListener(type,event=>{
  if(!promptDrag||event.pointerId!==promptDrag.id)return;event.stopPropagation();promptDrag=null;
  promptDragHandle.classList.remove('is-dragging');
  if(promptDragHandle.hasPointerCapture(event.pointerId))promptDragHandle.releasePointerCapture(event.pointerId);
});
promptDragHandle.addEventListener('keydown',event=>{
  const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},direction=directions[event.key];
  if(!direction)return;event.preventDefault();event.stopPropagation();
  const box=$('quickAreaPromptForm').getBoundingClientRect(),step=event.shiftKey?32:8;
  moveQuickPrompt(box.left+direction[0]*step,box.top+direction[1]*step);
});
$('quickAreaPromptInput').addEventListener('focus',()=>{
  if(!state.selectionOverlayHidden)return;
  state.selectionOverlayHidden=false;updateSelectionOutline();
});
$('quickAreaPromptInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('quickAreaPromptForm').requestSubmit()}});
$('quickAreaPromptForm').addEventListener('submit',e=>{
  e.preventDefault();
  const prompt=$('quickAreaPromptInput').value.trim();if(!prompt)return;
  const referenceFiles=window.MosaicPremium?.getReferenceFiles?.('quick')||[];
  hideQuickPrompt();
  if(window.MosaicGeometryEdit?.getMode?.()==='shape')void window.MosaicGeometryEdit.generate(prompt,referenceFiles,'shape');
  else void window.MosaicPremium?.generateSelection?.(prompt,null,referenceFiles);
});
$('discardPendingBtn').addEventListener('click',discardPending);$('exportBtn').addEventListener('click',exportImage);
$('groupList').addEventListener('click',groupEvent);
$('tools').addEventListener('click',e=>{const tool=e.target.closest('[data-tool]'),mode=e.target.closest('[data-mode]');if(tool){if(tool.dataset.tool==='select'){state.maskEditOnly=false;renderGroups()}selectTool(tool.dataset.tool);}if(mode)setMode(mode.dataset.mode)});
$('brushSize').addEventListener('input',e=>{state.brushSize=Number(e.target.value);$('brushValue').textContent=e.target.value;refreshBrushCursor()});
$('brushIntensity').addEventListener('input',e=>{state.brushIntensity=Number(e.target.value);$('brushIntensityValue').textContent=e.target.value+'%';refreshBrushCursor()});
const projectNameInput=$('projectNameInput');
$('projectName').addEventListener('click',()=>{projectNameInput.value=$('projectName').textContent;$('projectName').classList.add('hidden');projectNameInput.classList.remove('hidden');projectNameInput.focus();projectNameInput.select()});
function finishProjectRename(save){if(projectNameInput.classList.contains('hidden'))return;if(save&&projectNameInput.value.trim())setProjectTitle(projectNameInput.value,true);projectNameInput.classList.add('hidden');$('projectName').classList.remove('hidden')}
projectNameInput.addEventListener('blur',()=>finishProjectRename(true));
projectNameInput.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();finishProjectRename(event.key==='Enter')}});

$('commitBtn').addEventListener('click',applySelection);
$('undoBtn').addEventListener('click',()=>historyStep(state.undo,state.redo));$('redoBtn').addEventListener('click',()=>historyStep(state.redo,state.undo));
$('clearSelectionBtn').addEventListener('click',()=>{resetSelection();render();message('Selection cleared.')});
const simplifyButton=document.createElement('button');
simplifyButton.id='simplifySelectionBtn';simplifyButton.type='button';simplifyButton.className='btn btn-quiet compact';
simplifyButton.textContent='Simplify';simplifyButton.title='Straighten noisy selection edges (Undo available)';
$('clearSelectionBtn').before(simplifyButton);
simplifyButton.addEventListener('click',()=>{
  if(!state.master||!state.selectionMask||!maskBoundingBox(state.selectionMask)||state.busy||state.before||window.MosaicPremium?.isPreviewing()||window.MosaicSourceEditor?.isEditing())return;
  const original=ensureSelectionPaths(),tolerance=Math.max(2,Math.min(12,Math.max(canvas.width,canvas.height)*.004));
  const paths=original.map(path=>MaskGeometry.simplify(path,tolerance));
  if(paths.every((path,i)=>path.length===original[i].length)){toast('Selection edges are already simple.');return}
  const mask=renderMaskPaths(paths);if(!maskBoundingBox(mask))return;
  snapshotPointEdit();state.selectionMask=mask;setSelectionPaths(paths);state.selectionOverlayHidden=false;
  saveSelectionGeometry();updateSelectionOutline();updateApplyButton();renderGroups();render();
  void window.MosaicAccount?.track('mask_edited');
  void window.MosaicAccount?.track('selection_simplified');
  toast('Selection straightened. Undo restores the previous mask.');
});
$('resetTransformBtn').addEventListener('click',resetPatchTransform);
const workspace=document.querySelector('.workspace'),inspectorPanel=$('inspectorPanel'),inspectorResizeHandle=$('inspectorResizeHandle');
let inspectorResizeState=null;
function inspectorWidthBounds(){
  return {min:280,max:Math.max(280,Math.min(600,workspace.getBoundingClientRect().width-420))};
}
function setInspectorWidth(width,refit=false){
  const bounds=inspectorWidthBounds(),next=clamp(width,bounds.min,bounds.max);
  workspace.style.setProperty('--inspector-width',next+'px');
  inspectorResizeHandle.setAttribute('aria-valuemin',String(bounds.min));
  inspectorResizeHandle.setAttribute('aria-valuemax',String(bounds.max));
  inspectorResizeHandle.setAttribute('aria-valuenow',String(Math.round(next)));
  if(refit&&state.master)requestAnimationFrame(updateZoomFit);
}
inspectorResizeHandle.addEventListener('pointerdown',event=>{
  if(inspectorPanel.classList.contains('is-collapsed')||window.innerWidth<=730)return;
  inspectorResizeState={x:event.clientX,width:inspectorPanel.getBoundingClientRect().width,fit:Boolean(state.master&&Math.abs(state.zoom-state.fitZoom)<.001)};
  inspectorResizeHandle.setPointerCapture(event.pointerId);document.body.classList.add('inspector-resizing');event.preventDefault();
});
inspectorResizeHandle.addEventListener('pointermove',event=>{
  if(!inspectorResizeState)return;
  setInspectorWidth(inspectorResizeState.width+inspectorResizeState.x-event.clientX,inspectorResizeState.fit);
});
function finishInspectorResize(event){
  if(!inspectorResizeState)return;
  inspectorResizeState=null;document.body.classList.remove('inspector-resizing');
  if(event?.pointerId!=null&&inspectorResizeHandle.hasPointerCapture(event.pointerId))inspectorResizeHandle.releasePointerCapture(event.pointerId);
}
inspectorResizeHandle.addEventListener('pointerup',finishInspectorResize);
inspectorResizeHandle.addEventListener('pointercancel',finishInspectorResize);
inspectorResizeHandle.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight'].includes(event.key)||inspectorPanel.classList.contains('is-collapsed'))return;
  event.preventDefault();const direction=event.key==='ArrowLeft'?1:-1;
  setInspectorWidth(inspectorPanel.getBoundingClientRect().width+direction*(event.shiftKey?40:16),true);
});
$('inspectorToggle').addEventListener('click',()=>{
  const panel=$('inspectorPanel'),collapsed=panel.classList.toggle('is-collapsed'),toggle=$('inspectorToggle');
  document.querySelector('.workspace').classList.toggle('inspector-collapsed',collapsed);
  toggle.textContent=collapsed?'›':'−';
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Expand Groups':'Minimize Groups');
  toggle.title=collapsed?'Expand Groups':'Minimize Groups';
  const wasFit=state.master&&Math.abs(state.zoom-state.fitZoom)<.001;
  if(wasFit)requestAnimationFrame(updateZoomFit);
});
$('zoomIn').addEventListener('click',()=>setZoom(state.zoom*1.25));$('zoomOut').addEventListener('click',()=>setZoom(state.zoom/1.25));$('zoomFit').addEventListener('click',updateZoomFit);$('zoomValue').addEventListener('click',updateZoomFit);
const compare=$('beforeBtn'),compareView=document.createElement('div'),compareBase=makeCanvas(1,1);
compareView.id='compareView';compareView.className='compare-view';compareView.hidden=true;
compareView.innerHTML='<div class="compare-base-clip"></div><span class="compare-label compare-base-label">Base</span><span class="compare-label compare-latest-label">Latest</span><div class="compare-divider"><span aria-hidden="true">↔</span></div><input id="compareSlider" type="range" min="0" max="100" value="50" aria-label="Compare Base and latest image" />';
compareView.querySelector('.compare-base-clip').append(compareBase);$('canvasWrap').append(compareView);
const compareSlider=$('compareSlider');let compareDrag=null;
compare.title='Toggle Base / latest comparison, then drag the divider';compare.setAttribute('aria-pressed','false');
function positionComparison(){
  const value=state.comparePosition??50;
  compareSlider.value=value;compareView.style.setProperty('--compare-position',value+'%');
  compareView.querySelector('.compare-base-clip').style.clipPath='inset(0 '+(100-value)+'% 0 0)';
  compareSlider.setAttribute('aria-valuetext',value+'% Base, '+(100-value)+'% latest image');
}
function renderComparison(){
  compareView.hidden=!state.before;compare.classList.toggle('comparing',state.before);compare.setAttribute('aria-pressed',String(state.before));
  if(!state.before)return;
  if(compareBase.width!==canvas.width||compareBase.height!==canvas.height){compareBase.width=canvas.width;compareBase.height=canvas.height}
  const base=state.reference||state.rawBase||state.rawMaster||state.master,context=compareBase.getContext('2d');
  context.clearRect(0,0,compareBase.width,compareBase.height);context.drawImage(base,0,0,compareBase.width,compareBase.height);
  compareView.querySelector('.compare-base-label').textContent=state.reference||state.rawBase?'Base':'Original';
  positionComparison();
}
function toggleComparison(enabled=!state.before){if(!state.master)return;state.before=enabled;if(enabled){hideQuickPrompt();window.MosaicRegions?.clearHover?.()}render()}
compare.addEventListener('click',()=>toggleComparison());
compareSlider.addEventListener('input',()=>{state.comparePosition=Number(compareSlider.value);positionComparison()});
const moveCompare=event=>{const box=compareView.getBoundingClientRect();state.comparePosition=Math.round(clamp((event.clientX-box.left)/box.width*100,0,100));positionComparison()};
compareSlider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();compareDrag=event.pointerId;compareSlider.focus({preventScroll:true});compareSlider.setPointerCapture(event.pointerId);moveCompare(event)});
compareSlider.addEventListener('pointermove',event=>{if(compareDrag===event.pointerId){event.preventDefault();moveCompare(event)}});
for(const type of ['pointerup','pointercancel'])compareSlider.addEventListener(type,event=>{if(compareDrag!==event.pointerId)return;compareDrag=null;if(compareSlider.hasPointerCapture(event.pointerId))compareSlider.releasePointerCapture(event.pointerId)});
// Touch and mouse drawing both use Pointer Events.
for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])$('viewport').addEventListener(type,{pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerCancel}[type]);
$('viewport').addEventListener('dblclick',e=>{if(state.tool==='lasso'&&state.lasso.length>=3){e.preventDefault();updateMaskWithLasso()}});
window.addEventListener('keydown',onKeys);window.addEventListener('resize',()=>{if(window.innerWidth>730&&!inspectorPanel.classList.contains('is-collapsed'))setInspectorWidth(inspectorPanel.getBoundingClientRect().width);if(state.master)updateZoomFit();const form=$('quickAreaPromptForm');if(!form.classList.contains('hidden')){const box=form.getBoundingClientRect();moveQuickPrompt(box.left,box.top)}});
for(const id of ['copyPromptBtn','copyPromptSecondary'])$(id).addEventListener('click',async()=>{try{await navigator.clipboard.writeText(promptText());toast('Prompt copied.')}catch{toast('Clipboard unavailable. Select prompt from the panel.')}});
const viewport=$('viewport');viewport.addEventListener('pointerleave',()=>{window.MosaicRegions?.clearHover();window.MosaicSlimWand?.leave?.()});viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('dropping')});viewport.addEventListener('dragleave',()=>viewport.classList.remove('dropping'));viewport.addEventListener('drop',async e=>{e.preventDefault();viewport.classList.remove('dropping');const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));if(!state.master){if(files[0])await importReference(files[0]);if(files.length>1)await importVariants(files.slice(1))}else await importVariants(files)});
viewport.addEventListener('pointerleave',()=>{brushPointer=null;brushCursor.hidden=true;hoverMaskEdge=null;updateMaskPointControls()});
viewport.addEventListener('wheel',event=>{
  if(!state.master||event.target.closest('form,.mask-edit-controls'))return;
  event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
  zoomAt(state.zoom*Math.exp(-event.deltaY*unit*.004),event.clientX,event.clientY);
  if(state.panAnchor)state.panAnchor={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
  if(state.lasso.length)state.hoverPoint=canvasPoint(event,false);
  if(state.shapeStart)state.shapeEnd=canvasPoint(event,false);drawOverlay();
},{passive:false});
window.addEventListener('mosaic:keyconnected',()=>state.groups.forEach(autoClassifyGroup));
window.MosaicCore = {groupContainsPoint,appendGroupSelection,newGroup,matchingGroup,applyWandMask,svgNode,vectorLayer,drawVectorPaths,maskPathsFromRaster,state,canvas,overlay,ctx,makeCanvas,uid,setProjectTitle,toast,message,promptText,loadFileToCanvas,setMaster,continueWithBase,upgradeBaseDraft,setSourcePreview,updateSourceActions,render,composeApprovedCanvas,renderGroups,drawPatch,selectTool,setMode,updateApplyButton,maskBoundingBox,assignGroup,resetSelection,updateSelectionOutline,updateMaskWithLasso,updateZoomFit,escapeHTML,categoryFromText,updateGroupCategory,optionNameFromPrompt,prepareSelectionGroup,groupMask,selectGroupMask,CATEGORIES,showQuickPrompt,hideQuickPrompt,createBlankRegion,moveOptionToGroup,displayedPatchMask,renderedPatchLayer,refreshGroupFootprint,invalidateDisplayedMask,attachGeneratedSelection,patchSelectionPaths,exactMaskBoundingBox,unwarpPatchSelection,patchControlPoints,displayedMaskPoint};
Object.assign(window.MosaicCore,{focusGroupInSidebar,chooseGroupOption,groupChoiceVersion,toggleComparison,canCreateSelection});
promptText();
