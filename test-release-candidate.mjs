import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const required=['index.html','sw.js','nexus-master-50.js','nexus-master-70.js','nexus-master-100.js','nexus-fabric-50.mjs','nexus-fabric-60.mjs','nexus-fabric-70.mjs','nexus-fabric-90.mjs','nexus-fabric-100.mjs','nexus-ai-worker-50.js','manifest.webmanifest'];
for(const f of required){if(!fs.existsSync(path.join(dir,f))) throw new Error(`missing:${f}`)}
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
for(const s of ['/nexus-master-50.js?v=60','/nexus-master-70.js?v=70','/nexus-master-100.js?v=100']) if(!html.includes(s)) throw new Error(`html-missing:${s}`);
const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
if(!sw.includes('red-nexus-master-v100')) throw new Error('sw-cache-version');
const M=await import('./nexus-fabric-100.mjs');
const id=M.bindIdentity('release-candidate-public-key');
const health=M.health({trust:'ok',causalPending:0,filesPending:0,peers:2});
if(!id.nodeId.startsWith('node:')||health.status!=='converged') throw new Error('core-smoke');
console.log('RELEASE CANDIDATE SMOKE: PASS');
console.log(JSON.stringify({protocol:M.PROTOCOL,schema:M.SCHEMA,files:required.length,ui:'preserved',serviceWorker:'v100',health:health.status},null,2));
