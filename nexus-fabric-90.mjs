/* NEXUS-X CLASSROOM // FABRIC 90 — DISTRIBUTED FILE FABRIC
 * Deterministic content-addressed manifests, chunking, resumable exchange,
 * integrity checks and missing-chunk planning. Runtime-agnostic core.
 */
import {createHash} from 'node:crypto';
export const PROTOCOL='NEXUS/FABRIC-90';
export const SCHEMA=90;
export const DEFAULT_CHUNK_SIZE=24*1024;

function bytes(x){return x instanceof Uint8Array?x:new Uint8Array(x)}
export function sha256(data){return createHash('sha256').update(bytes(data)).digest('hex')}
export function chunkBytes(data,size=DEFAULT_CHUNK_SIZE){const b=bytes(data),out=[];for(let i=0;i<b.length;i+=size)out.push(b.slice(i,Math.min(i+size,b.length)));return out}
export function makeManifest({name='',mime='application/octet-stream',size=0,chunkSize=DEFAULT_CHUNK_SIZE,chunks=[],fileHash=null}={}){return {protocol:PROTOCOL,schema:SCHEMA,name,mime,size,chunkSize,chunks:chunks.map((hash,i)=>({index:i,hash})),fileHash}}
export function manifestFor(data,meta={}){const b=bytes(data),cs=meta.chunkSize||DEFAULT_CHUNK_SIZE,c=chunkBytes(b,cs);return makeManifest({name:meta.name||'',mime:meta.mime||'application/octet-stream',size:b.length,chunkSize:cs,chunks:c.map(sha256),fileHash:sha256(b)})}
export function verifyChunk(data,expected){return sha256(data)===expected}
export function missingChunks(manifest,have){const set=new Set(have);return manifest.chunks.filter(c=>!set.has(c.hash)).map(c=>c.index)}
export function validateManifest(m){if(!m||m.protocol!==PROTOCOL||m.schema!==SCHEMA)return {ok:false,reason:'manifest-protocol'};if(!Number.isInteger(m.size)||m.size<0)return {ok:false,reason:'manifest-size'};if(!Number.isInteger(m.chunkSize)||m.chunkSize<1)return {ok:false,reason:'manifest-chunk-size'};if(!Array.isArray(m.chunks))return {ok:false,reason:'manifest-chunks'};if(m.size===0&&m.chunks.length)return {ok:false,reason:'manifest-empty'};for(let i=0;i<m.chunks.length;i++)if(m.chunks[i]?.index!==i||typeof m.chunks[i]?.hash!=='string')return {ok:false,reason:'manifest-index'};return {ok:true}}
export function assemble(manifest,store){const v=validateManifest(manifest);if(!v.ok)return {ok:false,reason:v.reason};const parts=[];for(const c of manifest.chunks){const d=store.get(c.hash);if(!d)return {ok:false,reason:'missing-chunk',index:c.index};if(!verifyChunk(d,c.hash))return {ok:false,reason:'chunk-integrity',index:c.index};parts.push(bytes(d))}const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length}if(out.length!==manifest.size)return {ok:false,reason:'size-mismatch'};if(manifest.fileHash&&sha256(out)!==manifest.fileHash)return {ok:false,reason:'file-integrity'};return {ok:true,data:out}}
export function planTransfer(manifest,store,availableHashes=[]){const have=new Set([...store.keys(),...availableHashes]);return manifest.chunks.filter(c=>!have.has(c.hash)).map(c=>({index:c.index,hash:c.hash,bytes:manifest.chunkSize}))}
export function putChunk(store,data){const d=bytes(data),hash=sha256(d);store.set(hash,d.slice());return {hash,size:d.length}}
export function serializeRequest(manifest,missing){return {protocol:PROTOCOL,schema:SCHEMA,fileHash:manifest.fileHash,missing:[...missing]}}
export function applyChunk(store,chunk,expected){if(!verifyChunk(chunk,expected))return false;store.set(expected,bytes(chunk).slice());return true}
