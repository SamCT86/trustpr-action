import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectGitDiff} from '../src/git-diff.mjs';

test('real git: UTF-8, whitespace, rename and symlink preserve raw path identity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-git-names-'));
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8'}).trim();
 try{
  git('init','-q');git('config','user.name','QA');git('config','user.email','qa@example.invalid');
  const names=['spaces file.txt','unicode-éü.txt','emoji-😀.txt','tabs\tinname.txt','newline\ninname.txt','old.txt'];
  for(const x of names)await fs.writeFile(path.join(root,x),'first');
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  for(const x of names.slice(0,-1))await fs.writeFile(path.join(root,x),'second');
  await fs.rename(path.join(root,'old.txt'),path.join(root,'new.txt'));
  await fs.symlink('new.txt',path.join(root,'link.txt'));
  git('add','-A');git('commit','-qm','head');const head=git('rev-parse','HEAD');
  const x=await collectGitDiff({gitDirectory:path.join(root,'.git'),baseSha:base,headSha:head});
  assert.equal(x.status,'VALID');assert.deepEqual(x.unknowns,[]);assert.equal(x.changed_entries.length,8);
  const map=new Map(x.changed_entries.map(e=>[Buffer.from(e.raw_path_b64,'base64').toString('utf8'),e]));
  for(const name of names.slice(0,-1))assert.equal(map.get(name).change_type,'MODIFY');
  assert.equal(map.get('old.txt').change_type,'DELETE');assert.equal(map.get('new.txt').change_type,'ADD');
  assert.equal(map.get('old.txt').old_blob_sha,map.get('new.txt').new_blob_sha);
  assert.equal(map.get('link.txt').new_mode,'120000');assert.equal(map.get('link.txt').change_type,'ADD');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
