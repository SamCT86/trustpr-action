import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectGitDiff} from '../src/git-diff.mjs';

test('1000 Git changes accepted; 1001 returns PARTIAL without false truncated receipt',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-thousand-files-'));
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{
  encoding:'utf8',maxBuffer:1024*1024,timeout:15000}).trim();
 try{
  git('init','-q');git('config','user.name','QA');git('config','user.email','qa@example.invalid');
  git('commit','-qm','empty base','--allow-empty');
  const base=git('rev-parse','HEAD');
  await Promise.all(Array.from({length:1000},(_,i)=>
   fs.writeFile(path.join(root,'file-'+String(i).padStart(4,'0')+'.txt'),'safe fixture '+i)));
  git('add','.');git('commit','-qm','exact limit');
  const exactlyThousand=git('rev-parse','HEAD');
  const pass=await collectGitDiff({gitDirectory:path.join(root,'.git'),baseSha:base,headSha:exactlyThousand});
  assert.equal(pass.status,'VALID');assert.equal(pass.changed_entries.length,1000);
  assert.deepEqual(pass.unknowns,[]);
  await fs.writeFile(path.join(root,'file-1000.txt'),'additional change');
  git('add','.');git('commit','-qm','over limit');
  const beyond=git('rev-parse','HEAD');
  const bounded=await collectGitDiff({gitDirectory:path.join(root,'.git'),baseSha:base,headSha:beyond});
  assert.equal(bounded.status,'PARTIAL');
  assert.equal(bounded.changed_entries.length,0,'do not imply 1000-file subset complete');
  assert.deepEqual(bounded.unknowns,[{stable_code:'DIFF_UNAVAILABLE_OR_LIMIT',field_or_source_tuple:'git_diff'}]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
