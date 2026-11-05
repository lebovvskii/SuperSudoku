import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
for (const path of ['index.html','styles.css','src','icons','sw.js','manifest.webmanifest']) await cp(path, `dist/${path}`, {recursive:true});
console.log('Static PWA built in dist/');
