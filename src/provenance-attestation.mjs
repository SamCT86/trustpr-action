import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROVENANCE_ADMISSION_VERSION = 'TRUSTPR-PROVENANCE-ADMISSION-V1';
export const GITHUB_ATTESTATION_PREDICATE_DEFAULT = 'https://slsa.dev/provenance/v1';
const IN_TOTO_STATEMENT_V1 = 'https://in-toto.io/Statement/v1';
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const MAX_VERIFIER_OUTPUT_BYTES = 2 * 1024 * 1024;
const VERIFY_TIMEOUT_MS = 20_000;

function base(status, reason) {
  return reason === undefined
    ? { version: PROVENANCE_ADMISSION_VERSION, status, authenticity: 'UNAUTHENTICATED' }
    : { version: PROVENANCE_ADMISSION_VERSION, status, reason, authenticity: 'UNAUTHENTICATED' };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value, max = 4096) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function isHexDigest(value, lengths) {
  return typeof value === 'string'
    && lengths.includes(value.length)
    && /^[0-9a-f]+$/u.test(value);
}

function validRepo(value) {
  if (!safeText(value, 300)) return false;
  const parts = value.split('/');
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]+$/u.test(part) && part !== '.' && part !== '..');
}

function validSignerWorkflow(value, repository) {
  if (!safeText(value, 1000) || value.includes('\\') || value.includes('?') || value.includes('#')) return false;
  const prefixA = repository + '/';
  const prefixB = 'github.com/' + repository + '/';
  const rest = value.startsWith(prefixA)
    ? value.slice(prefixA.length)
    : value.startsWith(prefixB)
      ? value.slice(prefixB.length)
      : null;
  if (rest === null || !rest.startsWith('.github/workflows/')) return false;
  if (!/\.ya?ml$/u.test(rest)) return false;
  const segments = rest.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validPredicate(value) {
  if (!safeText(value, 1000)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}

function validatePolicy(policy) {
  if (!exactKeys(policy, [
    'denySelfHostedRunners',
    'oidcIssuer',
    'predicateType',
    'repository',
    'signerDigest',
    'signerWorkflow',
    'sourceDigest',
    'trustedRootSha256',
    'verifier'
  ])) return false;
  if (!exactKeys(policy.verifier, ['executablePath', 'executableSha256', 'kind'])) return false;
  if (policy.verifier.kind !== 'GITHUB_CLI_ATTESTATION_VERIFY_V1') return false;
  if (!safeText(policy.verifier.executablePath, 4096) || !path.isAbsolute(policy.verifier.executablePath)) return false;
  if (!isHexDigest(policy.verifier.executableSha256, [64])) return false;
  if (!validRepo(policy.repository)) return false;
  if (!validSignerWorkflow(policy.signerWorkflow, policy.repository)) return false;
  if (!isHexDigest(policy.signerDigest, [40, 64])) return false;
  if (!isHexDigest(policy.sourceDigest, [40, 64])) return false;
  if (policy.oidcIssuer !== GITHUB_OIDC_ISSUER) return false;
  if (!validPredicate(policy.predicateType)) return false;
  if (!isHexDigest(policy.trustedRootSha256, [64])) return false;
  if (typeof policy.denySelfHostedRunners !== 'boolean') return false;
  return true;
}

async function lstatRegular(file) {
  try {
    const stat = await fsp.lstat(file);
    return { exists: true, regular: stat.isFile(), stat };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { exists: false, regular: false };
    throw error;
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function fileIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mtimeMs: String(stat.mtimeMs)
  };
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function safeOfflineEnv() {
  const env = {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    GH_NO_UPDATE_NOTIFIER: '1'
  };
  if (safeText(process.env.HOME, 4096)) env.HOME = process.env.HOME;
  if (safeText(process.env.TMPDIR, 4096)) env.TMPDIR = process.env.TMPDIR;
  if (safeText(process.env.SSL_CERT_FILE, 4096)) env.SSL_CERT_FILE = process.env.SSL_CERT_FILE;
  if (safeText(process.env.SSL_CERT_DIR, 4096)) env.SSL_CERT_DIR = process.env.SSL_CERT_DIR;
  return env;
}

function verificationArgs({ artifactPath, bundlePath, trustedRootPath, policy }) {
  const args = [
    'attestation', 'verify', artifactPath,
    '--repo', policy.repository,
    '--signer-workflow', policy.signerWorkflow,
    '--signer-digest', policy.signerDigest,
    '--source-digest', policy.sourceDigest,
    '--cert-oidc-issuer', policy.oidcIssuer,
    '--predicate-type', policy.predicateType,
    '--bundle', bundlePath,
    '--custom-trusted-root', trustedRootPath,
    '--format', 'json'
  ];
  if (policy.denySelfHostedRunners) args.push('--deny-self-hosted-runners');
  return args;
}

function normalizedSignerWorkflow(value) {
  const prefix = 'github.com/';
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function equalFold(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function certificateIdentityFailure(certificate, policy) {
  if (!isPlainObject(certificate)) return 'VERIFIER_OUTPUT_INVALID';
  if (!equalFold(certificate.issuer, policy.oidcIssuer)) {
    return 'ATTESTATION_CERT_ISSUER_MISMATCH';
  }
  const expectedRepositoryUri = 'https://github.com/' + policy.repository;
  const expectedOwnerUri = 'https://github.com/' + policy.repository.split('/')[0];
  if (!equalFold(certificate.sourceRepositoryURI, expectedRepositoryUri)
      || !equalFold(certificate.sourceRepositoryOwnerURI, expectedOwnerUri)) {
    return 'ATTESTATION_CERT_REPOSITORY_MISMATCH';
  }
  if (!equalFold(certificate.buildSignerDigest, policy.signerDigest)) {
    return 'ATTESTATION_CERT_SIGNER_MISMATCH';
  }
  if (!equalFold(certificate.sourceRepositoryDigest, policy.sourceDigest)) {
    return 'ATTESTATION_CERT_SOURCE_MISMATCH';
  }
  const signerWorkflow = normalizedSignerWorkflow(policy.signerWorkflow);
  const signerPrefix = 'https://github.com/' + signerWorkflow + '@';
  if (typeof certificate.subjectAlternativeName !== 'string'
      || !certificate.subjectAlternativeName.startsWith(signerPrefix)
      || certificate.subjectAlternativeName.length <= signerPrefix.length) {
    return 'ATTESTATION_CERT_SIGNER_IDENTITY_MISMATCH';
  }
  if (policy.denySelfHostedRunners && certificate.runnerEnvironment !== 'github-hosted') {
    return 'ATTESTATION_CERT_RUNNER_MISMATCH';
  }
  return null;
}

function parseVerificationOutput(stdout, expectedDigest, expectedPredicate, policy) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return base('INVALID', 'VERIFIER_OUTPUT_INVALID');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return base('INVALID', 'VERIFIER_OUTPUT_INVALID');
  }

  for (const item of parsed) {
    const result = item?.verificationResult;
    if (!isPlainObject(result) || !isPlainObject(result.signature?.certificate)
        || !isPlainObject(result.statement)) {
      return base('INVALID', 'VERIFIER_OUTPUT_INVALID');
    }
    const certificateFailure = certificateIdentityFailure(result.signature.certificate, policy);
    if (certificateFailure !== null) return base('INVALID', certificateFailure);
    if (result.statement._type !== IN_TOTO_STATEMENT_V1) {
      return base('INVALID', 'ATTESTATION_STATEMENT_TYPE_MISMATCH');
    }
    if (result.statement.predicateType !== expectedPredicate) {
      return base('INVALID', 'ATTESTATION_PREDICATE_MISMATCH');
    }
    if (!Array.isArray(result.statement.subject) || result.statement.subject.length === 0) {
      return base('INVALID', 'ATTESTATION_SUBJECT_MISMATCH');
    }
    const matches = result.statement.subject.some((subject) =>
      isPlainObject(subject)
      && isPlainObject(subject.digest)
      && subject.digest.sha256 === expectedDigest);
    if (!matches) return base('INVALID', 'ATTESTATION_SUBJECT_MISMATCH');
  }

  return { count: parsed.length };
}

export async function verifyGitHubArtifactAttestation({
  artifactPath,
  bundlePath,
  trustedRootPath,
  policy
}) {
  if (!validatePolicy(policy)) return base('INVALID', 'PROVENANCE_POLICY_INVALID');

  const fileInputs = [
    [artifactPath, 'ARTIFACT_UNAVAILABLE', 'ARTIFACT_NOT_REGULAR_FILE'],
    [bundlePath, 'ATTESTATION_BUNDLE_UNAVAILABLE', 'ATTESTATION_BUNDLE_NOT_REGULAR_FILE'],
    [trustedRootPath, 'TRUSTED_ROOT_UNAVAILABLE', 'TRUSTED_ROOT_NOT_REGULAR_FILE']
  ];
  const inputStats = new Map();
  for (const [file, missingReason, typeReason] of fileInputs) {
    if (!safeText(file, 4096) || !path.isAbsolute(file)) return base('INVALID', 'PROVENANCE_INPUT_PATH_INVALID');
    const probe = await lstatRegular(file);
    if (!probe.exists) return base('UNKNOWN', missingReason);
    if (!probe.regular) return base('INVALID', typeReason);
    inputStats.set(file, fileIdentity(probe.stat));
  }

  const verifierProbe = await lstatRegular(policy.verifier.executablePath);
  if (!verifierProbe.exists) return base('UNKNOWN', 'VERIFIER_UNAVAILABLE');
  if (!verifierProbe.regular) return base('UNKNOWN', 'VERIFIER_NOT_REGULAR_FILE');
  if ((verifierProbe.stat.mode & 0o111) === 0) return base('UNKNOWN', 'VERIFIER_NOT_EXECUTABLE');

  const verifierIdentityBefore = fileIdentity(verifierProbe.stat);
  const verifierDigestBefore = await sha256File(policy.verifier.executablePath);
  if (verifierDigestBefore !== policy.verifier.executableSha256) {
    return base('UNKNOWN', 'VERIFIER_BINARY_MISMATCH');
  }

  const trustedRootDigestBefore = await sha256File(trustedRootPath);
  if (trustedRootDigestBefore !== policy.trustedRootSha256) {
    return base('UNKNOWN', 'TRUSTED_ROOT_MISMATCH');
  }

  const bundleDigestBefore = await sha256File(bundlePath);
  const artifactDigestBefore = await sha256File(artifactPath);
  const args = verificationArgs({ artifactPath, bundlePath, trustedRootPath, policy });

  let execution;
  let executionError = null;
  try {
    execution = await execFileAsync(policy.verifier.executablePath, args, {
      encoding: 'utf8',
      env: safeOfflineEnv(),
      timeout: VERIFY_TIMEOUT_MS,
      maxBuffer: MAX_VERIFIER_OUTPUT_BYTES,
      windowsHide: true
    });
  } catch (error) {
    executionError = error;
    execution = { stdout: error?.stdout ?? '', stderr: error?.stderr ?? '' };
  }

  const verifierAfterProbe = await lstatRegular(policy.verifier.executablePath);
  if (!verifierAfterProbe.exists || !verifierAfterProbe.regular) {
    return base('UNKNOWN', 'VERIFIER_BINARY_CHANGED');
  }
  const verifierDigestAfter = await sha256File(policy.verifier.executablePath);
  if (verifierDigestAfter !== policy.verifier.executableSha256
      || !sameIdentity(verifierIdentityBefore, fileIdentity(verifierAfterProbe.stat))) {
    return base('UNKNOWN', 'VERIFIER_BINARY_CHANGED');
  }

  const trustedRootAfterProbe = await lstatRegular(trustedRootPath);
  if (!trustedRootAfterProbe.exists || !trustedRootAfterProbe.regular) {
    return base('UNKNOWN', 'TRUSTED_ROOT_CHANGED');
  }
  const trustedRootDigestAfter = await sha256File(trustedRootPath);
  if (trustedRootDigestAfter !== policy.trustedRootSha256
      || !sameIdentity(inputStats.get(trustedRootPath), fileIdentity(trustedRootAfterProbe.stat))) {
    return base('UNKNOWN', 'TRUSTED_ROOT_CHANGED');
  }

  const bundleAfterProbe = await lstatRegular(bundlePath);
  if (!bundleAfterProbe.exists || !bundleAfterProbe.regular) {
    return base('UNKNOWN', 'ATTESTATION_BUNDLE_CHANGED');
  }
  const bundleDigestAfter = await sha256File(bundlePath);
  if (bundleDigestAfter !== bundleDigestBefore
      || !sameIdentity(inputStats.get(bundlePath), fileIdentity(bundleAfterProbe.stat))) {
    return base('UNKNOWN', 'ATTESTATION_BUNDLE_CHANGED');
  }

  const artifactAfterProbe = await lstatRegular(artifactPath);
  if (!artifactAfterProbe.exists || !artifactAfterProbe.regular) {
    return base('UNKNOWN', 'ARTIFACT_CHANGED');
  }
  const artifactDigestAfter = await sha256File(artifactPath);
  if (artifactDigestAfter !== artifactDigestBefore
      || !sameIdentity(inputStats.get(artifactPath), fileIdentity(artifactAfterProbe.stat))) {
    return base('UNKNOWN', 'ARTIFACT_CHANGED');
  }

  if (executionError) {
    if (executionError?.code === 'ENOENT') return base('UNKNOWN', 'VERIFIER_UNAVAILABLE');
    if (executionError?.killed || executionError?.code === 'ETIMEDOUT') {
      return base('UNKNOWN', 'VERIFIER_TIMEOUT');
    }
    return base('INVALID', 'ATTESTATION_VERIFICATION_REJECTED');
  }

  if (typeof execution.stdout !== 'string' || Buffer.byteLength(execution.stdout) > MAX_VERIFIER_OUTPUT_BYTES) {
    return base('INVALID', 'VERIFIER_OUTPUT_INVALID');
  }
  const parsed = parseVerificationOutput(execution.stdout, artifactDigestBefore, policy.predicateType, policy);
  if ('status' in parsed) return parsed;

  return {
    version: PROVENANCE_ADMISSION_VERSION,
    status: 'CRYPTOGRAPHICALLY_VERIFIED',
    verifier: policy.verifier.kind,
    verifier_sha256: policy.verifier.executableSha256,
    trusted_root_sha256: policy.trustedRootSha256,
    attestation_bundle_sha256: bundleDigestBefore,
    repository: policy.repository,
    signer_workflow: policy.signerWorkflow,
    signer_digest: policy.signerDigest,
    source_digest: policy.sourceDigest,
    oidc_issuer: policy.oidcIssuer,
    predicate_type: policy.predicateType,
    subject_sha256: artifactDigestBefore,
    verified_attestation_count: String(parsed.count),
    authenticity: 'CRYPTOGRAPHICALLY_VERIFIED'
  };
}
