import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLogicalChecks } from '../src/check-selection.mjs';

const head = 'a'.repeat(40);
function check(overrides = {}) {
  return {
    provider: 'github',
    immutable_workflow_identity: 'wf-blob-1',
    logical_job_identity: 'test-job',
    head_sha: head,
    run_attempt: '1',
    check_run_id: '100',
    status: 'completed',
    conclusion: 'success',
    app_identity: 'github-actions',
    verification_state: 'IMMUTABLE_ID_MATCH',
    ...overrides
  };
}

test('higher run_attempt is satisfaction candidate while history is retained', () => {
  const all = [check(), check({ run_attempt: '2', check_run_id: '200' })];
  const out = selectLogicalChecks(all, head);
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].attempts.length, 2);
  assert.equal(out.groups[0].selected.check_run_id, '200');
  assert.equal(out.groups[0].state, 'SATISFIABLE');
});

test('conflicting latest same-attempt checks are AMBIGUOUS and cannot satisfy', () => {
  const all = [
    check({ run_attempt: '2', check_run_id: '200', conclusion: 'success' }),
    check({ run_attempt: '2', check_run_id: '201', conclusion: 'failure' })
  ];
  const out = selectLogicalChecks(all, head);
  assert.equal(out.groups[0].state, 'AMBIGUOUS');
  assert.equal(out.groups[0].selected, null);
  assert.equal(out.partial, true);
});

test('wrong-head and cancelled attempts remain observed but never satisfy', () => {
  const all = [
    check({ head_sha: 'b'.repeat(40), check_run_id: '300' }),
    check({ run_attempt: '2', check_run_id: '301', status: 'cancelled', conclusion: null })
  ];
  const out = selectLogicalChecks(all, head);
  assert.equal(out.groups.reduce((n, group) => n + group.attempts.length, 0), 2);
  assert.equal(out.groups.every((group) => group.selected === null), true);
  assert.equal(out.groups.every((group) => group.state === 'UNSATISFIED'), true);
});

test('single third-party exact-head check can satisfy check evidence without invented run_attempt', () => {
  const thirdParty = check({
    immutable_workflow_identity: undefined,
    immutable_check_source_identity: 'github-check-source:app:42:codecov',
    logical_job_identity: 'check:coverage',
    run_attempt: null,
    check_run_id: '900',
    app_identity: 'app:42:codecov'
  });
  const out = selectLogicalChecks([thirdParty], head);
  assert.equal(out.groups[0].state, 'SATISFIABLE');
  assert.equal(out.groups[0].selected.run_attempt, null);
  assert.equal(out.partial, false);
});
