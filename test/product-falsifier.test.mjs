import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProductFalsifierResults,
  runMandatoryProductFalsifiers
} from '../src/product-falsifier.mjs';

const IDS = [
  'STALE_OR_MIXED_GENERATION',
  'TEST_NAME_NON_INFERENCE',
  'ARTIFACT_PROVENANCE_MISMATCH'
];

test('mandatory falsifiers prove three material deltas over minimal native surface', async () => {
  const report = await runMandatoryProductFalsifiers();
  assert.equal(report.status, 'PASS');
  assert.equal(report.recommendation, 'PROCEED_V1');
  assert.deepEqual(report.fixtures.map((item) => item.id), IDS);
  assert.deepEqual(report.fixtures.map((item) => item.materially_stronger), [true, true, true]);
  assert.equal('trust_score' in report, false);
});

test('stale fixture: green native check cannot hide S0/S1 subject change', async () => {
  const report = await runMandatoryProductFalsifiers();
  const item = report.fixtures[0];
  assert.equal(item.native_signal, 'GREEN_CHECKS');
  assert.equal(item.trustpr_signal.status, 'STALE');
  assert.equal(item.trustpr_signal.reason, 'SNAPSHOT_CHANGED');
});
test('test-name fixture: successful tests check is not command execution proof', async () => {
  const report = await runMandatoryProductFalsifiers();
  const item = report.fixtures[1];
  assert.equal(item.native_signal, 'GREEN_CHECK_NAMED_TESTS');
  assert.equal(item.trustpr_signal.state, 'UNKNOWN');
  assert.equal(item.trustpr_signal.reason, 'NO_MACHINE_EXECUTION_EVIDENCE');
});

test('artifact fixture: present artifact from wrong subject remains UNKNOWN/PARTIAL', async () => {
  const report = await runMandatoryProductFalsifiers();
  const item = report.fixtures[2];
  assert.equal(item.native_signal, 'GREEN_WORKFLOW_ARTIFACT_PRESENT');
  assert.equal(item.trustpr_signal.partial, true);
  assert.equal(item.trustpr_signal.verification_state, 'UNKNOWN');
  assert.equal(item.trustpr_signal.reason, 'PRODUCING_RUN_SUBJECT_MISMATCH');
});

test('no material delta forces KILL_OR_NARROW instead of false PASS', () => {
  const weak = [
    { id: IDS[0], native_signal: 'GREEN_CHECKS', trustpr_signal: { status: 'VALID', reason: null } },
    { id: IDS[1], native_signal: 'GREEN_CHECK_NAMED_TESTS', trustpr_signal: { state: 'OBSERVED', reason: null } },
    { id: IDS[2], native_signal: 'GREEN_WORKFLOW_ARTIFACT_PRESENT', trustpr_signal: { partial: false, verification_state: 'IMMUTABLE_ID_MATCH', reason: null } }
  ];
  const report = evaluateProductFalsifierResults(weak);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.recommendation, 'KILL_OR_NARROW');
  assert.deepEqual(report.fixtures.map((item) => item.materially_stronger), [false, false, false]);
});
test('baseline signal is derived from observation and cannot be self-asserted', () => {
  const spoofed = [
    { id: IDS[0], native_signal: 'GREEN_CHECKS', baseline_observation: { checks: [{ status: 'completed', conclusion: 'failure' }] }, trustpr_signal: { status: 'STALE', reason: 'SNAPSHOT_CHANGED' } },
    { id: IDS[1], native_signal: 'GREEN_CHECK_NAMED_TESTS', baseline_observation: { checks: [{ name: 'tests', status: 'completed', conclusion: 'failure' }] }, trustpr_signal: { state: 'UNKNOWN', reason: 'NO_MACHINE_EXECUTION_EVIDENCE' } },
    { id: IDS[2], native_signal: 'GREEN_WORKFLOW_ARTIFACT_PRESENT', baseline_observation: { workflow: { status: 'completed', conclusion: 'failure' }, artifacts: [] }, trustpr_signal: { partial: true, verification_state: 'UNKNOWN', reason: 'PRODUCING_RUN_SUBJECT_MISMATCH' } }
  ];
  const report = evaluateProductFalsifierResults(spoofed);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.recommendation, 'KILL_OR_NARROW');
  assert.deepEqual(report.fixtures.map((item) => item.materially_stronger), [false, false, false]);
});

test('report limits claim to the explicit minimal native PR summary baseline', async () => {
  const report = await runMandatoryProductFalsifiers();
  assert.equal(report.baseline_scope, 'MINIMAL_NATIVE_PR_SUMMARY_V1');
  assert.equal(report.claim_scope, 'MATERIAL_DELTA_OVER_BASELINE_ONLY');
});
test('near-miss TrustPR states with wrong reasons do not count as material deltas', () => {
  const nearMiss = [
    { id: IDS[0], baseline_observation: { checks: [{ status: 'completed', conclusion: 'success' }] }, trustpr_signal: { status: 'STALE', reason: 'OTHER' } },
    { id: IDS[1], baseline_observation: { checks: [{ name: 'tests', status: 'completed', conclusion: 'success' }] }, trustpr_signal: { state: 'UNKNOWN', reason: 'OTHER' } },
    { id: IDS[2], baseline_observation: { workflow: { status: 'completed', conclusion: 'success' }, artifacts: [{ retention_state: 'available' }] }, trustpr_signal: { partial: true, verification_state: 'UNKNOWN', reason: 'OTHER' } }
  ];
  const report = evaluateProductFalsifierResults(nearMiss);
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.fixtures.map((item) => item.materially_stronger), [false, false, false]);
});

test('fixture set is closed: missing, duplicate, or extra fixtures fail closed', () => {
  const base = IDS.map((id) => ({ id, baseline_observation: {}, trustpr_signal: {} }));
  assert.equal(evaluateProductFalsifierResults(base.slice(0, 2)).reason, 'INVALID_FIXTURE_SET');
  assert.equal(evaluateProductFalsifierResults([base[0], base[0], base[2]]).reason, 'INVALID_FIXTURE_SET');
  assert.equal(evaluateProductFalsifierResults([...base, { id: 'EXTRA' }]).reason, 'INVALID_FIXTURE_SET');
});
test('one weak fixture is sufficient to force KILL_OR_NARROW', () => {
  const mixed = [
    { id: IDS[0], baseline_observation: { checks: [{ status: 'completed', conclusion: 'success' }] }, trustpr_signal: { status: 'STALE', reason: 'SNAPSHOT_CHANGED' } },
    { id: IDS[1], baseline_observation: { checks: [{ name: 'tests', status: 'completed', conclusion: 'success' }] }, trustpr_signal: { state: 'OBSERVED', reason: null } },
    { id: IDS[2], baseline_observation: { workflow: { status: 'completed', conclusion: 'success' }, artifacts: [{ retention_state: 'available' }] }, trustpr_signal: { partial: true, verification_state: 'UNKNOWN', reason: 'PRODUCING_RUN_SUBJECT_MISMATCH' } }
  ];
  const report = evaluateProductFalsifierResults(mixed);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.recommendation, 'KILL_OR_NARROW');
  assert.deepEqual(report.fixtures.map((item) => item.materially_stronger), [true, false, true]);
});