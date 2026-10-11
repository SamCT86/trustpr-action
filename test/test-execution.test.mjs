import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTestExecutionEvidence } from '../src/test-execution.mjs';

const head = 'a'.repeat(40);
const check = {
  provider: 'github',
  check_run_id: '100',
  workflow_run_id: '200',
  run_attempt: '1',
  head_sha: head,
  name: 'tests',
  status: 'completed',
  conclusion: 'success'
};

test('successful check name alone never proves command execution', () => {
  const out = deriveTestExecutionEvidence([check], [], head);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'UNKNOWN');
  assert.equal(out[0].reason, 'NO_MACHINE_EXECUTION_EVIDENCE');
  assert.equal('command' in out[0], false);
});

test('machine evidence bound to same head/run/attempt becomes OBSERVED', () => {
  const machine = [{
    provider: 'github', workflow_run_id: '200', run_attempt: '1',
    head_sha: head, command: 'npm test', exit_code: '0', evidence_id: 'exec-1'
  }];
  const out = deriveTestExecutionEvidence([check], machine, head);
  assert.equal(out[0].state, 'OBSERVED');
  assert.equal(out[0].command, 'npm test');
  assert.equal(out[0].exit_code, '0');
});

test('wrong-head machine evidence stays UNKNOWN', () => {
  const machine = [{
    provider: 'github', workflow_run_id: '200', run_attempt: '1',
    head_sha: 'b'.repeat(40), command: 'npm test', exit_code: '0', evidence_id: 'exec-2'
  }];
  const out = deriveTestExecutionEvidence([check], machine, head);
  assert.equal(out[0].state, 'UNKNOWN');
  assert.equal(out[0].reason, 'NO_MACHINE_EXECUTION_EVIDENCE');
});
