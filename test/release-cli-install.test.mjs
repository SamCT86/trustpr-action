import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),root=path.resolve(import.meta.dirname,'..');

test('npm packed CLI works through real .bin symlink, spaces, PATH and npm exec',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr consumer space '));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const options={cwd:root,timeout:60000,maxBuffer:1024*1024};
  const packed=JSON.parse((await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],options)).stdout);
  assert.equal(packed.length,1);
  assert.ok(packed[0].files.every(f=>!f.path.startsWith('test/')&&f.path!=='RUNTIME_SOURCE_MANIFEST.json'));
  const consumer=path.join(temp,'consumer');
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',consumer,
    path.join(temp,packed[0].filename)],options);
  const bin=path.join(consumer,'node_modules','.bin','trustpr');
  assert.ok((await fs.lstat(bin)).isSymbolicLink());
  assert.match((await execute(bin,['--help'],options)).stdout,/TrustPR — read-only evidence receipts/);
  const demo=JSON.parse((await execute(bin,['--demo'],options)).stdout);
  assert.equal(demo.core.declared.evidence_source,'SYNTHETIC_DEMO');
  assert.equal(demo.core.validity.status,'PARTIAL');
  assert.equal(demo.authenticity,'UNAUTHENTICATED');
  const env={...process.env,PATH:path.dirname(bin)+path.delimiter+process.env.PATH};
  assert.match((await execute('trustpr',['--help'],{...options,env})).stdout,/TrustPR/);
  assert.match((await execute('npm',['exec','--offline','--','trustpr','--help'],{...options,cwd:consumer})).stdout,/TrustPR/);
  await assert.rejects(execute(bin,['--unknown'],options),e=>e.code===1&&/CLI_ARGUMENT_INVALID/.test(e.stderr));
  const output=path.join(temp,'receipt');
  const generated=await execute(bin,['--demo','--output',output],options);
  const verify=await execute(bin,['--verify-receipt',path.join(output,'receipt.json')],options);
  assert.equal(verify.stdout,generated.stdout);
});

test('importing CLI is inert, with or without argv[1]',async()=>{
  for(const code of ["await import('./bin/trustpr.mjs');", "process.argv[1]=undefined; await import('./bin/trustpr.mjs');"]) {
    const r=await execute(process.execPath,['--input-type=module','-e',code],{cwd:root,timeout:10000});
    assert.equal(r.stdout,'');assert.equal(r.stderr,'');
  }
});
