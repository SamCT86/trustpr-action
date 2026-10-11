function sameExecutionSubject(check, evidence, expectedHead) {
  return evidence?.provider === check?.provider
    && evidence?.workflow_run_id === check?.workflow_run_id
    && evidence?.run_attempt === check?.run_attempt
    && evidence?.head_sha === expectedHead
    && check?.head_sha === expectedHead;
}

export function deriveTestExecutionEvidence(checks, machineEvidence, expectedHead) {
  return checks.map((check) => {
    const match = machineEvidence.find((evidence) => sameExecutionSubject(check, evidence, expectedHead));
    if (!match) {
      return {
        provider: check.provider,
        workflow_run_id: check.workflow_run_id,
        run_attempt: check.run_attempt,
        head_sha: check.head_sha,
        state: 'UNKNOWN',
        reason: 'NO_MACHINE_EXECUTION_EVIDENCE'
      };
    }
    return {
      provider: match.provider,
      workflow_run_id: match.workflow_run_id,
      run_attempt: match.run_attempt,
      head_sha: match.head_sha,
      evidence_id: match.evidence_id,
      command: match.command,
      exit_code: match.exit_code,
      state: 'OBSERVED'
    };
  });
}
