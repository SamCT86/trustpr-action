import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateMitLicense,validatePackReport,checkRelease,REQUIRED_PACK_FILES} from '../scripts/check-release.mjs';
const execute=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
const template=(await fs.readFile(path.join(root,'LICENSE'),'utf8')).replace(/^Copyright \(c\) 2026 [^\r\n]+$/m,'Copyright (c) 2026 [COPYRIGHT_HOLDER_MUST_BE_VERIFIED_AND_APPROVED]');
const valid=template.replace('[COPYRIGHT_HOLDER_MUST_BE_VERIFIED_AND_APPROVED]','Synthetic Test Holder');

test('MIT gate rejects placeholder, truncated license, altered text, missing holder and duplicate owner line',()=>{
  assert.equal(validateMitLicense(valid).ownership_attested,false);
  for(const content of [template,'MIT License\n\nCopyright (c) 2026 Synthetic Test Holder\n',
    valid.replace('WITHOUT WARRANTY','WITH WARRANTY'),valid.replace('Synthetic Test Holder',' '),
    valid.replace('Synthetic Test Holder','Synthetic\nCopyright (c) 2026 Another Holder')]) {
    assert.throws(()=>validateMitLicense(content));
  }
});

test('npm release gate rejects unexpected files and missing runtime entrypoint',()=>{
  const required=[...REQUIRED_PACK_FILES];
  const report=names=>[{files:names.map(path=>({path}))}];
  assert.equal(validatePackReport(report(required)).files,21);
  for(const extra of ['RUNTIME_SOURCE_MANIFEST.json','proof/private.json','test/fixture.mjs','scripts/check-release.mjs',
    '../secret','src/../../secret','src/private.txt','/etc/passwd'])assert.throws(()=>validatePackReport(report([...required,extra])));
  assert.throws(()=>validatePackReport(report(required.slice(1))));
  assert.throws(()=>validatePackReport(report(required.filter(n=>n!=='src/strict-json.mjs'))));
  assert.throws(()=>validatePackReport(report(required.filter(n=>n!=='src/runtime.mjs'))));
  assert.throws(()=>validatePackReport(report([...required,'LICENSE'])));
});

test('npm release gate rejects unreviewed executable source despite its source-file extension',()=>{
  const report=[{files:[...REQUIRED_PACK_FILES,'src/private-notes.mjs'].map(path=>({path}))}];
  assert.throws(()=>validatePackReport(report),e=>e.code==='UNEXPECTED_PACK_FILE');
});

test('complete release gate stays closed until a real holder is approved; fixture tests do not authorize publication',async t=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-release-gate-'));
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  await fs.cp(root,tmp,{recursive:true});
  await fs.writeFile(path.join(tmp,'LICENSE'),template);
  await assert.rejects(checkRelease(tmp),e=>e.code==='LICENSE_COPYRIGHT_HOLDER_NOT_VERIFIED');
  await fs.writeFile(path.join(tmp,'LICENSE'),valid);
  const pass=await checkRelease(tmp);
  assert.equal(pass.publication_authorized,false);assert.equal(pass.ownership_attested,false);
  await fs.writeFile(path.join(tmp,'RUNTIME_SOURCE_MANIFEST.json'),'{}');
  await assert.rejects(checkRelease(tmp),e=>e.code==='INTERNAL_RUNTIME_MANIFEST_PRESENT');
  await fs.rm(path.join(tmp,'RUNTIME_SOURCE_MANIFEST.json'));
  const pkg=JSON.parse(await fs.readFile(path.join(tmp,'package.json'),'utf8'));
  pkg.scripts.postinstall='node unauthorized-script.mjs';
  await fs.writeFile(path.join(tmp,'package.json'),JSON.stringify(pkg));
  await assert.rejects(checkRelease(tmp),e=>e.code==='UNREVIEWED_LIFECYCLE_SCRIPT');
  delete pkg.scripts.postinstall;
  pkg.bin={trustpr:'src/runtime.mjs'};
  await fs.writeFile(path.join(tmp,'package.json'),JSON.stringify(pkg));
  await assert.rejects(checkRelease(tmp),e=>e.code==='CLI_PACKAGE_ENTRYPOINT_INVALID');
  pkg.bin={trustpr:'bin/trustpr.mjs'};
  pkg.private=false;await fs.writeFile(path.join(tmp,'package.json'),JSON.stringify(pkg));
  await assert.rejects(checkRelease(tmp),e=>e.code==='PRIVATE_CANDIDATE_REQUIRED');
});

test('public-history gate catches deletion in history, shallow clone and empty repository',async t=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-history-gate-'));
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  const repo=path.join(tmp,'repo');await fs.mkdir(repo);
  const env={PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=async args=>execute('/usr/bin/git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,env});
  const gate=(dir,extra={})=>execute('bash',[path.join(root,'scripts/check-public-history.sh'),dir],{env:{...env,...extra}});
  await git(['init','-q']);
  await assert.rejects(gate(repo),e=>e.stderr.includes('HOLD_NO_COMMIT_HISTORY'));
  await fs.writeFile(path.join(repo,'RUNTIME_SOURCE_MANIFEST.json'),'internal source');
  await git(['add','.']);await git(['commit','-qm','internal root']);
  await assert.rejects(gate(repo),e=>e.stderr.includes('HOLD_INTERNAL_MANIFEST_STILL_TRACKED'));
  await git(['rm','RUNTIME_SOURCE_MANIFEST.json']);await fs.writeFile(path.join(repo,'README.md'),'public');
  await git(['add','.']);await git(['commit','-qm','delete']);
  await assert.rejects(gate(repo),e=>e.stderr.includes('HOLD_INTERNAL_MANIFEST_IN_GIT_HISTORY'));
  const externalGraft=path.join(tmp,'external-grafts');
  await fs.writeFile(externalGraft,(await git(['rev-parse','HEAD'])).stdout.trim()+'\n');
  await assert.rejects(gate(repo,{GIT_GRAFT_FILE:externalGraft}),e=>e.stderr.includes('HOLD_GRAFTED_HISTORY'));
  const shallow=path.join(tmp,'shallow');
  await execute('/usr/bin/git',['clone','-q','--depth=1','file://'+repo,shallow],{env});
  await assert.rejects(gate(shallow),e=>e.stderr.includes('HOLD_SHALLOW_HISTORY'));
  const clean=path.join(tmp,'clean');await fs.mkdir(clean);
  await execute('/usr/bin/git',['init','-q',clean],{env});
  await fs.writeFile(path.join(clean,'README.md'),'public');
  await execute('/usr/bin/git',['-C',clean,'add','.'],{env});
  await execute('/usr/bin/git',['-C',clean,'commit','-qm','clean source'],{env});
  assert.match((await gate(clean)).stdout,/PASS_NO_KNOWN_INTERNAL_MANIFEST/);
  await assert.rejects(gate(repo,{GIT_DIR:path.join(clean,'.git')}),e=>e.stderr.includes('HOLD_INTERNAL_MANIFEST_IN_GIT_HISTORY'));
});
