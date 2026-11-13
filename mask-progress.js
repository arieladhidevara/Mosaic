// Persistent, accessible progress for browser model preload and AI masking.
// A percentage is shown only when the underlying file downloader reports it.
// Mount on document.body: canvasWrap is hidden before an image is uploaded.
const canvasWrap=document.getElementById('canvasWrap');
const hud=document.createElement('div');
hud.id='maskProgressHud';
hud.className='mask-progress-hud hidden';
hud.setAttribute('role','status');
hud.setAttribute('aria-live','polite');
hud.innerHTML='<div class="mask-progress-title"><span class="mask-progress-spinner" aria-hidden="true">✦</span><strong id="maskProgressTitle">AI Mask</strong></div><div id="maskProgressDetail" class="mask-progress-detail"></div><div id="maskProgressTrack" class="mask-progress-track" role="progressbar" aria-label="AI masking progress"><div id="maskProgressFill" class="mask-progress-fill"></div></div>';
document.body.append(hud);

const shimmer=document.createElement('div');
shimmer.className='mask-processing-shimmer hidden';
shimmer.setAttribute('aria-hidden','true');
canvasWrap.append(shimmer);
const jobs=new Map();
const priority=owner=>owner==='scene-split'?4:owner.startsWith('generation:')?3:({preload:0,image:0,wand:1,auto:2,'smart-select':2}[owner]??0);
const highlights=new Map();

function drawProgress(){
  if(!jobs.size){hud.classList.add('hidden');return}
  const entries=[...jobs.entries()];
  entries.sort(([a],[b])=>priority(b)-priority(a));
  const [,entry]=entries[0];
  const edits=entries.filter(([owner])=>owner.startsWith('generation:')).length;
  hud.classList.remove('hidden');
  document.getElementById('maskProgressTitle').textContent=edits>1&&entries[0][0].startsWith('generation:')?edits+' AI edit requests':entry.title;
  document.getElementById('maskProgressDetail').textContent=entry.detail;
  const track=document.getElementById('maskProgressTrack');
  const fill=document.getElementById('maskProgressFill');
  if(Number.isFinite(entry.percent)){
    const value=Math.max(0,Math.min(100,Math.round(entry.percent)));
    track.setAttribute('aria-valuenow',String(value));
    track.setAttribute('aria-valuemin','0');
    track.setAttribute('aria-valuemax','100');
    fill.style.width=value+'%';
    fill.classList.remove('indeterminate');
  }else{
    track.removeAttribute('aria-valuenow');
    fill.style.width='';
    fill.classList.add('indeterminate');
  }
}
function show(owner,title,detail,percent=null){
  jobs.set(owner,{title,detail,percent:Number.isFinite(percent)?percent:null});
  drawProgress();
}
function hide(owner){
  if(owner)jobs.delete(owner);else jobs.clear();
  clearHighlight(owner);
  drawProgress();
}
function highlight(owner,{mask=null,point=null,whole=false}={}){
  highlights.set(owner,{mask,point,whole});
  drawHighlight();
}
function drawHighlight(){
  const next=[...highlights.entries()].sort(([a],[b])=>priority(b)-priority(a))[0];
  if(!next){shimmer.classList.add('hidden');return}
  let {mask,point,whole}=next[1];
  if(next[0].startsWith('generation:')){
    const masks=[...highlights.entries()].filter(([owner,item])=>owner.startsWith('generation:')&&item.mask).map(([,item])=>item.mask);
    if(masks.length>1){
      const combined=document.createElement('canvas');combined.width=masks[0].width;combined.height=masks[0].height;
      const context=combined.getContext('2d');for(const item of masks)context.drawImage(item,0,0,combined.width,combined.height);
      mask=combined;
    }
  }
  shimmer.classList.remove('hidden');
  shimmer.style.webkitMaskImage='';
  shimmer.style.maskImage='';
  if(mask?.width&&mask?.height&&typeof mask.toDataURL==='function'){
    const uri=mask.toDataURL('image/png');
    shimmer.style.maskImage='url("'+uri+'")';
    shimmer.style.webkitMaskImage='url("'+uri+'")';
  }else if(!whole&&point&&canvasWrap.clientWidth&&canvasWrap.clientHeight){
    const x=Math.max(0,Math.min(100,point.x/canvasWrap.querySelector('canvas').width*100));
    const y=Math.max(0,Math.min(100,point.y/canvasWrap.querySelector('canvas').height*100));
    const radial='radial-gradient(ellipse 14% 18% at '+x+'% '+y+'%, black 18%, transparent 100%)';
    shimmer.style.maskImage=radial;
    shimmer.style.webkitMaskImage=radial;
  }
}
function clearHighlight(owner){
  if(owner)highlights.delete(owner);else highlights.clear();
  shimmer.style.maskImage='';shimmer.style.webkitMaskImage='';
  drawHighlight();
}
window.MosaicMaskProgress={show,hide,highlight,clearHighlight};
