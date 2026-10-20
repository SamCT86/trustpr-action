import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  RENDERER_VERSION, computeCoreDigest, renderTrustPrMarkdown
} from '../src/human-renderer.mjs';

// This is a stable V1 wire-format fixture, not an opinionated prose snapshot.
// A renderer text change with unchanged TRUSTPR-MD-V1 breaks old saved summaries.
test('V1 canonical Markdown bytes remain stable across source changes', () => {
  assert.equal(RENDERER_VERSION, 'TRUSTPR-MD-V1');
  const core = {
    subject: {
      repository_id: '1413924316', pull_request_number: '7',
      base_commit_sha: 'a'.repeat(40), head_commit_sha: 'b'.repeat(40),
      merge_base_sha: 'a'.repeat(40)
    },
    snapshot_identity: 'c'.repeat(64),
    declared: {
      policy_binding: 'POLICY_UNBOUND',
      required_evidence: ['git_diff', 'github_metadata']
    },
    observed: {
      changed_entries: [{
        raw_path_b64: Buffer.from('src/main.js').toString('base64'),
        change_type: 'MODIFY', old_mode: '100644', new_mode: '100644',
        old_blob_sha: 'd'.repeat(40), new_blob_sha: 'e'.repeat(40)
      }],
      checks: [], artifacts: []
    },
    unknowns: [{
      stable_code: 'TEST_EXECUTION_NOT_ESTABLISHED',
      field_or_source_tuple: 'checks'
    }],
    inferred: [],
    validity: {status: 'PARTIAL', reasons: [{code: 'EVIDENCE_NOT_COMPLETE'}]}
  };
  const receipt = {
    receipt_schema_version: 'trustpr-receipt-v1',
    authenticity: 'UNAUTHENTICATED',
    integrity: {algorithm: 'sha256', core_digest: computeCoreDigest(core)},
    core
  };
  const output = renderTrustPrMarkdown(receipt);
  assert.equal(Buffer.byteLength(output, 'utf8'), 1025);
  assert.equal(
    createHash('sha256').update(output).digest('hex'),
    '6df27109d14d7702aa330eedcb10a58995b525901571553c2d1b7f48dad5ac96'
  );
});
