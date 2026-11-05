import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleProgress, validState } from '../hosting/lib/progress-api.mjs';
function state(entry = 0) {
  return { version: 1, profile: { wins: {}, history: [], completedIds: [] }, settings: { theme: 'light' }, game: { id: 'test', levelId: 'easy', givens: Array(81).fill(0), entries: Array(81).fill(entry), notes: Array.from({ length: 81 }, () => []), mistakes: 0, elapsedMs: 0, status: 'playing' } };
}
function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE sudoku_progress (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)');
  return { DB: { prepare(sql) { return { bind(...values) { return { async first() { return sqlite.prepare(sql).get(...values) || null; } }; } }; } } };
}
function request(method = 'GET', user = 'owner', data, headers = {}) {
  return new Request('https://test.chatgpt.site/api/progress', { method, headers: { ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } : {}), ...(data ? { Origin: 'https://test.chatgpt.site', 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
test('anonymous requests cannot read or write', async () => {
  for (const method of ['GET', 'PUT']) assert.equal((await handleProgress(request(method, null), db())).status, 401);
});
test('save is persistent, per-user, and private/no-store', async () => {
  const env = db();
  const response = await handleProgress(request('PUT', 'owner', { expectedRevision: 0, state: state() }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).revision, 1);
  const owner = await handleProgress(request(), env);
  assert.match(owner.headers.get('cache-control'), /no-store/);
  assert.equal((await owner.json()).revision, 1);
  assert.equal((await (await handleProgress(request('GET', 'other'), env)).json()).state, null);
});
test('compare-and-swap refuses stale writes without losing existing data', async () => {
  const env = db();
  await handleProgress(request('PUT', 'owner', { expectedRevision: 0, state: state() }), env);
  const good = await handleProgress(request('PUT', 'owner', { expectedRevision: 1, state: state(1) }), env);
  assert.equal((await good.json()).revision, 2);
  const stale = await handleProgress(request('PUT', 'owner', { expectedRevision: 1, state: state(2) }), env);
  assert.equal(stale.status, 409);
  const latest = await stale.json(); assert.equal(latest.revision, 2); assert.equal(latest.state.game.entries[0], 1);
  assert.equal((await handleProgress(request('PUT', 'owner', { expectedRevision: 0, state: state(3) }), env)).status, 409);
});
test('cross-origin writes and invalid saves are rejected', async () => {
  const env = db();
  assert.equal((await handleProgress(request('PUT', 'owner', { expectedRevision: 0, state: state() }, { Origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await handleProgress(request('PUT', 'owner', { expectedRevision: 0, state: {} }), env)).status, 400);
  assert.equal(validState({ ...state(), game: { ...state().game, mistakes: 4 } }), false);
});
test('a missing database fails closed without reflecting internals', async () => {
  const response = await handleProgress(request(), {});
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'storage_unavailable' });
});
