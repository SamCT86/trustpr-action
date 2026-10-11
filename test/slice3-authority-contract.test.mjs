import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubRestClient } from '../src/github-rest-client.mjs';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

const B='a'.repeat(40), H='b'.repeat(40);
const expected={
  repository_id:'100', pull_request_number:'42',
  base_repository_id:'100', head_repository_id:'200',
  base_commit_sha:B, head_commit_sha:H
};

test('S0 identity is closed immutable fork-aware projection', async()=>{
  const calls=[];
  const client=createGithubRestClient(async req=>{ calls.push(req); return {data:{
    number:42, title:'hostile mutable extra',
    base:{sha:B,ref:'main',repo:{id:100}},
    head:{sha:H,ref:'feature',repo:{id:200}}
  }}; });
  const out=await client.getPullRequest({owner:'acme',repo:'widget',prNumber:42});
  assert.deepEqual(out,expected);
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
});

test('secondary 429 is one attempt, PARTIAL, with retry metadata only', async()=>{
  let checkCalls=0, sleepCalls=0, prReads=0;
  const client={
    sleep:async()=>{sleepCalls++;},
    getPullRequest:async()=>{prReads++; return expected;},
    listCheckSuites:async()=>({items:[{provider:'github',check_suite_id:'s1',head_sha:H,app_identity:'app:1:x'}],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>{checkCalls++; const e=new Error('secret-token'); e.status=429; e.retryAfterMs=9000; throw e;},
    listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(checkCalls,1);
  assert.equal(sleepCalls,0);
  assert.equal(out.validity.status,'PARTIAL');
  const ev=out.collection_evidence.find(x=>x.collection_kind==='check_runs');
  assert.equal(ev.retryable,true);
  assert.equal(ev.retry_after_ms,9000);
  assert.equal(JSON.stringify(out).includes('secret-token'),false);
});

test('mandatory S0 401 is INVALID after one attempt', async()=>{
  let reads=0;
  const client={ getPullRequest:async()=>{reads++; const e=new Error('unauthorized'); e.status=401; throw e;} };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(reads,1);
  assert.equal(out.validity.status,'INVALID');
  assert.equal(out.validity.reasons[0].code,'PROVIDER_IDENTITY_AUTH_FAILED');
});

test('wrong workflow generation is INVALID, never STALE', async()=>{
  const wrong='c'.repeat(40), snapshots=[expected,expected];
  const client={
    getPullRequest:async()=>snapshots.shift(),
    listCheckSuites:async()=>({items:[],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
    listWorkflowRuns:async()=>({items:[{provider:'github',workflow_run_id:'1',check_suite_id:'2',workflow_id:'3',head_sha:wrong,run_attempt:'1',status:'completed',conclusion:'success'}],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(out.validity.status,'INVALID');
  assert.equal(out.validity.reasons[0].code,'PROVIDER_GENERATION_MISMATCH');
});

test('base repository identity change between S0/S1 is STALE', async()=>{
  const snapshots=[expected,{...expected,base_repository_id:'999',repository_id:'999'}];
  const client={
    getPullRequest:async()=>snapshots.shift(),
    listCheckSuites:async()=>({items:[],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
    listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(out.validity.status,'STALE');
  assert.equal(out.validity.reasons[0].code,'SNAPSHOT_CHANGED');
});

test('pagination safety bound becomes explicit PARTIAL without extra read', async()=>{
  let suiteCalls=0;
  const client={
    paginationPageLimit:2,
    getPullRequest:async()=>expected,
    listCheckSuites:async()=>{suiteCalls++; return {items:[],next:String(suiteCalls+1),provider_complete:true};},
    listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(suiteCalls,2);
  assert.equal(out.validity.status,'PARTIAL');
  const ev=out.collection_evidence.find(x=>x.collection_kind==='check_suites');
  assert.equal(ev.failure_code,'PAGINATION_INCOMPLETE');
});

test('mandatory snapshot 403/404 fail INVALID with typed identity reason', async()=>{
  for (const [status,code] of [[403,'PROVIDER_IDENTITY_PERMISSION_DENIED'],[404,'PROVIDER_IDENTITY_NOT_FOUND']]) {
    let reads=0;
    const client={getPullRequest:async()=>{reads++; const e=new Error('sensitive'); e.status=status; throw e;}};
    const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
    assert.equal(reads,1);
    assert.equal(out.validity.status,'INVALID');
    assert.equal(out.validity.reasons[0].code,code);
    assert.equal(JSON.stringify(out).includes('sensitive'),false);
  }
});

test('secondary 403/500/timeout are typed PARTIAL without retries', async()=>{
  const cases=[
    [{status:403},'ACCESS_DENIED','PERMISSION_DENIED',false],
    [{status:500},'TRANSIENT_FAILURE','TRANSIENT_FAILURE',true],
    [{code:'ETIMEDOUT'},'TRANSIENT_FAILURE','TRANSIENT_FAILURE',true]
  ];
  for (const [shape,terminal,failure,retryable] of cases) {
    let calls=0;
    const client={
      getPullRequest:async()=>expected,
      listCheckSuites:async()=>{calls++; const e=new Error('raw-secret'); Object.assign(e,shape); throw e;},
      listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
      listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
      listArtifacts:async()=>({items:[],next:null,provider_complete:true})
    };
    const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
    const ev=out.collection_evidence.find(x=>x.collection_kind==='check_suites');
    assert.equal(calls,1);
    assert.equal(out.validity.status,'PARTIAL');
    assert.equal(ev.terminal_state,terminal);
    assert.equal(ev.failure_code,failure);
    assert.equal(ev.retryable,retryable);
    assert.equal(JSON.stringify(out).includes('raw-secret'),false);
  }
});

test('wrong check-run head under correct suite is INVALID', async()=>{
  const wrong='d'.repeat(40);
  const client={
    getPullRequest:async()=>expected,
    listCheckSuites:async()=>({items:[{provider:'github',check_suite_id:'s1',head_sha:H,app_identity:'app:1:x'}],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[{provider:'github',check_run_id:'c1',check_suite_id:'s1',head_sha:wrong,name:'ci',status:'completed',conclusion:'success',app_identity:'app:1:x',verification_state:'PROVIDER_ASSERTED'}],next:null,provider_complete:true}),
    listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(out.validity.status,'INVALID');
  assert.equal(out.validity.reasons[0].code,'PROVIDER_GENERATION_MISMATCH');
});

test('mandatory S1 404 is INVALID, not PARTIAL', async()=>{
  let reads=0;
  const client={
    getPullRequest:async()=>{reads++; if(reads===1) return expected; const e=new Error('gone'); e.status=404; throw e;},
    listCheckSuites:async()=>({items:[],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
    listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'42'});
  assert.equal(reads,2);
  assert.equal(out.validity.status,'INVALID');
  assert.equal(out.validity.reasons[0].code,'PROVIDER_IDENTITY_NOT_FOUND');
});