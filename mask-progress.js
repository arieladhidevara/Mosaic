// Shared progress HUD for local SlimSAM and remote SAM 3. Never invent percentages.
const wrap = document.getElementById('canvasWrap');
const hud = document.createElement('div');
hud.id = 'maskProgressHud';
hud.className = 'mask-progress-hud hidden';
hud.setAttribute('role','status');
hud.setAttribute('aria-live','polite');
hud.innerHTML = '<div class="mask-progress-title"><span class="mask-progress-spinner" aria-hidden="true">✦</span><strong id="maskProgressTitle">AI Mask</strong></div><div id="maskProgressDetail" class="mask-progress-detail"></div><div id="maskProgressTrack" class="mask-progress-track" role="progressbar" aria-label="AI masking progress"><div id="maskProgressFill" class="mask-progress-fill"></div></div>';
wrap.append(hud);
let owner = null;
function show(nextOwner, title, detail, percent = null) {
  owner = nextOwner;
  hud.classList.remove('hidden');
  document.getElementById('maskProgressTitle').textContent = title;
  document.getElementById('maskProgressDetail').textContent = detail;
  const track = document.getElementById('maskProgressTrack');
  const fill = document.getElementById('maskProgressFill');
  if (Number.isFinite(percent)) {
    const value = Math.max(0,Math.min(100, Math.round(percent)));
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuemin','0');
    track.setAttribute('aria-valuemax','100');
    fill.style.width = value + '%';
    fill.classList.remove('indeterminate');
  } else {
    track.removeAttribute('aria-valuenow');
    fill.style.width = '';
    fill.classList.add('indeterminate');
  }
}
function hide(requestOwner) {
  if (requestOwner && owner !== requestOwner) return;
  owner = null;
  hud.classList.add('hidden');
}
window.MosaicMaskProgress = {show,hide};
