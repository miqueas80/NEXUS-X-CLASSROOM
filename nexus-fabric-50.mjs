/* NEXUS-X CLASSROOM // FABRIC 50
 * Deterministic distributed-state primitives.
 * No UI, no network, no framework.
 */
export const PROTOCOL='NEXUS/FABRIC-50';
export const SCHEMA=50;

export function canonical(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function clone(x){return JSON.parse(JSON.stringify(x));}
export function cmpId(a,b){return String(a).localeCompare(String(b));}

// Vector clocks ------------------------------------------------------------
export function vcNormalize(v={}){const out={};for(const k of Object.keys(v).sort())out[k]=Math.max(0,Number(v[k])||0);return out;}
export function vcIncrement(v,node){const out=vcNormalize(v);out[node]=(out[node]||0)+1;return out;}
export function vcMerge(a={},b={}){const out={...vcNormalize(a)};for(const [k,n] of Object.entries(vcNormalize(b)))out[k]=Math.max(out[k]||0,n);return out;}
export function vcCompare(a={},b={}){const aa=vcNormalize(a),bb=vcNormalize(b),keys=new Set([...Object.keys(aa),...Object.keys(bb)]);let lt=false,gt=false;for(const k of keys){const x=aa[k]||0,y=bb[k]||0;if(x<y)lt=true;if(x>y)gt=true;}return lt&&gt?'concurrent':lt?'before':gt?'after':'equal';}
export function vcLeq(a={},b={}){return vcCompare(a,b)!=='after';}

// Deterministic total order. Concurrent events are not silently discarded.
export function eventOrder(a,b){
  const c=vcCompare(a.vc,b.vc);
  if(c==='before')return -1;if(c==='after')return 1;
  const ah=String(a.hlc||''),bh=String(b.hlc||'');
  if(ah<bh)return -1;if(ah>bh)return 1;
  return cmpId(a.id,b.id);
}

export function conflictWinner(a,b){
  if(!a)return b;if(!b)return a;
  const c=eventOrder(a,b);return c>=0?a:b;
}

// HLC ----------------------------------------------------------------------
export function parseHlc(x){const [w,l]=String(x||'0:0').split(':').map(Number);return {wall:Number.isFinite(w)?w:0,logical:Number.isFinite(l)?l:0};}
export function nextHlc(local,remote,wall=Date.now()){
  const a=parseHlc(local),b=parseHlc(remote);const max=Math.max(wall,a.wall,b.wall);
  let logical;if(max===a.wall&&max===b.wall)logical=Math.max(a.logical,b.logical)+1;
  else if(max===a.wall)logical=a.logical+1;
  else if(max===b.wall)logical=b.logical+1;
  else logical=0;
  return `${max}:${String(logical).padStart(8,'0')}`;
}

// Event envelope -----------------------------------------------------------
export function eventUnsigned({id,nodeId,seq,kind,payload,classId=null,entityId=null,vc,hlc,createdAt,schema=SCHEMA,op='upsert'}){
  return {protocol:PROTOCOL,schema,id,nodeId,seq,kind,op,payload,classId,entityId,vc:vcNormalize(vc),hlc,createdAt};
}
export function makeEvent(input,state){
  const vc=vcIncrement(state.vc||{},state.nodeId);
  const seq=vc[state.nodeId];
  const hlc=nextHlc(state.hlc,state.remoteHlc,state.wall||Date.now());
  const id=input.id||`${state.nodeId}:${seq}`;
  return eventUnsigned({...input,id,nodeId:state.nodeId,seq,vc,hlc,createdAt:input.createdAt||Date.now(),schema:SCHEMA});
}

// Anti-entropy -------------------------------------------------------------
export function missingByFrontier(events,remoteVc={}){
  const r=vcNormalize(remoteVc);
  return events.filter(e=>Number(e.seq||0)>(r[e.nodeId]||0)).sort(eventOrder);
}
export function frontierFrom(events){const out={};for(const e of events)out[e.nodeId]=Math.max(out[e.nodeId]||0,Number(e.seq)||0);return out;}
export function merkleBuckets(events,buckets=64){
  const out=Array.from({length:buckets},()=>[]);
  for(const e of events){let h=0;for(const ch of String(e.id))h=((h<<5)-h+ch.charCodeAt(0))|0;out[Math.abs(h)%buckets].push(e.hash||canonical(e));}
  return out.map(xs=>xs.sort().join('|'));
}

// Causal queue -------------------------------------------------------------
export function causalReady(event,frontier){
  const deps={...event.vc};deps[event.nodeId]=Math.max(0,(deps[event.nodeId]||1)-1);
  return vcLeq(deps,frontier);
}
export function causalDrain(queue,frontier){
  const pending=[...queue],ready=[];let changed=true;
  while(changed){changed=false;for(let i=0;i<pending.length;i++){if(causalReady(pending[i],frontier)){const e=pending.splice(i,1)[0];ready.push(e);frontier=vcMerge(frontier,e.vc);changed=true;break;}}}
  return {ready,remaining:pending,frontier};
}

// Materialized CRDT-ish state ---------------------------------------------
export function materialize(events){
  const entities=new Map(),conflicts=new Map();
  const ordered=[...events].sort(eventOrder);
  for(const e of ordered){
    const key=`${e.classId||'global'}:${e.entityId||e.id}`;
    const prev=entities.get(key);
    if(!prev){entities.set(key,e);continue;}
    const relation=vcCompare(prev.vc,e.vc);
    if(relation==='concurrent'){
      const arr=conflicts.get(key)||[prev];if(!arr.some(x=>x.id===e.id))arr.push(e);conflicts.set(key,arr);
    }
    entities.set(key,conflictWinner(prev,e));
  }
  for(const [k,arr] of conflicts)conflicts.set(k,arr.sort(eventOrder));
  return {entities:[...entities.values()],conflicts:[...conflicts.entries()].map(([key,events])=>({key,events}))};
}

// Capability policy --------------------------------------------------------
export function capabilityProfile({cores=2,memoryGB=2,saveData=false,battery=1}={}){
  const score=(cores>=8?4:cores>=4?3:cores>=2?2:1)+(memoryGB>=8?4:memoryGB>=4?3:memoryGB>=2?2:1)+(battery>0.6?2:1)-(saveData?2:0);
  return score>=8?'X':score>=6?'H':score>=4?'M':'L';
}
