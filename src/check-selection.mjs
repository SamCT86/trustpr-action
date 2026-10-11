const ATTEMPT = /^(?:0|[1-9][0-9]*)$/;
const NON_SATISFYING = new Set(['cancelled', 'superseded', 'deleted', 'expired']);

function sourceIdentity(item) {
  return item.immutable_workflow_identity ?? item.immutable_check_source_identity ?? null;
}

function logicalKey(item) {
  return JSON.stringify([
    item.provider,
    sourceIdentity(item),
    item.logical_job_identity,
    item.head_sha
  ]);
}

function attemptValue(item) {
  if (item?.run_attempt === null || item?.run_attempt === undefined) return null;
  if (!ATTEMPT.test(String(item.run_attempt))) throw new Error('INVALID_RUN_ATTEMPT');
  return BigInt(item.run_attempt);
}

function materialFingerprint(item) {
  return JSON.stringify([
    item.status,
    item.conclusion,
    item.app_identity,
    sourceIdentity(item),
    item.logical_job_identity
  ]);
}

function compareText(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}

function attemptKey(item) {
  return JSON.stringify([item.run_attempt ?? null, item.check_run_id ?? '', materialFingerprint(item)]);
}

function chooseCandidate(latest) {
  const fingerprints = new Set(latest.map(materialFingerprint));
  if (fingerprints.size > 1) return { state: 'AMBIGUOUS', selected: null };
  const candidates = latest
    .filter((item) => !NON_SATISFYING.has(String(item.status).toLowerCase()))
    .sort((a, b) => compareText(a.check_run_id, b.check_run_id));
  if (candidates.length === 0) return { state: 'UNSATISFIED', selected: null };
  const selected = candidates[0];
  const success = selected.status === 'completed' && selected.conclusion === 'success';
  return { state: success ? 'SATISFIABLE' : 'UNSATISFIED', selected };
}

function evaluateGroup(attempts, expectedHead) {
  const eligible = attempts.filter((item) => item.head_sha === expectedHead);
  if (eligible.length === 0) return { state: 'UNSATISFIED', selected: null };
  if (eligible.some((item) => item.run_correlation_state === 'AMBIGUOUS')) {
    return { state: 'AMBIGUOUS', selected: null };
  }
  const values = eligible.map(attemptValue);
  const withAttempt = eligible.filter((_, index) => values[index] !== null);
  const withoutAttempt = eligible.filter((_, index) => values[index] === null);
  if (withAttempt.length > 0 && withoutAttempt.length > 0) {
    return { state: 'AMBIGUOUS', selected: null };
  }
  if (withAttempt.length === 0) {
    if (withoutAttempt.length > 1) return { state: 'AMBIGUOUS', selected: null };
    return chooseCandidate(withoutAttempt);
  }
  let max = attemptValue(withAttempt[0]);
  for (const item of withAttempt.slice(1)) {
    const value = attemptValue(item);
    if (value > max) max = value;
  }
  const latest = withAttempt.filter((item) => attemptValue(item) === max);
  return chooseCandidate(latest);
}

export function selectLogicalChecks(items, expectedHead) {
  const groups = new Map();
  const orderedItems = [...items].sort((a, b) => {
    const keyOrder = compareText(logicalKey(a), logicalKey(b));
    return keyOrder !== 0 ? keyOrder : compareText(attemptKey(a), attemptKey(b));
  });
  for (const item of orderedItems) {
    attemptValue(item);
    if (!sourceIdentity(item) || !item?.logical_job_identity || !item?.head_sha) {
      throw new Error('INVALID_CHECK_IDENTITY');
    }
    const key = logicalKey(item);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  const out = [];
  for (const key of [...groups.keys()].sort(compareText)) {
    const attempts = [...groups.get(key)].sort((a, b) => compareText(attemptKey(a), attemptKey(b)));
    const evaluated = evaluateGroup(attempts, expectedHead);
    out.push({ key, attempts, ...evaluated });
  }
  return { groups: out, partial: out.some((group) => group.state === 'AMBIGUOUS') };
}
