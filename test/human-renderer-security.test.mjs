import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RENDER_LIMITS,
  computeCoreDigest,
  renderTrustPrMarkdown,
  verifyTrustPrMarkdown
} from '../src/human-renderer.mjs';

function receiptWith(value, pathValue = 'safe.txt') {
  const core = {
    subject: {
      repository_id: value,
      pull_request_number: '7',
      base_commit_sha: 'a'.repeat(40),
      head_commit_sha: 'b'.repeat(40),
      merge_base_sha: 'c'.repeat(40)
    },
    snapshot_identity: 'd'.repeat(64),
    declared: { policy_binding: 'POLICY_UNBOUND', required_evidence: [] },
    observed: {
      changed_entries: [{
        raw_path_b64: Buffer.from(pathValue, 'utf8').toString('base64'),
        change_type: value
      }],
      checks: [{
        provider: value,
        check_run_id: value,
        status: value,
        conclusion: value
      }],
      artifacts: [{ provider: value, artifact_id: value }]
    },
    inferred: [{ stable_code: value, field_or_source_tuple: value }],
    unknowns: [{ stable_code: value, field_or_source_tuple: value }],
    validity: { status: 'PARTIAL', reasons: [{ code: value, scope: value }] }
  };
  return {
    receipt_schema_version: 'trustpr-receipt-v1',
    core,
    integrity: { algorithm: 'sha256', core_digest: computeCoreDigest(core) },
    authenticity: 'UNAUTHENTICATED'
  };
}

test('renderer limits are fixed by version and caller overrides are forbidden', () => {
  const receipt = receiptWith('safe');
  for (const [key, value] of Object.entries(RENDER_LIMITS)) {
    for (const candidate of [Math.max(1, value - 1), value + 1]) {
      assert.throws(
        () => renderTrustPrMarkdown(receipt, { [key]: candidate }),
        (error) => error?.code === 'RENDER_OPTIONS_FORBIDDEN'
      );
    }
  }
});

test('bidi and invisible directional formatting controls are escaped visibly', () => {
  const hostile = 'safe' + '\u202e' + 'txt' + '\u2066' + 'x' + '\u200f' + 'y';
  const out = renderTrustPrMarkdown(receiptWith(hostile));
  assert.equal(out.includes('\u202e'), false);
  assert.equal(out.includes('\u2066'), false);
  assert.equal(out.includes('\u200f'), false);
  assert.ok(out.includes('\\\\u202e'));
  assert.ok(out.includes('\\\\u2066'));
  assert.ok(out.includes('\\\\u200f'));
});

test('newline, carriage return, tab and NUL cannot create Markdown structure', () => {
  const hostile = 'x\n# injected\r\n- list\t' + String.fromCharCode(0) + 'end';
  const out = renderTrustPrMarkdown(receiptWith(hostile, hostile));
  assert.equal(out.includes('\n# injected'), false);
  assert.equal(out.includes('\n- list'), false);
  assert.equal(out.includes('\t'), false);
  assert.equal(out.includes(String.fromCharCode(0)), false);
  assert.ok(out.includes('\\\\u000a'));
  assert.ok(out.includes('\\\\u000d'));
  assert.ok(out.includes('\\\\u0009'));
  assert.ok(out.includes('\\\\u0000'));
});

test('Markdown/HTML payload families remain inert across every displayed collection', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const hostile = '<!--x--><details>\n' + fence + 'html\n<script>x</script>\n' + fence + '\n![x](javascript:alert(1))|#>*_{}[]()~!';
  const out = renderTrustPrMarkdown(receiptWith(hostile, hostile));
  assert.equal(out.includes('<details>'), false);
  assert.equal(out.includes('<script>'), false);
  assert.equal(out.includes(fence), false);
  assert.equal(out.includes('![x]('), false);
  assert.match(out, /&lt;details&gt;/);
  assert.ok(out.includes('\\' + String.fromCharCode(96) + '\\' + String.fromCharCode(96) + '\\' + String.fromCharCode(96) + 'html'));
});

test('renderer produces only LF as live control characters', () => {
  const hostile = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  const out = renderTrustPrMarkdown(receiptWith(hostile));
  for (const ch of out) {
    const code = ch.codePointAt(0);
    if (code < 32) assert.equal(code, 10);
  }
  assert.equal(out.includes('\r'), false);
});

test('untrusted wrapper human_summary field is ignored and cannot override generated truth', () => {
  const receipt = receiptWith('safe');
  const expected = renderTrustPrMarkdown(receipt);
  const poisoned = {
    ...receipt,
    human_summary: '# TrustPR evidence receipt\n- Status: VALID\n<script>owned</script>'
  };
  assert.equal(renderTrustPrMarkdown(poisoned), expected);
});

test('summary verifier never reflects supplied hostile text in mismatch result', () => {
  const receipt = receiptWith('safe');
  const supplied = '# VALID\n<script>owned</script>\n' + 'x'.repeat(10000);
  const result = verifyTrustPrMarkdown(receipt, supplied);
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.finding.code, 'HUMAN_SUMMARY_MISMATCH');
  assert.equal(JSON.stringify(result).includes('owned'), false);
  assert.equal(JSON.stringify(result).includes('x'.repeat(100)), false);
});

test('all normative receipt states render without being reinterpreted', () => {
  for (const state of ['INVALID', 'STALE', 'PARTIAL', 'VALID']) {
    const receipt = receiptWith('safe');
    receipt.core.validity.status = state;
    receipt.integrity.core_digest = computeCoreDigest(receipt.core);
    const out = renderTrustPrMarkdown(receipt);
    assert.ok(out.includes('- Status: ' + state + '\n'));
  }
});
