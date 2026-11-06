import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import * as liveSetup from '../src/action-setup.mjs';

import {
  ACTION_SETUP_VERSION,
  ACTION_SETUP_PERMISSIONS,
  buildTrustPrActionWorkflow,
  renderTrustPrActionWorkflowYaml
} from '../src/action-setup.mjs';

const ACTION_REPO = 'SamCT86/trustpr-action';
const ACTION_SHA = '0123456789abcdef0123456789abcdef01234567';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('Action setup contract is explicit and exact least privilege', () => {
  assert.equal(ACTION_SETUP_VERSION, 'TRUSTPR-ACTION-SETUP-V1');
  assert.deepEqual(ACTION_SETUP_PERMISSIONS, {
    actions: 'read',
    checks: 'read',
    contents: 'read',
    'pull-requests': 'read'
  });
});

test('workflow model is pull_request-only and has no executable PR-code surface', () => {
  const model = buildTrustPrActionWorkflow({
    actionRepository: ACTION_REPO,
    actionCommitSha: ACTION_SHA
  });
  assert.deepEqual(model.on, {
    pull_request: {
      types: ['opened', 'synchronize', 'reopened', 'ready_for_review']
    }
  });
  assert.deepEqual(model.permissions, ACTION_SETUP_PERMISSIONS);
  assert.deepEqual(Object.keys(model.jobs), ['trustpr']);
  const job = model.jobs.trustpr;
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 10);
  assert.equal(job.steps.length, 1);
  assert.deepEqual(job.steps[0], {
    name: 'Generate TrustPR evidence receipt',
    uses: ACTION_REPO + '@' + ACTION_SHA,
    with: {
      repository: '${{ github.repository }}',
      'pull-request-number': '${{ github.event.pull_request.number }}',
      'base-sha': '${{ github.event.pull_request.base.sha }}',
      'head-sha': '${{ github.event.pull_request.head.sha }}'
    }
  });
  assert.equal('env' in job, false);
});

test('rendered workflow is deterministic and contains no privileged or executable trigger/step', () => {
  const a = renderTrustPrActionWorkflowYaml({ actionRepository: ACTION_REPO, actionCommitSha: ACTION_SHA });
  const b = renderTrustPrActionWorkflowYaml({ actionRepository: ACTION_REPO, actionCommitSha: ACTION_SHA });
  assert.equal(a, b);
  assert.match(a, /^name: TrustPR evidence receipt\n/);
  assert.match(a, /\non:\n  pull_request:\n/);
  assert.match(a, /\npermissions:\n  actions: read\n  checks: read\n  contents: read\n  pull-requests: read\n/);
  assert.match(a, new RegExp('uses: ' + ACTION_REPO.replace('/', '\\/') + '@' + ACTION_SHA));
  for (const forbidden of [
    'pull_request_target',
    'workflow_run',
    'issue_comment',
    'repository_dispatch',
    'workflow_dispatch',
    'actions/checkout',
    'actions/download-artifact',
    'actions/cache',
    ' run:',
    '\n    run:',
    '\n      run:',
    'secrets.',
    'id-token:',
    'attestations:',
    ': write',
    'persist-credentials',
    'github.event.pull_request.head.repo.full_name',
    'npm ',
    'pip ',
    'curl ',
    'wget '
  ]) {
    assert.equal(a.includes(forbidden), false, forbidden);
  }
  assert.equal(Buffer.from(a, 'utf8')[0] === 0xef, false);
  assert.match(sha256(a), /^[0-9a-f]{64}$/);
});

test('action dependency must be a simple repository plus full lowercase immutable commit SHA', () => {
  for (const actionRepository of [
    'owner',
    'owner/repo/sub',
    'owner/repo@main',
    'evil/trustpr',
    'SamCT86/trustpr',
    'SamCT86/trustpr-fork',
    '${{ github.event.pull_request.head.repo.full_name }}/trustpr',
    'owner/repo\nrun: pwn',
    '../owner/repo',
    'owner//repo'
  ]) {
    assert.throws(
      () => renderTrustPrActionWorkflowYaml({ actionRepository, actionCommitSha: ACTION_SHA }),
      (error) => error?.code === 'ACTION_REPOSITORY_INVALID',
      actionRepository
    );
  }

  for (const actionCommitSha of [
    'main',
    'v1',
    'abc123',
    'A'.repeat(40),
    '0'.repeat(39),
    '0'.repeat(41),
    '${{ github.sha }}',
    '0'.repeat(40) + '\nrun: pwn'
  ]) {
    assert.throws(
      () => renderTrustPrActionWorkflowYaml({ actionRepository: ACTION_REPO, actionCommitSha }),
      (error) => error?.code === 'ACTION_COMMIT_SHA_INVALID',
      actionCommitSha
    );
  }
});

test('untrusted PR expressions are data-only action inputs and never shell/env/code', () => {
  const text = renderTrustPrActionWorkflowYaml({ actionRepository: ACTION_REPO, actionCommitSha: ACTION_SHA });
  const expressions = [...text.matchAll(/\$\{\{[^\n]+\}\}/g)].map((m) => m[0]);
  assert.deepEqual(expressions, [
    '${{ github.repository }}',
    '${{ github.event.pull_request.number }}',
    '${{ github.event.pull_request.base.sha }}',
    '${{ github.event.pull_request.head.sha }}'
  ]);
  for (const expr of expressions) {
    const line = text.split('\n').find((candidate) => candidate.includes(expr));
    assert.match(line, /^          [a-z-]+: \$\{\{/);
  }
  assert.equal(/\b(?:run|shell|env):/.test(text), false);
});

test('public setup module no longer exports the obsolete prepublication handoff', () => {
  assert.equal(Object.hasOwn(liveSetup, 'buildLane2ActionHandoff'), false);
  assert.equal(typeof liveSetup.buildTrustPrActionWorkflow, 'function');
  assert.equal(typeof liveSetup.renderTrustPrActionWorkflowYaml, 'function');
});

test('setup inputs are closed and cannot accept caller security relaxations', () => {
  for (const extra of [
    { trigger: 'pull_request_target' },
    { permissions: { contents: 'write' } },
    { checkout: true },
    { run: 'npm test' },
    { secrets: 'inherit' }
  ]) {
    assert.throws(
      () => renderTrustPrActionWorkflowYaml({
        actionRepository: ACTION_REPO,
        actionCommitSha: ACTION_SHA,
        ...extra
      }),
      (error) => error?.code === 'ACTION_SETUP_INPUT_INVALID'
    );
  }
});

