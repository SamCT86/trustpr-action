import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectGitDiff,parseRawGitDiff} from '../src/git-diff.mjs';
const exec=promisify(execFile);
import {gitFixture} from './runtime-helper.mjs';
test('raw Git diff preserves non-UTF8 pathname bytes',()=>{
  const raw=Buffer.concat([Buffer.from(':100644 100644 '+'a'.repeat(40)+' '+'b'.repeat(40)+' M\0'),Buffer.from([0xff,0x2e,0x6d,0x64,0])]);
  assert.equal(parseRawGitDiff(raw)[0].raw_path_b64,Buffer.from([0xff,0x2e,0x6d,0x64]).toString('base64'));
  assert.throws(()=>parseRawGitDiff(Buffer.from(':bad\0name\0')),/RAW_DIFF_INVALID/);
});
test('collector reads immutable Git objects without checking out or running PR code',async t=>{
  const f=await gitFixture(t);
  const before=await f.run(['status','--porcelain=v1']);
  const diff=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:f.head});
  assert.equal(diff.status,'VALID');assert.equal(diff.merge_base_sha,f.base);
  assert.equal(diff.changed_entries.length,2);
  assert.equal(await f.run(['status','--porcelain=v1']),before);
  await assert.rejects(fs.access(path.join(f.dir,'executed-pr-code')));
});
test('missing objects and LFS pointers remain explicitly incomplete',async t=>{
  const f=await gitFixture(t);
  const missing=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:'f'.repeat(40)});
  assert.equal(missing.status,'PARTIAL');
  assert.ok(missing.unknowns.some(x=>x.stable_code==='COMMIT_UNAVAILABLE'));
  await fs.writeFile(path.join(f.dir,'large.dat'),'version https://git-lfs.github.com/spec/v1\noid sha256:'+'a'.repeat(64)+'\nsize 100\n');
  await f.run(['add','large.dat']);await f.run(['commit','-qm','LFS pointer']);
  const lfs=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:await f.run(['rev-parse','HEAD'])});
  assert.equal(lfs.status,'PARTIAL');assert.ok(lfs.unknowns.some(x=>x.stable_code==='LFS_CONTENT_NOT_OBSERVED'));
});
test('Git collector rejects shell/option-like subjects before invoking Git',async()=>{
  await assert.rejects(collectGitDiff({gitDirectory:'/tmp',baseSha:'--upload-pack=evil',headSha:'b'.repeat(40)}),/GIT_INPUT_INVALID/);
});

test('collector uses immutable commit ancestry despite local graft metadata',async t=>{
  const f=await gitFixture(t);
  await f.run(['checkout','-q',f.base]);
  await fs.writeFile(path.join(f.dir,'base-branch-only.md'),'main branch file\n');
  await f.run(['add','base-branch-only.md']);await f.run(['commit','-qm','diverged base']);
  const base=await f.run(['rev-parse','HEAD']);
  await fs.writeFile(path.join(f.gitDirectory,'info','grafts'),f.head+' '+base+'\n');
  const diff=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:base,headSha:f.head});
  assert.equal(diff.status,'VALID');
  assert.equal(diff.merge_base_sha,f.base);
  assert.deepEqual(diff.changed_entries.map(x=>Buffer.from(x.raw_path_b64,'base64').toString()).sort(),['README.md','evil.md']);
});

test('collector does not claim complete evidence from a corrupted local object store',async t=>{
  const f=await gitFixture(t);
  const original=await f.run(['rev-parse',f.head+':README.md']);
  await fs.writeFile(path.join(f.dir,'alternate-blob.txt'),'alternate local fixture bytes\n');
  const alternate=await f.run(['hash-object','-w','alternate-blob.txt']);
  const objectPath=oid=>path.join(f.gitDirectory,'objects',oid.slice(0,2),oid.slice(2));
  await fs.unlink(objectPath(original));
  await fs.copyFile(objectPath(alternate),objectPath(original));
  const diff=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:f.head});
  assert.equal(diff.status,'PARTIAL');
  assert.equal(diff.changed_entries.length,0);
  assert.ok(diff.unknowns.some(x=>x.stable_code==='GIT_OBJECT_INTEGRITY_NOT_ESTABLISHED'));
});

test('collector does not trust a commit stored under the wrong object ID',async t=>{
  const f=await gitFixture(t);
  const objectPath=oid=>path.join(f.gitDirectory,'objects',oid.slice(0,2),oid.slice(2));
  await fs.unlink(objectPath(f.head));
  await fs.copyFile(objectPath(f.base),objectPath(f.head));
  const diff=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:f.head});
  assert.equal(diff.status,'PARTIAL');
  assert.equal(diff.changed_entries.length,0);
  assert.ok(diff.unknowns.some(x=>x.stable_code==='COMMIT_UNAVAILABLE'));
});


test('local promisor configuration cannot make collector fetch off-origin objects',async t=>{
  const net=await import('node:net');
  const f=await gitFixture(t);
  const blob=await f.run(['rev-parse',f.head+':evil.md']);
  await fs.unlink(path.join(f.gitDirectory,'objects',blob.slice(0,2),blob.slice(2)));
  let connections=0;
  const server=net.createServer(socket=>{connections++;socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await f.run(['config','extensions.partialClone','origin']);
  await f.run(['config','remote.origin.promisor','true']);
  await f.run(['config','remote.origin.url','https://outside.invalid/repo.git']);
  await f.run(['config','http.proxy','http://127.0.0.1:'+server.address().port]);
  await f.run(['config','protocol.https.allow','always']);
  await f.run(['config','http.extraHeader','Authorization: Bearer placeholder-test-only']);
  const result=await collectGitDiff({gitDirectory:f.gitDirectory,baseSha:f.base,headSha:f.head});
  assert.equal(result.status,'PARTIAL');
  assert.equal(result.changed_entries.length,0);
  assert.ok(result.unknowns.some(x=>x.stable_code==='GIT_OBJECT_INTEGRITY_NOT_ESTABLISHED'));
  assert.equal(connections,0);
});
