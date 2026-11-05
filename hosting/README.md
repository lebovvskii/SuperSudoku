# Private SuperSudoku hosting

The zero-dependency PWA lives in the repository root. This adapter uses the supported Sites Vinext runtime to serve the same static frontend and a private Cloudflare D1 save API.

## Build

Use Node.js 24 (the SQLite-backed API tests use `node:sqlite`).

1. Install the locked hosting dependencies with `cd hosting && npm ci`.
2. From the root, run `node scripts/build-hosting.mjs`.
3. The deployable Worker, frontend assets and schema migrations are in `dist/`.

The root `npm run build` remains an independent static PWA build; it has local progress but no cloud API. Hosting-aware publication must use the hosted build. The build copies root frontend sources into ignored hosting files; do not edit `hosting/public/` or `hosting/app/game-shell.html`.

The existing `.openai/hosting.json` identifies the Site. Never register a second Site for this checkout. Runtime D1 binding is `DB`; Sites provisions it. There are no database passwords or API keys in the PWA.

## Privacy and synchronization

Keep the Site owner-private. Sites requires ChatGPT sign-in and injects the visitor identity. `GET /api/progress` and `PUT /api/progress` reject missing identity, scope every query to the user ID and set `Cache-Control: private, no-store`. PUT additionally requires a same-origin JSON request.

PUT accepts `{state, expectedRevision}`. The database performs an atomic compare-and-swap. A stale write returns HTTP 409 with the latest save; the client does not overwrite divergent progress without an explicit choice. The browser's IndexedDB/local backup remains the immediate source of truth while offline. API and authentication routes must not be cached by the service worker.

Cloud synchronization is a backup/convenience, not a replacement for exported JSON backups. Clearing browser data removes local/offline progress. Keep the Site and its D1 database if you want cloud progress to remain available. A source rollback does not roll back the database.

## Schema and tests

Edit `hosting/db/schema.ts`, then run `npm run db:generate` in `hosting/`. Schema-only migrations are appended under root `drizzle/`; preserve applied SQL and journal entries. The publication flow applies migrations before the new Worker.

From root run `npm test` for the game and API/client synchronization tests. `tests/progress-api.test.js` tests a real in-memory SQLite database through the D1-compatible API, including authentication, per-user isolation, stale writes and origin checks. `tests/sync.test.js` covers two-device conflicts, recovery and static/offline fallback.
