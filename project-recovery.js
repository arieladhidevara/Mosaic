/* Temporary local project recovery.
 * All data remains in this browser's IndexedDB, scoped to the current account.
 * Snapshots use the existing lossless .moz serializer, never remote storage.
 */
(() => {
  'use strict';
  const core = window.MosaicCore;
  const projects = window.MosaicProjects;
  if (!core || !projects?.buildProjectData || !projects?.loadProjectFile) return;

  const DB_NAME = 'mozai-local-recovery-v1';
  const STORE = 'workspaces';
  const TTL_MS = 24 * 60 * 60 * 1000;
  const AUTOSAVE_MS = 2 * 60 * 1000;
  const IDLE_MS = 20 * 1000;
  const MIN_WRITE_GAP_MS = 60 * 1000;
  const MAX_SNAPSHOT_BYTES = 500 * 1024 * 1024;
  const status = document.getElementById('recoveryStatus');
  const newButton = document.getElementById('newProjectBtn');
  let ready = false;
  let stopping = false;
  let revision = 0;
  let persistedRevision = 0;
  let dirty = false;
  let manuallySaved = false;
  let pendingSave = false;
  let lastWriteAt = 0;
  let timer = null;
  let inFlight = null;
  let owner = null;
  let lastErrorNotice = '';

  const hasProject = () => Boolean(core.state.reference || core.state.master);
  const working = () => Boolean(core.state.busy || window.MosaicSourceEditor?.isEditing?.() ||
    [...core.state.patches.values()].some(patch => patch.generating));
  const ownerKey = () => {
    const actor = window.MosaicAccount?.current?.();
    return actor?.id ? 'user:' + actor.id : 'guest';
  };
  const setStatus = value => { if (status) status.textContent = value; };

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(Error('Local disk storage is unavailable.')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('Cannot open local storage.'));
    });
  }

  async function transaction(mode, action) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || Error('Local storage transaction failed.'));
        tx.onabort = () => reject(tx.error || Error('Local storage transaction was cancelled.'));
        const operation = action(tx.objectStore(STORE));
        if (operation) {
          operation.onsuccess = () => { value = operation.result; };
          operation.onerror = () => reject(operation.error || Error('Local storage operation failed.'));
        }
      });
    } finally { db.close(); }
  }
  const read = key => transaction('readonly', store => store.get(key));
  const write = (key, value) => transaction('readwrite', store => store.put(value, key));
  const remove = key => transaction('readwrite', store => store.delete(key));

  function schedule(ms = IDLE_MS) {
    if (!ready || stopping || !hasProject() || timer) return;
    timer = setTimeout(() => { timer = null; void flush(); }, ms);
  }

  function markChanged() {
    if (!ready || stopping || !hasProject()) return;
    revision++;
    dirty = true;
    manuallySaved = false;
    pendingSave = true;
    setStatus('Unsaved changes · Auto-recovery pending');
    schedule();
  }

  async function flush() {
    if (!ready || stopping || !hasProject() || !pendingSave) return;
    if (inFlight) return inFlight;
    if (working()) { schedule(10000); return; }
    const wait = MIN_WRITE_GAP_MS - (Date.now() - lastWriteAt);
    if (lastWriteAt && wait > 0) { schedule(wait); return; }
    const snapshotRevision = revision;
    const snapshotOwner = owner;
    const snapshotSaved = manuallySaved;
    inFlight = (async () => {
      try {
        setStatus('Saving local recovery…');
        const project = await projects.buildProjectData();
        if (stopping || snapshotOwner !== ownerKey()) return;
        const blob = new Blob([JSON.stringify(project)], {type: 'application/json'});
        if (blob.size > MAX_SNAPSHOT_BYTES)
          throw Error('Recovery exceeds 500 MB. Use Save Project to keep a permanent copy.');
        const now = Date.now();
        await write(snapshotOwner, {blob, updatedAt: now, expiresAt: now + TTL_MS,
          saved: snapshotSaved, version: 1});
        lastWriteAt = now;
        persistedRevision = snapshotRevision;
        pendingSave = revision !== snapshotRevision || manuallySaved !== snapshotSaved;
        setStatus('Auto-recovery saved locally · 24h');
      } catch (error) {
        const reason = error?.name === 'QuotaExceededError'
          ? 'Browser storage full. Use Save Project.'
          : String(error?.message || error);
        setStatus('Auto-recovery unavailable · Save Project manually');
        if (lastErrorNotice !== reason) {
          lastErrorNotice = reason;
          core.toast('Auto-recovery: ' + reason);
        }
      } finally {
        inFlight = null;
        if (pendingSave && lastWriteAt && !stopping) schedule(AUTOSAVE_MS);
      }
    })();
    return inFlight;
  }

  function markSaved() {
    if (!ready || stopping) return;
    manuallySaved = true;
    dirty = false;
    revision++;
    pendingSave = true;
    setStatus('Project downloaded · Auto-recovery active');
    schedule();
  }

  function markLoaded() {
    if (!ready || stopping) return;
    manuallySaved = true;
    dirty = false;
    revision++;
    pendingSave = true;
    lastWriteAt = 0;
    clearTimeout(timer); timer = null;
    schedule();
  }

  async function newProject() {
    if (stopping) return;
    if (working()) {
      core.toast('Finish the active edit or generation before starting a new project.');
      return;
    }
    if (hasProject() && dirty && !window.confirm(
      'Start a new project?\n\nYour changes have not been saved as a .moz file. ' +
      'Starting a new project deletes this browser\'s temporary recovery.\n\n' +
      'Choose Cancel to save your current project first.'
    )) return;
    stopping = true;
    clearTimeout(timer); timer = null;
    if (newButton) { newButton.disabled = true; newButton.textContent = 'Starting…'; }
    try {
      if (inFlight) await inFlight;
      await remove(owner || ownerKey());
      // New Project clears both the recoverable snapshot and evicted image blobs.
      await window.MosaicDiskCache?.clearOwner?.(owner || ownerKey());
      location.reload();
    } catch (error) {
      stopping = false;
      if (newButton) { newButton.disabled = false; newButton.textContent = 'New project'; }
      core.toast('Could not clear temporary recovery: ' + (error?.message || error));
    }
  }

  async function boot() {
    setStatus('Checking local recovery…');
    try {
      await window.MosaicAccount?.ready?.();
      owner = ownerKey();
      let record = await read(owner);
      if (record && (!record.expiresAt || record.expiresAt <= Date.now())) {
        await remove(owner);
        await window.MosaicDiskCache?.clearOwner?.(owner);
        record = null;
      }
      // Absence of recovery in one tab must not delete an active tab's disk assets.
      if (record?.blob && !hasProject()) {
        const file = new File([record.blob], 'temporary-recovery.moz', {type:'application/json'});
        const restored = await projects.loadProjectFile(file, {recovery: true});
        if (restored) {
          manuallySaved = Boolean(record.saved);
          dirty = !manuallySaved;
          lastWriteAt = Number(record.updatedAt) || Date.now();
          setStatus('Restored from this device · Expires after 24h idle');
        } else {
          setStatus('Recovery could not be restored · Save Project manually');
        }
      } else {
        setStatus('Auto-recovery · Every 2 min · 24h');
      }
    } catch (error) {
      setStatus('Auto-recovery unavailable · Save Project manually');
      core.toast('Local recovery unavailable: ' + (error?.message || error));
    } finally {
      ready = true;
      // Only observe workspace indicators, not continuously changing canvas pixels.
      const observer = new MutationObserver(() => markChanged());
      for (const id of ['groupList', 'referenceZone', 'masterZone', 'projectName']) {
        const element = document.getElementById(id);
        if (element) observer.observe(element, {subtree:true,childList:true,attributes:true,characterData:true});
      }
      document.addEventListener('pointerup', event => {
        if (event.target.closest?.('#viewport,#tools,#groupList')) markChanged();
      }, true);
      document.addEventListener('change', event => {
        if (event.target.closest?.('#viewport,#tools,#groupList,#brushOptions,#brushIntensityOptions')) markChanged();
      }, true);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && pendingSave) void flush();
      });
      setInterval(() => {
        if (pendingSave) void flush();
      }, AUTOSAVE_MS);
      if (hasProject() && !lastWriteAt) markChanged();
    }
  }

  newButton?.addEventListener('click', () => void newProject());
  window.MosaicRecovery = {markChanged,markSaved,markLoaded,newProject,
    status:()=>({ready,dirty,pendingSave,lastWriteAt,owner})};
  void boot();
})();
