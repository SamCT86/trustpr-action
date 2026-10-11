import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCoreDigest,
  renderTrustPrMarkdown,
  verifyTrustPrMarkdown
} from '../src/human-renderer.mjs';

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function makeReceipt(label, pathBytes) {
  const core = {
    subject: {
      repository_id: label,
      pull_request_number: '99',
      base_commit_sha: 'a'.repeat(40),
      head_commit_sha: 'b'.repeat(40),
      merge_base_sha: 'c'.repeat(40)
    },
    snapshot_identity: 'd'.repeat(64),
    declared: { policy_binding: 'POLICY_UNBOUND', required_evidence: [] },
    observed: {
      changed_entries: [{
        raw_path_b64: Buffer.from(pathBytes).toString('base64'),
        change_type: label
      }],
      checks: [],
      artifacts: []
    },
    inferred: [],
    unknowns: [],
    validity: { status: 'VALID', reasons: [] }
  };
  return {
    receipt_schema_version: 'trustpr-receipt-v1',
    core,
    integrity: { algorithm: 'sha256', core_digest: computeCoreDigest(core) },
    authenticity: 'UNAUTHENTICATED'
  };
}

const atoms = [
  '<', '>', '&', '"', "'", '#', '*', '_', '[', ']', '(', ')', '`', '|', '~', '!',
  '\n', '\r', '\t', String.fromCharCode(0), String.fromCharCode(27),
  '\u202e', '\u2066', '\u200f', '\ufeff', 'é', '中', '😀', 'safe'
];

test('250 deterministic hostile-string fuzz cases remain byte-stable and control-safe', () => {
  const random = rng(0x51c34a9d);
  for (let caseNo = 0; caseNo < 250; caseNo += 1) {
    let label = '';
    const n = 1 + Math.floor(random() * 40);
    for (let i = 0; i < n; i += 1) {
      label += atoms[Math.floor(random() * atoms.length)];
    }
    const path = Buffer.from([caseNo & 0xff, 0xff, 0x00, 0x2f, 0x23, 0x60]);
    const receipt = makeReceipt(label, path);
    const a = renderTrustPrMarkdown(receipt);
    const b = renderTrustPrMarkdown(receipt);
    assert.equal(a, b);
    assert.equal(a.includes('<'), false);
    assert.equal(a.includes('>'), false);
    assert.equal(a.includes('\u202e'), false);
    for (const ch of a) {
      const code = ch.codePointAt(0);
      if (code < 32) assert.equal(code, 10);
    }
  }
});

test('canonical base64 for arbitrary path bytes always renders explicitly without throwing', () => {
  const random = rng(0x9e3779b9);
  for (let caseNo = 0; caseNo < 200; caseNo += 1) {
    const size = 1 + Math.floor(random() * 64);
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(random() * 256);
    const receipt = makeReceipt('safe', bytes);
    const out = renderTrustPrMarkdown(receipt);
    assert.match(out, /^# TrustPR evidence receipt\n/);
  }
});

test('tampered renderer bytes never collapse to MATCH under deterministic fuzz edits', () => {
  const receipt = makeReceipt('safe', Buffer.from('safe.txt'));
  const expected = renderTrustPrMarkdown(receipt);
  for (let i = 0; i < Math.min(200, expected.length); i += 7) {
    const replacement = expected[i] === 'X' ? 'Y' : 'X';
    const tampered = expected.slice(0, i) + replacement + expected.slice(i + 1);
    assert.equal(verifyTrustPrMarkdown(receipt, tampered).status, 'MISMATCH');
  }
});
