import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const entry=fileURLToPath(new URL('../bin/trustpr.mjs',import.meta.url));
const directory=path.dirname(entry);
const run=(args)=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:20000});

test('direct CLI help is user-visible and exits successfully',()=>{
  const p=run([entry,'--help']);
  assert.equal(p.status,0,p.stderr);
  assert.match(p.stdout,/TrustPR.*read-only evidence receipts/);
  assert.match(p.stdout,/--verify-receipt/);
});

test('real symlink under --preserve-symlinks-main cannot silently skip the CLI',async(t)=>{
  if(process.platform==='win32')return t.skip('Windows symlink privileges and realpath behavior require a separate native canary');
  const link=path.join(directory,'trustpr-entry-'+randomUUID()+'.mjs');
  try{
    await fs.symlink('trustpr.mjs',link);
    const normal=run([entry,'--help']);
    const alias=run(['--preserve-symlinks-main',link,'--help']);
    assert.equal(normal.status,0,normal.stderr);
    assert.equal(alias.status,0,alias.stderr);
    assert.ok(normal.stdout.length>200,'expected actual usage text');
    assert.equal(alias.stdout,normal.stdout,'symlink invocation must not return empty success');
  }finally{await fs.rm(link,{force:true});}
});

test('importing the CLI as an ESM library has no entrypoint side effect',()=>{
  const p=run(['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(entry).href)})`]);
  assert.equal(p.status,0,p.stderr);
  assert.equal(p.stdout,'');
  assert.equal(p.stderr,'');
});

test('an invalid direct CLI invocation fails visibly rather than returning success',()=>{
  const p=run([entry,'--not-an-option']);
  assert.equal(p.status,1);
  assert.match(p.stderr,/TrustPR: CLI_ARGUMENT_INVALID/);
  assert.equal(p.stdout,'');
});
