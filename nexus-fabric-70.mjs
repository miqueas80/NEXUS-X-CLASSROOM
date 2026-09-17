/* NEXUS-X CLASSROOM // FABRIC 70 — CAUSAL + STORE/FORWARD FABRIC
 * Deterministic primitives for out-of-order ingestion, relay envelopes,
 * resumable content-addressed files and explicit conflict materialization.
 */
import * as F from './nexus-fabric-50.mjs';
import * as T from './nexus-fabric-60.mjs';
export const PROTOCOL='NEXUS/FABRIC-70';
export const SCHEMA=70;
export const MAX_HOPS=8;
export const DEFAULT_TTL=120;

export function causalReady(event, applied={}){
  const v=F.vcNormalize(event?.vc||event?.unsigned?.vc||{});
  for(const [node,n] of Object.entries(v)){
    const have=Number(applied[node]||0);
    if(node===(event.nodeId||event?.unsigned?.nodeId)) { if(have+1!==n) return false; }
    else if(have<n) return false;
  }
  return true;
}

export function causalDrain(pending=[],applied={}){
  let frontier=F.vcNormalize(applied), ready=[], remain=pending.map(x=>x);
  let changed=true;
  while(changed){
    changed=false;
    const candidates=remain.filter(e=>causalReady(e,frontier)).sort(F.compareEvents||((a,b)=>String(a.id).localeCompare(String(b.id))));
    if(!candidates.length) break;
    const take=candidates[0];
    ready.push(take);
    frontier=F.vcMerge(frontier,take.vc||take.unsigned?.vc||{});
    remain=remain.filter(e=>e!==take); changed=true;
  }
  return {ready,remaining:remain,frontier};
}

export function dependencySet(event){
  const e=event?.unsigned||event, v=F.vcNormalize(e?.vc||{}), own=e?.nodeId;
  return Object.entries(v).filter(([n,c])=>n!==own).map(([node,counter])=>({node,counter}));
}

export function relayEnvelope({event,from,origin=event?.nodeId,ttl=DEFAULT_TTL,hops=[],seen=[]}={}){
  return {protocol:PROTOCOL,schema:SCHEMA,type:'RELAY',id:`relay:${event?.id||event?.unsigned?.id}`,origin,from,ttl:Math.max(0,Number(ttl)||0),hops:[...hops].slice(-MAX_HOPS),seen:[...seen].slice(-256),event};
}

export function acceptRelay(env,{nodeId,now=Date.now()}={}){
  if(!env||env.protocol!==PROTOCOL||env.schema!==SCHEMA||env.type!=='RELAY')return {ok:false,reason:'protocol'};
  if(!env.event?.id)return {ok:false,reason:'event'};
  if(env.ttl<=0)return {ok:false,reason:'ttl'};
  if(env.hops.includes(nodeId))return {ok:false,reason:'loop'};
  if(env.seen.includes(env.event.id))return {ok:false,reason:'seen'};
  return {ok:true,forward:relayEnvelope({event:env.event,from:nodeId,origin:env.origin,ttl:env.ttl-1,hops:[...env.hops,nodeId],seen:[...env.seen,env.event.id]}),receivedAt:now};
}

export function chooseRelayPeers(peers,{exclude=[],limit=4}={}){
  return peers.filter(p=>p&&p.connected!==false&&!exclude.includes(p.nodeId)).sort((a,b)=>{
    const sa=(b.capabilityScore||0)-(a.capabilityScore||0);
    return sa||String(a.nodeId).localeCompare(String(b.nodeId));
  }).slice(0,limit);
}

export function fileId({sha256,size,name=''}={}){return `sha256:${sha256}:${Number(size)||0}:${String(name)}`;}
export function chunkPlan(size,chunkSize=24*1024){
  size=Math.max(0,Number(size)||0); chunkSize=Math.max(1024,Number(chunkSize)||1024);
  const count=Math.ceil(size/chunkSize); return Array.from({length:count},(_,i)=>({index:i,offset:i*chunkSize,length:Math.min(chunkSize,size-i*chunkSize)}));
}
export function missingChunks(total,received=[]){const set=new Set(received.map(Number));return Array.from({length:Math.max(0,total|0)},(_,i)=>i).filter(i=>!set.has(i));}
export function fileManifest({id,size,chunkSize,sha256,name='',mime='application/octet-stream'}={}){
  return {protocol:PROTOCOL,schema:SCHEMA,type:'FILE_MANIFEST',id,size:Number(size)||0,chunkSize:Number(chunkSize)||24576,sha256,name,mime,chunks:Math.ceil((Number(size)||0)/(Number(chunkSize)||24576))};
}

export function trustBind(nodeId,publicKey){
  const fp=T.fingerprint(publicKey); return {nodeId,fingerprint:fp};
}
export function verifyNodeBinding({nodeId,publicKey,fingerprint}={}){
  return !!nodeId&&!!publicKey&&fingerprint===T.fingerprint(publicKey);
}

export function materialize(events=[]){
  const ordered=[...events].sort(F.compareEvents||((a,b)=>String(a.id).localeCompare(String(b.id))));
  const state=new Map(), conflicts=[];
  for(const e of ordered){
    const body=e.payload??e.unsigned?.payload??e.data??null, key=e.entityId??e.unsigned?.entityId??e.id;
    const existing=state.get(key);
    if(!existing){state.set(key,{event:e,value:body});continue;}
    const cmp=F.vcCompare(existing.event.vc||existing.event.unsigned?.vc||{},e.vc||e.unsigned?.vc||{});
    if(cmp==='concurrent'){
      conflicts.push({key,winner:F.compareEvents?F.compareEvents(existing.event,e)<=0?existing.event:e:existing.event, siblings:[existing.event,e]});
      const winner=(F.compareEvents?F.compareEvents(existing.event,e)<=0:existing.event.id<e.id)?existing.event:e;
      state.set(key,{event:winner,value:winner.payload??winner.unsigned?.payload??winner.data??null});
    } else if(cmp==='before') state.set(key,{event:e,value:body});
  }
  return {state:Object.fromEntries([...state].map(([k,v])=>[k,v.value])),conflicts};
}
