import { collectGithubReadEvidence } from './github-read-adapter.mjs';
import { deriveTestExecutionEvidence } from './test-execution.mjs';
import { bindArtifactsToRuns } from './artifact-binding.mjs';

const IDS = Object.freeze([
  'STALE_OR_MIXED_GENERATION',
  'TEST_NAME_NON_INFERENCE',
  'ARTIFACT_PROVENANCE_MISMATCH'
]);

const BASELINE_SCOPE = 'MINIMAL_NATIVE_PR_SUMMARY_V1';
const CLAIM_SCOPE = 'MATERIAL_DELTA_OVER_BASELINE_ONLY';

function green(check) {
  return check?.status === 'completed' && check?.conclusion === 'success';
}

function deriveNativeSignal(id, observation) {
  const obs = observation && typeof observation === 'object' ? observation : {};
  if (id === IDS[0]) {
    const checks = Array.isArray(obs.checks) ? obs.checks : [];
    return checks.length > 0 && checks.every(green) ? 'GREEN_CHECKS' : 'NOT_GREEN';
  }
  if (id === IDS[1]) {
    const checks = Array.isArray(obs.checks) ? obs.checks : [];
    const visibleGreenTests = checks.some((check) => green(check) && /test/i.test(String(check?.name ?? '')));
    return visibleGreenTests ? 'GREEN_CHECK_NAMED_TESTS' : 'NO_GREEN_TEST_NAMED_CHECK';
  }
  if (id === IDS[2]) {
    const artifacts = Array.isArray(obs.artifacts) ? obs.artifacts : [];
    const artifactVisible = artifacts.some((artifact) => String(artifact?.retention_state ?? '').toLowerCase() === 'available');
    return green(obs.workflow) && artifactVisible ? 'GREEN_WORKFLOW_ARTIFACT_PRESENT' : 'NO_GREEN_WORKFLOW_ARTIFACT';
  }
  return 'UNKNOWN_BASELINE';
}

function assess(item) {
  if (item.id === IDS[0]) {
    return item.native_signal === 'GREEN_CHECKS'
      && item.trustpr_signal?.status === 'STALE'
      && item.trustpr_signal?.reason === 'SNAPSHOT_CHANGED';
  }
  if (item.id === IDS[1]) {
    return item.native_signal === 'GREEN_CHECK_NAMED_TESTS'
      && item.trustpr_signal?.state === 'UNKNOWN'
      && item.trustpr_signal?.reason === 'NO_MACHINE_EXECUTION_EVIDENCE';
  }
  if (item.id === IDS[2]) {
    return item.native_signal === 'GREEN_WORKFLOW_ARTIFACT_PRESENT'
      && item.trustpr_signal?.partial === true
      && item.trustpr_signal?.verification_state === 'UNKNOWN'
      && item.trustpr_signal?.reason === 'PRODUCING_RUN_SUBJECT_MISMATCH';
  }
  return false;
}
export function evaluateProductFalsifierResults(results) {
  const items = Array.isArray(results) ? results : [];
  const validSet = items.length === IDS.length
    && IDS.every((id, index) => items[index]?.id === id);
  if (!validSet) {
    return {
      status: 'FAIL', recommendation: 'KILL_OR_NARROW',
      reason: 'INVALID_FIXTURE_SET',
      baseline_scope: BASELINE_SCOPE,
      claim_scope: CLAIM_SCOPE,
      fixtures: []
    };
  }
  const fixtures = items.map((item) => {
    const normalized = {
      ...item,
      native_surface: BASELINE_SCOPE,
      native_signal: deriveNativeSignal(item.id, item.baseline_observation)
    };
    return { ...normalized, materially_stronger: assess(normalized) };
  });
  const pass = fixtures.every((item) => item.materially_stronger === true);
  return {
    status: pass ? 'PASS' : 'FAIL',
    recommendation: pass ? 'PROCEED_V1' : 'KILL_OR_NARROW',
    baseline_scope: BASELINE_SCOPE,
    claim_scope: CLAIM_SCOPE,
    fixtures
  };
}

function snapshot(head) {
  return {
    repository_id: 'repo-1', pull_request_number: '42',
    base_repository_id: 'repo-1', head_repository_id: 'repo-1',
    base_commit_sha: 'a'.repeat(40), head_commit_sha: head
  };
}
async function staleFixture() {
  const firstHead = 'b'.repeat(40);
  const secondHead = 'c'.repeat(40);
  const suite = { provider: 'github', check_suite_id: 'suite-1', head_sha: firstHead, app_identity: 'app:1:actions' };
  const check = { provider: 'github', check_run_id: 'check-1', check_suite_id: 'suite-1', head_sha: firstHead, name: 'ci', status: 'completed', conclusion: 'success', app_identity: 'app:1:actions', verification_state: 'PROVIDER_ASSERTED' };
  const run = { provider: 'github', workflow_run_id: 'run-1', check_suite_id: 'suite-1', workflow_id: 'wf-1', head_sha: firstHead, run_attempt: '1', status: 'completed', conclusion: 'success' };
  let snapshotReads = 0;
  const client = {
    async getPullRequest() {
      snapshotReads += 1;
      return snapshot(snapshotReads === 1 ? firstHead : secondHead);
    },
    async listCheckSuites() {
      return { items: [suite], next: null };
    },
    async listCheckRunsForSuite() {
      return { items: [check], next: null };
    },
    async listWorkflowRuns() {
      return { items: [run], next: null };
    },
    async listArtifacts() { return { items: [], next: null }; }
  };
  const result = await collectGithubReadEvidence(client, { owner: 'acme', repo: 'widget', prNumber: 42 });
  return {
    id: IDS[0],
    baseline_observation: {
      checks: [{ name: check.name, status: check.status, conclusion: check.conclusion }]
    },
    trustpr_signal: { status: result.validity.status, reason: result.validity.reasons[0]?.code ?? null }
  };
}
function testNameFixture() {
  const head = 'd'.repeat(40);
  const check = {
    provider: 'github', workflow_run_id: 'run-tests', run_attempt: '1',
    head_sha: head, name: 'tests', status: 'completed', conclusion: 'success'
  };
  const execution = deriveTestExecutionEvidence([check], [], head)[0];
  return {
    id: IDS[1],
    baseline_observation: {
      checks: [{ name: check.name, status: check.status, conclusion: check.conclusion }]
    },
    trustpr_signal: { state: execution.state, reason: execution.reason ?? null }
  };
}

function artifactMismatchFixture() {
  const expectedHead = 'e'.repeat(40);
  const wrongHead = 'f'.repeat(40);
  const artifact = {
    provider: 'github', artifact_id: 'artifact-1',
    producing_run_id: 'run-artifact', attempt: '1',
    retention_state: 'available', provider_digest: null
  };
  const run = {
    provider: 'github', workflow_run_id: 'run-artifact', run_attempt: '1',
    head_sha: wrongHead, status: 'completed', conclusion: 'success'
  };
  const binding = bindArtifactsToRuns([artifact], [run], expectedHead);
  return {
    id: IDS[2],
    baseline_observation: {
      workflow: { status: run.status, conclusion: run.conclusion },
      artifacts: [{ retention_state: artifact.retention_state }]
    },
    trustpr_signal: {
      partial: binding.partial,
      verification_state: binding.items[0]?.verification_state ?? null,
      reason: binding.items[0]?.reason ?? null
    }
  };
}

export async function runMandatoryProductFalsifiers() {
  const results = [
    await staleFixture(),
    testNameFixture(),
    artifactMismatchFixture()
  ];
  return evaluateProductFalsifierResults(results);
}
