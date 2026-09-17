import assert from 'node:assert/strict';
import {canonical,vcCompare,vcIncrement,vcMerge,eventOrder,nextHlc,makeEvent,missingByFrontier,causalDrain,materialize,merkleBuckets,capabilityProfile} from './nexus-fabric-50.mjs';

assert.equal(canonical({b:2,a:1}),'{"a":1,"b":2}');
assert.equal(vcCompare({a:1},{a:1}),'equal');
assert.equal(vcCompare({a:1},{a:2}),'before');
assert.equal(vcCompare({a:2,b:1},{a:1,b:2}),'concurrent');
assert.deepEqual(vcIncrement({a:2},'a'),{a:3});
assert.deepEqual(vcMerge({a:2},{a:4,b:2}),{a:4,b:2});
assert.equal(nextHlc('100:00000001','100:00000003',100),'100:00000004');

const state={nodeId:'A',vc:{},hlc:'0:00000000',wall:1000};
const a=makeEvent({kind:'post.create',payload:{text:'A'},classId:'c',entityId:'p'},state);state.vc=a.vc;state.hlc=a.hlc;
const b=makeEvent({kind:'post.update',payload:{text:'B'},classId:'c',entityId:'p'},state);state.vc=b.vc;state.hlc=b.hlc;
assert.equal(a.seq,1);assert.equal(b.seq,2);
assert.equal(missingByFrontier([a,b],{A:1}).length,1);

const e1={id:'1',nodeId:'A',seq:1,vc:{A:1},hlc:'10:00000001'};
const e2={id:'2',nodeId:'B',seq:1,vc:{B:1},hlc:'10:00000001'};
const drain=causalDrain([e1,e2],{});assert.equal(drain.ready.length,2);assert.equal(drain.remaining.length,0);
const mat=materialize([
 {...e1,classId:'c',entityId:'x',payload:{v:1}},
 {...e2,classId:'c',entityId:'x',payload:{v:2}}
]);
assert.equal(mat.conflicts.length,1);
assert.equal(merkleBuckets([e1,e2],8).length,8);
assert.equal(capabilityProfile({cores:8,memoryGB:8,saveData:false,battery:1}),'X');
console.log('FABRIC 50 TESTS: PASS');
