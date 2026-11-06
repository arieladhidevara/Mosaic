/* Mosaic region memory UI — local masks, editable names, category controls and hover hints. */
const core=window.MosaicCore;
if(!core)throw Error('Mosaic core must load first.');
const {state,canvas,overlay,renderGroups,render,groupMask,selectGroupMask,CATEGORIES,updateGroupCategory}=core;
const list=document.getElementById('groupList'),viewport=document.getElementById('viewport');
const wrap=document.getElementById('canvasWrap');
const ghost=document.createElement('canvas');ghost.id='regionGhostCanvas';ghost.className='region-ghost-canvas';
ghost.setAttribute('aria-hidden','true');wrap.append(ghost);
const ghostCtx=ghost.getContext('2d');
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
    head.append(makeButton('✎','rename-group','Rename group'));
    const details=document.createElement('div');details.className='group-details';
    const badge=document.createElement('span');badge.className='group-badge';
    badge.textContent=g.classificationPending?'Identifying…':g.category&&g.category!=='Region'?g.category:'Uncategorized';
    const select=document.createElement('select');select.className='group-category';
    select.dataset.regionCategory=g.id;select.title='Set object category';select.setAttribute('aria-label','Object category');
    for(const category of CATEGORIES){
      const option=document.createElement('option');option.value=category;option.textContent=category;
      option.selected=category===(g.category||'Region');select.append(option);
    }
    details.append(badge,select,makeButton('✦','identify','Identify object with AI'),makeButton('×','remove-group','Delete group and its options'));
    head.after(details);
    for(const row of section.querySelectorAll('.variant-row[data-patch]')){
      if(row.dataset.patch==='master')continue;
      const patch=state.patches.get(row.dataset.patch);
      if(!patch)continue;
      const text=row.querySelector('.variant-text');
      if(text){text.textContent=patch.name;const number=document.createElement('small');number.textContent=' #'+(g.patchIds.indexOf(patch.id)+1);text.append(number)}
      row.querySelector('.variant-action')?.before(makeButton('✎','rename-option','Rename option'));
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
      if(window.MosaicAuth?.isReady()){
        list.querySelectorAll('.region-option-prompt').forEach(el=>el.remove());
        const field=document.createElement('form');field.className='region-option-prompt';
        field.innerHTML='<input type="text" maxlength="250" aria-label="New material or edit prompt" placeholder="e.g. Black, Walnut, Terrazzo" required><button type="submit">✦ Generate</button>';
        section.querySelector('.group-options').prepend(field);
        field.addEventListener('click',event=>event.stopPropagation());
        field.addEventListener('submit',event=>{
          event.preventDefault();event.stopPropagation();
          const prompt=field.querySelector('input').value.trim();
          field.remove();if(prompt)window.MosaicPremium?.generateSelection?.(prompt,group.id);
        });
        field.querySelector('input').focus({preventScroll:true});
      }else{
        core.toast('Add a new image, then press Enter to keep this region.');
        document.getElementById('variantInput').click();
      }
      return true;
    }
    if(action.dataset.regionAction==='rename-group'){
      inlineRename(section.querySelector('.group-name'),group.name,name=>{group.name=name;group.manualName=true});return true;
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
  ghostCtx.clearRect(0,0,ghost.width,ghost.height);
}
function onPointerMove(e){
  if(!state.master||state.busy||state.before||state.drawing||state.transformDrag||
    state.panAnchor||window.MosaicPremium?.isPreviewing()||e.pointerType==='touch'){
    if(hovering)clearHover();return;
  }
  const rect=overlay.getBoundingClientRect(),v=viewport.getBoundingClientRect();
  if(!rect.width||!rect.height){if(hovering)clearHover();return}
  const x=(e.clientX-rect.left)/rect.width*canvas.width,y=(e.clientY-rect.top)/rect.height*canvas.height;
  let found=null;
  if(x>=0&&y>=0&&x<canvas.width&&y<canvas.height){
    const px=Math.floor(x),py=Math.floor(y);
    for(let i=state.groups.length-1;i>=0;i--){
      const g=state.groups[i],mask=groupMask(g);
      if(mask.getContext('2d',{willReadFrequently:true}).getImageData(px,py,1,1).data[3]>128){found=g;break}
    }
  }
  if(!found){if(hovering)clearHover();return}
  if(hovering!==found.id||ghost.width!==canvas.width||ghost.height!==canvas.height){
    hovering=found.id;state.hoveredGroupId=found.id;
    ghost.width=canvas.width;ghost.height=canvas.height;
    ghostCtx.clearRect(0,0,ghost.width,ghost.height);
    const mask=groupMask(found);
    ghostCtx.save();ghostCtx.globalAlpha=.05;ghostCtx.fillStyle='#b19aff';ghostCtx.drawImage(mask,0,0);ghostCtx.restore();
    const width=Math.min(mask.width,720),height=Math.max(1,Math.round(mask.height*width/mask.width));
    const sample=document.createElement('canvas');sample.width=width;sample.height=height;
    const sc=sample.getContext('2d',{willReadFrequently:true});sc.drawImage(mask,0,0,width,height);
    const pixels=sc.getImageData(0,0,width,height).data,outline=sc.createImageData(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,k=i*4;if(pixels[k+3]<110)continue;
      if(x>0&&x<width-1&&y>0&&y<height-1&&pixels[k-1*4+3]>=110&&pixels[k+4+3]>=110&&pixels[k-width*4+3]>=110&&pixels[k+width*4+3]>=110)continue;
      outline.data[k]=180;outline.data[k+1]=145;outline.data[k+2]=255;outline.data[k+3]=215;
    }
    sc.clearRect(0,0,width,height);sc.putImageData(outline,0,0);
    ghostCtx.save();ghostCtx.imageSmoothingEnabled=false;ghostCtx.drawImage(sample,0,0,mask.width,mask.height);ghostCtx.restore();
  }
  hint.textContent=found.category&&found.category!=='Region'?found.category:found.name;
  hint.title='Click '+found.name+' in Layers to reuse its mask';
  hint.style.left=Math.min(Math.max(5,e.clientX-v.left+14),Math.max(5,v.width-130))+'px';
  hint.style.top=Math.min(Math.max(5,e.clientY-v.top+16),Math.max(5,v.height-38))+'px';
  hint.classList.remove('hidden');hint.setAttribute('aria-hidden','false');
}
viewport.addEventListener('pointerdown',clearHover);
window.MosaicRegions={decorate,handleGroupEvent,onPointerMove,clearHover};
decorate();