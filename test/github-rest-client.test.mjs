import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubRestClient } from '../src/github-rest-client.mjs';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const merge = 'c'.repeat(40);

function fakeRequest(responses, calls) {
  return async (request) => {
    calls.push(request);
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  };
}

test('getPullRequest uses one GET and returns closed fork-aware identity', async () => {
  const calls = [];
  const request = fakeRequest([
    { data: { number: 42, base: { sha: base, ref: 'main', repo: { id: 99 } }, head: { sha: head, ref: 'feature', repo: { id: 199 } } } }
  ], calls);
  const client = createGithubRestClient(request);
  const out = await client.getPullRequest({ owner: 'acme', repo: 'widget', prNumber: 42 });
  assert.deepEqual(out, {
    repository_id: '99', pull_request_number: '42', base_repository_id: '99',
    head_repository_id: '199', base_commit_sha: base, head_commit_sha: head
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/repos/acme/widget/pulls/42');
});

test('listWorkflowRuns uses exact head_sha filter and maps immutable run fields', async () => {
  const calls = [];
  const request = fakeRequest([{ data: { total_count: 1, workflow_runs: [{
    id: 501, check_suite_id: 601, workflow_id: 701, head_sha: head,
    run_attempt: 2, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml@main'
  }] }, nextPage: null }], calls);
  const client = createGithubRestClient(request);
  const out = await client.listWorkflowRuns({ owner: 'acme', repo: 'widget', headSha: head, cursor: null });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/repos/acme/widget/actions/runs');
  assert.equal(calls[0].query.head_sha, head);
  assert.equal(calls[0].query.per_page, 100);
  assert.equal(out.items[0].workflow_run_id, '501');
  assert.equal(out.items[0].run_attempt, '2');
  assert.equal(out.items[0].head_sha, head);
  assert.equal(out.provider_complete, true);
});

test('listArtifacts preserves run identity without inventing an artifact attempt', async () => {
  const calls = [];
  const request = fakeRequest([{ data: { total_count: 1, artifacts: [{
    id: 801, expired: false, digest: 'sha256:abc', workflow_run: { id: 501 }
  }] }, nextPage: null }], calls);
  const client = createGithubRestClient(request);
  const out = await client.listArtifacts({
    owner: 'acme', repo: 'widget', workflowRunId: '501', runAttempt: '2', cursor: null
  });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/repos/acme/widget/actions/runs/501/artifacts');
  assert.equal(out.items[0].artifact_id, '801');
  assert.equal(out.items[0].producing_run_id, '501');
  assert.equal(out.items[0].attempt, null);
  assert.equal(out.items[0].retention_state, 'available');
  assert.equal(out.provider_complete, true);
});

test('legacy ref check-runs endpoint is not exposed by V1 client', () => {
  const client = createGithubRestClient(async () => { throw new Error('must not be called'); });
  assert.equal(typeof client.listChecks, 'undefined');
});

test('artifact availability requires an explicit provider boolean',async()=>{
  const args={owner:'acme',repo:'widget',workflowRunId:'501',runAttempt:'2',cursor:null};
  for(const expired of [undefined,null,'false',0]){
    const client=createGithubRestClient(async()=>({data:{artifacts:[{id:801,expired}],total_count:1},nextPage:null}));
    const out=await client.listArtifacts(args);
    assert.deepEqual(out.items,[]);
    assert.equal(out.provider_complete,false);
    assert.equal(out.failure_code,'PROVIDER_RESPONSE_INVALID');
  }
  for(const expired of [true,false]){
    const client=createGithubRestClient(async()=>({data:{artifacts:[{id:801,expired}],total_count:1},nextPage:null}));
    const out=await client.listArtifacts(args);
    assert.equal(out.items[0].retention_state,expired?'expired':'available');
    assert.equal(out.provider_complete,true);
  }
});

test('missing provider collections cannot become successful empty evidence', async () => {
  const client=createGithubRestClient(async()=>({data:{total_count:0},nextPage:null}));
  const args={owner:'acme',repo:'widget',headSha:head,checkSuiteId:'601',workflowRunId:'501',runAttempt:'2',cursor:null};
  for(const method of ['listCheckSuites','listCheckRunsForSuite','listWorkflowRuns','listArtifacts'])
    await assert.rejects(client[method](args),e=>e.code==='PROVIDER_RESPONSE_INVALID');
});

test('commit-scoped collections require an explicit full provider head SHA', async () => {
  const args = { owner: 'acme', repo: 'widget', headSha: head, checkSuiteId: '601', cursor: null };
  const collections = [
    ['listCheckSuites', 'check_suites'],
    ['listCheckRunsForSuite', 'check_runs'],
    ['listWorkflowRuns', 'workflow_runs']
  ];
  for (const [method, name] of collections) {
    for (const head_sha of [undefined, null, '', 'short', 123, 'B'.repeat(40)]) {
      const client = createGithubRestClient(async () => ({
        data: { [name]: [{ id: 601, workflow_id: 701, status: 'completed', head_sha }], total_count: 1 }, nextPage: null
      }));
      const out = await client[method](args);
      assert.deepEqual(out.items, []);
      assert.equal(out.provider_complete, false);
      assert.equal(out.failure_code, 'PROVIDER_RESPONSE_INVALID');
    }
    const client = createGithubRestClient(async () => ({
      data: { [name]: [{ id: 601, workflow_id: 701, status: 'completed', head_sha: head }], total_count: 1 }, nextPage: null
    }));
    assert.equal((await client[method](args)).items[0].head_sha, head);
  }
});

test('provider count is never coerced or inferred from an absent field', async () => {
  const args = { owner: 'acme', repo: 'widget', headSha: head, checkSuiteId: '601', workflowRunId: '501', cursor: null };
  const collections = [['listCheckSuites', 'check_suites'], ['listCheckRunsForSuite', 'check_runs'], ['listWorkflowRuns', 'workflow_runs'], ['listArtifacts', 'artifacts']];
  for (const [method, name] of collections) {
    for (const total_count of [undefined, null, '', '0', false, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const client = createGithubRestClient(async () => ({ data: { [name]: [], total_count }, nextPage: null }));
      const out = await client[method](args);
      assert.equal(out.reported_total_count, null);
      assert.equal(out.provider_complete, false);
      assert.equal(out.failure_code, 'PROVIDER_RESPONSE_INVALID');
    }
    const client = createGithubRestClient(async () => ({ data: { [name]: [], total_count: 0 }, nextPage: null }));
    const out = await client[method](args);
    assert.equal(out.reported_total_count, 0);
    assert.equal(out.provider_complete, true);
  }
});

test('malformed record leaves every valid record visible in either page order', async () => {
  const args = { owner: 'acme', repo: 'widget', headSha: head, checkSuiteId: '601', workflowRunId: '501', cursor: null };
  for (const [method, name] of [['listCheckSuites', 'check_suites'], ['listCheckRunsForSuite', 'check_runs'], ['listWorkflowRuns', 'workflow_runs'], ['listArtifacts', 'artifacts']]) {
    const valid = { id: 601, workflow_id: 701, status: 'completed', head_sha: head, expired: false };
    for (const malformed of [null, [], { id: 602 }]) {
      for (const records of [[valid, malformed], [malformed, valid]]) {
        const client = createGithubRestClient(async () => ({ data: { [name]: records, total_count: 2 }, nextPage: null }));
        const out = await client[method](args);
        assert.equal(out.items.length, 1);
        assert.equal(out.provider_complete, false);
        assert.equal(out.failure_code, 'PROVIDER_RESPONSE_INVALID');
      }
    }
  }
});
