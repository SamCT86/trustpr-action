function key(provider, runId, attempt) {
  return JSON.stringify([provider, runId, attempt]);
}

export function bindArtifactsToRuns(artifacts, workflowRuns, expectedHead) {
  const runs = new Map();
  for (const run of workflowRuns) {
    runs.set(key(run.provider, run.workflow_run_id, run.run_attempt), run);
  }
  let partial = false;
  const items = artifacts.map((artifact) => {
    const run = runs.get(key(artifact.provider, artifact.producing_run_id, artifact.attempt));
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
