/* NEXUS-X CLASSROOM // FABRIC 100 — DISTRIBUTED CORE
 * Integration contract for trust, causality, relay and files.
 */
import * as F from './nexus-fabric-50.mjs';
import * as T from './nexus-fabric-60.mjs';
import * as C from './nexus-fabric-70.mjs';
import * as D from './nexus-fabric-90.mjs';
export const PROTOCOL='NEXUS/FABRIC-100';
export const SCHEMA=100;
export function nodeIdFor(publicKey){return `node:${T.fingerprint(publicKey)}`}
export function bindIdentity(publicKey){return {nodeId:nodeIdFor(publicKey),fingerprint:T.fingerprint(publicKey),publicKey}}
export function authorizeRelay({certificate,classId,revokedSerials=[],now=Date.now()}={}){return T.authorize({certificate,action:'relay',classId,now,revokedSerials:new Set(revokedSerials)})}
export function routeEvent({event,from,peers=[],certificate,classId,revokedSerials=[]}={}){
  const auth=authorizeRelay({certificate,classId,revokedSerials});
  if(!auth.ok)return {ok:false,reason:`relay-${auth.reason}`,peers:[]};
  const eligible=C.chooseRelayPeers(peers,{exclude:[from],limit:4});
  return {ok:true,peers:eligible.map(p=>p.nodeId),envelope:C.relayEnvelope({event,from,origin:event?.unsigned?.nodeId||event?.nodeId})};
}
export function reconcile({applied={},pending=[],incoming=[]}={}){
  const all=[...pending,...incoming].filter(Boolean); const unique=new Map();
  for(const e of all){const id=e.id||e.unsigned?.id;if(id&&!unique.has(id))unique.set(id,e)}
  return C.causalDrain([...unique.values()],F.vcNormalize(applied));
}
export function filePlan(manifest,have=[],available=[]){return D.planTransfer(manifest,new Map(have.map(h=>[h,true])),available)}
export function verifyFile(manifest,store){return D.assemble(manifest,store)}
export function health({trust='ok',causalPending=0,peers=0,filesPending=0}={}){
  const degraded=trust!=='ok'||causalPending>0||filesPending>0;
  return {protocol:PROTOCOL,schema:SCHEMA,status:degraded?'degraded':'converged',trust,causalPending,peers,filesPending};
}
export function snapshot({nodeId,frontier={},events=0,pending=0,peers=0,files=0}={}){
  return {protocol:PROTOCOL,schema:SCHEMA,nodeId,frontier:F.vcNormalize(frontier),events,pending,peers,files};
}
