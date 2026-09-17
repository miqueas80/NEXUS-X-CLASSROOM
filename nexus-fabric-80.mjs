/* NEXUS-X CLASSROOM // FABRIC 80 — DETERMINISTIC NETWORK LAB
 * In-memory adversarial simulator for partitions, reordering, duplication,
 * relay/store-forward, causal delivery and recovery.
 */
import * as F from './nexus-fabric-50.mjs';
import * as X from './nexus-fabric-70.mjs';
export const PROTOCOL='NEXUS/FABRIC-80';
export const SCHEMA=80;
export function makeNode(id){return {id,clock:{},events:new Map(),pending:new Map(),online:true,links:new Set(),outbox:[],stats:{sent:0,delivered:0,duplicates:0,rejected:0}}}
export function connect(a,b){a.links.add(b.id);b.links.add(a.id)}
export function disconnect(a,b){a.links.delete(b.id);b.links.delete(a.id)}
function nextClock(node){node.clock={...node.clock,[node.id]:Number(node.clock[node.id]||0)+1};return F.vcNormalize(node.clock)}
export function emit(node,{id=`${node.id}:${node.clock[node.id]}`,entityId=null,payload=null,type='EVENT'}={}){const unsigned={protocol:F.PROTOCOL,schema:F.SCHEMA,id,nodeId:node.id,vc:nextClock(node),hlc:`${Date.now()}:${node.id}`,type,entityId,payload};const e={unsigned,publicKey:{node:node.id},signature:`sig:${id}`,hash:F.canonical(unsigned)};node.events.set(id,e);return e}
function ready(node){let changed=true;while(changed){changed=false;for(const [id,e] of [...node.pending]){if(X.causalReady(e.unsigned,node.clock)){node.pending.delete(id);node.events.set(id,e);node.clock=F.vcMerge(node.clock,e.unsigned.vc);node.stats.delivered++;changed=true}}}return changed}
export function queue(node,e,from){if(node.events.has(e.unsigned.id)){node.stats.duplicates++;return false}node.pending.set(e.unsigned.id,e);node.outbox.push({event:e,from,ttl:X.DEFAULT_TTL,hops:[from],seen:[e.unsigned.id]});return true}
export function pump(nodes,{duplicateRate=0,reorder=true,seed=1}={}){let rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};let delivered=0;let queue=[];for(const n of nodes)if(n.online){for(const [peerId] of n.links){const p=nodes.find(x=>x.id===peerId);if(!p||!p.online)continue;for(const e of n.events.values()){if(!p.events.has(e.unsigned.id))queue.push({from:n.id,to:p.id,event:e})}}}if(reorder)queue.sort(()=>rng()-.5);for(const m of queue){const n=nodes.find(x=>x.id===m.to);if(!n?.online)continue;n.stats.sent++;if(rng()<duplicateRate){n.stats.duplicates++;continue}if(!n.events.has(m.event.unsigned.id)){n.pending.set(m.event.unsigned.id,m.event);delivered++;n.stats.delivered++}}for(const n of nodes)ready(n);return {delivered,pending:nodes.reduce((s,n)=>s+n.pending.size,0),events:nodes.reduce((s,n)=>s+n.events.size,0)}}
export function heal(nodes){for(const a of nodes)for(const b of nodes)if(a!==b)connect(a,b);return pump(nodes,{reorder:true})}
export function partition(nodes,leftIds){const left=new Set(leftIds);for(const a of nodes)for(const b of nodes)if(a!==b && left.has(a.id)!==left.has(b.id))disconnect(a,b);return nodes}
export function audit(nodes){const ids=new Set(nodes.flatMap(n=>[...n.events.keys()]));const missing=nodes.map(n=>({node:n.id,missing:[...ids].filter(id=>!n.events.has(id)),pending:[...n.pending.keys()]}));return {uniqueEvents:ids.size,converged:missing.every(x=>x.missing.length===0),missing}}
