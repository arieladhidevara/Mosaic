/* Mosaic source browser: locked uploads, direct previews, exportable Master versions. */
const core=window.MosaicCore;
if(!core)throw Error('Mosaic core must load before source browser.');
const {state,toast,makeCanvas}=core;
const $=id=>document.getElementById(id);
const dialog=$('sourcePreviewDialog'),masterPanel=$('masterVersionsPanel');
let selected=null,lastVersionCount=0;
function versions(){return window.MosaicPremium?.getMasterVersions?.()||[]}
function latestMaster(){return versions().at(-1)}
function versionByNumber(number){return versions().find(version=>version.number===Number(number))||null}
async function previewSource(kind,number=null){
  const version=kind==='version'?versionByNumber(number):null;
  if(version&&!version.image){
    try{await window.MosaicDiskCache?.ensure?.(version,'image');}
    catch(error){toast('Cannot load Master version: '+error.message);return;}
  }
  const source=kind==='base'?state.reference:version?.image||((state.master&&!state.masterIsBase)?state.master:null);
  if(!source){toast(kind==='base'?'Upload Base first.':'Upload or generate Master first.');return}
  const title=kind==='base'?'Base · Original':kind==='version'?'Master '+version.number:'Master '+(latestMaster()?.number||1);
  selected={canvas:source,title};
  $('sourcePreviewTitle').textContent=title;
  $('sourcePreviewInfo').textContent=kind==='base'?'Read-only original geometry reference':version?.kind||'Current working Master';
  $('sourcePreviewImage').src=source.toDataURL('image/jpeg',.84);
  if(!dialog.open)dialog.showModal();
}
function downloadPNG(source,name){
  if(!source){toast('Image no longer available.');return}
  source.toBlob(blob=>{
    if(!blob){toast('Could not save the PNG.');return}
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1200);
    toast(name+' saved.');
  },'image/png');
}
function refresh(){
  const hasBase=Boolean(state.reference),hasMaster=Boolean(state.master&&!state.masterIsBase);
  $('referenceInput').disabled=hasBase;
  $('masterInput').disabled=hasMaster;
  $('referenceZone').classList.toggle('source-locked',hasBase);
  $('masterZone').classList.toggle('source-locked',hasMaster);
  $('referenceZone').title=hasBase?'Preview Base image (original upload is locked)':'Upload Base image';
  $('masterZone').title=hasMaster?'Preview latest Master image (original upload is locked)':'Upload Master image';
  // Full-scene Master history was removed. The current Master can still be
  // previewed from the main Master zone; earlier looks live as object Options.
  masterPanel.classList.add('hidden');
  $('masterVersionsCount').textContent='0';
  $('masterVersionsList').replaceChildren();
  lastVersionCount=0;
}
for(const [zoneId,inputId,kind] of [['referenceZone','referenceInput','base'],['masterZone','masterInput','master']]){
  const zone=$(zoneId);
  zone.addEventListener('click',event=>{
    const ready=kind==='base'?Boolean(state.reference):Boolean(state.master&&!state.masterIsBase);
    if(!ready)return;
    event.preventDefault();event.stopPropagation();previewSource(kind);
  });
  zone.addEventListener('dragover',event=>{event.preventDefault()});
  zone.addEventListener('drop',event=>{
    const ready=kind==='base'?Boolean(state.reference):Boolean(state.master&&!state.masterIsBase);
    if(!ready)return;event.preventDefault();event.stopPropagation();previewSource(kind);
  });
  // Once populated, even programmatic input.click() cannot replace a locked source.
  $(inputId).addEventListener('click',event=>{
    const ready=kind==='base'?Boolean(state.reference):Boolean(state.master&&!state.masterIsBase);
    if(ready)event.preventDefault();
  });
}
$('quickMasterBtn').addEventListener('click',event=>{
  if(state.master&&!state.masterIsBase){event.preventDefault();event.stopImmediatePropagation();previewSource('master')}
},true);
$('quickRevitBtn').addEventListener('click',event=>{
  if(state.reference){event.preventDefault();event.stopImmediatePropagation();previewSource('base')}
},true);
$('masterVersionsList').addEventListener('click',async event=>{
  const button=event.target.closest('[data-master-action]'),row=button?.closest('[data-version]');
  if(!row)return;
  const version=versionByNumber(row.dataset.version);if(!version)return;
  switch(button.dataset.masterAction){
    case 'preview':await previewSource('version',version.number);break;
    case 'save':
      try {
        await window.MosaicDiskCache?.ensure?.(version,'image');
        downloadPNG(version.image,'Mosaic_Master_'+version.number+'.png');
      }catch(error){toast('Cannot load Master for download: '+error.message);}
      break;
    case 'regen':void window.MosaicPremium?.regenerateMaster?.(version.number);break;
  }
});
$('sourcePreviewSave').addEventListener('click',()=>{
  if(selected)downloadPNG(selected.canvas,'Mosaic_'+selected.title.replace(/[^a-z0-9]+/gi,'_')+'.png');
});
const close=()=>{if(dialog.open)dialog.close()};
$('sourcePreviewClose').addEventListener('click',close);
$('sourcePreviewDismiss').addEventListener('click',close);
dialog.addEventListener('close',()=>{selected=null;$('sourcePreviewImage').removeAttribute('src')});
window.MosaicSources={refresh,previewSource,downloadPNG};
refresh();
