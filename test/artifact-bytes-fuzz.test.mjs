import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeArchiveManifest, validateArtifactRedirectChain } from '../src/artifact-bytes.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const entry = (path, body) => ({
  raw_path_b64: b64(path),
  kind: 'file',
  uncompressed_size: String(Buffer.byteLength(body)),
  bytes: Buffer.from(body)
});
const dir = (path) => ({
  raw_path_b64: b64(path),
  kind: 'directory',
  uncompressed_size: '0'
});

function permute(items, seed) {
  const out = [...items];
  let x = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('200 deterministic archive input permutations produce byte-identical safe manifest', () => {
  const base = [
    dir('docs/'),
    entry('docs/a.txt', 'alpha'),
    entry('docs/b.txt', 'beta'),
    dir('src/'),
    entry('src/index.mjs', 'export default 1;'),
    entry('README.md', '# receipt')
  ];
  const expected = buildSafeArchiveManifest(base);
  assert.equal(expected.status, 'VALID');
  for (let seed = 1; seed <= 200; seed += 1) {
    assert.deepEqual(buildSafeArchiveManifest(permute(base, seed)), expected, 'seed=' + seed);
  }
});

test('hostile path corpus always fails closed and never aliases a safe member', () => {
  const hostile = [
    '.', '..', './a', '../a', 'a/.', 'a/..', 'a/../b', 'a//b',
    '/a', '//server/share', 'C:/a', 'Z:evil', 'a\\b', '\\server\\share',
    'a\u0000b', 'a\u0001b', 'a\u007fb', 'a\u0085b',
    'e\u0301.txt'
  ];
  for (const path of hostile) {
    const out = buildSafeArchiveManifest([entry(path, 'x')]);
    assert.equal(out.status, 'INVALID', JSON.stringify(path));
    assert.match(out.reason, /^ARCHIVE_PATH_/);
  }
});

test('file ancestor conflicts are permutation invariant', () => {
  const cases = [
    [entry('a', 'x'), entry('a/b', 'y')],
    [entry('root/file', 'x'), dir('root/file/')],
    [entry('x/y', 'x'), entry('x/y/z', 'y')]
  ];
  for (const pair of cases) {
    const forward = buildSafeArchiveManifest(pair);
    const reverse = buildSafeArchiveManifest([...pair].reverse());
    assert.equal(forward.status, 'INVALID');
    assert.equal(reverse.status, 'INVALID');
    assert.equal(forward.reason, reverse.reason);
  }
});

test('redirect allowlist cannot be escaped by normalization, alternate origin or credentials', () => {
  const policy = {
    initialOrigin: 'https://api.github.com',
    initialPathPrefixes: ['/repos/o/r/actions/artifacts/'],
    approvedRedirects: [
      { origin: 'https://objects.example.invalid', pathPrefixes: ['/blob/'] }
    ]
  };
  const hostile = [
    ['https://api.github.com/repos/o/r/actions/artifacts/1/../../user'],
    ['https://api.github.com/repos/o/r/actions/artifacts/1/zip', 'https://objects.example.invalid/blob/../admin'],
    ['https://api.github.com/repos/o/r/actions/artifacts/1/zip', 'https://objects.example.invalid.evil.invalid/blob/x'],
    ['https://api.github.com/repos/o/r/actions/artifacts/1/zip', 'https://user@objects.example.invalid/blob/x'],
    ['https://api.github.com/repos/o/r/actions/artifacts/1/zip', 'https://objects.example.invalid/admin']
  ];
  for (const chain of hostile) {
    assert.equal(validateArtifactRedirectChain(chain, policy).status, 'INVALID', JSON.stringify(chain));
  }
});

test('redirect paths fail closed on path-affecting percent encodings while allowing inert encodings', () => {
  const policy = {
    initialOrigin: 'https://api.github.com',
    initialPathPrefixes: ['/repos/o/r/actions/artifacts/'],
    approvedRedirects: [
      { origin: 'https://objects.example.invalid', pathPrefixes: ['/blob/'] }
    ]
  };
  const hostileTargets = [
    'https://objects.example.invalid/blob/%2fadmin',
    'https://objects.example.invalid/blob/%2Fadmin',
    'https://objects.example.invalid/blob/%5cadmin',
    'https://objects.example.invalid/blob/%5Cadmin',
    'https://objects.example.invalid/blob\\admin',
    'https://objects.example.invalid/blob/%2e/admin',
    'https://objects.example.invalid/blob/%2E%2E/admin',
    'https://objects.example.invalid/blob/file%2ename',
    'https://objects.example.invalid/blob/%252e%252e/admin',
    'https://objects.example.invalid/blob/%00evil',
    'https://objects.example.invalid/blob/%zz'
  ];
  for (const target of hostileTargets) {
    const out = validateArtifactRedirectChain([
      'https://api.github.com/repos/o/r/actions/artifacts/1/zip',
      target
    ], policy);
    assert.equal(out.status, 'INVALID', target);
    assert.match(out.reason, /^REDIRECT_(?:PATH_ENCODING|PATH)_/);
  }

  for (const target of [
    'https://objects.example.invalid/blob/file%20name',
    'https://objects.example.invalid/blob/%E2%82%AC.txt'
  ]) {
    assert.equal(validateArtifactRedirectChain([
      'https://api.github.com/repos/o/r/actions/artifacts/1/zip',
      target
    ], policy).status, 'VALID', target);
  }

  assert.equal(validateArtifactRedirectChain([
    'https://api.github.com/repos/o/r/actions/artifacts/%2fadmin/zip'
  ], policy).status, 'INVALID');
});
