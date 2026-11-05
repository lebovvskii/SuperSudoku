/** Private D1 save API. Identity is provided and authenticated by Sites dispatch. */
const MAX_BYTES = 512 * 1024;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers }); }
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digit = value => Number.isInteger(value) && value >= 0 && value <= 9;
const grid = value => Array.isArray(value) && value.length === 81 && value.every(digit);
export function validState(state) {
  if (!object(state) || state.version !== 1 || !object(state.profile) || !object(state.settings)) return false;
  if (!object(state.profile.wins) || !Array.isArray(state.profile.history) || state.profile.history.length > 10000 || !Array.isArray(state.profile.completedIds) || state.profile.completedIds.length > 10000) return false;
  if (state.game === null) return true;
  const g = state.game;
  return object(g) && typeof g.id === 'string' && g.id.length <= 200 && typeof g.levelId === 'string' && g.levelId.length <= 100 && grid(g.givens) && grid(g.entries)
    && Array.isArray(g.notes) && g.notes.length === 81 && g.notes.every(n => Array.isArray(n) && n.length <= 9 && n.every(d => Number.isInteger(d) && d >= 1 && d <= 9))
    && Number.isInteger(g.mistakes) && g.mistakes >= 0 && g.mistakes <= 3
    && Number.isFinite(g.elapsedMs) && g.elapsedMs >= 0 && ['playing', 'won', 'lost'].includes(g.status);
}
function snapshot(row) {
  return row ? { state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at } : { state: null, revision: 0, updatedAt: null };
}
export async function handleProgress(request, env, now = () => new Date().toISOString()) {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!userId || !email) return json({ error: 'authentication_required' }, 401);
  if (!env.DB) return json({ error: 'storage_unavailable' }, 503);
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
  try {
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT state_json, revision, updated_at FROM sudoku_progress WHERE user_id = ?').bind(userId).first();
      return json(snapshot(row));
    }
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'invalid_origin' }, 403);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'json_required' }, 415);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BYTES) return json({ error: 'save_too_large' }, 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return json({ error: 'save_too_large' }, 413);
    let payload;
    try { payload = JSON.parse(text); } catch { return json({ error: 'invalid_json' }, 400); }
    if (!object(payload) || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 || !validState(payload.state)) return json({ error: 'invalid_save' }, 400);
    const updatedAt = now();
    const stateJson = JSON.stringify(payload.state);
    let saved;
    if (payload.expectedRevision === 0) {
      saved = await env.DB.prepare('INSERT INTO sudoku_progress (user_id, state_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING RETURNING revision, updated_at')
        .bind(userId, stateJson, updatedAt).first();
    } else {
      saved = await env.DB.prepare('UPDATE sudoku_progress SET state_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ? RETURNING revision, updated_at')
        .bind(stateJson, updatedAt, userId, payload.expectedRevision).first();
    }
    if (!saved) {
      const latest = await env.DB.prepare('SELECT state_json, revision, updated_at FROM sudoku_progress WHERE user_id = ?').bind(userId).first();
      return json({ error: 'conflict', ...snapshot(latest) }, 409);
    }
    return json({ revision: saved.revision, updatedAt: saved.updated_at });
  } catch {
    // Do not put state, SQL errors, identities, or internal details in responses.
    return json({ error: 'storage_unavailable' }, 503);
  }
}
