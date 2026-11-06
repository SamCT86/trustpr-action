import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTestExecutionEvidence} from '../src/test-execution.mjs';

const head='a'.repeat(40);
const check={provider:'github',check_run_id:'100',workflow_run_id:'200',run_attempt:'1',head_sha:head,
  name:'tests',status:'completed',conclusion:'success'};
const claim={provider:'github',check_run_id:'100',workflow_run_id:'200',run_attempt:'1',head_sha:head,
  command:'npm test',exit_code:'0',evidence_id:'exec-1'};

test('positive: exact check/run/attempt/head claim binds only its check',()=>{
 const out=deriveTestExecutionEvidence([check,{...check,check_run_id:'101'}],[claim],head);
 assert.equal(out[0].state,'OBSERVED');
 assert.equal(out[0].check_run_id,'100');
 assert.equal(out[0].command,'npm test');
 assert.equal(out[1].state,'UNKNOWN');
 assert.equal('command' in out[1],false);
});

test('legacy run-level claim cannot assert execution',()=>{
 const {check_run_id,...legacy}=claim;
 const out=deriveTestExecutionEvidence([check],[legacy],head)[0];
 assert.equal(out.state,'UNKNOWN');
 assert.equal('command' in out,false);
});

test('wrong or absent check ID rejects association',()=>{
 for(const check_run_id of ['101','',null,{},[],0]){
  assert.equal(deriveTestExecutionEvidence([check],[{...claim,check_run_id}],head)[0].state,'UNKNOWN');
 }
 for(const check_run_id of ['',null,{},[],0]){
  assert.equal(deriveTestExecutionEvidence([{...check,check_run_id}],[claim],head)[0].state,'UNKNOWN');
 }
});

test('wrong provider/run/attempt/head leaves claim UNKNOWN',()=>{
 for(const [field,wrong] of [['provider','gitlab'],['workflow_run_id','202'],
   ['run_attempt','2'],['head_sha','b'.repeat(40)]]) {
   assert.equal(deriveTestExecutionEvidence([check],[{...claim,[field]:wrong}],head)[0].state,'UNKNOWN',field);
 }
});

test('duplicated and contradictory claims never select by input order',()=>{
 for(const claims of [[claim,claim],[claim,{...claim,command:'false'}]]){
  const a=deriveTestExecutionEvidence([check],claims,head)[0];
  const b=deriveTestExecutionEvidence([check],[...claims].reverse(),head)[0];
  assert.equal(a.state,'UNKNOWN');
  assert.equal(a.reason,'MACHINE_EXECUTION_AMBIGUOUS');
  assert.deepEqual(a,b);
 }
});

test('missing, malformed and unmatched claims never inherit check success',()=>{
 for(const value of [undefined,null,'',[],{},true,0]){
  for(const field of ['evidence_id','provider','workflow_run_id','run_attempt','check_run_id']){
   assert.equal(deriveTestExecutionEvidence([check],[{...claim,[field]:value}],head)[0].state,'UNKNOWN',field);
  }
 }
 for(const exit_code of ['zero',NaN,Infinity,1.2,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(deriveTestExecutionEvidence([check],[{...claim,exit_code}],head)[0].state,'UNKNOWN');
 }
 assert.equal(deriveTestExecutionEvidence([check],[],head)[0].state,'UNKNOWN');
});
