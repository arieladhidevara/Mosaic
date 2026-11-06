/* Mosaic Premium Preview — non-destructive masked AI handoff and harmonization.
 * No network calls, API key or subscription entitlement is implemented here.
 * Connect a server-side provider later; never expose an OpenAI key in the browser.
 */
const core = window.MosaicCore;
if (!core) throw new Error('Mosaic core must load before Premium');
const {state, canvas, makeCanvas, uid, render, renderGroups, resetSelection, assignGroup, maskBoundingBox, toast, message} = core;
const $ = id => document.getElementById(id);
const esc = core.escapeHTML;
const premium = {
  projectPrompt: '', root: null, serial: 0, expanded: new Set(),
  previewNode: null, uploadPatch: null, lastRequest: null,
  originalMaster: null, branchFrom: null
};
const cloneCanvas = input => {
  const output = makeCanvas(input.width, input.height);
  output.getContext('2d').drawImage(input, 0, 0);
  return output;
};
function copyGraph(groups, patches, sources) {
  return {
    groups: groups.map(g => ({...g, patchIds: [...g.patchIds]})),
    patches: new Map([...patches].map(([id,p]) => [id, {...p, mask: cloneCanvas(p.mask), corners: p.corners?.map(q=>({...q}))||null}])),
    sources: new Map([...sources].map(([id,s]) => [id, {...s, canvas: cloneCanvas(s.canvas)}]))
  };
}
function drawComposition(context, base, groups, patches, sources) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(base, 0, 0, canvas.width, canvas.height);
  for (const group of groups) {
    if (!group.active) continue;
    const patch = patches.get(group.active);
    const source = patch && sources.get(patch.sourceId);
    if (!patch || !source) continue;
    core.drawPatch(context, patch, source);
  }
}
function currentComposite() {
  const output = makeCanvas(canvas.width, canvas.height);
  drawComposition(output.getContext('2d'), state.master, state.groups, state.patches, state.sources);
  return output;
}
function findHistory(id, node = premium.root) {
  for (let n = node; n; n = n.parent) if (n.id === id) return n;
  return null;
}
function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}
function updateIntent() {
  $('projectPromptSummary').textContent = premium.projectPrompt || 'No project prompt yet. Edit to set design intent.';
  core.promptText();
}
function setReferenceAsBase() {
  if (state.master || !state.reference) return;
  const ref = state.reference;
  const scale = Math.min(1, 2400 / Math.max(ref.width, ref.height));
  const base = makeCanvas(Math.round(ref.width * scale), Math.round(ref.height * scale));
  base.getContext('2d').drawImage(ref, 0, 0, base.width, base.height);
  core.setMaster(base, 'Base · Original');
}
function onReferenceLoaded() {
  setReferenceAsBase();
  if (state.master && state.reference) {
    premium.originalMaster = makeCanvas(canvas.width, canvas.height);
    premium.originalMaster.getContext('2d').drawImage(state.reference, 0, 0, canvas.width, canvas.height);
  }
  $('projectPromptInput').value = premium.projectPrompt;
  showDialog('projectPromptDialog');
}
function onMasterReset() {
  premium.root = null;
  premium.serial = 0;
  premium.expanded.clear();
  premium.previewNode = null;
  premium.uploadPatch = null;
  premium.lastRequest = null;
  premium.originalMaster = null;
  premium.branchFrom = null;
}
function canSelectArea() {
  return Boolean(state.master && !state.pendingSourceId && !state.editingPatchId && !premium.previewNode);
}
function isPreviewing() { return Boolean(premium.previewNode); }
function drawArchivePreview(context) {
  if (!premium.previewNode) return false;
  const node = findHistory(premium.previewNode);
  if (!node) {premium.previewNode = null; return false;}
  drawComposition(context, node.base, node.groups, node.patches, node.sources);
  return true;
}
function activePatchMarkup() {
  // A result image is accepted as a full frame but immediately clipped by the saved original mask.
  for (const patch of state.patches.values()) {
    if (!patch.awaitingResult) continue;
    const row = $('groupList').querySelector('.variant-row[data-action="choose"][data-patch="' + patch.id + '"]');
    if (!row) continue;
    row.classList.add('awaiting-ai');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'small-action add-ai-result';
    b.dataset.aiAction = 'upload';
    b.dataset.patch = patch.id;
    b.textContent = 'Add result';
    b.title = 'Attach a generated image; Mosaic will apply the saved lasso mask automatically';
    row.appendChild(b);
  }
}
function groupMarkup(group, node) {
  let html = '<div class="archived-region"><div class="archived-region-name">▧ ' + esc(group.name) +
    ' <span>' + group.patchIds.length + ' options</span></div>';
  const option = (pid, label) => '<button type="button" class="archived-option ' +
    (group.active === pid ? 'selected' : '') + '" data-history-action="option" data-node="' +
    node.id + '" data-history-group="' + group.id + '" data-history-patch="' + (pid || 'master') +
    '"><span class="variant-dot"></span><span>' + esc(label) + '</span></button>';
  html += option(null, 'Original / off');
  for (const pid of group.patchIds) {
    const p = node.patches.get(pid);
    if (p) html += option(pid, p.name + (p.awaitingResult ? ' · awaiting image' : ''));
  }
  return html + '</div>';
}
function nodeMarkup(node, depth = 0) {
  const open = premium.expanded.has(node.id);
  const preview = premium.previewNode === node.id;
  const safeTitle = 'Harmonized ' + node.number;
  let html = '<section class="archive-node ' + (preview ? 'archive-previewing' : '') +
    '" style="--history-depth:' + Math.min(depth, 6) + '"><button class="archive-head" type="button" data-history-action="toggle" data-node="' +
    node.id + '"><span>' + (open ? '▾' : '▸') + '</span><span class="archive-icon">▣</span><span class="archive-title">' +
    safeTitle + '<small>Archived · Local snapshot · ' + node.groups.length +
    ' groups</small></span><span class="archive-lock">◎</span></button>';
  if (open) {
    html += '<div class="archive-body"><div class="archive-actions">' +
      '<button type="button" class="small-action ' + (preview ? 'active-action' : '') +
      '" data-history-action="preview" data-node="' + node.id + '">' +
      (preview ? 'Close preview' : 'Preview collage') + '</button>' +
      '<button type="button" class="small-action" data-history-action="restore" data-node="' + node.id +
      '">Branch from edits</button><button type="button" class="small-action" data-history-action="result" data-node="' +
      node.id + '">Use flattened</button></div>';
    html += '<p class="archive-note">Snapshot keeps masks, options and prompts. Select an old option to preview it, then branch to edit.</p>';
    html += node.groups.map(g => groupMarkup(g, node)).join('');
    if (node.parent) html += nodeMarkup(node.parent, depth + 1);
    html += '</div>';
  }
  return html + '</section>';
}
function renderHistory(list) {
  activePatchMarkup();
  if (!premium.root) return;
  list.insertAdjacentHTML('beforeend',
    '<div class="history-section-label">HARMONIZED HISTORY <span>Editable archive</span></div>' +
    nodeMarkup(premium.root));
}
function workFromNode(node, useFlattened) {
  if (state.pendingSourceId || state.editingPatchId) {toast('Finish or discard your current mask first.');return;}
  if (state.groups.length && !window.confirm('Switch working version? Your current unharmonized patches will be replaced. Harmonized snapshots remain in history.')) return;
  premium.previewNode = null;
  state.pendingSourceId = null;
  state.queue = [];
  state.selectedPatchId = null;
  state.editingPatchId = null;
  state.undo = [];
  state.redo = [];
  if (useFlattened) {
    state.master = cloneCanvas(node.output);
    state.groups = [];
    state.patches = new Map();
    state.sources = new Map();
  } else {
    const graph = copyGraph(node.groups, node.patches, node.sources);
    state.master = cloneCanvas(node.base);
    state.groups = graph.groups;
    state.patches = graph.patches;
    state.sources = graph.sources;
  }
  premium.branchFrom = node.id;
  state.before = false;
  resetSelection();
  $('projectName').textContent = 'Branch · Harmonized ' + node.number;
  $('masterTitle').textContent = useFlattened ? 'Harmonized ' + node.number : 'Restored edit composition';
  renderGroups();
  render();
  message(useFlattened ? 'Editing a previous harmonized result. Existing history is preserved.' :
    'Restored the archived editable collage. Change alternatives and harmonize again.');
  toast('Branch created. Earlier harmonizations are still available.');
}
function handleGroupEvent(event) {
  const ai = event.target.closest('[data-ai-action]');
  if (ai) {
    if (ai.dataset.aiAction === 'upload') {
      premium.uploadPatch = ai.dataset.patch;
      $('aiResultInput').click();
    }
    return true;
  }
  const control = event.target.closest('[data-history-action]');
  if (!control) return false;
  const node = findHistory(control.dataset.node);
  if (!node) return true;
  if (state.pendingSourceId) {toast('Finish the imported variation first.');return true;}
  const action = control.dataset.historyAction;
  if (action === 'toggle') {
    premium.expanded.has(node.id) ? premium.expanded.delete(node.id) : premium.expanded.add(node.id);
  } else if (action === 'preview') {
    premium.previewNode = premium.previewNode === node.id ? null : node.id;
  } else if (action === 'option') {
    const group = node.groups.find(g => g.id === control.dataset.historyGroup);
    if (group) {
      const id = control.dataset.historyPatch;
      group.active = id === 'master' ? null : id;
      premium.previewNode = node.id;
    }
  } else if (action === 'restore') {
    workFromNode(node, false);
    return true;
  } else if (action === 'result') {
    workFromNode(node, true);
    return true;
  }
  renderGroups();
  render();
  return true;
}
function openAreaPrompt() {
  if (!canSelectArea()) {toast('Finish the current layer or restore an archived branch before prompting.');return;}
  if (state.lasso.length > 2) core.updateMaskWithLasso();
  const bbox = state.selectionMask && maskBoundingBox(state.selectionMask);
  if (!bbox) {toast('Draw a lasso selection first, then press Prompt area.');return;}
  $('areaPromptInput').value = '';
  showDialog('areaPromptDialog');
}
function createRegionRequest(prompt) {
  const bbox = maskBoundingBox(state.selectionMask);
  if (!bbox) {toast('Selection has no pixels.');return;}
  const mask = cloneCanvas(state.selectionMask);
  const base = currentComposite();
  const sourceId = uid('ai_source');
  const text = prompt.trim();
  const source = {id: sourceId, name: 'AI request', canvas: base};
  const patch = {id: uid('ai_patch'), sourceId, mask, bbox,
    name: '✦ ' + text.slice(0, 36), prompt: text, awaitingResult: true,
    projectPrompt: premium.projectPrompt,
    request: {baseImage: base, reference: state.reference, mask, prompt: text}};
  state.sources.set(sourceId, source);
  const group = assignGroup(patch);
  state.selectedPatchId = null;
  state.editingPatchId = null;
  resetSelection();
  renderGroups();
  render();
  message('Masked request saved in ' + group.name + '. Attach an AI result to fill only the selected area.');
  toast('AI request queued locally. Attach a result when it is ready.');
}
async function attachAIResult(file) {
  const patch = state.patches.get(premium.uploadPatch);
  premium.uploadPatch = null;
  if (!file || !patch) return;
  try {
    const img = await core.loadFileToCanvas(file);
    const c = makeCanvas(canvas.width, canvas.height);
    c.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const source = state.sources.get(patch.sourceId);
    if (!source) throw new Error('Original request was not found');
    source.canvas = c;
    source.name = file.name;
    patch.awaitingResult = false;
    patch.name = '✦ ' + patch.prompt.slice(0, 34);
    const group = state.groups.find(g => g.patchIds.includes(patch.id));
    if (group) group.active = patch.id;
    state.selectedPatchId = patch.id;
    core.selectTool('transform');
    renderGroups();
    render();
    toast('Generated result masked automatically and added to its region group.');
  } catch (error) {toast('Could not attach result: ' + error.message);}
}
function openHarmonize() {
  if (!state.master || !state.reference) {toast('Upload Base first.');return;}
  if (state.pendingSourceId || state.editingPatchId) {toast('Apply or discard the current mask first.');return;}
  if (premium.previewNode) {toast('Close the archive preview or branch from it before harmonizing.');return;}
  if (state.groups.some(g => g.active && state.patches.get(g.active)?.awaitingResult)) {
    toast('An active masked AI request is still waiting for its result image.');return;
  }
  $('harmonizePromptInput').value = core.promptText();
  showDialog('harmonizeDialog');
}
function harmonizeLocally(prompt) {
  // Provider slot: send Base + currentComposite() + prompt to a trusted
  // backend once an AI endpoint and premium entitlements are actually configured.
  const flattened = currentComposite();
  const graph = copyGraph(state.groups, state.patches, state.sources);
  const number = ++premium.serial;
  const node = {
    id: uid('harmonized'), number, base: cloneCanvas(state.master),
    groups: graph.groups, patches: graph.patches, sources: graph.sources,
    output: cloneCanvas(flattened), prompt, parent: premium.root,
    branchedFrom: premium.branchFrom, aiGenerated: false
  };
  premium.root = node;
  premium.expanded.add(node.id);
  premium.previewNode = null;
  premium.lastRequest = {
    originalBase: state.reference, collage: cloneCanvas(flattened),
    prompt, snapshotId: node.id
  };
  state.master = flattened;
  state.groups = [];
  state.patches = new Map();
  state.sources = new Map();
  state.pendingSourceId = null;
  state.editingPatchId = null;
  state.selectedPatchId = null;
  state.undo = [];
  state.redo = [];
  premium.branchFrom = node.id;
  resetSelection();
  $('masterTitle').textContent = 'Harmonized ' + number + ' · Local';
  $('masterInfo').textContent = canvas.width + ' × ' + canvas.height + ' · working image';
  $('projectName').textContent = 'Harmonized ' + number + ' · local snapshot';
  renderGroups();
  render();
  message('Flattened working image created. Expand Harmonized ' + number + ' to access previous layers.');
  toast('Harmonized ' + number + ' archived. Preview only: no AI API connected.');
}
function exportPrompt() {
  return premium.lastRequest?.prompt || null;
}
function originalImage() {
  return premium.originalMaster;
}
function onPatchApplied() {
  // A committed patch stays selected so its four corner handles are immediately available.
  if(state.selectedPatchId)core.selectTool('transform');
}
window.MosaicPremium = {
  projectPrompt: () => premium.projectPrompt,
  onReferenceLoaded, onMasterReset, canSelectArea, onPatchApplied,
  drawArchivePreview, isPreviewing, renderHistory, handleGroupEvent,
  originalImage, exportPrompt
};
for (const id of ['editProjectPromptBtn', 'projectPromptToolbarBtn']) $(id).addEventListener('click', () => {
  $('projectPromptInput').value = premium.projectPrompt;
  showDialog('projectPromptDialog');
});
$('projectPromptForm').addEventListener('submit', e => {
  e.preventDefault();
  premium.projectPrompt = $('projectPromptInput').value.trim();
  $('projectPromptDialog').close();
  updateIntent();
  toast('Project design prompt saved locally.');
});
$('promptAreaBtn').addEventListener('click', openAreaPrompt);
$('areaPromptForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('areaPromptInput').value.trim();
  if (!text) return;
  $('areaPromptDialog').close();
  createRegionRequest(text);
});
for (const id of ['harmonizeBtn', 'harmonizeSidebarBtn'])
  $(id).addEventListener('click', openHarmonize);
$('harmonizeForm').addEventListener('submit', e => {
  e.preventDefault();
  const prompt = $('harmonizePromptInput').value.trim() || core.promptText();
  $('harmonizeDialog').close();
  harmonizeLocally(prompt);
});
$('aiResultInput').addEventListener('change', async e => {
  await attachAIResult(e.target.files[0]);
  e.target.value = '';
});
document.querySelectorAll('[data-close-dialog]').forEach(button =>
  button.addEventListener('click', () => $(button.dataset.closeDialog).close()));
updateIntent();
