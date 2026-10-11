import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  TRUSTPR_ACTION_REPOSITORY,
  buildTrustPrActionWorkflow,
  renderTrustPrActionWorkflowYaml,
  buildLane2ActionHandoff
} from '../src/action-setup.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('canonical action repository cannot be substituted by a fork or PR-controlled expression', () => {
  assert.equal(TRUSTPR_ACTION_REPOSITORY, 'SamCT86/trustpr-action');
  const canonical = renderTrustPrActionWorkflowYaml({
    actionRepository: 'SamCT86/trustpr-action',
    actionCommitSha: SHA
  });
  const caseVariant = renderTrustPrActionWorkflowYaml({
    actionRepository: 'samct86/TRUSTPR-ACTION',
    actionCommitSha: SHA
  });
  assert.equal(caseVariant, canonical);
  assert.equal(canonical.includes('uses: SamCT86/trustpr-action@' + SHA), true);

  for (const repo of [
    'SamCT86/trustpr',
    'attacker/trustpr',
    'SamCT86/trustpr-fork',
    'SamCT86/trustpr/../../attacker',
    'SamCT86%2ftrustpr',
    'SamCT86/trustpr@' + SHA,
    '${{ github.event.pull_request.head.repo.full_name }}',
    '${{ github.repository_owner }}/trustpr',
    'SamCT86/trustpr\u0000evil',
    'SamCT86/trustpr\npermissions:\n  contents: write',
    'SamCT86/trustpr\r\n- run: pwn'
  ]) {
    assert.throws(
      () => renderTrustPrActionWorkflowYaml({ actionRepository: repo, actionCommitSha: SHA }),
      (error) => error?.code === 'ACTION_REPOSITORY_INVALID',
      JSON.stringify(repo)
    );
  }
});

test('fork and Dependabot contexts cannot alter workflow structure or introduce secret/write surfaces', () => {
  const text = renderTrustPrActionWorkflowYaml({
    actionRepository: TRUSTPR_ACTION_REPOSITORY,
    actionCommitSha: SHA
  });
  const scenarios = [
    {
      name: 'fork',
      headRepo: 'attacker/repo',
      actor: 'external-user',
      tokenMode: 'read-only',
      secrets: false
    },
    {
      name: 'dependabot',
      headRepo: 'owner/repo',
      actor: 'dependabot[bot]',
      tokenMode: 'read-only',
      secrets: false
    }
  ];
  for (const scenario of scenarios) {
    assert.equal(text.includes(scenario.headRepo), false, scenario.name);
    assert.equal(text.includes(scenario.actor), false, scenario.name);
    assert.equal(text.includes('secrets.'), false, scenario.name);
    assert.equal(text.includes(': write'), false, scenario.name);
    assert.equal(text.includes('pull_request_target'), false, scenario.name);
  }
});

test('rendered permissions are exactly the four read scopes and no implicit write scope is emitted', () => {
  const text = renderTrustPrActionWorkflowYaml({
    actionRepository: TRUSTPR_ACTION_REPOSITORY,
    actionCommitSha: SHA
  });
  const lines = text.split('\n');
  const start = lines.indexOf('permissions:');
  assert.notEqual(start, -1);
  const permissionLines = lines.slice(start + 1, start + 5);
  assert.deepEqual(permissionLines, [
    '  actions: read',
    '  checks: read',
    '  contents: read',
    '  pull-requests: read'
  ]);
  assert.equal(lines[start + 5], '');
  assert.equal(text.includes('id-token:'), false);
  assert.equal(text.includes('attestations:'), false);
  assert.equal(text.includes('packages:'), false);
  assert.equal(text.includes('deployments:'), false);
  assert.equal(text.includes('statuses:'), false);
});

test('workflow has no checkout, artifact download, cache, install, shell, env, or executable PR code step', () => {
  const model = buildTrustPrActionWorkflow({
    actionRepository: TRUSTPR_ACTION_REPOSITORY,
    actionCommitSha: SHA
  });
  const text = renderTrustPrActionWorkflowYaml({
    actionRepository: TRUSTPR_ACTION_REPOSITORY,
    actionCommitSha: SHA
  });
  assert.equal(model.jobs.trustpr.steps.length, 1);
  assert.equal(Object.hasOwn(model.jobs.trustpr.steps[0], 'uses'), true);
  for (const token of [
    'actions/checkout',
    'actions/download-artifact',
    'actions/upload-artifact',
    'actions/cache',
    'run:',
    'shell:',
    'env:',
    'npm ',
    'npx ',
    'node ',
    'python ',
    'pip ',
    'bash ',
    'sh ',
    'git ',
    'curl ',
    'wget ',
    'docker '
  ]) {
    assert.equal(text.includes(token), false, token);
  }
});

test('hostile SHA/ref families cannot downgrade immutable full-SHA pinning', () => {
  const hostile = [
    ...['main', 'master', 'trunk', 'latest', 'v1', 'v1.2.3', 'refs/heads/main', 'refs/tags/v1'],
    'a'.repeat(7),
    'a'.repeat(39),
    'a'.repeat(41),
    'g'.repeat(40),
    'A'.repeat(40),
    '0'.repeat(40) + '@main',
    '${{ github.sha }}',
    '${{ github.event.pull_request.head.sha }}',
    'a'.repeat(40) + '\nrun: pwn'
  ];
  for (const actionCommitSha of hostile) {
    assert.throws(
      () => renderTrustPrActionWorkflowYaml({
        actionRepository: TRUSTPR_ACTION_REPOSITORY,
        actionCommitSha
      }),
      (error) => error?.code === 'ACTION_COMMIT_SHA_INVALID',
      actionCommitSha
    );
  }
});

test('same reviewed inputs always regenerate byte-identical UTF-8 workflow', () => {
  const inputs = { actionRepository: TRUSTPR_ACTION_REPOSITORY, actionCommitSha: SHA };
  const hashes = new Set();
  for (let i = 0; i < 100; i += 1) {
    const text = renderTrustPrActionWorkflowYaml(inputs);
    assert.equal(Buffer.from(text, 'utf8').toString('utf8'), text);
    assert.equal(text.includes('\r'), false);
    hashes.add(digest(text));
  }
  assert.equal(hashes.size, 1);
});

test('handoff preserves unresolved deployment/integration boundaries', () => {
  const handoff = buildLane2ActionHandoff({
    actionRepository: TRUSTPR_ACTION_REPOSITORY,
    actionCommitSha: SHA,
    integrationState: 'BLOCKED_SOURCE_BYTES_UNAVAILABLE'
  });
  assert.equal(handoff.full_v1_done, false);
  assert.equal(handoff.github_effect_performed, false);
  assert.equal(handoff.provider_effect_performed, false);
  assert.equal(handoff.action_reference_state, 'CALLER_SUPPLIED_MUST_BE_REVERIFIED_BEFORE_PUBLICATION');
  assert.deepEqual(handoff.non_claims, [
    'NOT_GITHUB_PUBLISHED',
    'NOT_DEPLOYED',
    'NOT_FULL_RECEIPT_INTEGRATED',
    'NOT_FULL_TRUSTPR_V1_DONE'
  ]);
});
