import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubRestClient } from '../src/github-rest-client.mjs';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

const H='a'.repeat(40), B='b'.repeat(40), M='c'.repeat(40);
function pr(){ return {repository_id:'7',pull_request_number:'9',base_repository_id:'7',head_repository_id:'7',base_commit_sha:B,head_commit_sha:H}; }

test('REST client exposes paginated check-suite then per-suite check-run topology', async () => {
  const calls=[];
  const client=createGithubRestClient(async (req)=>{ calls.push(req);
    if(req.path.endsWith('/check-suites')) return {data:{total_count:1,check_suites:[{id:55,head_sha:H,app:{id:2,slug:'actions'}}]}};
    if(req.path.includes('/check-suites/55/check-runs')) return {data:{total_count:1,check_runs:[{id:66,head_sha:H,name:'ci',status:'completed',conclusion:'success',check_suite:{id:55},app:{id:2,slug:'actions'}}]}};
    throw new Error('unexpected '+req.path);
  });
  const suites=await client.listCheckSuites({owner:'o',repo:'r',headSha:H,cursor:null});
  const runs=await client.listCheckRunsForSuite({owner:'o',repo:'r',checkSuiteId:'55',cursor:null});
  assert.equal(suites.items[0].check_suite_id,'55');
  assert.equal(runs.items[0].check_run_id,'66');
  assert.ok(calls.every(c=>c.method==='GET'));
});

test('adapter requires suite-scoped check collection, not ref check-runs', async () => {
  let prReads=0;
  const client={
    getPullRequest:async()=>{prReads++; return pr();},
    listCheckSuites:async()=>({items:[{provider:'github',check_suite_id:'55',head_sha:H,app_identity:'app:2:actions'}],next:null,provider_complete:true}),
    listCheckRunsForSuite:async()=>({items:[{provider:'github',check_run_id:'66',check_suite_id:'55',head_sha:H,name:'ci',status:'completed',conclusion:'success',app_identity:'app:2:actions',verification_state:'PROVIDER_ASSERTED'}],next:null,provider_complete:true}),
    listWorkflowRuns:async()=>({items:[{provider:'github',workflow_run_id:'77',check_suite_id:'55',workflow_id:'88',head_sha:H,run_attempt:'1',status:'completed',conclusion:'success'}],next:null,provider_complete:true}),
    listArtifacts:async()=>({items:[],next:null,provider_complete:true})
  };
  const out=await collectGithubReadEvidence(client,{owner:'o',repo:'r',prNumber:'9'});
  assert.equal(out.validity.status,'PARTIAL');
  assert.equal(out.observed.checks[0].check_run_id,'66');
  assert.equal(out.observed.checks[0].run_attempt,null);
  assert.equal(prReads,2);
});
