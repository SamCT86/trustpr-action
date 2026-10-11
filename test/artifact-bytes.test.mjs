import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  ARTIFACT_BYTES_VERSION,
  ARCHIVE_MANIFEST_VERSION,
  ARTIFACT_LIMITS,
  verifyArtifactBytes,
  classifyArtifactRetrievalFailure,
  validateArtifactRedirectChain,
  buildSafeArchiveManifest
} from '../src/artifact-bytes.mjs';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const sha = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');

test('artifact byte verifier versions and fixed limits are explicit', () => {
  assert.equal(ARTIFACT_BYTES_VERSION, 'TRUSTPR-ARTIFACT-BYTES-V1');
  assert.equal(ARCHIVE_MANIFEST_VERSION, 'TRUSTPR-ARCHIVE-MANIFEST-V1');
  assert.deepEqual(ARTIFACT_LIMITS, {
    maxArchiveBytes: 268435456,
    maxMemberBytes: 67108864,
    maxMembers: 1000,
    maxPathBytes: 4096,
    maxRedirects: 8
  });
});

test('exact downloaded bytes get deterministic local sha256 and length without authenticity upgrade', () => {
  const bytes = Buffer.from('artifact bytes\x00\xff', 'latin1');
  const out = verifyArtifactBytes({
    provider: 'github',
    artifact_id: 'a1',
    retention_state: 'available',
    provider_digest: null
  }, bytes, { contentLength: String(bytes.length) });
  assert.equal(out.status, 'VALID');
  assert.equal(out.content_sha256, sha(bytes));
  assert.equal(out.content_length, String(bytes.length));
  assert.equal(out.provider_digest_state, 'NOT_SUPPLIED');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('matching sha256 provider digest is checked but does not become receipt authenticity', () => {
  const bytes = Buffer.from('abc');
  const out = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'available',
    provider_digest: 'sha256:' + sha(bytes)
  }, bytes, { contentLength: '3' });
  assert.equal(out.status, 'VALID');
  assert.equal(out.provider_digest_state, 'MATCH');
  assert.equal(out.authenticity, 'UNAUTHENTICATED');
});

test('provider digest mismatch fails INVALID', () => {
  const bytes = Buffer.from('abc');
  const out = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'available',
    provider_digest: 'sha256:' + '0'.repeat(64)
  }, bytes, { contentLength: '3' });
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARTIFACT_DIGEST_MISMATCH');
});

test('content length or reported size mismatch fails INVALID before trust claim', () => {
  const bytes = Buffer.from('abc');
  const a = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'available',
    provider_digest: null, reported_size: '4'
  }, bytes, { contentLength: '3' });
  assert.equal(a.status, 'INVALID');
  assert.equal(a.reason, 'ARTIFACT_REPORTED_SIZE_MISMATCH');

  const b = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'available',
    provider_digest: null
  }, bytes, { contentLength: '4' });
  assert.equal(b.status, 'INVALID');
  assert.equal(b.reason, 'ARTIFACT_CONTENT_LENGTH_MISMATCH');
});

test('unsupported provider digest is PARTIAL not silently ignored', () => {
  const bytes = Buffer.from('abc');
  const out = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'available',
    provider_digest: 'sha512:' + '0'.repeat(128)
  }, bytes, { contentLength: '3' });
  assert.equal(out.status, 'PARTIAL');
  assert.equal(out.reason, 'PROVIDER_DIGEST_UNSUPPORTED');
  assert.equal(out.content_sha256, sha(bytes));
});

test('expired/deleted metadata cannot be byte-verified as available', () => {
  const out = verifyArtifactBytes({
    provider: 'github', artifact_id: 'a1', retention_state: 'expired',
    provider_digest: null
  }, Buffer.from('abc'), { contentLength: '3' });
  assert.equal(out.status, 'PARTIAL');
  assert.equal(out.reason, 'ARTIFACT_UNAVAILABLE');
  assert.equal(out.content_sha256, null);
});

test('retrieval failures classify expected missing vs transient vs contradiction explicitly', () => {
  assert.deepEqual(classifyArtifactRetrievalFailure({ kind: 'not_found' }), {
    status: 'PARTIAL', reason: 'ARTIFACT_UNRETRIEVABLE', retryable: false
  });
  assert.deepEqual(classifyArtifactRetrievalFailure({ kind: 'timeout' }), {
    status: 'PARTIAL', reason: 'ARTIFACT_RETRIEVAL_TRANSIENT', retryable: true
  });
  assert.deepEqual(classifyArtifactRetrievalFailure({ kind: 'digest_mismatch' }), {
    status: 'INVALID', reason: 'ARTIFACT_DIGEST_MISMATCH', retryable: false
  });
});

test('redirect chain requires HTTPS, no userinfo/fragments, bounded hops and approved origins', () => {
  const policy = {
    initialOrigin: 'https://api.github.com',
    initialPathPrefixes: ['/repos/o/r/actions/artifacts/'],
    approvedRedirects: [
      { origin: 'https://objects.example.invalid', pathPrefixes: ['/blob/'] }
    ]
  };
  const ok = validateArtifactRedirectChain([
    'https://api.github.com/repos/o/r/actions/artifacts/1/zip',
    'https://objects.example.invalid/blob/path?sig=SECRET'
  ], policy);
  assert.equal(ok.status, 'VALID');
  assert.equal(JSON.stringify(ok).includes('SECRET'), false);
  assert.deepEqual(ok.hops, [
    { origin: 'https://api.github.com', path: '/repos/o/r/actions/artifacts/1/zip' },
    { origin: 'https://objects.example.invalid', path: '/blob/path' }
  ]);

  for (const chain of [
    ['http://api.github.com/x'],
    ['https://u:p@api.github.com/x'],
    ['https://api.github.com/x#frag'],
    ['https://evil.invalid/x']
  ]) {
    const out = validateArtifactRedirectChain(chain, policy);
    assert.equal(out.status, 'INVALID');
  }
});

test('redirect chain rejects policy relaxation shapes and over-limit hops', () => {
  assert.equal(validateArtifactRedirectChain(
    ['https://api.github.com/x'],
    {
      initialOrigin: 'https://api.github.com',
      initialPathPrefixes: ['/x'],
      approvedRedirects: [{ origin: '*', pathPrefixes: ['/'] }]
    }
  ).status, 'INVALID');
  const tooMany = Array.from({ length: ARTIFACT_LIMITS.maxRedirects + 1 }, (_, i) =>
    i === 0 ? 'https://api.github.com/x' : 'https://objects.example.invalid/x'
  );
  assert.equal(validateArtifactRedirectChain(tooMany, {
    initialOrigin: 'https://api.github.com',
    initialPathPrefixes: ['/x'],
    approvedRedirects: [
      { origin: 'https://objects.example.invalid', pathPrefixes: ['/x'] }
    ]
  }).reason, 'REDIRECT_LIMIT_EXCEEDED');
});

const file = (path, text) => ({
  raw_path_b64: b64(Buffer.from(path, 'utf8')),
  kind: 'file',
  uncompressed_size: String(Buffer.byteLength(text)),
  bytes: Buffer.from(text)
});
const dir = (path) => ({
  raw_path_b64: b64(Buffer.from(path, 'utf8')),
  kind: 'directory',
  uncompressed_size: '0'
});

test('safe archive manifest sorts deterministically and hashes exact member bytes', () => {
  const a = file('z.txt', 'z');
  const b = file('a.txt', 'hello');
  const d = dir('docs/');
  const one = buildSafeArchiveManifest([a, b, d]);
  const two = buildSafeArchiveManifest([d, b, a]);
  assert.equal(one.status, 'VALID');
  assert.deepEqual(one, two);
  assert.equal(one.members[0].display_path, 'a.txt');
  assert.equal(one.members[0].sha256, sha(Buffer.from('hello')));
  assert.equal(one.members[2].display_path, 'z.txt');
  assert.match(one.manifest_sha256, /^[0-9a-f]{64}$/);
  assert.equal('bytes' in one.members[0], false);
});

test('archive paths fail closed on traversal, absolute, drive, backslash, dot, NUL and invalid UTF-8', () => {
  const hostile = [
    '../x', '/abs', 'C:/x', 'a\\b', './x', 'a/../b', 'a//b', 'nul\x00x'
  ];
  for (const path of hostile) {
    const out = buildSafeArchiveManifest([file(path, 'x')]);
    assert.equal(out.status, 'INVALID', path);
    assert.match(out.reason, /^ARCHIVE_PATH_/);
  }
  const nonUtf8 = {
    raw_path_b64: b64(Buffer.from([0xff, 0xfe, 0x61])),
    kind: 'file', uncompressed_size: '1', bytes: Buffer.from('x')
  };
  const out = buildSafeArchiveManifest([nonUtf8]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_PATH_INVALID_UTF8');
});

test('symlink and unsupported entry kinds are rejected', () => {
  for (const kind of ['symlink', 'hardlink', 'device', 'fifo']) {
    const out = buildSafeArchiveManifest([{
      raw_path_b64: b64(Buffer.from('x')), kind, uncompressed_size: '0'
    }]);
    assert.equal(out.status, 'INVALID');
    assert.equal(out.reason, 'ARCHIVE_MEMBER_KIND_FORBIDDEN');
  }
});

test('duplicate member path is INVALID even when bytes are identical', () => {
  const a = file('a.txt', 'x');
  const out = buildSafeArchiveManifest([a, { ...a, bytes: Buffer.from('x') }]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_DUPLICATE_PATH');
});

test('declared member size cap fails before any large allocation is required', () => {
  const out = buildSafeArchiveManifest([{
    raw_path_b64: b64(Buffer.from('big.bin')),
    kind: 'file',
    uncompressed_size: String(ARTIFACT_LIMITS.maxMemberBytes + 1)
  }]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_MEMBER_SIZE_LIMIT_EXCEEDED');
});

test('member-count and total-uncompressed caps fail closed', () => {
  const many = Array.from({ length: ARTIFACT_LIMITS.maxMembers + 1 }, (_, i) => ({
    raw_path_b64: b64(Buffer.from('f' + i)),
    kind: 'directory',
    uncompressed_size: '0'
  }));
  assert.equal(buildSafeArchiveManifest(many).reason, 'ARCHIVE_MEMBER_COUNT_LIMIT_EXCEEDED');

  const chunks = Array.from({ length: 5 }, (_, i) => ({
    raw_path_b64: b64(Buffer.from('f' + i)),
    kind: 'file',
    uncompressed_size: String(60000000)
  }));
  const out = buildSafeArchiveManifest(chunks);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_TOTAL_SIZE_LIMIT_EXCEEDED');
});

test('actual file bytes must exactly match declared uncompressed size', () => {
  const out = buildSafeArchiveManifest([{
    raw_path_b64: b64(Buffer.from('a.txt')),
    kind: 'file',
    uncompressed_size: '4',
    bytes: Buffer.from('abc')
  }]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_MEMBER_SIZE_MISMATCH');
});

test('archive path length cap operates on raw bytes', () => {
  const raw = Buffer.alloc(ARTIFACT_LIMITS.maxPathBytes + 1, 0x61);
  const out = buildSafeArchiveManifest([{
    raw_path_b64: b64(raw), kind: 'directory', uncompressed_size: '0'
  }]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_PATH_LENGTH_EXCEEDED');
});

test('redirect policy binds every hop to explicit approved path prefixes', () => {
  const policy = {
    initialOrigin: 'https://api.github.com',
    initialPathPrefixes: ['/repos/o/r/actions/artifacts/'],
    approvedRedirects: [
      { origin: 'https://objects.example.invalid', pathPrefixes: ['/blob/'] }
    ]
  };
  assert.equal(validateArtifactRedirectChain([
    'https://api.github.com/repos/o/r/actions/artifacts/1/zip',
    'https://objects.example.invalid/blob/abc?sig=SECRET'
  ], policy).status, 'VALID');
  assert.equal(validateArtifactRedirectChain([
    'https://api.github.com/user',
    'https://objects.example.invalid/blob/abc'
  ], policy).reason, 'REDIRECT_PATH_FORBIDDEN');
  assert.equal(validateArtifactRedirectChain([
    'https://api.github.com/repos/o/r/actions/artifacts/1/zip',
    'https://objects.example.invalid/admin'
  ], policy).reason, 'REDIRECT_PATH_FORBIDDEN');
});

test('directory paths require canonical trailing slash', () => {
  const out = buildSafeArchiveManifest([{ raw_path_b64: b64(Buffer.from('docs')), kind: 'directory', uncompressed_size: '0' }]);
  assert.equal(out.status, 'INVALID');
  assert.equal(out.reason, 'ARCHIVE_PATH_KIND_MISMATCH');
});

test('archive manifest rejects file-directory and file-ancestor path conflicts', () => {
  assert.equal(buildSafeArchiveManifest([file('a', 'x'), dir('a/')]).reason, 'ARCHIVE_PATH_TYPE_CONFLICT');
  assert.equal(buildSafeArchiveManifest([file('a', 'x'), file('a/b', 'y')]).reason, 'ARCHIVE_PATH_ANCESTOR_FILE_CONFLICT');
});
