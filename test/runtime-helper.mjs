import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function gitFixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-git-runtime-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const run=async args=>(await exec('/usr/bin/git',args,{cwd:dir,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'TrustPR fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'TrustPR fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}})).stdout.trim();
  await run(['init','-q']);
  await fs.writeFile(path.join(dir,'README.md'),'before\n');
  await run(['add','README.md']);await run(['commit','-qm','base']);
  const base=await run(['rev-parse','HEAD']);
  await fs.writeFile(path.join(dir,'README.md'),'after\n');
  await fs.writeFile(path.join(dir,'evil.md'),'#!/bin/sh\ntouch executed-pr-code\n');
  await run(['add','README.md','evil.md']);await run(['commit','-qm','head']);
  const head=await run(['rev-parse','HEAD']);
  return{dir,gitDirectory:path.join(dir,'.git'),run,base,head};
}
