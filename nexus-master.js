/* RED NEXUS MASTER 31 — orchestration core. No UI replacement. */
(()=>{
'use strict';
const V='31.0-master', DBN='NEXUS_MASTER_FABRIC', DBV=2, NODE='nexus.node.v2';
const E=new Map(), emit=(k,v)=>{for(const f of E.get(k)||[])try{f(v)}catch(e){console.warn('[NEXUS]',e)}try{dispatchEvent(new CustomEvent('nexus:'+k,{detail:v}))}catch{}};
const on=(k,f)=>{const s=E.get(k)||new Set();s.add(f);E.set(k,s);return()=>s.delete(f)};
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now=()=>Date.now();
let identity; try{identity=JSON.parse(localStorage.getItem(NODE)||'null')}catch{}
if(!identity){identity={id:uid(),createdAt:now(),label:'NEXUS-'+Math.random().toString(36).slice(2,7).toUpperCase()};try{localStorage.setItem(NODE,JSON.stringify(identity))}catch{}}
let dbp;
function open(){return dbp||(dbp=new Promise((ok,bad)=>{if(!indexedDB)return bad(Error('IndexedDB no disponible'));const r=indexedDB.open(DBN,DBV);r.onupgradeneeded=()=>{const d=r.result; for(const [n,key] of [['events','id'],['documents','id'],['chunks','id'],['peers','id'],['meta','key']])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:key}); const s=d.objectStore('events'); if(s&& !s.indexNames.contains('status'))s.createIndex('status','status'); if(s&&!s.indexNames.contains('createdAt'))s.createIndex('createdAt','createdAt');};r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)}))}
async function put(store,v){const d=await open();return new Promise((ok,bad)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(v);t.oncomplete=()=>ok(v);t.onerror=()=>bad(t.error)})}
async function all(store){const d=await open();return new Promise((ok,bad)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>bad(r.error)})}
async function del(store,id){const d=await open();return new Promise((ok,bad)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(id);t.oncomplete=ok;t.onerror=()=>bad(t.error)})}
async function queue(kind,payload,classId=null){const x={id:uid(),nodeId:identity.id,kind,payload,classId,createdAt:now(),status:'pending',schema:1};await put('events',x);emit('queue',x);return x}
async function pending(){return (await all('events')).filter(x=>x.status==='pending').sort((a,b)=>a.createdAt-b.createdAt)}
async function ack(id,extra={}){const xs=await all('events'),x=xs.find(a=>a.id===id);if(!x)return false;await put('events',{...x,status:'acked',...extra});return true}
function caps(){return {online:navigator.onLine,secure:isSecureContext,indexedDB:!!indexedDB,opfs:!!navigator.storage?.getDirectory,sw:'serviceWorker'in navigator,webrtc:'RTCPeerConnection'in self,webgpu:!!navigator.gpu,webtransport:'WebTransport'in self,bluetooth:!!navigator.bluetooth,broadcast:'BroadcastChannel'in self,workers:'Worker'in self,streams:'ReadableStream'in self,memoryGB:navigator.deviceMemory||null,cores:navigator.hardwareConcurrency||null,native:!!window.NexusNative}}
async function opfsWrite(name,data){if(!navigator.storage?.getDirectory)throw Error('OPFS no disponible');const root=await navigator.storage.getDirectory();const h=await root.getFileHandle(name,{create:true});const w=await h.createWritable();await w.write(data);await w.close();return name}
async function opfsRead(name){if(!navigator.storage?.getDirectory)throw Error('OPFS no disponible');const root=await navigator.storage.getDirectory();const h=await root.getFileHandle(name);return h.getFile()}
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const toks=s=>[...new Set(norm(s).split(' ').filter(x=>x.length>2))];
function sim(q,t){const a=toks(q),b=toks(t);if(!a.length||!b.length)return 0;const bs=new Set(b);return a.reduce((n,x)=>n+(bs.has(x)?1:0),0)/Math.sqrt(a.length*b.length)}
async function indexDocument({id=uid(),classId=null,name='Documento',mime='text/plain',text=''}){const size=text.length;await put('documents',{id,classId,name,mime,size,updatedAt:now()});const old=(await all('chunks')).filter(x=>x.documentId===id);for(const x of old)await del('chunks',x.id);const step=1400, rows=[];for(let i=0,n=0;i<text.length;i+=step,n++){const c=text.slice(i,i+step).trim();if(c)rows.push({id:id+':'+n,documentId:id,classId,text:c,terms:toks(c),offset:i,createdAt:now()})}const d=await open();await new Promise((ok,bad)=>{const t=d.transaction('chunks','readwrite'),s=t.objectStore('chunks');rows.forEach(x=>s.put(x));t.oncomplete=ok;t.onerror=()=>bad(t.error)});await queue('knowledge.indexed',{documentId:id,chunks:rows.length},classId);return {id,chunks:rows.length}}
async function retrieve(q,classId=null,limit=8){const rows=await all('chunks');return rows.filter(x=>!classId||x.classId===classId).map(x=>({...x,score:sim(q,x.text)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit)}
async function grounded(q,classId=null){const hits=await retrieve(q,classId);return {grounded:hits.length>0,hits,context:hits.map((h,i)=>`[EVIDENCIA ${i+1}]\n${h.text}`).join('\n\n')}}
async function ai(){const c=caps();return c.webgpu?{mode:'local-webgpu',ready:true}:{mode:'local-rag',ready:true};}
async function route(){const c=caps();if(c.native&&typeof NexusNative.getStatus==='function')try{const s=await NexusNative.getStatus();if(s?.nearbyReady)return{transport:'nearby',offline:true}}catch{}if(c.webrtc&&c.online)return{transport:'webrtc',offline:false};if(c.webtransport&&c.online&&c.secure)return{transport:'webtransport',offline:false};if(c.broadcast)return{transport:'local-bus',offline:true};return{transport:'store-forward',offline:true}}
const channel=('BroadcastChannel'in self)?new BroadcastChannel('NEXUS_MASTER_BUS'):null;
function localSend(msg){if(channel)channel.postMessage({...msg,nodeId:identity.id,ts:now()});emit('bus',msg)}
if(channel)channel.onmessage=e=>{if(e.data?.nodeId!==identity.id)emit('peer-message',e.data)};
async function status(){return{version:V,identity,capabilities:caps(),route:await route(),ai:await ai(),pending:(await pending()).length}}
async function sync(){if(!navigator.onLine)return{ok:false,reason:'offline'};const q=await pending();emit('sync.ready',{count:q.length});return{ok:true,pending:q.length}}
addEventListener('online',()=>{emit('network.online',{at:now()});sync().catch(()=>{})});
addEventListener('offline',()=>emit('network.offline',{at:now()}));
window.NexusMaster={version:V,identity,on,emit,caps,route,status,queue,pending,ack,opfsWrite,opfsRead,indexDocument,retrieve,grounded,ai,localSend,sync,nativeContract:{required:['getStatus','startAdvertising','startDiscovery','send','sendFile','stop'],transport:'Google Nearby Connections'}};
open().then(()=>emit('ready',{version:V})).catch(e=>console.warn('[NEXUS MASTER] storage',e));
})();
