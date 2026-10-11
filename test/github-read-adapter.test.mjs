import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

function pr(head_sha) {
  return {
    repository_id: 'repo-1',
    pull_request_number: '42',
    base_repository_id: 'repo-1',
    head_repository_id: 'repo-1',
    base_commit_sha: 'a'.repeat(40),
    head_commit_sha: head_sha,
    merge_base_sha: '0'.repeat(40),
    base_ref: 'main',
    head_ref: 'feature'
  };
}

function fullCheck(head, id = '1') {
  return {
    provider: 'github', immutable_workflow_identity: 'wf-1', logical_job_identity: 'job-1',
    head_sha: head, run_attempt: '1', check_run_id: id,
    status: 'completed', conclusion: 'success', app_identity: 'gha',
    verification_state: 'IMMUTABLE_ID_MATCH'
  };
}

function suite(head, id = 'suite-1') {
  return { provider: 'github', check_suite_id: id, head_sha: head, app_identity: 'gha' };
}

test('S0/S1 head change returns STALE, never coherent success', async () => {
  let reads = 0;
  const client = {
    async getPullRequest() {
      reads += 1;
      return reads === 1 ? pr('b'.repeat(40)) : pr('c'.repeat(40));
    },
    async listCheckSuites() { return { items: [], next: null }; },
    async listCheckRunsForSuite() { return { items: [], next: null }; },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });

  assert.equal(out.validity.status, 'STALE');
  assert.equal(out.validity.reasons[0].code, 'SNAPSHOT_CHANGED');
  assert.equal(out.s0.head_commit_sha, 'b'.repeat(40));
  assert.equal(out.s1.head_commit_sha, 'c'.repeat(40));
});

test('incomplete pagination is explicit PARTIAL, never silently complete', async () => {
  const head = 'd'.repeat(40);
  let checkCalls = 0;
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head)], next: null }; },
    async listCheckRunsForSuite({ cursor }) {
      checkCalls += 1;
      if (!cursor) return { items: [fullCheck(head)], next: 'p2' };
      const error = new Error('rate limited');
      error.code = 'RATE_LIMITED';
      throw error;
    },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(checkCalls, 2);
  assert.equal(out.validity.status, 'PARTIAL');
  const checks = out.collection_evidence.find((item) => item.collection_kind === 'check_runs');
  assert.equal(checks.complete, false);
  assert.equal(checks.pages_observed, '1');
  assert.equal(checks.item_count, '1');
  assert.equal(checks.terminal_state, 'RATE_LIMITED');
});

import { GITHUB_READ_PERMISSIONS } from '../src/github-read-adapter.mjs';

test('permission contract is exactly least-privilege read-only', () => {
  assert.deepEqual(GITHUB_READ_PERMISSIONS, {
    contents: 'read',
    actions: 'read',
    checks: 'read',
    'pull-requests': 'read'
  });
  for (const [name, level] of Object.entries(GITHUB_READ_PERMISSIONS)) {
    assert.equal(level, 'read', `${name} must remain read-only`);
  }
});

test('mixed-generation check evidence is INVALID', async () => {
  const head = 'e'.repeat(40);
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite('f'.repeat(40), 'suite-9')], next: null }; },
    async listCheckRunsForSuite() { return { items: [fullCheck('f'.repeat(40), '9')], next: null }; },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.validity.status, 'INVALID');
  assert.equal(out.validity.reasons[0].code, 'PROVIDER_GENERATION_MISMATCH');
});

test('transient page read returns retry metadata without retrying', async () => {
  const head = '1'.repeat(40);
  let checkCalls = 0;
  const sleeps = [];
  const client = {
    async sleep(ms) { sleeps.push(ms); },
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head)], next: null }; },
    async listCheckRunsForSuite() {
      checkCalls += 1;
      if (checkCalls < 3) {
        const error = new Error('rate limited');
        error.code = 'RATE_LIMITED';
        error.retryAfterMs = 7;
        throw error;
      }
      return { items: [fullCheck(head)], next: null };
    },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(checkCalls, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(out.validity.status, 'PARTIAL');
  const retryEvidence = out.collection_evidence.find((item) => item.collection_kind === 'check_runs');
  assert.equal(retryEvidence.retryable, true);
  assert.equal(retryEvidence.retry_after_ms, 7);
});

test('transient page read is single-attempt PARTIAL', async () => {
  const head = '2'.repeat(40);
  let checkCalls = 0;
  const client = {
    async sleep() {},
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head)], next: null }; },
    async listCheckRunsForSuite() {
      checkCalls += 1;
      const error = new Error('network');
      error.code = 'TRANSIENT_FAILURE';
      throw error;
    },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(checkCalls, 1);
  assert.equal(out.validity.status, 'PARTIAL');
  const checks = out.collection_evidence.find((item) => item.collection_kind === 'check_runs');
  assert.equal(checks.terminal_state, 'TRANSIENT_FAILURE');
});

test('PR identity is closed-projected and provider extras cannot enter snapshot truth', async () => {
  const raw = {
    ...pr('3'.repeat(40)),
    merge_base_sha: '4'.repeat(40),
    merge_authorization: true,
    title: 'hostile extra field'
  };
  const client = {
    async getPullRequest() { return raw; },
    async listCheckSuites() { return { items: [], next: null }; },
    async listCheckRunsForSuite() { return { items: [], next: null }; },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.validity.status, 'VALID');
  assert.equal('merge_authorization' in out.s0, false);
  assert.equal('title' in out.s0, false);
  assert.equal('merge_base_sha' in out.s0, false);
});

test('malformed provider identity fails INVALID without evidence collection', async () => {
  let evidenceCalls = 0;
  const client = {
    async getPullRequest() {
      return { ...pr('not-a-sha'), merge_base_sha: '5'.repeat(40) };
    },
    async listCheckSuites() { evidenceCalls += 1; return { items: [], next: null }; },
    async listCheckRunsForSuite() { evidenceCalls += 1; return { items: [], next: null }; },
    async listWorkflowRuns() { evidenceCalls += 1; return { items: [], next: null }; },
    async listArtifacts() { evidenceCalls += 1; return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.validity.status, 'INVALID');
  assert.equal(out.validity.reasons[0].code, 'PROVIDER_IDENTITY_SCHEMA_INVALID');
  assert.equal(evidenceCalls, 0);
});

test('artifacts are collected per immutable workflow run and bound to current head', async () => {
  const head = '6'.repeat(40);
  const artifactCalls = [];
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [], next: null }; },
    async listCheckRunsForSuite() { return { items: [], next: null }; },
    async listWorkflowRuns() {
      return { items: [{ provider: 'github', workflow_run_id: 'run-7', run_attempt: '2', head_sha: head }], next: null };
    },
    async listArtifacts(args) {
      artifactCalls.push(args);
      return { items: [{ provider: 'github', artifact_id: 'art-1', producing_run_id: 'run-7', attempt: '2', retention_state: 'available' }], next: null };
    }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(artifactCalls.length, 1);
  assert.equal(artifactCalls[0].workflowRunId, 'run-7');
  assert.equal(out.artifact_bindings.items[0].verification_state, 'IMMUTABLE_ID_MATCH');
  assert.equal(out.validity.status, 'VALID');
  const artifactCollection = out.collection_evidence.find((item) => item.collection_kind === 'artifacts');
  assert.equal(typeof artifactCollection.immutable_subject, 'string');
  assert.equal(artifactCollection.complete, true);
});

test('ambiguous latest check attempts force PARTIAL despite complete collection', async () => {
  const head = '7'.repeat(40);
  const baseCheck = {
    provider: 'github', immutable_workflow_identity: 'wf-1', logical_job_identity: 'job-1',
    head_sha: head, run_attempt: '2', status: 'completed', app_identity: 'gha',
    verification_state: 'IMMUTABLE_ID_MATCH'
  };
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head)], next: null }; },
    async listCheckRunsForSuite() { return { items: [
      { ...baseCheck, check_run_id: '1', conclusion: 'success' },
      { ...baseCheck, check_run_id: '2', conclusion: 'failure' }
    ], next: null }; },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.check_selection.partial, true);
  assert.equal(out.validity.status, 'PARTIAL');
});

test('malformed check identity fails closed as INVALID instead of throwing', async () => {
  const head = '8'.repeat(40);
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head)], next: null }; },
    async listCheckRunsForSuite() {
      return { items: [{ ...fullCheck(head), run_attempt: '01' }], next: null };
    },
    async listWorkflowRuns() { return { items: [], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, {
    owner: 'acme', repo: 'widget', prNumber: 42
  });
  assert.equal(out.validity.status, 'INVALID');
  assert.equal(out.validity.reasons[0].code, 'CHECK_SCHEMA_INVALID');
});


test('multiple workflow runs sharing one check suite fail correlation PARTIAL', async () => {
  const head = '9'.repeat(40);
  const rawCheck = {
    provider: 'github', check_run_id: 'check-1', check_suite_id: 'suite-shared',
    head_sha: head, name: 'unit', status: 'completed', conclusion: 'success',
    app_identity: 'app:1:github-actions', verification_state: 'PROVIDER_ASSERTED'
  };
  const client = {
    async getPullRequest() { return pr(head); },
    async listCheckSuites() { return { items: [suite(head, 'suite-shared')], next: null }; },
    async listCheckRunsForSuite() { return { items: [rawCheck], next: null }; },
    async listWorkflowRuns() { return { items: [
      { provider: 'github', workflow_run_id: 'run-1', check_suite_id: 'suite-shared', workflow_id: 'wf', head_sha: head, run_attempt: '1', status: 'completed', conclusion: 'success' },
      { provider: 'github', workflow_run_id: 'run-2', check_suite_id: 'suite-shared', workflow_id: 'wf', head_sha: head, run_attempt: '2', status: 'completed', conclusion: 'success' }
    ], next: null }; },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const out = await collectGithubReadEvidence(client, { owner: 'acme', repo: 'widget', prNumber: 42 });
  assert.equal(out.validity.status, 'PARTIAL');
  assert.equal(out.observed.checks[0].workflow_run_id, null);
  assert.equal(out.observed.checks[0].run_attempt, null);
  assert.equal(out.observed.checks[0].run_correlation_state, 'AMBIGUOUS');
  assert.equal(out.check_selection.groups[0].state, 'AMBIGUOUS');
  assert.equal(out.check_selection.groups[0].selected, null);
});