/*
 RED NEXUS // NEXUS-X CLASSROOM — MASTER 40
 Distributed local-first kernel. UI-agnostic by design.

 Guarantees sought by the kernel:
 - append-only/idempotent event log
 - hybrid logical clock + causal dependencies
 - signed node identity (WebCrypto ECDSA P-256)
 - deterministic state digest for anti-entropy
 - resumable content-addressed chunks
 - peer sync envelopes with deduplication
 - transport abstraction: Nearby/native, WebRTC, BroadcastChannel, server
 - offline queue/store-and-forward
 - local RAG bridge + optional WebLLM worker
 - capability/resource governor
*/
(()=>{
'use strict';
const VERSION='40.0-monster';
const DB='NEXUS_MASTER_FABRIC';
const DBV=4;
const IDKEY='nexus.master.identity.v40';
const TAB='nexus.master.tab.v40';
const CHUNK=192*1024;
const MAX_EVENT=128*1024;
const now=()=>Date.now();
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const enc=new TextEncoder(), dec=new TextDecoder();
const b64u=b=>{let s='';for(const x of new Uint8Array(b))s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const ub64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
const json=o=>JSON.stringify(o);
const sha256=async data=>{const b=typeof data==='string'?enc.encode(data):data;return b64u(await crypto.subtle.digest('SHA-256',b))};
const E=new Map();
function emit(k,v){for(const f of E.get(k)||[])try{f(v)}catch{};try{dispatchEvent(new CustomEvent('nexus:'+k,{detail:v}))}catch{}}
function on(k,f){const s=E.get(k)||new Set();s.add(f);E.set(k,s);return()=>s.delete(f)}
function uuidSet(){return new Set()}
let dbp;
function open(){return dbp||(dbp=new Promise((ok,bad)=>{const r=indexedDB.open(DB,DBV);r.onupgradeneeded=()=>{const d=r.result;
 for(const [n,key] of [['events','id'],['documents','id'],['chunks','id'],['peers','id'],['meta','key'],['seen','id'],['files','id']])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:key});
 const e=d.transaction.objectStore('events'); if(!e.indexNames.contains('status'))e.createIndex('status','status'); if(!e.indexNames.contains('classId'))e.createIndex('classId','classId'); if(!e.indexNames.contains('hlc'))e.createIndex('hlc','hlc');
 const c=d.transaction.objectStore('chunks'); if(!c.indexNames.contains('fileId'))c.createIndex('fileId','fileId');
};r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)}))}
async function tx(store,mode,fn){const d=await open();return new Promise((ok,bad)=>{const t=d.transaction(store,mode),s=t.objectStore(store);let out;try{out=fn(s,t)}catch(e){bad(e);return}t.oncomplete=()=>ok(out);t.onerror=()=>bad(t.error);t.onabort=()=>bad(t.error||Error('transaction aborted'))})}
async function put(store,v){return tx(store,'readwrite',s=>s.put(v))}
async function get(store,k){const d=await open();return new Promise((ok,bad)=>{const r=d.transaction(store).objectStore(store).get(k);r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error)})}
async function all(store){const d=await open();return new Promise((ok,bad)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>bad(r.error)})}
async function del(store,k){return tx(store,'readwrite',s=>s.delete(k))}

// ---- signed identity -----------------------------------------------------
let identity=null, keyPair=null;
async function identityLoad(){
 const saved=await get('meta','identity.v40');
 if(saved?.value?.id&&saved.value.publicKey&&saved.value.signingKey){
   identity={id:saved.value.id,label:saved.value.label,createdAt:saved.value.createdAt,publicKey:saved.value.publicKey,algorithm:'ECDSA-P256-SHA256'};
   keyPair={privateKey:saved.value.signingKey};return identity;
 }
 const kp=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const pub=await crypto.subtle.exportKey('jwk',kp.publicKey);
 identity={id:uid(),label:'NEXUS-'+Math.random().toString(36).slice(2,8).toUpperCase(),createdAt:now(),publicKey:pub,algorithm:'ECDSA-P256-SHA256'};
 keyPair={privateKey:kp.privateKey};
 await put('meta',{key:'identity.v40',value:{id:identity.id,label:identity.label,createdAt:identity.createdAt,publicKey:pub,signingKey:kp.privateKey}});
 try{localStorage.setItem(IDKEY,JSON.stringify({id:identity.id,label:identity.label,createdAt:identity.createdAt,publicKey:pub}))}catch{}
 return identity;
}
async function privateKey(){return keyPair.privateKey}
async function publicKey(jwk){return crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify'])}
async function signObject(o){const k=await privateKey();return b64u(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k,enc.encode(json(o))))}
async function verifyObject(o,sig,jwk){try{const k=await publicKey(jwk);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k,ub64(sig),enc.encode(json(o)))}catch{return false}}

// ---- hybrid logical clock / causal frontier -----------------------------
let clock={wall:0,logical:0};
async function loadClock(){clock=(await get('meta','clock'))?.value||clock}
async function tick(remote){const rw=remote?.wall||0, rl=remote?.logical||0,w=now();clock.wall=Math.max(w,clock.wall,rw);clock.logical=(clock.wall===rw&&clock.wall===w)?Math.max(clock.logical,rl)+1:(clock.wall===rw?Math.max(clock.logical,rl)+1:clock.logical+1);await put('meta',{key:'clock',value:clock});return `${clock.wall}:${String(clock.logical).padStart(6,'0')}`}
function cmpHlc(a,b){const [aw,al]=String(a||'0:0').split(':').map(Number),[bw,bl]=String(b||'0:0').split(':').map(Number);return aw-bw||al-bl}
let frontier=new Map();
async function loadFrontier(){frontier=new Map(Object.entries((await get('meta','frontier'))?.value||{}))}
async function saveFrontier(){await put('meta',{key:'frontier',value:Object.fromEntries(frontier)})}
function causalReady(e){for(const [n,v] of Object.entries(e.deps||{}))if((frontier.get(n)||'0:0')!==v)return false;return true}
function advanceFrontier(e){frontier.set(e.nodeId,e.hlc)}

// ---- event log -----------------------------------------------------------
function canonicalEvent(e){const {signature,publicKey,hash,...rest}=e;return rest}
async function eventHash(e){return sha256(json(canonicalEvent(e)))}
async function append(kind,payload,{classId=null,entityId=null,deps=null}={}){
 const payloadText=json(payload||{});if(payloadText.length>MAX_EVENT)throw Error('Evento demasiado grande');
 const hlc=await tick();const e={id:uid(),nodeId:identity.id,kind,payload,classId,entityId,deps:deps||Object.fromEntries(frontier),hlc,createdAt:now(),schema:40,status:'pending'};
 e.hash=await eventHash(e);e.signature=await signObject(e);await put('events',e);advanceFrontier(e);await saveFrontier();emit('event.appended',e);return e;
}
async function hasSeen(id){return !!(await get('seen',id))}
async function markSeen(e){await put('seen',{id:e.id,hash:e.hash,at:now(),nodeId:e.nodeId})}
async function acceptEvent(e){
 if(!e?.id||!e.nodeId||await hasSeen(e.id))return {ok:true,duplicate:true};
 if(!e.signature||!e.publicKey)return {ok:false,reason:'unsigned'};
 if(!(await verifyObject(canonicalEvent(e),e.signature,e.publicKey)))return {ok:false,reason:'bad-signature'};
 const expected=await eventHash(e);if(expected!==e.hash)return {ok:false,reason:'bad-hash'};
 await tick(parseHlc(e.hlc));await markSeen(e);await put('events',{...e,status:'remote'});advanceFrontier(e);await saveFrontier();emit('event.accepted',e);return {ok:true};
}
function parseHlc(s){const [wall,logical]=String(s||'0:0').split(':').map(Number);return {wall:wall||0,logical:logical||0}}
async function pending(){return (await all('events')).filter(e=>e.status==='pending').sort((a,b)=>cmpHlc(a.hlc,b.hlc))}
async function ack(id){const e=await get('events',id);if(!e)return false;e.status='acked';await put('events',e);return true}

// ---- deterministic materialized state -----------------------------------
const conflictKey=e=>`${e.classId||'global'}:${e.entityId||e.id}`;
function lww(a,b){if(!a)return b;if(!b)return a;const c=cmpHlc(a.hlc,b.hlc);return c<0?b:c>0?a:(a.nodeId<b.nodeId?b:a)}
async function materialize(classId=null){
 const es=(await all('events')).filter(e=>!classId||e.classId===classId);
 const state={entities:new Map(),lastHlc:'0:0',events:es.length};
 for(const e of es){state.lastHlc=lww({hlc:state.lastHlc,nodeId:''},{hlc:e.hlc,nodeId:e.nodeId}).hlc;const k=conflictKey(e);const prev=state.entities.get(k);const winner=lww(prev,e);if(winner===e)state.entities.set(k,e)}
 return {events:state.events,lastHlc:state.lastHlc,entities:[...state.entities.values()]};
}
async function digest(classId=null){const m=await materialize(classId);return sha256(json(m.entities.map(e=>({id:e.id,hash:e.hash,hlc:e.hlc})).sort((a,b)=>a.id.localeCompare(b.id))))}

// ---- content-addressed files / resumable transfer -----------------------
async function hashBlob(blob){return sha256(await blob.arrayBuffer())}
async function beginFile(file,{classId=null,name=file.name,mime=file.type||'application/octet-stream'}={}){
 const hash=await hashBlob(file), id=`file:${hash}`;const meta={id,hash,classId,name,mime,size:file.size,chunkSize:CHUNK,chunks:Math.ceil(file.size/CHUNK),createdAt:now(),complete:false};await put('files',meta);return meta;
}
async function putChunk(fileId,index,data){const buf=data instanceof ArrayBuffer?data:data.buffer||data;await put('chunks',{id:`${fileId}:${index}`,fileId,index,size:buf.byteLength,hash:await sha256(buf),data:buf});const f=await get('files',fileId);if(f){const got=(await all('chunks')).filter(x=>x.fileId===fileId).length;f.complete=got>=f.chunks;await put('files',f)}return true}
async function getChunk(fileId,index){return get('chunks',`${fileId}:${index}`)}
async function fileStatus(fileId){const f=await get('files',fileId);if(!f)return null;const cs=(await all('chunks')).filter(x=>x.fileId===fileId).map(x=>x.index).sort((a,b)=>a-b);return {...f,received:cs.length,missing:Array.from({length:f.chunks},(_,i)=>i).filter(i=>!cs.includes(i))}}
async function assembleFile(fileId){const f=await get('files',fileId);if(!f)throw Error('archivo inexistente');const s=await fileStatus(fileId);if(!s.complete)throw Error(`faltan ${s.missing.length} fragmentos`);const parts=[];for(let i=0;i<f.chunks;i++)parts.push((await getChunk(fileId,i)).data);const blob=new Blob(parts,{type:f.mime});if(await hashBlob(blob)!==f.hash)throw Error('integridad de archivo inválida');return new File([blob],f.name,{type:f.mime})}

// ---- anti-entropy sync protocol -----------------------------------------
function envelope(type,payload){return {protocol:'NEXUS/40',type,from:identity.id,ts:now(),payload}}
async function makeHello(){return envelope('HELLO',{node:{id:identity.id,label:identity.label,publicKey:identity.publicKey},frontier:Object.fromEntries(frontier),digest:await digest()})}
async function makeSyncRequest(){return envelope('SYNC_REQUEST',{frontier:Object.fromEntries(frontier),digest:await digest(),want:'events'})}
async function makeSyncBatch(limit=64){const p=await pending();const events=p.slice(0,limit).map(e=>({...e,publicKey:identity.publicKey}));return envelope('SYNC_BATCH',{events,frontier:Object.fromEntries(frontier),digest:await digest()})}
async function receiveEnvelope(msg){if(!msg||msg.protocol!=='NEXUS/40')return {ok:false,reason:'protocol'};emit('protocol.in',msg);switch(msg.type){
 case 'HELLO': return {ok:true,reply:await makeSyncRequest()};
 case 'SYNC_REQUEST': return {ok:true,reply:await makeSyncBatch()};
 case 'SYNC_BATCH': {let accepted=0,duplicates=0,rejected=0;for(const e of msg.payload?.events||[]){const r=await acceptEvent(e);if(r.ok&&!r.duplicate)accepted++;else if(r.duplicate)duplicates++;else rejected++}return {ok:true,accepted,duplicates,rejected,digest:await digest()};}
 case 'PING': return {ok:true,reply:envelope('PONG',{t:now()})};
 default:return {ok:false,reason:'unknown-type'};
}}

// ---- transports ----------------------------------------------------------
const channel='BroadcastChannel'in self?new BroadcastChannel(TAB):null;
const peers=new Map();
function busSend(msg){channel?.postMessage(msg);emit('transport.out',{transport:'broadcast',msg})}
if(channel)channel.onmessage=async e=>{if(e.data?.from===identity?.id)return;emit('transport.in',{transport:'broadcast',msg:e.data});try{const r=await receiveEnvelope(e.data);if(r.reply)busSend(r.reply)}catch(err){emit('error',{scope:'broadcast',error:String(err)})}};
function native(){return window.NexusNative&&typeof window.NexusNative.getStatus==='function'?window.NexusNative:null}
function bindNativeEvents(){
 if(window.__nexusNative40)return;window.__nexusNative40=true;
 addEventListener('nexus:native:payload',async e=>{try{const b=atob(e.detail?.base64||'');const u=Uint8Array.from(b,c=>c.charCodeAt(0));const msg=JSON.parse(dec.decode(u));emit('transport.in',{transport:'nearby',msg,endpointId:e.detail?.endpointId});const r=await receiveEnvelope(msg);if(r.reply&&e.detail?.endpointId){const raw=enc.encode(json(r.reply));let out='';for(const x of raw)out+=String.fromCharCode(x);native()?.sendBase64(e.detail.endpointId,btoa(out))}}catch(err){emit('error',{scope:'nearby.payload',error:String(err)})}});
 addEventListener('nexus:native:connection_request',e=>emit('trust.request',e.detail));
 addEventListener('nexus:native:found',e=>emit('peer.found',e.detail));
}
async function transportStatus(){const n=native();let ns=null;try{ns=n?await n.getStatus():null}catch{};return {nearby:!!ns?.nearbyReady,webrtc:!!self.RTCPeerConnection,webtransport:'WebTransport'in self,broadcast:!!channel,online:navigator.onLine}}
async function broadcastSync(){busSend(await makeHello());busSend(await makeSyncRequest());busSend(await makeSyncBatch());return {transport:'broadcast',ok:true}}
async function nativeSend(msg){const n=native();if(!n)throw Error('native bridge no disponible');return n.send(JSON.stringify(msg))}
async function sync(){const s=await transportStatus();if(s.nearby)return nativeSend(await makeHello()).then(()=>({transport:'nearby',ok:true}));if(s.online&&'WebTransport'in self){emit('sync.decision',{preferred:'webtransport',note:'adapter reserved'});}
 if(s.broadcast)return broadcastSync();return {ok:false,reason:'no-local-transport'}}

// ---- resource governor ---------------------------------------------------
function resources(){const c=navigator.hardwareConcurrency||2,m=navigator.deviceMemory||2;return {cores:c,memoryGB:m,saveData:!!navigator.connection?.saveData,effectiveType:navigator.connection?.effectiveType||null,profile:c>=8&&m>=8?'X':c>=4&&m>=4?'H':c>=4?'M':'L',conservative:!!navigator.connection?.saveData||m<3}}
let aiWorker=null,aiSeq=0,aiPending=new Map();
function ai(){
 if(aiWorker)return {mode:'webllm-worker',ready:true};
 if('gpu'in navigator)return {mode:'webgpu-ready',ready:false};
 return {mode:'rag-only',ready:true};
}
function startAIWorker(){if(aiWorker||!window.Worker)return false;aiWorker=new Worker('/nexus-ai-worker-40.js',{type:'module'});aiWorker.onmessage=e=>{const m=e.data;if(m.id&&aiPending.has(m.id)){const p=aiPending.get(m.id);aiPending.delete(m.id);m.ok?p.resolve(m):p.reject(Error(m.error||'AI worker error'))}emit('ai.message',m)};return true}
function askAI(messages,opts={}){startAIWorker();if(!aiWorker)return Promise.reject(Error('AI worker unavailable'));const id=++aiSeq;return new Promise((resolve,reject)=>{aiPending.set(id,{resolve,reject});aiWorker.postMessage({id,type:'chat',messages,opts})})}

// ---- public kernel -------------------------------------------------------
async function status(){return {version:VERSION,identity:{id:identity.id,label:identity.label,createdAt:identity.createdAt,publicKey:identity.publicKey},clock,frontier:Object.fromEntries(frontier),capabilities:{secure:isSecureContext,indexedDB:!!indexedDB,opfs:!!navigator.storage?.getDirectory,webgpu:'gpu'in navigator,webrtc:'RTCPeerConnection'in self,webtransport:'WebTransport'in self,workers:'Worker'in self,nearby:!!native()},transport:await transportStatus(),resources:resources(),ai:ai(),pending:(await pending()).length,digest:await digest()}}
async function boot(){await open();await identityLoad();bindNativeEvents();await loadClock();await loadFrontier();emit('ready',await status());setTimeout(()=>sync().catch(()=>{}),1200)}
window.NexusMaster={version:VERSION,on,emit,status,identity:()=>identity,append,pending,ack,acceptEvent,materialize,digest,beginFile,putChunk,getChunk,fileStatus,assembleFile,makeHello,makeSyncRequest,makeSyncBatch,receiveEnvelope,transportStatus,sync,broadcastSync,resources,ai,startAIWorker,askAI,hashBlob,constants:{CHUNK,MAX_EVENT}};
addEventListener('online',()=>{emit('network.online',{});sync().catch(()=>{})});
addEventListener('offline',()=>emit('network.offline',{}));
boot().catch(e=>emit('error',{scope:'boot',error:String(e)}));
})();
