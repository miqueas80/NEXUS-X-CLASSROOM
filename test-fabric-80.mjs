import assert from 'node:assert/strict';
import * as X from './nexus-fabric-80.mjs';
const A=X.makeNode('A'),B=X.makeNode('B'),C=X.makeNode('C');X.connect(A,B);X.connect(B,C);
const e1=X.emit(A,{id:'e1',entityId:'lesson',payload:'one'});const e2=X.emit(A,{id:'e2',entityId:'lesson',payload:'two'});
X.partition([A,B,C],['A']);let r=X.pump([A,B,C]);assert.equal(r.delivered,0);
X.heal([A,B,C]);assert.equal(X.audit([A,B,C]).uniqueEvents,2);
const late=X.emit(C,{id:'c1',payload:'c'});X.pump([A,B,C],{reorder:true,duplicateRate:.4});
assert.equal(X.audit([A,B,C]).uniqueEvents,3);
console.log('FABRIC 80 TESTS: PASS');
