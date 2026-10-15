import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectGitDiff} from '../src/git-diff.mjs';

async function oneFile(name,content){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-content-unknown-'));
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:15000}).trim();
 try{
  git('init','-q');git('config','user.name','QA');git('config','user.email','qa@example.invalid');
  git('commit','-qm','empty','--allow-empty');const base=git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,name),content);
  git('add','.');git('commit','-qm','file');const head=git('rev-parse','HEAD');
  return await collectGitDiff({gitDirectory:path.join(root,'.git'),baseSha:base,headSha:head});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('Git LFS pointer never claims its missing external media bytes verified',async()=>{
 const pointer='version https://git-lfs.github.com/spec/v1\noid sha256:'+'a'.repeat(64)+'\nsize 123456\n';
 const r=await oneFile('media.bin',pointer);
 assert.equal(r.status,'PARTIAL');assert.equal(r.changed_entries.length,1);
 assert.ok(r.unknowns.some(x=>x.stable_code==='LFS_CONTENT_NOT_OBSERVED'));
});
test('Git blob above 1 MiB is bounded and explicitly PARTIAL',async()=>{
 const r=await oneFile('oversized.dat',Buffer.alloc(1024*1024+1,65));
 assert.equal(r.status,'PARTIAL');assert.equal(r.changed_entries.length,1);
 assert.ok(r.unknowns.some(x=>x.stable_code==='BLOB_INSPECTION_LIMIT'));
});
