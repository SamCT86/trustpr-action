import test from 'node:test';
import assert from 'node:assert/strict';
import { bindArtifactsToRuns } from '../src/artifact-binding.mjs';

const head = 'a'.repeat(40);
const artifact = {
  provider: 'github',
  artifact_id: 'artifact-1',
  producing_run_id: 'run-1',
  attempt: '2',
  retention_state: 'available',
  provider_digest: null
};
const run = {
  provider: 'github',
  workflow_run_id: 'run-1',
  run_attempt: '2',
  head_sha: head
};

test('artifact binds to exact producing run and subject head', () => {
  const out = bindArtifactsToRuns([artifact], [run], head);
  assert.equal(out.partial, false);
  assert.equal(out.items[0].verification_state, 'IMMUTABLE_ID_MATCH');
  assert.equal(out.items[0].head_sha, head);
});

test('artifact with missing producing run is UNKNOWN/PARTIAL', () => {
  const out = bindArtifactsToRuns([artifact], [], head);
  assert.equal(out.partial, true);
  assert.equal(out.items[0].verification_state, 'UNKNOWN');
  assert.equal(out.items[0].reason, 'PRODUCING_RUN_UNAVAILABLE');
});

test('artifact without an established attempt cannot bind even to a known run', () => {
  const out=bindArtifactsToRuns([{...artifact,attempt:null}],[run],head);
  assert.equal(out.partial,true);
  assert.equal(out.items[0].verification_state,'UNKNOWN');
  assert.equal(out.items[0].reason,'ARTIFACT_ATTEMPT_NOT_ESTABLISHED');
});

test('wrong-head producing run cannot bind artifact to current subject', () => {
  const out = bindArtifactsToRuns([artifact], [{ ...run, head_sha: 'b'.repeat(40) }], head);
  assert.equal(out.partial, true);
  assert.equal(out.items[0].verification_state, 'UNKNOWN');
  assert.equal(out.items[0].reason, 'PRODUCING_RUN_SUBJECT_MISMATCH');
});


test('expired artifact is UNKNOWN/PARTIAL even with exact producing run', () => {
  const out = bindArtifactsToRuns([{ ...artifact, retention_state: 'expired' }], [run], head);
  assert.equal(out.partial, true);
  assert.equal(out.items[0].verification_state, 'UNKNOWN');
  assert.equal(out.items[0].reason, 'ARTIFACT_UNAVAILABLE');
});
