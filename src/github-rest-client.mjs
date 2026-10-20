function pageNumber(cursor) {
  if (cursor === null || cursor === undefined) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) throw new Error('INVALID_PAGE_CURSOR');
  return page;
}

function nextCursor(response) {
  if (response?.nextPage == null) return null;
  const page = Number(response.nextPage);
  if (!Number.isInteger(page) || page < 1) throw Object.assign(new Error('INVALID_NEXT_PAGE'), { code: 'TRANSIENT_FAILURE' });
  return String(page);
}

function segment(value) {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E');
}

function id(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function providerId(value) {
  if (!['string', 'number'].includes(typeof value)
      || !/^[1-9][0-9]*$/.test(String(value))
      || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID' });
  }
  return String(value);
}

function optionalProviderId(value) {
  return value === null || value === undefined ? null : providerId(value);
}

function checkStatus(value) {
  if (!['queued', 'in_progress', 'completed', 'pending', 'waiting', 'requested'].includes(value)) {
    throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID' });
  }
  return value;
}

function checkConclusion(value) {
  if (value === null || value === undefined) return null;
  if (!['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'].includes(value)) {
    throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID' });
  }
  return value;
}

function totalCount(response) {
  const value = response?.data?.total_count;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function collection(response,name) {
  const items=response?.data?.[name];
  if(!Array.isArray(items))throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'),{code:'PROVIDER_RESPONSE_INVALID'});
  return items;
}

function providerHead(item) {
  const head = item?.head_sha;
  if (typeof head !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) {
    throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID' });
  }
  return head;
}

function artifactRetention(artifact) {
  if(typeof artifact?.expired!=='boolean')throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'),{code:'PROVIDER_RESPONSE_INVALID'});
  return artifact.expired?'expired':'available';
}

function endpointIdentity(value, expected) {
  const actual = providerId(value ?? expected);
  if (actual !== String(expected)) throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), {code:'PROVIDER_RESPONSE_INVALID'});
  return actual;
}

function collectionPage(response, name, map, capped = false) {
  const items = [];
  let malformed = false;
  for (const item of collection(response, name)) {
    try {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw Object.assign(new Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID' });
      }
      items.push(map(item));
    } catch (error) {
      if (error.code !== 'PROVIDER_RESPONSE_INVALID') throw error;
      malformed = true;
    }
  }
  const total = totalCount(response);
  const invalid = malformed || total === null;
  const providerCap = capped && total !== null && total >= 1000;
  return {
    items,
    next: nextCursor(response),
    reported_total_count: total,
    provider_complete: !invalid && !providerCap,
    ...(invalid ? { failure_code: 'PROVIDER_RESPONSE_INVALID' }
      : providerCap ? { failure_code: 'WORKFLOW_RUNS_PROVIDER_CAP' } : {})
  };
}

function get(request, path, query = undefined) {
  return request({ method: 'GET', path, query });
}

export function createGithubRestClient(request) {
  if (typeof request !== 'function') throw new Error('request function required');
  return {
    async getPullRequest({ owner, repo, prNumber }) {
      const prResponse = await get(request, `/repos/${segment(owner)}/${segment(repo)}/pulls/${segment(prNumber)}`);
      const pr = prResponse?.data;
      return {
        repository_id: id(pr?.base?.repo?.id),
        pull_request_number: id(pr?.number),
        base_repository_id: id(pr?.base?.repo?.id),
        head_repository_id: id(pr?.head?.repo?.id),
        base_commit_sha: pr?.base?.sha,
        head_commit_sha: pr?.head?.sha
      };
    },

    async listCheckSuites({ owner, repo, headSha, cursor }) {
      const response = await get(request, `/repos/${segment(owner)}/${segment(repo)}/commits/${segment(headSha)}/check-suites`, {
        per_page: 100, page: pageNumber(cursor)
      });
      return collectionPage(response, 'check_suites', (suite) => ({
          provider: 'github',
          check_suite_id: providerId(suite.id),
          head_sha: providerHead(suite),
          app_identity: suite?.app?.id == null
            ? 'app:unknown'
            : `app:${suite.app.id}:${suite.app.slug ?? 'unknown'}`
        }));
    },

    async listCheckRunsForSuite({ owner, repo, checkSuiteId, cursor }) {
      const response = await get(request, `/repos/${segment(owner)}/${segment(repo)}/check-suites/${segment(checkSuiteId)}/check-runs`, {
        per_page: 100, page: pageNumber(cursor)
      });
      return collectionPage(response, 'check_runs', (check) => ({
          provider: 'github',
          check_run_id: providerId(check.id),
          check_suite_id: endpointIdentity(check?.check_suite?.id, checkSuiteId),
          head_sha: providerHead(check),
          name: check.name,
          status: checkStatus(check.status),
          conclusion: checkConclusion(check.conclusion),
          app_identity: check?.app?.id == null
            ? 'app:unknown'
            : `app:${check.app.id}:${check.app.slug ?? 'unknown'}`,
          verification_state: 'PROVIDER_ASSERTED'
        }));
    },

    async listWorkflowRuns({ owner, repo, headSha, cursor }) {
      const response = await get(request, `/repos/${segment(owner)}/${segment(repo)}/actions/runs`, {
        head_sha: headSha, per_page: 100, page: pageNumber(cursor)
      });
      return collectionPage(response, 'workflow_runs', (run) => ({
          provider: 'github',
          workflow_run_id: providerId(run.id),
          check_suite_id: optionalProviderId(run.check_suite_id),
          workflow_id: providerId(run.workflow_id),
          head_sha: providerHead(run),
          run_attempt: optionalProviderId(run.run_attempt),
          status: run.status,
          conclusion: run.conclusion ?? null,
          workflow_path: run.path ?? null
        }), true);
    },
    async listArtifacts({ owner, repo, workflowRunId, runAttempt, cursor }) {
      const response = await get(request, `/repos/${segment(owner)}/${segment(repo)}/actions/runs/${segment(workflowRunId)}/artifacts`, {
        per_page: 100, page: pageNumber(cursor)
      });
      return collectionPage(response, 'artifacts', (artifact) => ({
          provider: 'github',
          artifact_id: providerId(artifact.id),
          producing_run_id: endpointIdentity(artifact?.workflow_run?.id, workflowRunId),
          // This endpoint is run-scoped; it does not establish the producing attempt.
          attempt: null,
          retention_state: artifactRetention(artifact),
          provider_digest: artifact.digest ?? null
        }));
    },


  };
}
