import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubRestClient } from '../src/github-rest-client.mjs';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';
import { buildReceipt, verifyReceipt } from '../src/receipt.mjs';

const base = '1'.repeat(40);
const head = '2'.repeat(40);
const merge = '3'.repeat(40);

test('REST evidence keeps producing attempts unknown despite current workflow attempt metadata', async () => {
  const calls = [];
  const request = async (req) => {
    calls.push(req);
    if (req.path === '/repos/acme/widget/pulls/42') return {
      data: { number: 42, base: { sha: base, ref: 'main', repo: { id: 77 } }, head: { sha: head, ref: 'feature', repo: { id: 88 } } }
    };
    if (req.path === `/repos/acme/widget/commits/${head}/check-suites`) return {
      data: { total_count: 1, check_suites: [{ id: 20, head_sha: head, app: { id: 30, slug: 'github-actions' } }] }, nextPage: null
    };
    if (req.path === '/repos/acme/widget/check-suites/20/check-runs') return {
      data: { total_count: 1, check_runs: [{ id: 10, name: 'unit', head_sha: head, status: 'completed', conclusion: 'success',
        check_suite: { id: 20 }, app: { id: 30, slug: 'github-actions' } }] }, nextPage: null
    };
    if (req.path === '/repos/acme/widget/actions/runs') return {
      data: { workflow_runs: [{ id: 40, check_suite_id: 20, workflow_id: 50, head_sha: head,
        run_attempt: 2, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml@main' }] }, nextPage: null
    };
    if (req.path === '/repos/acme/widget/actions/runs/40/artifacts') return {
      data: { artifacts: [{ id: 60, expired: false, digest: 'sha256:abc', workflow_run: { id: 40 } }] }, nextPage: null
    };
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  const client = createGithubRestClient(request);
  const out = await collectGithubReadEvidence(client, { owner: 'acme', repo: 'widget', prNumber: 42 });
  assert.equal(calls.every((call) => call.method === 'GET'), true);
  assert.equal(out.observed.checks[0].run_attempt,null);
  assert.equal(out.validity.status, 'PARTIAL');
  assert.equal(out.check_selection.groups[0].state, 'SATISFIABLE');
  assert.equal(out.artifact_bindings.items[0].verification_state, 'UNKNOWN');
  assert.equal(out.artifact_bindings.items[0].reason, 'ARTIFACT_ATTEMPT_NOT_ESTABLISHED');
});

test('GitHub documented workflow-run result cap cannot become false COMPLETE', async () => {
  const request = async (req) => {
    if (req.path === '/repos/acme/widget/pulls/42') return {
      data: { number: 42, base: { sha: base, ref: 'main', repo: { id: 77 } }, head: { sha: head, ref: 'feature', repo: { id: 88 } } }
    };
    if (req.path === `/repos/acme/widget/commits/${head}/check-suites`) return { data: { total_count: 0, check_suites: [] }, nextPage: null };
    if (req.path === '/repos/acme/widget/actions/runs') return {
      data: { total_count: 1000, workflow_runs: [] }, nextPage: null
    };
    throw new Error(`unexpected ${req.path}`);
  };
  const out = await collectGithubReadEvidence(createGithubRestClient(request), {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.validity.status, 'PARTIAL');
  const runs = out.collection_evidence.find((item) => item.collection_kind === 'workflow_runs');
  assert.equal(runs.complete, false);
  assert.equal(runs.failure_code, 'WORKFLOW_RUNS_PROVIDER_CAP');
});

test('malformed successful collection response becomes explicit incomplete evidence',async()=>{
  const request=async req=>{
    if(req.path.endsWith('/pulls/42'))return {data:{number:42,base:{sha:base,repo:{id:77}},head:{sha:head,repo:{id:88}}}};
    if(req.path.endsWith('/check-suites'))return {data:{total_count:0}};
    if(req.path.endsWith('/actions/runs'))return {data:{workflow_runs:[],total_count:0},nextPage:null};
    throw new Error('unexpected fixture request');
  };
  const out=await collectGithubReadEvidence(createGithubRestClient(request),{owner:'acme',repo:'widget',prNumber:42});
  assert.equal(out.validity.status,'PARTIAL');
  assert.equal(out.collection_evidence.find(x=>x.collection_kind==='check_suites').complete,false);
});

test('missing artifact expiry stays incomplete instead of observed available',async()=>{
  const request=async req=>{
    if(req.path.endsWith('/pulls/42'))return {data:{number:42,base:{sha:base,repo:{id:77}},head:{sha:head,repo:{id:88}}}};
    if(req.path.endsWith('/check-suites'))return {data:{check_suites:[],total_count:0},nextPage:null};
    if(req.path.endsWith('/actions/runs'))return {data:{workflow_runs:[{id:40,workflow_id:50,head_sha:head,run_attempt:2}],total_count:1},nextPage:null};
    if(req.path.endsWith('/artifacts'))return {data:{artifacts:[{id:60,workflow_run:{id:40}}],total_count:1},nextPage:null};
    throw new Error('unexpected fixture request');
  };
  const out=await collectGithubReadEvidence(createGithubRestClient(request),{owner:'acme',repo:'widget',prNumber:42});
  assert.equal(out.validity.status,'PARTIAL');
  assert.deepEqual(out.observed.artifacts,[]);
  assert.equal(out.collection_evidence.find(x=>x.collection_kind==='artifacts').complete,false);
});

test('missing suite or workflow head cannot disappear as complete empty evidence', async () => {
  for (const missing of ['check_suites', 'workflow_runs']) {
    const calls = [];
    const request = async req => {
      calls.push(req.path);
      if (req.path.endsWith('/pulls/42')) return {
        data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } }
      };
      if (req.path.endsWith('/check-suites')) return {
        data: { check_suites: missing === 'check_suites' ? [{ id: 20 }] : [], total_count: missing === 'check_suites' ? 1 : 0 }, nextPage: null
      };
      if (req.path.endsWith('/actions/runs')) return {
        data: { workflow_runs: missing === 'workflow_runs' ? [{ id: 40, workflow_id: 50, run_attempt: 2 }] : [], total_count: missing === 'workflow_runs' ? 1 : 0 }, nextPage: null
      };
      throw new Error('unexpected dependent collection request');
    };
    const out = await collectGithubReadEvidence(createGithubRestClient(request), { owner: 'acme', repo: 'widget', prNumber: 42 });
    assert.equal(out.validity.status, 'PARTIAL');
    const evidence = out.collection_evidence.find(item => item.collection_kind === missing);
    assert.equal(evidence.complete, false);
    assert.equal(evidence.item_count, '0');
    assert.equal(calls.some(path => path.endsWith('/check-runs') || path.endsWith('/artifacts')), false);
  }
});

test('missing check head preserves incomplete suite evidence without invalidating its PR identity', async () => {
  const request = async req => {
    if (req.path.endsWith('/pulls/42')) return {
      data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } }
    };
    if (req.path.endsWith('/check-suites')) return { data: { check_suites: [{ id: 20, head_sha: head }], total_count: 1 }, nextPage: null };
    if (req.path.endsWith('/check-runs')) return { data: { check_runs: [{ id: 10, name: 'unit', status: 'completed', conclusion: 'success' }], total_count: 1 }, nextPage: null };
    if (req.path.endsWith('/actions/runs')) return { data: { workflow_runs: [], total_count: 0 }, nextPage: null };
    throw new Error('unexpected fixture request');
  };
  const out = await collectGithubReadEvidence(createGithubRestClient(request), { owner: 'acme', repo: 'widget', prNumber: 42 });
  assert.equal(out.validity.status, 'PARTIAL');
  assert.deepEqual(out.observed.checks, []);
  assert.equal(out.collection_evidence.find(item => item.collection_kind === 'check_runs').complete, false);
});

test('known foreign generation remains INVALID beside malformed records in either order', async () => {
  const other = 'f'.repeat(40);
  for (const kind of ['check_suites', 'workflow_runs']) {
    for (const records of [[{ id: 20, workflow_id: 50, head_sha: other }, { id: 21 }], [{ id: 21 }, { id: 20, workflow_id: 50, head_sha: other }]]) {
      const request = async req => {
        if (req.path.endsWith('/pulls/42')) return { data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } } };
        if (req.path.endsWith('/check-suites')) return { data: { check_suites: kind === 'check_suites' ? records : [], total_count: kind === 'check_suites' ? 2 : 0 }, nextPage: null };
        if (req.path.endsWith('/actions/runs')) return { data: { workflow_runs: kind === 'workflow_runs' ? records : [], total_count: kind === 'workflow_runs' ? 2 : 0 }, nextPage: null };
        throw new Error('unexpected dependent collection request');
      };
      const out = await collectGithubReadEvidence(createGithubRestClient(request), { owner: 'acme', repo: 'widget', prNumber: 42 });
      assert.equal(out.validity.status, 'INVALID');
      assert.equal(out.validity.reasons[0].code, 'PROVIDER_GENERATION_MISMATCH');
      const evidence = out.collection_evidence.find(item => item.collection_kind === kind);
      assert.equal(evidence.complete, false);
      assert.equal(evidence.item_count, '1');
      assert.equal(evidence.failure_code, 'PROVIDER_RESPONSE_INVALID');
      assert.equal(evidence.retryable, false);
    }
  }
});

test('malformed check record preserves usable receipt and valid neighboring checks', async () => {
  const valid = { id: 10, head_sha: head, name: 'unit', status: 'completed', conclusion: 'success' };
  for (const malformed of [{ ...valid, id: undefined }, { ...valid, id: false }, { ...valid, status: 'unexpected' }, { ...valid, conclusion: 123 }]) {
    const request = async req => {
      if (req.path.endsWith('/pulls/42')) return { data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } } };
      if (req.path.endsWith('/check-suites')) return { data: { check_suites: [{ id: 20, head_sha: head }], total_count: 1 }, nextPage: null };
      if (req.path.endsWith('/check-runs')) return { data: { check_runs: [malformed, valid], total_count: 2 }, nextPage: null };
      if (req.path.endsWith('/actions/runs')) return { data: { workflow_runs: [], total_count: 0 }, nextPage: null };
      throw new Error('unexpected fixture request');
    };
    const target = { owner: 'acme', repo: 'widget', prNumber: '42' };
    const evidence = await collectGithubReadEvidence(createGithubRestClient(request), target);
    const receipt = buildReceipt({ target, evidence, diff: { status: 'VALID', base_commit_sha: base, head_commit_sha: head, merge_base_sha: merge, changed_entries: [], unknowns: [] } });
    assert.equal(receipt.core.validity.status, 'PARTIAL');
    assert.equal(receipt.core.observed.checks.length, 1);
    assert.equal(receipt.core.observed.checks[0].check_run_id, '10');
    assert.ok(receipt.core.unknowns.some(item => item.stable_code === 'PROVIDER_RESPONSE_INVALID' && item.field_or_source_tuple === 'check_runs'));
    assert.equal(verifyReceipt(receipt).merge_authorized, false);
  }
});

test('a missing count remains incomplete while preserving observed records', async () => {
  const request = async req => {
    if (req.path.endsWith('/pulls/42')) return { data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } } };
    if (req.path.endsWith('/check-suites')) return { data: { check_suites: [{ id: 20, head_sha: head }] }, nextPage: null };
    if (req.path.endsWith('/check-runs')) return { data: { check_runs: [], total_count: 0 }, nextPage: null };
    if (req.path.endsWith('/actions/runs')) return { data: { workflow_runs: [], total_count: 0 }, nextPage: null };
    throw new Error('unexpected fixture request');
  };
  const out = await collectGithubReadEvidence(createGithubRestClient(request), { owner: 'acme', repo: 'widget', prNumber: 42 });
  assert.equal(out.validity.status, 'PARTIAL');
  const evidence = out.collection_evidence.find(item => item.collection_kind === 'check_suites');
  assert.equal(evidence.complete, false);
  assert.equal(evidence.item_count, '1');
  assert.equal(evidence.failure_code, 'PROVIDER_RESPONSE_INVALID');
});

test('provider count smaller than its returned collection remains explicitly incomplete', async () => {
  for (const kind of ['check_suites', 'check_runs', 'workflow_runs', 'artifacts']) {
    const request = async req => {
      if (req.path.endsWith('/pulls/42')) return { data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } } };
      if (req.path.endsWith('/check-suites')) return {
        data: { check_suites: [{ id: 20, head_sha: head }], total_count: kind === 'check_suites' ? 0 : 1 }, nextPage: null
      };
      if (req.path.endsWith('/check-runs')) return {
        data: { check_runs: [{ id: 10, head_sha: head, name: 'unit', status: 'completed', conclusion: 'success' }], total_count: kind === 'check_runs' ? 0 : 1 }, nextPage: null
      };
      if (req.path.endsWith('/actions/runs')) return {
        data: { workflow_runs: [{ id: 40, workflow_id: 50, head_sha: head, run_attempt: 1 }], total_count: kind === 'workflow_runs' ? 0 : 1 }, nextPage: null
      };
      if (req.path.endsWith('/artifacts')) return {
        data: { artifacts: [{ id: 60, expired: false }], total_count: kind === 'artifacts' ? 0 : 1 }, nextPage: null
      };
      throw new Error('unexpected fixture request');
    };
    const target = { owner: 'acme', repo: 'widget', prNumber: '42' };
    const evidence = await collectGithubReadEvidence(createGithubRestClient(request), target);
    const collection = evidence.collection_evidence.find(item => item.collection_kind === kind);
    assert.equal(collection.complete, false);
    assert.equal(collection.item_count, '1');
    assert.equal(collection.failure_code, 'PROVIDER_RESULT_COUNT_MISMATCH');
    const receipt = buildReceipt({ target, evidence, diff: { status: 'VALID', base_commit_sha: base, head_commit_sha: head, merge_base_sha: merge, changed_entries: [], unknowns: [] } });
    assert.ok(receipt.core.unknowns.some(item => item.stable_code === 'PROVIDER_RESULT_COUNT_MISMATCH' && item.field_or_source_tuple === kind));
    assert.equal(verifyReceipt(receipt).merge_authorized, false);
  }
});

test('changing provider totals between pages cannot appear complete by taking their maximum', async () => {
  for (const kind of ['check_suites', 'check_runs', 'workflow_runs', 'artifacts']) {
    for (const totals of [[2, 1], [1, 2]]) {
      const request = async req => {
        const page = req.query?.page ?? 1;
        const changing = (name, record) => ({
          data: { [name]: [record], total_count: totals[page - 1] },
          nextPage: page === 1 ? 2 : null
        });
        if (req.path.endsWith('/pulls/42')) return { data: { number: 42, base: { sha: base, repo: { id: 77 } }, head: { sha: head, repo: { id: 88 } } } };
        if (req.path.endsWith('/check-suites')) return kind === 'check_suites'
          ? changing('check_suites', { id: 19 + page, head_sha: head })
          : { data: { check_suites: [{ id: 20, head_sha: head }], total_count: 1 }, nextPage: null };
        if (req.path.endsWith('/check-runs')) return kind === 'check_runs'
          ? changing('check_runs', { id: 9 + page, head_sha: head, name: 'unit-' + page, status: 'completed', conclusion: 'success' })
          : { data: { check_runs: [], total_count: 0 }, nextPage: null };
        if (req.path.endsWith('/actions/runs')) return kind === 'workflow_runs'
          ? changing('workflow_runs', { id: 39 + page, workflow_id: 50, head_sha: head, run_attempt: 1 })
          : { data: { workflow_runs: [{ id: 40, workflow_id: 50, head_sha: head, run_attempt: 1 }], total_count: 1 }, nextPage: null };
        if (req.path.endsWith('/artifacts')) return kind === 'artifacts'
          ? changing('artifacts', { id: 59 + page, expired: false })
          : { data: { artifacts: [], total_count: 0 }, nextPage: null };
        throw new Error('unexpected fixture request');
      };
      const target = { owner: 'acme', repo: 'widget', prNumber: '42' };
      const evidence = await collectGithubReadEvidence(createGithubRestClient(request), target);
      const collection = evidence.collection_evidence.find(item => item.collection_kind === kind);
      assert.equal(collection.complete, false);
      assert.equal(collection.item_count, '2');
      assert.equal(collection.pages_observed, '2');
      assert.equal(collection.failure_code, 'PROVIDER_RESULT_COUNT_MISMATCH');
      const receipt = buildReceipt({ target, evidence, diff: { status: 'VALID', base_commit_sha: base, head_commit_sha: head, merge_base_sha: merge, changed_entries: [], unknowns: [] } });
      assert.ok(receipt.core.unknowns.some(item => item.stable_code === 'PROVIDER_RESULT_COUNT_MISMATCH' && item.field_or_source_tuple === kind));
      assert.equal(verifyReceipt(receipt).merge_authorized, false);
    }
  }
});
