import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectGitDiff} from '../src/git-diff.mjs';
const exec=promisify(execFile);
test('shallow metadata cannot conceal a second immutable merge base',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-qa-ancestry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const run=async args=>(await exec('/usr/bin/git',args,{cwd:dir,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'QA',GIT_AUTHOR_EMAIL:'qa@example.invalid',GIT_COMMITTER_NAME:'QA',GIT_COMMITTER_EMAIL:'qa@example.invalid'}})).stdout.trim();
  await run(['init','-q']);const tree=await run(['write-tree']);
  const commit=async(label,parents=[])=>run(['commit-tree',tree,...parents.flatMap(p=>['-p',p]),'-m',label]);
  const r=await commit('r'),a=await commit('a',[r]),b=await commit('b',[r]),x=await commit('x',[a]),y=await commit('y',[b]),base=await commit('base',[a,y]),head=await commit('head',[b,x]);
  const input={gitDirectory:path.join(dir,'.git'),baseSha:base,headSha:head};
  assert.equal((await run(['merge-base','--all',base,head])).split('\n').length,2);
  const full=await collectGitDiff(input);assert.equal(full.status,'PARTIAL');assert.ok(full.unknowns.some(x=>x.stable_code==='AMBIGUOUS_MERGE_BASE'));
  await fs.writeFile(path.join(dir,'.git','shallow'),x+'\n');
  const shallow=await collectGitDiff(input);assert.equal(shallow.status,'PARTIAL');assert.equal(shallow.merge_base_sha,'');assert.deepEqual(shallow.changed_entries,[]);
  assert.ok(shallow.unknowns.some(x=>x.stable_code==='SHALLOW_ANCESTRY_NOT_ESTABLISHED'));
  // An unrelated shallow branch does not impair full subject ancestry.
  const unrelated=await commit('unrelated',[a]);await fs.writeFile(path.join(dir,'.git','shallow'),unrelated+'\n');
  const complete=await collectGitDiff({gitDirectory:input.gitDirectory,baseSha:a,headSha:x});
  assert.equal(complete.status,'VALID');assert.equal(complete.merge_base_sha,a);
  // Marking a real root shallow changes no immutable edges.
  await fs.writeFile(path.join(dir,'.git','shallow'),r+'\n');
  const root=await collectGitDiff({gitDirectory:input.gitDirectory,baseSha:a,headSha:x});assert.equal(root.status,'VALID');
});
test('missing older history below the proven merge base remains usable',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-qa-older-history-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const run=async args=>(await exec('/usr/bin/git',args,{cwd:dir,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'QA',GIT_AUTHOR_EMAIL:'qa@example.invalid',GIT_COMMITTER_NAME:'QA',GIT_COMMITTER_EMAIL:'qa@example.invalid'}})).stdout.trim();
  await run(['init','-q']);const tree=await run(['write-tree']);
  const commit=async(label,parents=[])=>run(['commit-tree',tree,...parents.flatMap(p=>['-p',p]),'-m',label]);
  const missing=await commit('missing'),boundary=await commit('boundary',[missing]),base=await commit('base',[boundary]),head=await commit('head',[base]);
  await fs.writeFile(path.join(dir,'.git','shallow'),boundary+'\n');
  await fs.unlink(path.join(dir,'.git','objects',missing.slice(0,2),missing.slice(2)));
  const result=await collectGitDiff({gitDirectory:path.join(dir,'.git'),baseSha:base,headSha:head});
  assert.equal(result.status,'VALID');assert.equal(result.merge_base_sha,base);assert.deepEqual(result.unknowns,[]);
  // The boundary may itself be the unique observed merge base.
  const atBoundary=await collectGitDiff({gitDirectory:path.join(dir,'.git'),baseSha:boundary,headSha:head});
  assert.equal(atBoundary.status,'VALID');assert.equal(atBoundary.merge_base_sha,boundary);
});
