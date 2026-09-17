/* NEXUS-X CLASSROOM // FABRIC 60 — TRUST FABRIC
 * Deterministic trust, membership, authorization and revocation primitives.
 */
export const PROTOCOL='NEXUS/FABRIC-60';
export const SCHEMA=60;
export const ROLES=Object.freeze(['teacher','student','admin','guest']);
export const ACTIONS=Object.freeze(['read','write','submit','grade','moderate','invite','revoke','relay']);
export function canonical(v){
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export function clone(x){return JSON.parse(JSON.stringify(x));}
export function normalizeRole(r){return ROLES.includes(r)?r:'guest';}
export function fingerprint(jwk){return canonical({kty:jwk?.kty,crv:jwk?.crv,x:jwk?.x,y:jwk?.y})}
export function nodeBinding(nodeId,publicKey){return {nodeId,publicKey,fingerprint:fingerprint(publicKey)};}
export function makeCertificate({classId,nodeId,publicKey,role='student',issuerId,issuedAt=Date.now(),expiresAt=0,serial}){
  return {protocol:PROTOCOL,schema:SCHEMA,type:'MEMBERSHIP',serial:serial||`${issuerId}:${nodeId}:${issuedAt}`,classId,nodeId,role:normalizeRole(role),issuerId,issuedAt,expiresAt,publicKey,fingerprint:fingerprint(publicKey)};
}
export function certificatePayload(cert){const c=clone(cert);delete c.signature;return c;}
export function certificateValid(cert,now=Date.now()){
  if(!cert||cert.protocol!==PROTOCOL||cert.schema!==SCHEMA||cert.type!=='MEMBERSHIP')return false;
  if(!cert.classId||!cert.nodeId||!cert.issuerId||!cert.publicKey||cert.fingerprint!==fingerprint(cert.publicKey))return false;
  if(!ROLES.includes(cert.role))return false;
  return !(cert.expiresAt&&now>cert.expiresAt);
}
export function canRole(role,action){
  const p={teacher:['read','write','submit','grade','moderate','invite','revoke','relay'],admin:['read','write','submit','grade','moderate','invite','revoke','relay'],student:['read','write','submit','relay'],guest:['read']};
  return !!p[normalizeRole(role)]?.includes(action);
}
export function authorize({certificate,action,classId,now=Date.now(),revokedSerials=new Set()}){
  if(!certificateValid(certificate,now))return {ok:false,reason:'certificate'};
  if(classId&&certificate.classId!==classId)return {ok:false,reason:'class'};
  if(revokedSerials.has(certificate.serial))return {ok:false,reason:'revoked'};
  if(!canRole(certificate.role,action))return {ok:false,reason:'role'};
  return {ok:true,role:certificate.role};
}
export function applyRevocation(revocations,cert,now=Date.now()){
  return revocations.some(r=>r.serial===cert.serial&&(!r.effectiveAt||r.effectiveAt<=now));
}
export function trustRecord(cert,{connected=true,lastSeen=Date.now()}={}){
  return {nodeId:cert.nodeId,classId:cert.classId,role:cert.role,fingerprint:cert.fingerprint,serial:cert.serial,connected,lastSeen};
}
export function classifyPeer(localClassId,cert,revocations=[],now=Date.now()){
  if(!certificateValid(cert,now))return 'untrusted';
  if(cert.classId!==localClassId)return 'foreign-class';
  if(applyRevocation(revocations,cert,now))return 'revoked';
  return 'member';
}
