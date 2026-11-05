const CACHE='supersudoku-shell-v1';
const SHELL=['./','./index.html','./styles.css','./src/app.js','./src/engine.js','./src/puzzles.js','./src/storage.js','./src/sync.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('supersudoku-shell-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/')||url.pathname.includes('/_auth/')||url.pathname.includes('/cdn-cgi/')||['/signin-with-chatgpt','/signout-with-chatgpt','/callback'].includes(url.pathname))return;
 const known=SHELL.map(p=>new URL(p,self.registration.scope).pathname).includes(url.pathname);
 if(event.request.mode==='navigate'){
   event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./',self.registration.scope))));return;
 }
 if(known)event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||fetch(event.request)));
});
