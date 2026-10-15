import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const gate=path.resolve(import.meta.dirname,'../scripts/check-public-history.sh');

for(const internal of [true,false])test(`complete history gate ${internal?'rejects an internal manifest':'accepts a clean neighbor'} on a merged and unreferenced side branch`,async t=>{
  const repo=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-merged-history-'));
  t.after(()=>fs.rm(repo,{recursive:true,force:true}));
  const env={PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
    GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=async args=>(await execute('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',repo,...args],{env})).stdout.trim();
  await git(['init','-q','-b','main']);
  await fs.writeFile(path.join(repo,'README.md'),'public fixture');
  await git(['add','.']);await git(['commit','-qm','public root']);
  await git(['checkout','-qb','side']);
  const filename=internal?'RUNTIME_SOURCE_MANIFEST.json':'public-side.json';
  await fs.writeFile(path.join(repo,filename),'{"fixture":"benign"}');
  await git(['add','.']);await git(['commit','-qm','add side file']);
  const sideCommit=await git(['rev-parse','HEAD']);
  await git(['rm','-q',filename]);await git(['commit','-qm','remove side file']);
  await git(['checkout','-q','main']);
  await fs.writeFile(path.join(repo,'public.txt'),'mainline progress');
  await git(['add','.']);await git(['commit','-qm','advance main']);
  await git(['merge','-q','--no-ff','side','-m','merge cleaned side']);
  await git(['branch','-D','side']);
  assert.ok((await git(['rev-list','--all'])).split('\n').includes(sideCommit));
  assert.equal(await git(['log','--all','--format=%H','--','RUNTIME_SOURCE_MANIFEST.json']),'');
  const run=()=>execute('bash',[gate,repo],{env});
  if(internal){
    assert.ok((await git(['log','--all','--full-history','--format=%H','--',filename])).split('\n').includes(sideCommit));
    await assert.rejects(run(),e=>e.code===1&&e.stderr.includes('HOLD_INTERNAL_MANIFEST_IN_GIT_HISTORY'));
  }else assert.match((await run()).stdout,/PASS_NO_KNOWN_INTERNAL_MANIFEST_IN_COMPLETE_REACHABLE_HISTORY/);
});
