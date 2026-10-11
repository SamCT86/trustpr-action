import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  RENDERER_VERSION,
  RENDER_LIMITS,
  computeCoreDigest,
  renderTrustPrMarkdown,
  renderTrustPrMarkdownBytes,
  verifyTrustPrMarkdown
} from '../src/human-renderer.mjs';

function jcs(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error('unsafe number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}';
  }
  throw new Error('unsupported');
}

function digest(core) {
  return crypto.createHash('sha256').update(Buffer.from(jcs(core), 'utf8')).digest('hex');
}

function baseCore() {
  return {
    subject: {
      repository_id: 'repo-123',
      pull_request_number: '42',
      base_commit_sha: 'a'.repeat(40),
      head_commit_sha: 'b'.repeat(40),
      merge_base_sha: 'c'.repeat(40)
    },
    snapshot_identity: 'd'.repeat(64),
    declared: {
      policy_binding: 'POLICY_UNBOUND',
      required_evidence: ['artifacts', 'checks']
    },
    observed: {
      changed_entries: [
        {
          raw_path_b64: Buffer.from('src/example.md', 'utf8').toString('base64'),
          change_type: 'MODIFY',
          old_mode: '100644',
          new_mode: '100644',
          old_blob_sha: 'e'.repeat(40),
          new_blob_sha: 'f'.repeat(40)
        }
      ],
      checks: [
        {
          provider: 'github',
          check_run_id: '100',
          head_sha: 'b'.repeat(40),
          status: 'completed',
          conclusion: 'success'
        }
      ],
      artifacts: []
    },
    inferred: [],
    unknowns: [
      {
        stable_code: 'REQUIRED_EVIDENCE_MISSING',
        field_or_source_tuple: 'artifacts'
      }
    ],
    validity: {
      status: 'PARTIAL',
      reasons: [
        { code: 'REQUIRED_EVIDENCE_MISSING', scope: 'artifacts' }
      ]
    }
  };
}

function makeReceipt(core = baseCore(), extra = {}) {
  return {
    receipt_schema_version: 'trustpr-receipt-v1',
    core,
    integrity: {
      algorithm: 'sha256',
      core_digest: digest(core)
    },
    authenticity: 'UNAUTHENTICATED',
    collection_metadata: { observed_at: '2026-10-02T00:00:00Z' },
    ...extra
  };
}

test('renderer version and implementation limits are fixed and versioned', () => {
  assert.equal(RENDERER_VERSION, 'TRUSTPR-MD-V1');
  assert.deepEqual(RENDER_LIMITS, {
    maxStringCodePoints: 512,
    maxListItems: 50,
    maxReasons: 50,
    maxOutputBytes: 65536
  });
});

test('summary displays schema, renderer, core digest, status, reasons, policy and authenticity', () => {
  const receipt = makeReceipt();
  const out = renderTrustPrMarkdown(receipt);
  assert.match(out, /^# TrustPR evidence receipt\n/);
  assert.match(out, /Renderer: TRUSTPR\\-MD\\-V1/);
  assert.match(out, /Receipt schema: trustpr\\-receipt\\-v1/);
  assert.match(out, new RegExp(receipt.integrity.core_digest));
  assert.match(out, /Status: PARTIAL/);
  assert.match(out, /REQUIRED\\_EVIDENCE\\_MISSING/);
  assert.match(out, /Policy: POLICY\\_UNBOUND/);
  assert.match(out, /Authenticity: UNAUTHENTICATED/);
  assert.match(out, /VALID does not mean safe to merge/);
});

test('core digest verification is independent of object insertion order', () => {
  const core = baseCore();
  const reordered = {
    validity: core.validity,
    unknowns: core.unknowns,
    inferred: core.inferred,
    observed: core.observed,
    declared: core.declared,
    snapshot_identity: core.snapshot_identity,
    subject: core.subject
  };
  assert.equal(computeCoreDigest(core), digest(core));
  assert.equal(computeCoreDigest(reordered), digest(core));
  assert.equal(renderTrustPrMarkdown(makeReceipt(core)), renderTrustPrMarkdown(makeReceipt(reordered)));
});

test('tampered core or digest fails closed before rendering', () => {
  const receipt = makeReceipt();
  receipt.core.validity.status = 'VALID';
  assert.throws(
    () => renderTrustPrMarkdown(receipt),
    (error) => error?.code === 'CORE_DIGEST_MISMATCH'
  );
});

test('unsupported schema, algorithm, authenticity, policy, or status fail closed', () => {
  const cases = [
    [makeReceipt(baseCore(), { receipt_schema_version: 'trustpr-receipt-v2' }), 'UNSUPPORTED_RECEIPT_SCHEMA'],
    [makeReceipt(baseCore(), { integrity: { algorithm: 'md5', core_digest: '0'.repeat(64) } }), 'UNSUPPORTED_INTEGRITY_ALGORITHM'],
    [makeReceipt(baseCore(), { authenticity: 'VERIFIED' }), 'AUTHENTICITY_NOT_SUPPORTED']
  ];
  const policyCore = baseCore();
  policyCore.declared.policy_binding = 'BRANCH_PROTECTION';
  cases.push([makeReceipt(policyCore), 'POLICY_BINDING_NOT_SUPPORTED']);
  const stateCore = baseCore();
  stateCore.validity.status = 'GREEN';
  cases.push([makeReceipt(stateCore), 'INVALID_VALIDITY_STATUS']);

  for (const [receipt, code] of cases) {
    assert.throws(() => renderTrustPrMarkdown(receipt), (error) => error?.code === code);
  }
});

test('hostile Markdown, raw HTML, ANSI and controls are neutralized rather than executed', () => {
  const core = baseCore();
  core.subject.repository_id = '<script>alert(1)</script> # h [x](javascript:1) ' + String.fromCharCode(27) + '[31mRED' + String.fromCharCode(27) + '[0m `code`';
  core.validity.reasons = [{
    code: '# boom <img src=x onerror=alert(1)>',
    scope: 'a|b' + String.fromCharCode(10) + '> quote' + String.fromCharCode(13) + String.fromCharCode(0)
  }];
  const receipt = makeReceipt(core);
  const out = renderTrustPrMarkdown(receipt);
  assert.equal(out.includes('<script>'), false);
  assert.equal(out.includes('<img'), false);
  assert.equal(out.includes('\x1b'), false);
  assert.equal(out.includes('\x00'), false);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /\\# h/);
  assert.match(out, /\\\[x\\\]\\\(javascript:1\\\)/);
  assert.ok(out.includes('\\\\u001b'));
  assert.ok(out.includes('\\\\u0000'));
  assert.equal(out.includes('\n> quote'), false);
});

test('valid UTF-8 Git path is derived from base64 and Markdown-escaped', () => {
  const core = baseCore();
  core.observed.changed_entries[0].raw_path_b64 =
    Buffer.from('docs/# risky [name].md', 'utf8').toString('base64');
  const out = renderTrustPrMarkdown(makeReceipt(core));
  assert.ok(out.includes('docs/\\# risky \\[name\\]\\.md'));
});

test('non-UTF8 Git path is shown as an explicit base64 representation', () => {
  const core = baseCore();
  core.observed.changed_entries[0].raw_path_b64 = Buffer.from([0xff, 0xfe, 0x2f, 0x61]).toString('base64');
  const out = renderTrustPrMarkdown(makeReceipt(core));
  assert.match(out, /non\\-UTF8 path/);
  assert.match(out, /base64:/);
  assert.ok(out.includes('//4vYQ=='));
});

test('invalid raw path base64 fails closed rather than inventing a display path', () => {
  const core = baseCore();
  core.observed.changed_entries[0].raw_path_b64 = 'not-base64***';
  assert.throws(
    () => renderTrustPrMarkdown(makeReceipt(core)),
    (error) => error?.code === 'INVALID_RAW_PATH_B64'
  );
});

test('over-limit strings are visibly truncated and emit a renderer finding', () => {
  const core = baseCore();
  core.subject.repository_id = 'x'.repeat(RENDER_LIMITS.maxStringCodePoints + 25);
  const out = renderTrustPrMarkdown(makeReceipt(core));
  assert.match(out, /…\\\[truncated 25 code points\\\]/);
  assert.match(out, /RENDER\\_TRUNCATED/);
  assert.ok(out.includes('subject\\.repository\\_id'));
});

test('over-limit arrays are visibly bounded and emit item-count findings', () => {
  const core = baseCore();
  core.observed.changed_entries = Array.from({ length: RENDER_LIMITS.maxListItems + 5 }, (_, i) => ({
    raw_path_b64: Buffer.from(`src/f-${String(i).padStart(3, '0')}.txt`, 'utf8').toString('base64'),
    change_type: 'MODIFY',
    old_mode: '100644',
    new_mode: '100644',
    old_blob_sha: 'e'.repeat(40),
    new_blob_sha: 'f'.repeat(40)
  }));
  const out = renderTrustPrMarkdown(makeReceipt(core));
  assert.match(out, /RENDER\\_LIST\\_TRUNCATED/);
  assert.match(out, /changed\\_entries/);
  assert.match(out, /observed=55 cap=50/);
  assert.equal(out.includes('src/f-054.txt'), false);
});

test('collection metadata never changes deterministic human summary', () => {
  const core = baseCore();
  const a = makeReceipt(core, { collection_metadata: { observed_at: 'a', duplicate_count: 1 } });
  const b = makeReceipt(core, { collection_metadata: { observed_at: 'b', duplicate_count: 999 } });
  assert.equal(renderTrustPrMarkdown(a), renderTrustPrMarkdown(b));
});

test('same validated receipt regenerates byte-for-byte identical UTF-8 without BOM', () => {
  const receipt = makeReceipt();
  const a = renderTrustPrMarkdownBytes(receipt);
  const b = renderTrustPrMarkdownBytes(receipt);
  assert.ok(Buffer.isBuffer(a));
  assert.deepEqual(a, b);
  assert.equal(a[0] === 0xef && a[1] === 0xbb && a[2] === 0xbf, false);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(a), renderTrustPrMarkdown(receipt));
});

test('tampered human summary is explicit and cannot mutate receipt truth', () => {
  const receipt = makeReceipt();
  const before = JSON.stringify(receipt);
  const expected = renderTrustPrMarkdown(receipt);
  const good = verifyTrustPrMarkdown(receipt, expected);
  assert.equal(good.status, 'MATCH');

  const bad = verifyTrustPrMarkdown(receipt, expected.replace('Status: PARTIAL', 'Status: VALID'));
  assert.equal(bad.status, 'MISMATCH');
  assert.equal(bad.finding.code, 'HUMAN_SUMMARY_MISMATCH');
  assert.match(bad.expected_sha256, /^[0-9a-f]{64}$/);
  assert.match(bad.supplied_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(receipt), before);
});

test('invalid UTF-8 supplied summary is mismatch evidence without echoing hostile bytes', () => {
  const receipt = makeReceipt();
  const bad = verifyTrustPrMarkdown(receipt, Buffer.from([0xff, 0xfe, 0xfd]));
  assert.equal(bad.status, 'MISMATCH');
  assert.equal(bad.finding.code, 'SUPPLIED_SUMMARY_INVALID_UTF8');
  assert.equal('supplied_text' in bad, false);
});

test('output byte cap fails explicitly rather than silently clipping receipt status', () => {
  const core = baseCore();
  const large = 'x'.repeat(RENDER_LIMITS.maxStringCodePoints);
  core.observed.checks = Array.from({ length: RENDER_LIMITS.maxListItems }, (_, i) => ({
    provider: large,
    check_run_id: String(i),
    head_sha: 'b'.repeat(40),
    status: large,
    conclusion: large
  }));
  core.observed.artifacts = Array.from({ length: RENDER_LIMITS.maxListItems }, (_, i) => ({
    provider: large,
    artifact_id: String(i)
  }));
  assert.throws(
    () => renderTrustPrMarkdown(makeReceipt(core)),
    (error) => error?.code === 'RENDER_OUTPUT_LIMIT_EXCEEDED'
  );
});
