import { bindArtifactsToRuns } from './artifact-binding.mjs';
import { selectLogicalChecks } from './check-selection.mjs';

export const GITHUB_READ_PERMISSIONS = Object.freeze({
  contents: 'read', actions: 'read', checks: 'read', 'pull-requests': 'read'
});

const SNAPSHOT_FIELDS = [
  'repository_id', 'pull_request_number',
  'base_repository_id', 'head_repository_id',
  'base_commit_sha', 'head_commit_sha'
];
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GLOBAL_PAGE_LIMIT = 100;

function normalizeSnapshot(raw) {
  const out = Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, raw?.[field]]));
  // A public PR may retain commit SHAs after GitHub removes its fork metadata.
  // Diagnose this case without converting an INVALID Action outcome into green.
  if (!SNAPSHOT_FIELDS.filter((field) => field !== 'head_repository_id')
    .every((field) => typeof out[field] === 'string' && out[field].length > 0)) {
    throw new Error('identity');
  }
  if (![out.base_commit_sha, out.head_commit_sha].every((v) => FULL_OID.test(v))) throw new Error('identity');
  if (out.repository_id !== out.base_repository_id) throw new Error('identity');
  if (out.head_repository_id == null) {
    throw Object.assign(new Error('head repository unavailable'), { code: 'HEAD_REPOSITORY_UNAVAILABLE' });
  }
  if (typeof out.head_repository_id !== 'string' || out.head_repository_id.length === 0) throw new Error('identity');
  return out;
}

function sameSnapshot(a, b) {
  return SNAPSHOT_FIELDS.every((field) => a?.[field] === b?.[field]);
}

function statusOf(error) {
  const value = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  return Number.isInteger(value) ? value : null;
}

function classifyProviderError(error) {
  const status = statusOf(error);
  const code = String(error?.code || '');
  const retryAfter = Number(error?.retryAfterMs);
  const retry_after_ms = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null;
  if (code === 'PROVIDER_RESPONSE_INVALID') return { terminal_state: 'TRANSIENT_FAILURE', failure_code: code, retryable: false, retry_after_ms: null };
  if (status === 401) return { terminal_state: 'ACCESS_DENIED', failure_code: 'AUTHENTICATION_FAILED', retryable: false, retry_after_ms: null };
  if (status === 403 || code === 'ACCESS_DENIED') return { terminal_state: 'ACCESS_DENIED', failure_code: 'PERMISSION_DENIED', retryable: false, retry_after_ms: null };
  if (status === 404 || code === 'DELETED') return { terminal_state: 'DELETED', failure_code: 'NOT_FOUND', retryable: false, retry_after_ms: null };
  if (status === 429 || code === 'RATE_LIMITED') return { terminal_state: 'RATE_LIMITED', failure_code: 'RATE_LIMITED', retryable: true, retry_after_ms };
  if ((status !== null && status >= 500) || ['TRANSIENT_FAILURE','ETIMEDOUT','TIMEOUT','ECONNRESET'].includes(code)) {
    return { terminal_state: 'TRANSIENT_FAILURE', failure_code: 'TRANSIENT_FAILURE', retryable: true, retry_after_ms };
  }
  return { terminal_state: 'TRANSIENT_FAILURE', failure_code: 'TRANSIENT_FAILURE', retryable: true, retry_after_ms };
}

function pageLimit(client) {
  const requested = Number(client?.paginationPageLimit);
  if (!Number.isInteger(requested) || requested < 1) return GLOBAL_PAGE_LIMIT;
  return Math.min(requested, GLOBAL_PAGE_LIMIT);
}

function paginationFailureCode(collectionKind) {
  return collectionKind === 'artifacts' ? 'ARTIFACT_PAGINATION_INCOMPLETE' : 'PAGINATION_INCOMPLETE';
}

function itemHeadMismatch(items, expectedHead) {
  return items.some((item) => typeof item?.head_sha === 'string' && item.head_sha !== expectedHead);
}

function compareText(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortBy(items, key) {
  return [...items].sort((a, b) => compareText(key(a), key(b)));
}

async function readPaged(client, method, args, collectionKind, immutableSubject) {
  const items = [];
  let cursor = null;
  let pages = 0;
  let providerCapCode = null;
  let reportedTotal = null;
  let reportedTotalChanged = false;
  const seenIdentities = new Map();
  let identityFailure = null;
  const identityField = {check_suites:'check_suite_id',check_runs:'check_run_id',workflow_runs:'workflow_run_id',artifacts:'artifact_id'}[collectionKind];
  const limit = pageLimit(client);
  while (true) {
    let page;
    try {
      page = await client[method]({ ...args, cursor });
    } catch (error) {
      const failure = classifyProviderError(error);
      return { items, evidence: {
        provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
        complete: false, item_count: String(items.length), pages_observed: String(pages), ...failure
      }};
    }
    if (!page || !Array.isArray(page.items)) {
      return { items, evidence: {
        provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
        complete: false, item_count: String(items.length), pages_observed: String(pages),
        terminal_state: 'TRANSIENT_FAILURE', failure_code: 'PROVIDER_PAGE_INVALID',
        retryable: false, retry_after_ms: null
      }};
    }
    for (const item of page.items) {
      const identity = item?.[identityField];
      if (identity === undefined || identity === null) { items.push(item); continue; }
      const key = JSON.stringify([item.provider, identity]);
      const fingerprint = JSON.stringify(item);
      if (seenIdentities.has(key)) {
        const conflict = seenIdentities.get(key) !== fingerprint;
        if (conflict) { identityFailure = 'PROVIDER_IDENTITY_CONFLICT'; items.push(item); }
        else if (!identityFailure) identityFailure = 'PROVIDER_DUPLICATE_IDENTITY';
      } else { seenIdentities.set(key, fingerprint); items.push(item); }
    }
    pages += 1;
    const pageTotal = page.reported_total_count;
    if (typeof pageTotal === 'number' && Number.isSafeInteger(pageTotal) && pageTotal >= 0) {
      if (reportedTotal !== null && pageTotal !== reportedTotal) reportedTotalChanged = true;
      reportedTotal = Math.max(reportedTotal ?? 0, pageTotal);
    }
    if (page.provider_complete === false) providerCapCode = page.failure_code || 'PROVIDER_RESULT_CAP';
    cursor = page.next ?? null;
    if (cursor === null) break;
    if (pages >= limit) {
      return { items, evidence: {
        provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
        complete: false, item_count: String(items.length), pages_observed: String(pages),
        terminal_state: 'TRANSIENT_FAILURE', failure_code: paginationFailureCode(collectionKind),
        retryable: false, retry_after_ms: null
      }};
    }
  }
  if (identityFailure || providerCapCode) {
    return { items, evidence: {
      provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
      complete: false, item_count: String(items.length), pages_observed: String(pages),
      terminal_state: 'TRANSIENT_FAILURE', failure_code: identityFailure || providerCapCode,
      retryable: false, retry_after_ms: null
    }};
  }
  if (reportedTotalChanged || (reportedTotal !== null && items.length !== reportedTotal)) {
    return { items, evidence: {
      provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
      complete: false, item_count: String(items.length), pages_observed: String(pages),
      terminal_state: 'TRANSIENT_FAILURE', failure_code: reportedTotalChanged || items.length > reportedTotal
        ? 'PROVIDER_RESULT_COUNT_MISMATCH' : paginationFailureCode(collectionKind),
      retryable: false, retry_after_ms: null
    }};
  }
  return { items, evidence: {
    provider: 'github', collection_kind: collectionKind, immutable_subject: immutableSubject,
    complete: true, item_count: String(items.length), pages_observed: String(pages),
    terminal_state: 'COMPLETE', retryable: false, retry_after_ms: null
  }};
}
function correlateChecksWithRuns(checks, runs) {
  const bySuite = new Map();
  for (const run of runs) {
    if (!run.check_suite_id) continue;
    const matches = bySuite.get(run.check_suite_id) || [];
    matches.push(run);
    bySuite.set(run.check_suite_id, matches);
  }
  return checks.map((check) => {
    if (check.immutable_workflow_identity || check.immutable_check_source_identity) return check;
    const matches = check.check_suite_id ? (bySuite.get(check.check_suite_id) || []) : [];
    const logical_job_identity = check.name ? `check:${check.name}` : `check-run:${check.check_run_id}`;
    if (matches.length === 1) {
      const run = matches[0];
      return {
        ...check,
        workflow_run_id: run.workflow_run_id,
        run_attempt: check.run_attempt ?? null,
        immutable_workflow_identity: JSON.stringify(['github-workflow', run.workflow_id, run.head_sha]),
        logical_job_identity,
        workflow_identity_state: 'PROVIDER_ASSERTED',
        run_correlation_state: 'UNIQUE'
      };
    }
    if (matches.length > 1) {
      return {
        ...check,
        workflow_run_id: null,
        run_attempt: null,
        immutable_check_source_identity: JSON.stringify(['github-check-suite-ambiguous', check.check_suite_id, check.app_identity]),
        logical_job_identity,
        run_correlation_state: 'AMBIGUOUS'
      };
    }
    return {
      ...check,
      workflow_run_id: null,
      run_attempt: null,
      immutable_check_source_identity: JSON.stringify(['github-check-source', check.app_identity]),
      logical_job_identity,
      run_correlation_state: 'UNBOUND'
    };
  });
}

async function collectChecks(client, target, suites, expectedHead) {
  const eligibleSuites = sortBy(
    suites.items.filter((suite) => suite.head_sha === expectedHead),
    (suite) => suite.check_suite_id
  );
  const reads = await Promise.all(eligibleSuites.map((suite) => readPaged(
    client,
    'listCheckRunsForSuite',
    { ...target, checkSuiteId: suite.check_suite_id },
    'check_runs',
    JSON.stringify(['github-check-suite', suite.check_suite_id, suite.head_sha])
  )));
  return {
    items: sortBy(
      reads.flatMap((read) => read.items),
      (check) => `${check.check_suite_id ?? ''}\u0000${check.check_run_id ?? ''}`
    ),
    suites: sortBy(suites.items, (suite) => `${suite.check_suite_id ?? ''}\u0000${suite.head_sha ?? ''}`),
    evidence: [suites.evidence, ...reads.map((read) => read.evidence)]
  };
}

async function collectArtifacts(client, target, runs, expectedHead) {
  const eligibleRuns = sortBy(
    runs.filter((run) => run.head_sha === expectedHead),
    (run) => `${run.workflow_run_id ?? ''}\u0000${run.run_attempt ?? ''}`
  );
  const reads = await Promise.all(eligibleRuns.map((run) => readPaged(
    client,
    'listArtifacts',
    { ...target, workflowRunId: run.workflow_run_id, runAttempt: run.run_attempt },
    'artifacts',
    JSON.stringify(['github-workflow-run', run.workflow_run_id, run.run_attempt, run.head_sha])
  )));
  return {
    items: sortBy(
      reads.flatMap((read) => read.items),
      (artifact) => `${artifact.producing_run_id ?? ''}\u0000${artifact.attempt ?? ''}\u0000${artifact.artifact_id ?? ''}`
    ),
    evidence: reads.map((read) => read.evidence)
  };
}

async function readSnapshot(client, target) {
  let raw;
  try {
    raw = await client.getPullRequest(target);
  } catch (error) {
    const failure = classifyProviderError(error);
    if (failure.failure_code === 'AUTHENTICATION_FAILED') return { kind: 'invalid', failure_code: 'PROVIDER_IDENTITY_AUTH_FAILED' };
    if (failure.failure_code === 'PERMISSION_DENIED') return { kind: 'invalid', failure_code: 'PROVIDER_IDENTITY_PERMISSION_DENIED' };
    if (failure.failure_code === 'NOT_FOUND') return { kind: 'invalid', failure_code: 'PROVIDER_IDENTITY_NOT_FOUND' };
    return { kind: 'unavailable', ...failure };
  }
  try {
    return { kind: 'ok', snapshot: normalizeSnapshot(raw) };
  } catch (error) {
    // A missing fork is the specific cause only if the provider subject still
    // matches the requested PR. Never obscure an event/repository mismatch.
    const expectedSubjectMatches = raw?.pull_request_number === String(target.prNumber)
      && (target.repositoryId == null || raw.repository_id === String(target.repositoryId))
      && (target.expectedBaseSha == null || raw.base_commit_sha === target.expectedBaseSha)
      && (target.expectedHeadSha == null || raw.head_commit_sha === target.expectedHeadSha);
    return { kind: 'invalid', failure_code: error?.code === 'HEAD_REPOSITORY_UNAVAILABLE' && expectedSubjectMatches
      ? 'HEAD_REPOSITORY_UNAVAILABLE' : 'PROVIDER_IDENTITY_SCHEMA_INVALID' };
  }
}

export async function collectGithubReadEvidence(client, target) {
  const s0Read = await readSnapshot(client, target);
  if (s0Read.kind === 'invalid') {
    return { validity: { status: 'INVALID', reasons: [{ code: s0Read.failure_code }] } };
  }
  if (s0Read.kind === 'unavailable') {
    return {
      collection_evidence: [{
        provider: 'github', collection_kind: 'snapshot_s0', complete: false,
        terminal_state: s0Read.terminal_state, failure_code: s0Read.failure_code,
        retryable: s0Read.retryable, retry_after_ms: s0Read.retry_after_ms
      }],
      validity: { status: 'PARTIAL', reasons: [{ code: 'SNAPSHOT_READ_UNAVAILABLE' }] }
    };
  }
  const s0 = s0Read.snapshot;
  const [checkSuites, workflowRuns] = await Promise.all([
    readPaged(client, 'listCheckSuites', { ...target, headSha: s0.head_commit_sha }, 'check_suites', s0.head_commit_sha),
    readPaged(client, 'listWorkflowRuns', { ...target, headSha: s0.head_commit_sha }, 'workflow_runs', s0.head_commit_sha)
  ]);
  const orderedWorkflowRuns = {
    ...workflowRuns,
    items: sortBy(
      workflowRuns.items,
      (run) => `${run.workflow_run_id ?? ''}\u0000${run.run_attempt ?? ''}\u0000${run.head_sha ?? ''}`
    )
  };
  const checks = await collectChecks(client, target, checkSuites, s0.head_commit_sha);
  const correlatedChecks = sortBy(
    correlateChecksWithRuns(checks.items, orderedWorkflowRuns.items),
    (check) => `${check.check_suite_id ?? ''}\u0000${check.check_run_id ?? ''}`
  );
  const artifacts = await collectArtifacts(client, target, orderedWorkflowRuns.items, s0.head_commit_sha);
  const artifactBindings = bindArtifactsToRuns(artifacts.items, orderedWorkflowRuns.items, s0.head_commit_sha);
  let checkSelection;
  try {
    checkSelection = selectLogicalChecks(correlatedChecks, s0.head_commit_sha);
  } catch {
    return { s0, validity: { status: 'INVALID', reasons: [{ code: 'CHECK_SCHEMA_INVALID' }] } };
  }
  const s1Read = await readSnapshot(client, target);
  if (s1Read.kind === 'invalid') {
    return { s0, validity: { status: 'INVALID', reasons: [{ code: s1Read.failure_code }] } };
  }
  const collection_evidence = [...checks.evidence, workflowRuns.evidence, ...artifacts.evidence];
  const generationMismatch = itemHeadMismatch(checks.suites, s0.head_commit_sha)
    || itemHeadMismatch(correlatedChecks, s0.head_commit_sha)
    || itemHeadMismatch(orderedWorkflowRuns.items, s0.head_commit_sha);
  if (s1Read.kind === 'unavailable') {
    const validity = generationMismatch
      ? { status: 'INVALID', reasons: [{ code: 'PROVIDER_GENERATION_MISMATCH' }] }
      : { status: 'PARTIAL', reasons: [{ code: 'SNAPSHOT_RECHECK_UNAVAILABLE' }] };
    return {
      s0, s1: null,
      observed: { checks: correlatedChecks, workflow_runs: orderedWorkflowRuns.items, artifacts: artifacts.items },
      artifact_bindings: artifactBindings,
      check_selection: checkSelection,
      collection_evidence: [...collection_evidence, {
        provider: 'github', collection_kind: 'snapshot_s1', complete: false,
        terminal_state: s1Read.terminal_state, failure_code: s1Read.failure_code,
        retryable: s1Read.retryable, retry_after_ms: s1Read.retry_after_ms
      }],
      validity
    };
  }
  const s1 = s1Read.snapshot;
  const snapshotStale = !sameSnapshot(s0, s1);
  const partial = collection_evidence.some((entry) => entry.complete === false)
    || artifactBindings.partial || checkSelection.partial
    || correlatedChecks.some(check=>check.workflow_run_id&&check.run_attempt==null);
  const validity = generationMismatch
    ? { status: 'INVALID', reasons: [{ code: 'PROVIDER_GENERATION_MISMATCH' }] }
    : snapshotStale
      ? { status: 'STALE', reasons: [{ code: 'SNAPSHOT_CHANGED' }] }
      : partial
        ? { status: 'PARTIAL', reasons: [{ code: 'COLLECTION_INCOMPLETE' }] }
        : { status: 'VALID', reasons: [] };
  return {
    s0,
    s1,
    observed: { checks: correlatedChecks, workflow_runs: orderedWorkflowRuns.items, artifacts: artifacts.items },
    artifact_bindings: artifactBindings,
    check_selection: checkSelection,
    collection_evidence,
    validity
  };
}
