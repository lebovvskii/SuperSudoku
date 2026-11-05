import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hosting = resolve(root, 'hosting');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
// The frontend build is dependency-free and is also suitable for other hosts.
run(process.execPath, ['scripts/build.mjs']);
const source = resolve(root, 'dist');
if (!existsSync(resolve(source, 'index.html'))) throw new Error('Static build must produce dist/index.html');
rmSync(resolve(hosting, 'public'), { recursive: true, force: true });
cpSync(source, resolve(hosting, 'public'), { recursive: true });
cpSync(resolve(source, 'index.html'), resolve(hosting, 'app/game-shell.html'));
cpSync(resolve(root, '.openai/hosting.json'), resolve(hosting, '.openai/hosting.json'));
// The maintained Sites builder preserves platform bindings and artifact metadata.
const helper = process.env.SITES_BUILD_HELPER;
if (helper) run(process.execPath, [helper], hosting);
else run('npm', ['run', 'build'], hosting);
rmSync(source, { recursive: true, force: true });
cpSync(resolve(hosting, 'dist'), source, { recursive: true });
mkdirSync(resolve(source, '.openai'), { recursive: true });
cpSync(resolve(root, '.openai/hosting.json'), resolve(source, '.openai/hosting.json'));
if (existsSync(resolve(root, 'drizzle'))) cpSync(resolve(root, 'drizzle'), resolve(source, '.openai/drizzle'), { recursive: true });
console.log('Private Sites artifact built in dist/ with D1 migrations.');
