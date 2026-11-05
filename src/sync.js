/** Offline-first sync. Saves are private and guarded by compare-and-swap revisions. */
const META_KEY = 'supersudoku:cloud-sync:v1';
const BACKUP_KEY = 'supersudoku:before-cloud-choice:v1';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'updatedAt').map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = state => JSON.stringify(canonical(state));
function progressFingerprint(state) {
  const value = canonical(state);
  if (value?.game) delete value.game.elapsedMs;
  return JSON.stringify(value);
}
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function meaningful(state) {
  const game = state?.game;
  return Boolean(state?.profile?.history?.length || state?.profile?.completedIds?.length || Object.values(state?.profile?.wins || {}).some(Number)
    || game?.entries?.some(Number) || game?.notes?.some(notes => notes.length) || game?.mistakes || (game && game.status !== 'playing'));
}
export function createCloudSync({ getState, applyState, onStatus = () => {} }) {
  let meta = null, conflict = null, timer = null, interval = null, inFlight = null;
  let started = false, unavailable = false, destroyed = false, requested = false;
  try { meta = JSON.parse(localStorage.getItem(META_KEY)); } catch {}
  if (!meta || !Number.isSafeInteger(meta.revision) || typeof meta.fingerprint !== 'string') meta = null;
  if (meta && !meta.progressFingerprint) {
    try { meta.progressFingerprint = progressFingerprint(JSON.parse(meta.fingerprint)); } catch { meta = null; }
  }
  const report = (status, message) => { if (!destroyed) onStatus({ status, ...(message ? { message } : {}) }); };
  const mark = (state, revision) => {
    meta = { fingerprint: fingerprint(state), progressFingerprint: progressFingerprint(state), revision };
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
  };
  const showConflict = remote => {
    conflict = clone(remote);
    report('conflict', 'На другом устройстве есть другой прогресс. Выберите, какую версию оставить.');
  };
  async function api(method = 'GET', body) {
    const response = await fetch('/api/progress', {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404 || response.status === 405) {
      unavailable = true;
      report('local', 'Прогресс сохранён на этом устройстве.');
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      report('local', 'Войдите в ChatGPT на этом сайте, чтобы синхронизировать прогресс.');
      return null;
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      report('local', 'Прогресс сохранён на устройстве. Для синхронизации откройте сайт онлайн.');
      return null;
    }
    const value = await response.json();
    if (response.status === 409) return { ...value, conflict: true };
    if (!response.ok) throw new Error('cloud_save_failed');
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('invalid_cloud_response');
    return value;
  }
  async function put(local, expectedRevision) {
    const result = await api('PUT', { state: local, expectedRevision });
    if (!result) return;
    if (result.conflict) { showConflict(result); return; }
    mark(local, result.revision);
    if (fingerprint(getState()) !== meta.fingerprint) { requested = true; schedule(); }
    else report('saved');
  }
  async function reconcile() {
    if (destroyed || unavailable || conflict) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { report('offline'); return; }
    report('syncing');
    try {
      const remote = await api();
      if (!remote) return;
      const local = clone(getState());
      const localHash = fingerprint(local);
      if (!remote.state) { await put(local, 0); return; }
      const remoteHash = fingerprint(remote.state);
      const localProgress = progressFingerprint(local);
      const remoteProgress = progressFingerprint(remote.state);
      if (localHash === remoteHash) { mark(local, remote.revision); report('saved'); return; }
      // A ticking clock alone is not divergent gameplay. Keep the longer clock
      // when the actual board, notes, history, and settings are identical.
      if (localProgress === remoteProgress) {
        if ((local.game?.elapsedMs || 0) >= (remote.state.game?.elapsedMs || 0)) await put(local, remote.revision);
        else { await applyState(clone(remote.state)); mark(remote.state, remote.revision); report('saved'); }
        return;
      }
      if ((meta && localProgress === meta.progressFingerprint) || (!meta && !meaningful(local))) {
        await applyState(clone(remote.state));
        mark(remote.state, remote.revision);
        report('saved');
        return;
      }
      if (meta && remoteProgress === meta.progressFingerprint) { await put(local, remote.revision); return; }
      showConflict(remote);
    } catch {
      report(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', 'Облако временно недоступно. Игра и прогресс сохранены на устройстве.');
    }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!started || destroyed || unavailable) return;
    if (inFlight) { requested = true; return inFlight; }
    requested = false;
    inFlight = reconcile();
    try { await inFlight; } finally {
      inFlight = null;
      if (requested && !conflict && !destroyed && !unavailable) schedule();
    }
  }
  function schedule() {
    if (destroyed || unavailable) return;
    requested = true;
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 1200);
  }
  const onOnline = () => { void flush(); };
  const onOffline = () => report('offline');
  const onVisible = () => { if (document.visibilityState === 'visible') void flush(); };
  async function start() {
    if (started || destroyed) return;
    started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisible);
      interval = setInterval(() => { if (document.visibilityState === 'visible') void flush(); }, 60000);
    }
    await flush();
  }
  async function resolveConflict(choice) {
    if (!conflict || !['local', 'cloud'].includes(choice) || inFlight) return;
    const observed = conflict;
    report('syncing');
    try {
      if (choice === 'local') {
        // Only replace the exact cloud revision the user saw; a newer save conflicts again.
        const local = clone(getState());
        const result = await api('PUT', { state: local, expectedRevision: observed.revision });
        if (!result) { showConflict(observed); return; }
        if (result.conflict) { showConflict(result); return; }
        conflict = null;
        mark(local, result.revision);
      } else {
        const newest = await api();
        if (!newest?.state) { showConflict(observed); return; }
        try { localStorage.setItem(BACKUP_KEY, JSON.stringify(getState())); } catch {}
        await applyState(clone(newest.state));
        conflict = null;
        mark(newest.state, newest.revision);
      }
      report('saved');
      if (fingerprint(getState()) !== meta.fingerprint) schedule();
    } catch {
      showConflict(observed);
    }
  }
  function stop() {
    destroyed = true;
    clearTimeout(timer); clearInterval(interval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    }
  }
  return { start, schedule, flush, resolveConflict, stop, exportCloudState: () => clone(conflict?.state || null) };
}
