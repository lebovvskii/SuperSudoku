import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCloudSync } from '../src/sync.js';
import { handleProgress } from '../hosting/lib/progress-api.mjs';
function save(value = 0) {
  return { version: 1, updatedAt: '2026-11-05T00:00:00Z', profile: { wins: {}, history: [], completedIds: [] }, settings: { theme: 'light' }, game: { id: 'a', levelId: 'easy', givens: Array(81).fill(0), entries: Array(81).fill(value), notes: Array.from({ length: 81 }, () => []), mistakes: 0, elapsedMs: 0, status: 'playing' } };
}
function memoryStore() {
  const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}
function environment() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sudoku_progress (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)');
  const env = { DB: { prepare(sql) { return { bind(...values) { return { async first() { return db.prepare(sql).get(...values) || null; } }; } }; } } };
  globalThis.fetch = (_url, options) => handleProgress(new Request('https://test.chatgpt.site/api/progress', { ...options, headers: { ...options.headers, Origin: 'https://test.chatgpt.site', 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@test.example' } }), env);
}
function client(initial) {
  let state = structuredClone(initial); const statuses = []; const storage = memoryStore(); globalThis.localStorage = storage;
  const sync = createCloudSync({ getState: () => state, applyState: next => { state = next; }, onStatus: status => statuses.push(status.status) });
  return { storage, sync, statuses, get state() { return state; }, set state(value) { state = value; }, activate() { globalThis.localStorage = storage; } };
}
test('first device persists and a fresh device retrieves private cloud progress', async () => {
  environment(); const a = client(save(1)); await a.sync.start(); assert.equal(a.statuses.at(-1), 'saved');
  const b = client(save()); await b.sync.start(); assert.equal(b.state.game.entries[0], 1); assert.equal(b.statuses.at(-1), 'saved'); a.sync.stop(); b.sync.stop();
});
test('diverging devices conflict until an explicit local choice', async () => {
  environment(); const a = client(save(1)); await a.sync.start(); const b = client(save()); await b.sync.start();
  a.activate(); a.state = save(2); await a.sync.flush();
  b.activate(); b.state = save(3); await b.sync.flush(); assert.equal(b.statuses.at(-1), 'conflict'); assert.equal(b.sync.exportCloudState().game.entries[0], 2);
  await b.sync.resolveConflict('local'); assert.equal(b.statuses.at(-1), 'saved');
  a.activate(); await a.sync.flush(); assert.equal(a.state.game.entries[0], 3); a.sync.stop(); b.sync.stop();
});
test('explicit cloud choice keeps a local backup', async () => {
  environment(); const a = client(save(1)); await a.sync.start(); const b = client(save(2)); await b.sync.start(); assert.equal(b.statuses.at(-1), 'conflict');
  await b.sync.resolveConflict('cloud'); assert.equal(b.state.game.entries[0], 1); assert.ok(b.storage.getItem('supersudoku:before-cloud-choice:v1')); a.sync.stop(); b.sync.stop();
});
test('plain static hosting stays local without a pretend successful cloud save', async () => {
  globalThis.fetch = async () => new Response('Not found', { status: 404 });
  const a = client(save(1)); await a.sync.start(); assert.equal(a.statuses.at(-1), 'local'); a.sync.stop();
});
test('unavailable cloud preserves offline progress', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const a = client(save(4)); await a.sync.start(); assert.equal(a.statuses.at(-1), 'error'); assert.equal(a.state.game.entries[0], 4); a.sync.stop();
});
test('a ticking local clock alone does not conflict with meaningful progress elsewhere', async () => {
  environment(); const a = client(save(1)); await a.sync.start(); const b = client(save()); await b.sync.start();
  a.activate(); a.state = save(2); await a.sync.flush();
  b.activate(); b.state.game.elapsedMs = 15000; await b.sync.flush();
  assert.equal(b.statuses.at(-1), 'saved'); assert.equal(b.state.game.entries[0], 2); a.sync.stop(); b.sync.stop();
});
