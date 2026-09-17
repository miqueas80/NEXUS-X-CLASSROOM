/* NEXUS-X CLASSROOM // MASTER 70
 * Causal ingestion + store-and-forward + resumable file fabric.
 * Additive layer: original UI remains untouched.
 */
(async()=>{
'use strict';
const X=await import('./nexus-fabric-70.mjs');
const F=await import('./nexus-fabric-50.mjs');
const DB='NEXUS_FABRIC_70',VER=1;
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=b=>{let s='';for(const x of new Uint8Array(b))s+=String.fromCharCode(x);return btoa(s)};
const ub64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const hash=async x=>b64(await crypto.subtle.digest('SHA-256',typeof x==='string'?enc.encode(x):x));
let dbp,identity,keys,frontier={},pending=new Map(),applied=new Map(),events=new Map(),seen=new Set(),peers=new Map(),files=new Map();
const listeners=new Map();const emit=(k,v)=>{for(const f of listeners.get(k)||[])try{f(v)}catch{};try{dispatchEvent(new CustomEvent('nexus70:'+k,{detail:v}))}catch{}};
const on=(k,f)=>{const s=listeners.get(k)||new Set();s.add(f);listeners.set(k,s);return()=>s.delete(f)};
function open(){return dbp||(dbp=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=()=>{const d=r.result;for(const [n,k] of [['events','id'],['pending','id'],['meta','key'],['peers','nodeId'],['files','id'],['chunks','key']])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:k})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}))}
async function put(s,v){const d=await open();return new Promise((ok,bad)=>{const t=d.transaction(s,'readwrite');t.objectStore(s).put(v);t.oncomplete=ok;t.onerror=()=>bad(t.error)})}
async function all(s){const d=await open();return new Promise((ok,bad)=>{const r=d.transaction(s).objectStore(s).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>bad(r.error)})}
async function get(s,k){const d=await open();return new Promise((ok,bad)=>{const r=d.transaction(s).objectStore(s).get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)})}
async function init(){const saved=await get('meta','identity');if(saved?.value){identity=saved.value.identity;keys=saved.value.keys}else{const kp=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const pub=await crypto.subtle.exportKey('jwk',kp.publicKey);identity={id:crypto.randomUUID(),label:'NEXUS-'+Math.random().toString(36).slice(2,7).toUpperCase()};keys={publicKey:pub,privateKey:kp.privateKey};await put('meta',{key:'identity',value:{identity,keys}})}
 const clock=await get('meta','clock');if(clock?.value)frontier=clock.value.frontier||{};applied=new Map(Object.entries(frontier));
 for(const e of await all('events')){events.set(e.id,e);seen.add(e.id)}
 for(const e of await all('pending'))pending.set(e.id,e);
 for(const p of await all('peers'))peers.set(p.nodeId,p);
 for(const f of await all('files'))files.set(f.id,f);
}
async function persistClock(){await put('meta',{key:'clock',value:{frontier}})}
async function sign(obj){return b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,enc.encode(F.canonical(obj))))}
async function verify(packet){try{if(!packet?.unsigned||!packet.signature||!packet.publicKey)return false;const pk=await crypto.subtle.importKey('jwk',packet.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pk,ub64(packet.signature),enc.encode(F.canonical(packet.unsigned)))}catch{return false}}
async function create(input={}){const node=identity.id;const next={...frontier,[node]:Number(frontier[node]||0)+1};const unsigned={protocol:F.PROTOCOL,schema:F.SCHEMA,id:crypto.randomUUID(),nodeId:node,vc:next,hlc:`${Date.now()}:${node.slice(0,8)}`,type:input.type||'EVENT',entityId:input.entityId||null,payload:input.payload??null};const packet={unsigned,publicKey:keys.publicKey,signature:await sign(unsigned)};packet.hash=await hash(F.canonical(unsigned));frontier=next;applied.set(node,next[node]);events.set(unsigned.id,packet);seen.add(unsigned.id);await put('events',{id:unsigned.id,...packet});await persistClock();emit('event.created',packet);return packet}
async function drain(){const batch=[...pending.values()].map(x=>x.unsigned);const d=X.causalDrain(batch,applied);for(const e of d.ready){const p=pending.get(e.id);if(!p)continue;pending.delete(e.id);events.set(e.id,p);seen.add(e.id);applied=new Map(Object.entries(d.frontier));frontier=F.vcMerge(frontier,e.vc);await put('events',{id:e.id,...p});const db=await open();await new Promise((ok,bad)=>{const t=db.transaction('pending','readwrite');t.objectStore('pending').delete(e.id);t.oncomplete=ok;t.onerror=()=>bad(t.error)});emit('event.applied',p)}
 for(const [id,p] of pending)await put('pending',{id,...p});await persistClock();return {applied:d.ready.length,pending:pending.size,frontier}}
async function accept(packet){const id=packet?.unsigned?.id;if(!id)return{ok:false,reason:'malformed'};if(seen.has(id))return{ok:true,duplicate:true};if(!(await verify(packet)))return{ok:false,reason:'signature'};const h=await hash(F.canonical(packet.unsigned));if(h!==packet.hash)return{ok:false,reason:'hash'};pending.set(id,packet);await put('pending',{id,...packet});const r=await drain();emit('event.received',{id,status:pending.has(id)?'waiting-causal':'applied'});return{ok:true,status:pending.has(id)?'pending':'applied',drain:r}}
async function relay(packet,from){return X.relayEnvelope({event:packet,from,origin:packet?.unsigned?.nodeId})}
async function acceptRelay(env){const r=X.acceptRelay(env,{nodeId:identity.id});if(!r.ok)return r;const a=await accept(r.forward.event);if(a.ok&&!a.duplicate)emit('relay.accepted',{origin:env.origin,eventId:r.forward.event.unsigned?.id||r.forward.event.id});return{...r,accepted:a}}
async function rememberPeer(p){if(!p?.nodeId)return false;peers.set(p.nodeId,p);await put('peers',p);return true}
async function beginFile(meta){const m=X.fileManifest(meta);files.set(m.id,{...m,received:[],complete:false});await put('files',{id:m.id,...files.get(m.id)});emit('file.manifest',m);return m}
async function receiveChunk({id,index,bytes,sha256:expected}={}){const f=files.get(id);if(!f)return{ok:false,reason:'manifest'};const raw=typeof bytes==='string'?ub64(bytes):new Uint8Array(bytes);const actual=await hash(raw);if(expected&&actual!==expected)return{ok:false,reason:'chunk-hash'};await put('chunks',{key:`${id}:${index}`,id,index,bytes:Array.from(raw),hash:actual});const set=new Set(f.received||[]);set.add(Number(index));f.received=[...set].sort((a,b)=>a-b);f.complete=f.received.length>=f.chunks;await put('files',{id,...f});emit('file.chunk',{id,index,complete:f.complete});return{ok:true,missing:X.missingChunks(f.chunks,f.received),complete:f.complete}}
function metrics(){return{version:'70.0-causal-store-forward',node:identity,events:events.size,pending:pending.size,frontier,peers:peers.size,files:files.size,capability:X.chooseRelayPeers([...peers.values()],{limit:1}).length?'relay-ready':'standalone'}}
window.NexusMaster70={version:'70.0',on,create,accept,relay,acceptRelay,rememberPeer,beginFile,receiveChunk,metrics,events:()=>[...events.values()],pending:()=>[...pending.values()],fileMissing:id=>{const f=files.get(id);return f?X.missingChunks(f.chunks,f.received):[]}};
await open();await init();await drain();emit('ready',metrics());
})().catch(e=>console.error('[NEXUS 70]',e));
