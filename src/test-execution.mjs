function nonemptyText(value) {
  return typeof value === 'string' && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validSubject(item) {
  return item !== null && typeof item === 'object'
    && nonemptyText(item.provider) && nonemptyText(item.workflow_run_id)
    && nonemptyText(item.run_attempt) && /^(?:0|[1-9][0-9]*)$/u.test(item.run_attempt)
    && typeof item.head_sha === 'string' && /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u.test(item.head_sha);
}

function validExecution(item) {
  return validSubject(item) && nonemptyText(item.evidence_id)
    && typeof item.command === 'string' && item.command.trim().length > 0 && !item.command.includes('\u0000')
    && (Number.isSafeInteger(item.exit_code)
      || (typeof item.exit_code === 'string' && /^(?:0|-?[1-9][0-9]*)$/u.test(item.exit_code)));
}

function sameExecutionSubject(check, evidence, expectedHead) {
  return validSubject(check) && validExecution(evidence)
    && evidence?.provider === check?.provider
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
