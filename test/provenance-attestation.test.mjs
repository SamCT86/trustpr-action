import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PROVENANCE_ADMISSION_VERSION,
  GITHUB_ATTESTATION_PREDICATE_DEFAULT,
  verifyGitHubArtifactAttestation
} from '../src/provenance-attestation.mjs';

async function sha256File(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function fixture({ mode = 'pass', artifactName = 'artifact.bin' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trustpr-s6-'));
  const artifactPath = path.join(dir, artifactName);
  const bundlePath = path.join(dir, 'bundle.jsonl');
  const trustedRootPath = path.join(dir, 'trusted_root.jsonl');
  const verifierPath = path.join(dir, 'gh-test-double');
  await fs.writeFile(artifactPath, Buffer.from('exact artifact bytes\n'));
  await fs.writeFile(bundlePath, '{}\n');
  await fs.writeFile(trustedRootPath, '{}\n');
  const digest = await sha256File(artifactPath);
  const statementDigest = mode === 'subject-mismatch' ? 'f'.repeat(64) : digest;
  const predicate = mode === 'predicate-mismatch'
    ? 'https://example.invalid/predicate'
    : GITHUB_ATTESTATION_PREDICATE_DEFAULT;
  const output = JSON.stringify([{
    attestation: { ignored: 'untrusted-predicate-data' },
    verificationResult: {
      signature: { certificate: mode === 'no-certificate' ? null : {
        subjectAlternativeName: mode === 'cert-san-mismatch'
          ? 'https://github.com/evil/repo/.github/workflows/release.yml@refs/heads/main'
          : 'https://github.com/owner/repo/.github/workflows/release.yml@refs/heads/main',
        issuer: mode === 'cert-issuer-mismatch'
          ? 'https://issuer.example.invalid'
          : 'https://token.actions.githubusercontent.com',
        sourceRepositoryURI: mode === 'cert-repository-mismatch'
          ? 'https://github.com/evil/repo'
          : 'https://github.com/owner/repo',
        sourceRepositoryOwnerURI: mode === 'cert-owner-mismatch'
          ? 'https://github.com/evil'
          : 'https://github.com/owner',
        buildSignerDigest: mode === 'cert-signer-mismatch' ? 'c'.repeat(40) : 'a'.repeat(40),
        sourceRepositoryDigest: mode === 'cert-source-mismatch' ? 'd'.repeat(40) : 'b'.repeat(40),
        runnerEnvironment: mode === 'cert-self-hosted' ? 'self-hosted' : 'github-hosted'
      } },
      verifiedTimestamps: [{ type: 'fixture' }],
      statement: {
        _type: mode === 'statement-type-mismatch' ? 'https://example.invalid/Statement/v9' : 'https://in-toto.io/Statement/v1',
        subject: [{ name: artifactName, digest: { sha256: statementDigest } }],
        predicateType: predicate,
        predicate: { attackerControlled: true }
      }
    }
  }]);
  const escapedOutput = output.replaceAll("'", "'\\''");
  const script = mode === 'reject'
    ? '#!/bin/sh\nexit 1\n'
    : mode === 'malformed'
      ? '#!/bin/sh\nprintf not-json\n'
      : mode === 'self-modify'
        ? `#!/bin/sh
printf '%s' '${escapedOutput}'
printf '\\n# changed' >> "$0"
`
        : mode === 'bundle-modify'
          ? `#!/bin/sh
printf '\\nchanged' >> '${bundlePath}'
printf '%s' '${escapedOutput}'
`
          : mode === 'root-modify'
            ? `#!/bin/sh
printf '\\nchanged' >> '${trustedRootPath}'
printf '%s' '${escapedOutput}'
`
            : mode === 'artifact-modify'
              ? `#!/bin/sh
printf 'changed' >> '${artifactPath}'
printf '%s' '${escapedOutput}'
`
              : `#!/bin/sh
set -eu
args="$*"
for required in "attestation verify" "--format json" "--repo owner/repo" "--signer-workflow owner/repo/.github/workflows/release.yml" "--signer-digest ${'a'.repeat(40)}" "--source-digest ${'b'.repeat(40)}" "--cert-oidc-issuer https://token.actions.githubusercontent.com" "--predicate-type ${GITHUB_ATTESTATION_PREDICATE_DEFAULT}" "--bundle ${bundlePath}" "--custom-trusted-root ${trustedRootPath}" "--deny-self-hosted-runners"; do
  case "$args" in *"$required"*) ;; *) echo "missing:$required" >&2; exit 41;; esac
done
printf '%s' '${escapedOutput}'
`;
  await fs.writeFile(verifierPath, script, { mode: 0o700 });
  await fs.chmod(verifierPath, 0o700);
  const verifierSha256 = await sha256File(verifierPath);
  const trustedRootSha256 = await sha256File(trustedRootPath);
  const bundleSha256 = await sha256File(bundlePath);
  const policy = {
    verifier: {
      kind: 'GITHUB_CLI_ATTESTATION_VERIFY_V1',
      executablePath: verifierPath,
      executableSha256: verifierSha256
    },
    repository: 'owner/repo',
    signerWorkflow: 'owner/repo/.github/workflows/release.yml',
    signerDigest: 'a'.repeat(40),
    sourceDigest: 'b'.repeat(40),
    oidcIssuer: 'https://token.actions.githubusercontent.com',
    predicateType: GITHUB_ATTESTATION_PREDICATE_DEFAULT,
    trustedRootSha256,
    denySelfHostedRunners: true
  };
  return { dir, artifactPath, bundlePath, trustedRootPath, verifierPath, verifierSha256, trustedRootSha256, bundleSha256, digest, policy };
}

test('version and default predicate are explicit', () => {
  assert.equal(PROVENANCE_ADMISSION_VERSION, 'TRUSTPR-PROVENANCE-ADMISSION-V1');
  assert.equal(GITHUB_ATTESTATION_PREDICATE_DEFAULT, 'https://slsa.dev/provenance/v1');
});

test('pinned offline GitHub verifier success admits only bounded cryptographic evidence', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy: f.policy
  });
  assert.deepEqual(out, {
    version: PROVENANCE_ADMISSION_VERSION,
    status: 'CRYPTOGRAPHICALLY_VERIFIED',
    verifier: 'GITHUB_CLI_ATTESTATION_VERIFY_V1',
    verifier_sha256: f.verifierSha256,
    trusted_root_sha256: f.trustedRootSha256,
    attestation_bundle_sha256: f.bundleSha256,
    repository: 'owner/repo',
    signer_workflow: 'owner/repo/.github/workflows/release.yml',
    signer_digest: 'a'.repeat(40),
    source_digest: 'b'.repeat(40),
    oidc_issuer: 'https://token.actions.githubusercontent.com',
    predicate_type: GITHUB_ATTESTATION_PREDICATE_DEFAULT,
    subject_sha256: f.digest,
    verified_attestation_count: '1',
    authenticity: 'CRYPTOGRAPHICALLY_VERIFIED'
  });
  assert.equal(JSON.stringify(out).includes('attackerControlled'), false);
});

test('missing or unpinned verifier fails UNKNOWN without authenticity upgrade', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const missing = structuredClone(f.policy);
  missing.verifier.executablePath = path.join(f.dir, 'missing-gh');
  assert.deepEqual(
    await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: missing
    }),
    { version: PROVENANCE_ADMISSION_VERSION, status: 'UNKNOWN', reason: 'VERIFIER_UNAVAILABLE', authenticity: 'UNAUTHENTICATED' }
  );

  const wrongHash = structuredClone(f.policy);
  wrongHash.verifier.executableSha256 = '0'.repeat(64);
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy: wrongHash
  });
  assert.equal(out.status, 'UNKNOWN');
  assert.equal(out.reason, 'VERIFIER_BINARY_MISMATCH');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('policy requires exact repository, workflow, signer/source digests and issuer', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  for (const key of ['repository', 'signerWorkflow', 'signerDigest', 'sourceDigest', 'oidcIssuer', 'predicateType', 'trustedRootSha256']) {
    const policy = structuredClone(f.policy);
    delete policy[key];
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy
    });
    assert.equal(out.status, 'INVALID', key);
    assert.equal(out.reason, 'PROVENANCE_POLICY_INVALID', key);
  }
});

test('subject or predicate mismatch after verifier success is INVALID', async (t) => {
  for (const mode of ['subject-mismatch', 'predicate-mismatch']) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    });
    assert.equal(out.status, 'INVALID', mode);
    assert.match(out.reason, /^(ATTESTATION_SUBJECT_MISMATCH|ATTESTATION_PREDICATE_MISMATCH)$/);
    assert.equal(out.authenticity, 'UNAUTHENTICATED');
  }
});

test('offline verifier rejection or malformed successful output fails closed', async (t) => {
  for (const mode of ['reject', 'malformed']) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    });
    assert.equal(out.status, 'INVALID', mode);
    assert.equal(out.authenticity, 'UNAUTHENTICATED');
  }
});

test('missing artifact, bundle, or trusted root is UNKNOWN and never invokes trust', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  for (const [key, reason] of [
    ['artifactPath', 'ARTIFACT_UNAVAILABLE'],
    ['bundlePath', 'ATTESTATION_BUNDLE_UNAVAILABLE'],
    ['trustedRootPath', 'TRUSTED_ROOT_UNAVAILABLE']
  ]) {
    const input = {
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    };
    input[key] = path.join(f.dir, 'missing-' + key);
    const out = await verifyGitHubArtifactAttestation(input);
    assert.deepEqual(out, {
      version: PROVENANCE_ADMISSION_VERSION,
      status: 'UNKNOWN',
      reason,
      authenticity: 'UNAUTHENTICATED'
    });
  }
});

test('shell metacharacters in artifact path stay argv data, not shell execution', async (t) => {
  const f = await fixture({ artifactName: 'artifact;touch SHOULD_NOT_EXIST.bin' });
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy: f.policy
  });
  assert.equal(out.status, 'CRYPTOGRAPHICALLY_VERIFIED');
  await assert.rejects(fs.stat(path.join(f.dir, 'SHOULD_NOT_EXIST')));
});

test('verifier binary mutation during execution invalidates result after execution', async (t) => {
  const f = await fixture({ mode: 'self-modify' });
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy: f.policy
  });
  assert.equal(out.status, 'UNKNOWN');
  assert.equal(out.reason, 'VERIFIER_BINARY_CHANGED');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('symlink verifier is not accepted as a pinned trust root', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const link = path.join(f.dir, 'gh-link');
  await fs.symlink(f.verifierPath, link);
  const policy = structuredClone(f.policy);
  policy.verifier.executablePath = link;
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy
  });
  assert.equal(out.status, 'UNKNOWN');
  assert.equal(out.reason, 'VERIFIER_NOT_REGULAR_FILE');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('trusted root is an authority input and must match its pinned digest', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const policy = structuredClone(f.policy);
  policy.trustedRootSha256 = '0'.repeat(64);
  const out = await verifyGitHubArtifactAttestation({
    artifactPath: f.artifactPath,
    bundlePath: f.bundlePath,
    trustedRootPath: f.trustedRootPath,
    policy
  });
  assert.equal(out.status, 'UNKNOWN');
  assert.equal(out.reason, 'TRUSTED_ROOT_MISMATCH');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('successful process output still requires in-toto v1 statement and certificate structure', async (t) => {
  for (const [mode, reason] of [
    ['statement-type-mismatch', 'ATTESTATION_STATEMENT_TYPE_MISMATCH'],
    ['no-certificate', 'VERIFIER_OUTPUT_INVALID']
  ]) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    });
    assert.equal(out.status, 'INVALID', mode);
    assert.equal(out.reason, reason, mode);
    assert.equal(out.authenticity, 'UNAUTHENTICATED');
  }
});

test('artifact, bundle, or trusted-root mutation during verification invalidates the result', async (t) => {
  for (const [mode, reason] of [
    ['artifact-modify', 'ARTIFACT_CHANGED'],
    ['bundle-modify', 'ATTESTATION_BUNDLE_CHANGED'],
    ['root-modify', 'TRUSTED_ROOT_CHANGED']
  ]) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    });
    assert.equal(out.status, 'UNKNOWN', mode);
    assert.equal(out.reason, reason, mode);
    assert.equal(out.authenticity, 'UNAUTHENTICATED', mode);
  }
});

test('certificate identity fields are independently bound after verifier success', async (t) => {
  const cases = [
    ['cert-issuer-mismatch', 'ATTESTATION_CERT_ISSUER_MISMATCH'],
    ['cert-repository-mismatch', 'ATTESTATION_CERT_REPOSITORY_MISMATCH'],
    ['cert-owner-mismatch', 'ATTESTATION_CERT_REPOSITORY_MISMATCH'],
    ['cert-signer-mismatch', 'ATTESTATION_CERT_SIGNER_MISMATCH'],
    ['cert-source-mismatch', 'ATTESTATION_CERT_SOURCE_MISMATCH'],
    ['cert-san-mismatch', 'ATTESTATION_CERT_SIGNER_IDENTITY_MISMATCH'],
    ['cert-self-hosted', 'ATTESTATION_CERT_RUNNER_MISMATCH']
  ];
  for (const [mode, reason] of cases) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
    const out = await verifyGitHubArtifactAttestation({
      artifactPath: f.artifactPath,
      bundlePath: f.bundlePath,
      trustedRootPath: f.trustedRootPath,
      policy: f.policy
    });
    assert.equal(out.status, 'INVALID', mode);
    assert.equal(out.reason, reason, mode);
    assert.equal(out.authenticity, 'UNAUTHENTICATED', mode);
  }
});
