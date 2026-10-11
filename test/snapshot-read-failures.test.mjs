import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

const H='a'.repeat(40), B='b'.repeat(40), M='c'.repeat(40);
const snap={repository_id:'7',pull_request_number:'9',base_repository_id:'7',head_repository_id:'7',base_commit_sha:B,head_commit_sha:H};
function emptyReads(client={}){ return {
  listCheckSuites:async()=>({items:[],next:null,provider_complete:true}),
  listCheckRunsForSuite:async()=>({items:[],next:null,provider_complete:true}),
  listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
  listArtifacts:async()=>({items:[],next:null,provider_complete:true}),
  ...client
}; }

test('S0 rate-limit exhaustion is PARTIAL, not INVALID', async()=>{
  let calls=0;
  const client=emptyReads({sleep:async()=>{},getPullRequest:async()=>{calls++; const e=new Error('rate'); e.code='RATE_LIMITED'; throw e;}});
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'9'});
  assert.equal(calls,1);
  assert.equal(out.validity.status,'PARTIAL');
  assert.equal(out.validity.reasons[0].code,'SNAPSHOT_READ_UNAVAILABLE');
});

test('S1 recheck exhaustion is PARTIAL, never VALID', async()=>{
  let reads=0;
  const client=emptyReads({sleep:async()=>{},getPullRequest:async()=>{
    reads++;
    if(reads===1) return snap;
    const e=new Error('network'); e.code='TRANSIENT_FAILURE'; throw e;
  }});
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'9'});
  assert.equal(reads,2);
  assert.equal(out.validity.status,'PARTIAL');
  assert.equal(out.validity.reasons[0].code,'SNAPSHOT_RECHECK_UNAVAILABLE');
});

test('transient S0 snapshot read returns retry metadata without retrying', async()=>{
  let reads=0;
  const sleeps=[];
  const client=emptyReads({sleep:async(ms)=>sleeps.push(ms),getPullRequest:async()=>{
    reads++; const e=new Error('rate'); e.code='RATE_LIMITED'; e.retryAfterMs=5; throw e;
  }});
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'9'});
  assert.equal(out.validity.status,'PARTIAL');
  assert.equal(reads,1);
  assert.deepEqual(sleeps,[]);
  assert.equal(out.collection_evidence[0].retryable,true);
  assert.equal(out.collection_evidence[0].retry_after_ms,5);
});
