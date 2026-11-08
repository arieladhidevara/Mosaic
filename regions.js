/* Mosaic region memory UI — local masks, editable names, category controls and hover hints. */
const core=window.MosaicCore;
if(!core)throw Error('Mosaic core must load first.');
const {state,canvas,overlay,renderGroups,render,groupMask,selectGroupMask,CATEGORIES,updateGroupCategory}=core;
const list=document.getElementById('groupList'),viewport=document.getElementById('viewport');
const wrap=document.getElementById('canvasWrap');
const ghost=core.vectorLayer('regionHoverVectors');
const hint=document.createElement('div');hint.className='group-hover-hint hidden';hint.id='groupHoverHint';
hint.setAttribute('aria-hidden','true');viewport.append(hint);
let hovering=null;
function makeButton(text,action,title){
  const b=document.createElement('button');b.type='button';b.textContent=text;
  b.className='variant-action';b.dataset.regionAction=action;b.title=title;b.setAttribute('aria-label',title);return b;
}
function decorate(){
  for(const section of list.querySelectorAll('.region-group[data-group]')){
    const g=state.groups.find(x=>x.id===section.dataset.group);if(!g)continue;
    const head=section.querySelector('.group-head');
    if(!head||section.querySelector('.group-details'))continue;
    head.setAttribute('role','button');head.tabIndex=0;
    head.title='Click to reuse '+g.name+' selection on the current image';
    if(state.draftGroupId===g.id)section.classList.add('region-focused');
    const label=head.querySelector('.group-name');
    if(label)label.textContent=g.name;
    (head.querySelector('.group-head-actions')||head).append(makeButton('✎','rename-group','Rename group'));
    const details=document.createElement('div');details.className='group-details';
    const select=document.createElement('select');select.className='group-category';
    select.dataset.regionCategory=g.id;select.title='Set object category';select.setAttribute('aria-label','Object category');
    for(const category of CATEGORIES){
      const option=document.createElement('option');option.value=category;option.textContent=category==='Region'?'Uncategorized':category;
      option.selected=category===(g.category||'Region');select.append(option);
    }
    details.append(select,makeButton('✦','identify','Identify object with AI'),makeButton('×','remove-group','Delete group and its options'));
    head.after(details);
    for(const row of section.querySelectorAll('.variant-row[data-patch]')){
      if(row.dataset.patch==='master')continue;
      const patch=state.patches.get(row.dataset.patch);
      if(!patch)continue;
      const text=row.querySelector('.variant-text');
      if(text)text.textContent=patch.name;
      const edit=row.querySelector('[data-action="edit-mask"]');if(edit){edit.setAttribute('aria-pressed',String(state.maskEditOnly&&state.selectionTargetPatchId===patch.id));edit.setAttribute('aria-label','Edit selection mask')}if(edit)edit.textContent='✎';
      const rename=row.querySelector('[data-region-action="rename-option"]');if(rename)rename.textContent='Aa';
      const remove=row.querySelector('[data-action="delete"]');if(remove)remove.textContent='×';
      const regen=row.querySelector('[data-region-action="regen-option"]');
      if(regen){regen.textContent=patch.generating?'…':'↻';regen.disabled=Boolean(patch.generating)}
      row.draggable=true;row.title='Drag to another Group, or right-click / long-press to move';
      // Exactly four primary actions are authored by app.js.
      // Drag/drop between Groups remains available without extra buttons.
    }
  }
}
function inlineRename(container,current,onSave){
  if(!container)return;
  const input=document.createElement('input');input.className='region-rename-input';
  input.type='text';input.value=current;input.maxLength=64;
  input.setAttribute('aria-label','Rename');container.replaceChildren(input);input.focus();input.select();
  let done=false;
  const finish=save=>{
    if(done)return;done=true;
    const value=input.value.trim().slice(0,64);
    if(save&&value)onSave(value);
    renderGroups();
  };
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Enter'){e.preventDefault();finish(true)}
    else if(e.key==='Escape'){e.preventDefault();finish(false)}
  });
  input.addEventListener('blur',()=>finish(true));
}
function showMovePicker(row,group){
  const patchId=row?.dataset.patch;
  if(!patchId||state.groups.length<2){core.toast('Create another Group before moving an option.');return true}
  row.querySelector('.region-move-picker')?.remove();
  const select=document.createElement('select');select.className='region-move-picker';
  select.setAttribute('aria-label','Move option to group');
  select.append(new Option('Move to Group…',''));
  for(const destination of state.groups){
    if(destination.id===group.id)continue;
    select.append(new Option(destination.name,destination.id));
  }
  row.append(select);select.focus({preventScroll:true});
  select.addEventListener('click',event=>event.stopPropagation());
  select.addEventListener('change',event=>{
    event.stopPropagation();
    if(select.value)core.moveOptionToGroup(patchId,select.value);
    else select.remove();
  });
  return true;
}
function handleGroupEvent(e){
  if(e.target.closest('.region-rename-input,[data-region-category]'))return true;
  const action=e.target.closest('[data-region-action]');
  const section=e.target.closest('.region-group[data-group]');
  if(!section)return false;
  const group=state.groups.find(g=>g.id===section.dataset.group);
  if(!group)return false;
  if(action){
    e.stopPropagation();
    if(action.dataset.regionAction==='add-option'){
      selectGroupMask(group);
      list.querySelectorAll('.region-option-prompt').forEach(el=>el.remove());
        const field=document.createElement('form');field.className='region-option-prompt';
        field.innerHTML='<input type="text" maxlength="250" aria-label="New material or edit prompt" placeholder="e.g. Black, Walnut, Terrazzo" required><button class="reference-upload-action region-reference-button" type="button" aria-label="Attach reference images to this Group option">＋ Ref</button><input class="region-reference-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><span class="reference-previews region-inline-previews"></span><button type="submit">✦ Generate</button>';
        list.querySelector('.region-group[data-group="'+group.id+'"] .group-options')?.prepend(field);
        field.addEventListener('click',event=>event.stopPropagation());
        const references=window.MosaicPremium?.bindInlineReferencePrompt?.(field);
        field.addEventListener('submit',event=>{
          event.preventDefault();event.stopPropagation();
          const prompt=field.querySelector('input[type="text"]').value.trim();
          const images=references?.getFiles?.()||[];
          references?.clear?.();
          field.remove();if(prompt)void window.MosaicPremium?.generateSelection?.(prompt,group.id,images);
        });
        field.querySelector('input').focus({preventScroll:true});
      return true;
    }
    if(action.dataset.regionAction==='rename-group'){
      inlineRename(section.querySelector('.group-name'),group.name,name=>{group.name=name;group.manualName=true});return true;
    }
    if(action.dataset.regionAction==='move-option'){
      return showMovePicker(action.closest('.variant-row'),group);
    }
    if(action.dataset.regionAction==='regen-option'){
      const patchId=action.closest('.variant-row')?.dataset.patch;
      if(patchId)void window.MosaicPremium?.regenerateOption?.(patchId);
      return true;
    }
    if(action.dataset.regionAction==='rename-option'){
      const row=action.closest('.variant-row'),patch=state.patches.get(row?.dataset.patch);
      if(patch)inlineRename(row.querySelector('.variant-text'),patch.name,name=>{patch.name=name;patch.manualName=true});
      return true;
    }
    if(action.dataset.regionAction==='remove-group'){
      if(window.confirm('Delete '+group.name+' and all its options?')){
        for(const id of group.patchIds)state.patches.delete(id);
        state.groups=state.groups.filter(g=>g!==group);
        if(state.draftGroupId===group.id)core.resetSelection();
        if(hovering===group.id)clearHover();
        renderGroups();render();
      }
      return true;
    }
    if(action.dataset.regionAction==='identify'){
      void (async()=>{
        try{
          if(!window.MosaicPremium?.classifyArea)throw Error('AI classifier not available.');
          if(!await window.MosaicAuth.ensure())return;
          group.classificationPending=true;renderGroups();
          const result=await window.MosaicPremium.classifyArea(groupMask(group));
          if(!state.groups.includes(group))return;
          group.manualCategory=false;updateGroupCategory(group,result,'vision');
        }catch(err){core.toast('Identify: '+err.message)}
        finally{if(state.groups.includes(group)){group.classificationPending=false;renderGroups()}}
      })();
      return true;
    }
    return true;
  }
  if(e.target.closest('.group-head')){selectGroupMask(group);return true}
  return false;
}
list.addEventListener('contextmenu',event=>{
  const row=event.target.closest('.variant-row[data-patch]'),section=row?.closest('.region-group[data-group]');
  const group=section&&state.groups.find(g=>g.id===section.dataset.group);
  if(!row||!group||!state.patches.has(row.dataset.patch))return;
  event.preventDefault();
  showMovePicker(row,group);
});
let draggedPatchId=null;
list.addEventListener('dragstart',event=>{
  const row=event.target.closest('.variant-row[data-patch]');
  if(!row||row.dataset.patch==='master'||!state.patches.has(row.dataset.patch))return;
  draggedPatchId=row.dataset.patch;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',draggedPatchId);
  row.classList.add('dragging');
});
list.addEventListener('dragover',event=>{
  if(!draggedPatchId)return;
  const destination=event.target.closest('.region-group[data-group]');
  if(!destination)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';
  destination.classList.add('region-drop-target');
});
list.addEventListener('dragleave',event=>{
  if(!event.target.closest('.region-group[data-group]'))return;
  if(!event.currentTarget.contains(event.relatedTarget))list.querySelectorAll('.region-drop-target').forEach(el=>el.classList.remove('region-drop-target'));
});
list.addEventListener('drop',event=>{
  const region=event.target.closest('.region-group[data-group]');
  if(!region||!draggedPatchId)return;
  event.preventDefault();
  core.moveOptionToGroup(draggedPatchId,region.dataset.group);
  draggedPatchId=null;list.querySelectorAll('.region-drop-target,.dragging').forEach(el=>el.classList.remove('region-drop-target','dragging'));
});
list.addEventListener('dragend',()=>{
  draggedPatchId=null;list.querySelectorAll('.region-drop-target,.dragging').forEach(el=>el.classList.remove('region-drop-target','dragging'));
});
list.addEventListener('change',e=>{
  const select=e.target.closest('[data-region-category]');if(!select)return;
  const group=state.groups.find(g=>g.id===select.dataset.regionCategory);
  if(!group||!CATEGORIES.includes(select.value))return;
  group.manualCategory=false;updateGroupCategory(group,select.value,'manual');
  group.category=select.value;group.manualCategory=true;
  if(!group.manualName){
    const label=group.name.split(' · ').slice(1).join(' · ');
    group.name=select.value+(label?' · '+label:'');
  }
  renderGroups();
});
list.addEventListener('keydown',e=>{
  if(e.target.classList.contains('group-head')&&(e.key==='Enter'||e.key===' ')){
    e.preventDefault();const group=state.groups.find(g=>g.id===e.target.dataset.group);
    if(group)selectGroupMask(group);
  }
});
function clearHover(){
  hovering=null;state.hoveredGroupId=null;
  hint.classList.add('hidden');hint.setAttribute('aria-hidden','true');
  ghost.replaceChildren();
}
function onPointerMove(e){
  if(!state.master||state.busy||state.before||state.drawing||state.transformDrag||state.maskVertexDrag||state.maskMoveDrag||
    state.panAnchor||window.MosaicSourceEditor?.isEditing()||state.tool!=='select'||window.MosaicPremium?.isPreviewing()||e.pointerType==='touch'){
    clearHover();return;
  }
  const rect=overlay.getBoundingClientRect(),v=viewport.getBoundingClientRect();
  if(!rect.width||!rect.height){clearHover();return}
  const x=(e.clientX-rect.left)/rect.width*canvas.width,y=(e.clientY-rect.top)/rect.height*canvas.height;
  let found=null,paths=null;
  if(x>=0&&y>=0&&x<canvas.width&&y<canvas.height){
    const px=Math.floor(x),py=Math.floor(y);
    for(let i=state.groups.length-1;i>=0;i--){
      const g=state.groups[i],mask=groupMask(g);
      if(mask.getContext('2d',{willReadFrequently:true}).getImageData(px,py,1,1).data[3]>0){found=g;break}
    }
    // Unsubmitted selections have a hover area too, without creating a Group.
    if(state.boundaryCanvas&&state.selectionMask.getContext('2d').getImageData(px,py,1,1).data[3]>0){
      const target=state.groups.find(g=>g.id===state.draftGroupId);
      found=target||{id:'draft',name:'Selection (unsaved)'};paths=state.selectionPaths;
    }
  }
  if(!found){clearHover();return}
  if(hovering!==found.id||!ghost.childElementCount){
    hovering=found.id;state.hoveredGroupId=found.id==='draft'?null:found.id;
    ghost.replaceChildren();
    const active=state.patches.get(found.active);
    paths=paths||(active?core.patchSelectionPaths(active):core.maskPathsFromRaster(groupMask(found)));
    core.drawVectorPaths(ghost,paths,{color:'#bca9ff',fill:'#b19aff30',width:1.5});
  }
  hint.textContent=found.name;
  hint.title='Click to select '+found.name;
  hint.classList.remove('hidden');hint.setAttribute('aria-hidden','false');
  const width=hint.getBoundingClientRect().width;
  hint.style.left=Math.min(Math.max(v.left+5,e.clientX+14),Math.max(v.left+5,v.right-width-5))+'px';
  hint.style.top=Math.min(Math.max(v.top+5,e.clientY+16),Math.max(v.top+5,v.bottom-38))+'px';
}
viewport.addEventListener('pointerdown',clearHover);
window.MosaicRegions={decorate,handleGroupEvent,onPointerMove,clearHover};
decorate();
