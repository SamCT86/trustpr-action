import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildSafeArchiveManifest } from '../src/artifact-bytes.mjs';

const file = (name, body) => ({
  raw_path_b64: Buffer.from(name, 'utf8').toString('base64'),
  kind: 'file', uncompressed_size: String(Buffer.byteLength(body)), bytes: Buffer.from(body)
});

test('archive BOM filename identity is preserved with distinct contents in either order', () => {
  const entries = [file('a.txt', 'first'), file('\ufeffa.txt', 'second')];
  const forward = buildSafeArchiveManifest(entries);
  assert.equal(forward.status, 'VALID');
  assert.deepEqual(buildSafeArchiveManifest([...entries].reverse()), forward);
  assert.deepEqual(forward.members.map(m => m.display_path), ['a.txt', '\ufeffa.txt']);
  for (const member of forward.members) {
    assert.equal(Buffer.from(member.raw_path_b64, 'base64').toString('utf8'), member.display_path);
  }
  assert.notEqual(forward.members[0].sha256, forward.members[1].sha256);
  assert.notEqual(forward.manifest_sha256, buildSafeArchiveManifest([entries[0]]).manifest_sha256);
});

test('equal contents cannot alias BOM and ordinary raw filename identities', () => {
  const ordinary = buildSafeArchiveManifest([file('a.txt', 'same')]);
  const bom = buildSafeArchiveManifest([file('\ufeffa.txt', 'same')]);
  assert.equal(ordinary.status, 'VALID');
  assert.equal(bom.status, 'VALID');
  assert.equal(ordinary.members[0].sha256, bom.members[0].sha256);
  assert.notEqual(ordinary.manifest_sha256, bom.manifest_sha256);
  const pair = buildSafeArchiveManifest([file('\ufeffa.txt', 'same'), file('a.txt', 'same')]);
  assert.equal(pair.status, 'VALID');
  assert.equal(new Set(pair.members.map(m => m.display_path)).size, 2);
});

test('BOM-prefixed slash, drive and dot names preserve literal relative filename semantics', () => {
  for (const name of ['\ufeff/absolute-looking', '\ufeffC:/drive-looking', '\ufeff./dot-looking', '\ufeff../dotdot-looking']) {
    const out = buildSafeArchiveManifest([file(name, 'bytes')]);
    assert.equal(out.status, 'VALID', name);
    assert.equal(out.members[0].display_path, name);
    assert.equal(out.members[0].sha256, crypto.createHash('sha256').update('bytes').digest('hex'));
  }
  // A BOM never legitimizes an actual later traversal component.
  assert.equal(buildSafeArchiveManifest([file('\ufeff/../escape', 'bytes')]).reason,
    'ARCHIVE_PATH_DOT_SEGMENT_FORBIDDEN');
});

test('duplicate BOM filenames and actual ancestor/type conflicts still reject in either order', () => {
  const duplicate = file('\ufeffa.txt', 'first');
  assert.equal(buildSafeArchiveManifest([duplicate, file('\ufeffa.txt', 'second')]).reason, 'ARCHIVE_DUPLICATE_PATH');
  const parent = file('\ufeffa', 'first');
  const child = file('\ufeffa/child', 'second');
  for (const entries of [[parent, child], [child, parent]]) {
    assert.equal(buildSafeArchiveManifest(entries).reason, 'ARCHIVE_PATH_ANCESTOR_FILE_CONFLICT');
  }
  const directory = { raw_path_b64: Buffer.from('\ufeffa/').toString('base64'), kind: 'directory', uncompressed_size: '0' };
  for (const entries of [[parent, directory], [directory, parent]]) {
    assert.equal(buildSafeArchiveManifest(entries).reason, 'ARCHIVE_PATH_TYPE_CONFLICT');
  }
});
