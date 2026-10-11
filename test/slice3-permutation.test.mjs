import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

const H='a'.repeat(40), B='b'.repeat(40);
const snap={repository_id:'1',pull_request_number:'2',base_repository_id:'1',head_repository_id:'1',base_commit_sha:B,head_commit_sha:H};
const suites=[
  {provider:'github',check_suite_id:'10',head_sha:H,app_identity:'app:1:x'},
  {provider:'github',check_suite_id:'20',head_sha:H,app_identity:'app:2:y'}
];
const checks={
  '10':{provider:'github',check_run_id:'101',check_suite_id:'10',head_sha:H,name:'a',status:'completed',conclusion:'success',app_identity:'app:1:x',verification_state:'PROVIDER_ASSERTED'},
  '20':{provider:'github',check_run_id:'201',check_suite_id:'20',head_sha:H,name:'b',status:'completed',conclusion:'success',app_identity:'app:2:y',verification_state:'PROVIDER_ASSERTED'}
};
function client(reverse){ return {
  getPullRequest:async()=>snap,
  listCheckSuites:async()=>({items:reverse?[...suites].reverse():suites,next:null,provider_complete:true}),
  listCheckRunsForSuite:async({checkSuiteId})=>({items:[checks[checkSuiteId]],next:null,provider_complete:true}),
  listWorkflowRuns:async()=>({items:[],next:null,provider_complete:true}),
  listArtifacts:async()=>({items:[],next:null,provider_complete:true})
}; }

test('provider arrival-order permutations produce byte-equivalent adapter result', async()=>{
  const a=await collectGithubReadEvidence(client(false),{owner:'o',repo:'r',prNumber:'2'});
  const b=await collectGithubReadEvidence(client(true),{owner:'o',repo:'r',prNumber:'2'});
  assert.deepEqual(a,b);
});