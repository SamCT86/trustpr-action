function key(provider, runId, attempt) {
  return JSON.stringify([provider, runId, attempt]);
}

function identityText(value) {
  return typeof value === 'string' && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validRunTuple(provider, runId, attempt) {
  return identityText(provider) && identityText(runId) && identityText(attempt);
}

function fingerprint(value) {
  if (Array.isArray(value)) return '[' + value.map(fingerprint).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(
      (name) => JSON.stringify(name) + ':' + fingerprint(value[name])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function bindArtifactsToRuns(artifacts, workflowRuns, expectedHead) {
  const runs = new Map();
  const conflicts = new Set();
  const invalidRunIdentities = new Set();
  let partial = !identityText(expectedHead);
  for (const run of workflowRuns) {
    if (run === null || typeof run !== 'object' || Array.isArray(run)
        || !validRunTuple(run.provider, run.workflow_run_id, run.run_attempt)) {
      partial = true;
      continue;
    }
    const identity = key(run.provider, run.workflow_run_id, run.run_attempt);
    if (!identityText(run.head_sha)) {
      partial = true;
      invalidRunIdentities.add(identity);
      continue;
    }
    const prior = runs.get(identity);
    if (prior && fingerprint(prior) !== fingerprint(run)) conflicts.add(identity);
    if (!prior) runs.set(identity, run);
  }
  const items = artifacts.map((artifact) => {
    if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
      partial = true;
      return { verification_state: 'UNKNOWN', reason: 'ARTIFACT_BINDING_IDENTITY_INVALID' };
    }
    const base = {
      provider: artifact.provider,
      artifact_id: artifact.artifact_id,
      producing_run_id: artifact.producing_run_id,
      attempt: artifact.attempt,
      retention_state: artifact.retention_state,
      provider_digest: artifact.provider_digest ?? null
    };
    if (artifact.attempt == null) {
      partial = true;
      return { ...base, verification_state: 'UNKNOWN', reason: 'ARTIFACT_ATTEMPT_NOT_ESTABLISHED' };
    }
    if (!validRunTuple(artifact.provider, artifact.producing_run_id, artifact.attempt)
        || !identityText(artifact.artifact_id) || !identityText(expectedHead)) {
      partial = true;
      return { ...base, verification_state: 'UNKNOWN', reason: 'ARTIFACT_BINDING_IDENTITY_INVALID' };
    }
    const identity = key(artifact.provider, artifact.producing_run_id, artifact.attempt);
    if (invalidRunIdentities.has(identity)) {
      partial = true;
      return { ...base, verification_state: 'UNKNOWN', reason: 'PRODUCING_RUN_IDENTITY_INVALID' };
    }
    const run = runs.get(identity);
    if (conflicts.has(key(artifact.provider, artifact.producing_run_id, artifact.attempt))) {
      partial = true;
      return { ...base, verification_state: 'UNKNOWN', reason: 'PRODUCING_RUN_AMBIGUOUS' };
    }
    if (!run) {
      partial = true;
      return { ...base, verification_state: 'UNKNOWN', reason: 'PRODUCING_RUN_UNAVAILABLE' };
    }
    if (run.head_sha !== expectedHead) {
      partial = true;
      return {
        ...base,
        head_sha: run.head_sha,
        verification_state: 'UNKNOWN',
        reason: 'PRODUCING_RUN_SUBJECT_MISMATCH'
      };
    }
    if (String(artifact.retention_state).toLowerCase() !== 'available') {
      partial = true;
      return {
        ...base,
        head_sha: run.head_sha,
        verification_state: 'UNKNOWN',
        reason: 'ARTIFACT_UNAVAILABLE'
      };
    }
    return {
      ...base,
      head_sha: run.head_sha,
      verification_state: 'IMMUTABLE_ID_MATCH'
    };
  });
  return { items, partial };
}
