import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';
import { createGithubRestClient } from '../src/github-rest-client.mjs';

const H='a'.repeat(40), B='b'.repeat(40);
const snap={repository_id:'1',pull_request_number:'2',base_repository_id:'1',head_repository_id:'1',base_commit_sha:B,head_commit_sha:H};

test('2+ page checks, workflow runs and artifacts exhaust coherently', async()=>{
  const calls={checks:0,runs:0,artifacts:0};
  const client={
    getPullRequest:async()=>snap,
    listCheckSuites:async()=>({items:[{provider:'github',check_suite_id:'s1',head_sha:H,app_identity:'app:1:a'}],next:null,provider_complete:true}),
    listCheckRunsForSuite:async({cursor})=>{calls.checks++; return cursor===null
      ? {items:[{provider:'github',check_run_id:'c1',check_suite_id:'s1',head_sha:H,name:'unit',run_attempt:'1',status:'completed',conclusion:'success',app_identity:'app:1:a',verification_state:'PROVIDER_ASSERTED'}],next:'2',provider_complete:true}
      : {items:[{provider:'github',check_run_id:'c2',check_suite_id:'s1',head_sha:H,name:'lint',run_attempt:'1',status:'completed',conclusion:'success',app_identity:'app:1:a',verification_state:'PROVIDER_ASSERTED'}],next:null,provider_complete:true};},
    listWorkflowRuns:async({cursor})=>{calls.runs++; return cursor===null
      ? {items:[{provider:'github',workflow_run_id:'r1',check_suite_id:'s1',workflow_id:'w1',head_sha:H,run_attempt:'1',status:'completed',conclusion:'success'}],next:'2',provider_complete:true}
      : {items:[{provider:'github',workflow_run_id:'r2',check_suite_id:'s2',workflow_id:'w2',head_sha:H,run_attempt:'1',status:'completed',conclusion:'success'}],next:null,provider_complete:true};},
    listArtifacts:async({workflowRunId,cursor})=>{calls.artifacts++; if(workflowRunId==='r2') return {items:[],next:null,provider_complete:true}; return cursor===null
      ? {items:[{provider:'github',artifact_id:'a1',producing_run_id:'r1',attempt:'1',retention_state:'available'}],next:'2',provider_complete:true}
      : {items:[{provider:'github',artifact_id:'a2',producing_run_id:'r1',attempt:'1',retention_state:'available'}],next:null,provider_complete:true};}
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'2'});
  assert.equal(out.validity.status,'VALID');
  assert.ok(out.observed.checks.every(check=>check.run_attempt==='1'));
  assert.equal(calls.checks,2); assert.equal(calls.runs,2); assert.equal(calls.artifacts,3);
  assert.equal(out.collection_evidence.find(x=>x.collection_kind==='check_runs').pages_observed,'2');
  assert.equal(out.collection_evidence.find(x=>x.collection_kind==='workflow_runs').pages_observed,'2');
  assert.ok(out.collection_evidence.some(x=>x.collection_kind==='artifacts'&&x.pages_observed==='2'));
});

test('artifact total_count mismatch is explicit PARTIAL truncation', async()=>{
  const request=async req=>{
    if(req.path==='/repos/o/r/pulls/2') return {data:{number:2,base:{sha:B,repo:{id:1}},head:{sha:H,repo:{id:1}}}};
    if(req.path===`/repos/o/r/commits/${H}/check-suites`) return {data:{total_count:0,check_suites:[]},nextPage:null};
    if(req.path==='/repos/o/r/actions/runs') return {data:{total_count:1,workflow_runs:[{id:7,check_suite_id:8,workflow_id:9,head_sha:H,run_attempt:1,status:'completed',conclusion:'success'}]},nextPage:null};
    if(req.path==='/repos/o/r/actions/runs/7/artifacts') return {data:{total_count:2,artifacts:[{id:10,expired:false,workflow_run:{id:7}}]},nextPage:null};
    throw new Error('unexpected '+req.path);
  };
  const out=await collectGithubReadEvidence(createGithubRestClient(request),{owner:'o',repo:'r',prNumber:2});
  assert.equal(out.validity.status,'PARTIAL');
  const ev=out.collection_evidence.find(x=>x.collection_kind==='artifacts');
  assert.equal(ev.complete,false);
  assert.equal(ev.failure_code,'ARTIFACT_PAGINATION_INCOMPLETE');
});
