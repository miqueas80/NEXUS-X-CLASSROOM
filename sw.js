const CACHE='red-nexus-master-v100';
const CORE=['/','./index.html','./manifest.webmanifest','./nexus-master-50.js?v=60','./nexus-master-70.js?v=70','./nexus-master-100.js?v=100','./nexus-fabric-100.mjs','./nexus-ai-worker-50.js'];
const inject=async response=>{
  if(!response||!response.ok)return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  if(html.includes('nexus-master-100.js?v=100'))return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  const body=html.replace('</body>','<script src="/nexus-master-50.js?v=60"></script>\n<script src="/nexus-master-70.js?v=70"></script>\n<script type="module" src="/nexus-master-100.js?v=100"></script>\n</body>');
  return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});
};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async c=>{for(const u of CORE){try{const r=await fetch(u,{cache:'no-store'});if(r.ok)await c.put(u,r.clone())}catch{}}await self.skipWaiting()})));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(xs=>Promise.all(xs.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET'||r.url.includes('/api/')||r.url.includes('/ws'))return;
 if(r.mode==='navigate'){
  e.respondWith(fetch(r,{cache:'no-store'}).then(inject).then(async res=>{if(res?.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp)).catch(()=>{})}return res}).catch(async()=>inject(await caches.match('./index.html'))));return;
 }
 e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{if(res?.status===200){const cp=res.clone();caches.open(CACHE).then(x=>x.put(r,cp)).catch(()=>{})}return res}).catch(()=>caches.match('./index.html'))));
});
