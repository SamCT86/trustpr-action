import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const OID=/^[0-9a-f]{40}$/;
const ZERO='0'.repeat(40);
export const GIT_LIMITS=Object.freeze({maxDiffBytes:8*1024*1024,maxEntries:1000,maxBlobBytes:1024*1024,maxTotalBlobBytes:16*1024*1024});
const CONFIG=['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.attributesFile=/dev/null','-c','diff.external=',
  '-c','credential.helper=','-c','protocol.allow=never','-c','protocol.https.allow=never','-c','http.extraHeader=','-c','http.followRedirects=false','-c','gc.auto=0',
  '-c','core.commitGraph=false'];
const ENV={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null',
  GIT_PAGER:'cat',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_PROTOCOL_FROM_USER:'0'};
function fail(code){throw Object.assign(new TypeError(code),{code});}
async function git(directory,args,maxBuffer=GIT_LIMITS.maxDiffBytes,timeout=20000,publicFetch=false) {
  return (await execute('/usr/bin/git',['--no-pager','--git-dir='+directory,...CONFIG,...(publicFetch?['-c','protocol.https.allow=always']:[]),...args],{encoding:'buffer',env:publicFetch?{...ENV,GIT_ALLOW_PROTOCOL:'https'}:ENV,maxBuffer,timeout})).stdout;
}
function finding(stable_code,field_or_source_tuple='git_diff'){return{stable_code,field_or_source_tuple};}
export function parseRawGitDiff(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>GIT_LIMITS.maxDiffBytes)fail('RAW_DIFF_INVALID');
  if(!bytes.length)return[];
  const parts=[];let start=0;
  for(let i=0;i<bytes.length;i++)if(bytes[i]===0){parts.push(bytes.subarray(start,i));start=i+1;}
  if(start!==bytes.length||parts.length%2||parts.length/2>GIT_LIMITS.maxEntries)fail('RAW_DIFF_INVALID');
  const entries=[];
  for(let i=0;i<parts.length;i+=2){
    const header=parts[i].toString('ascii');
    if(Buffer.from(header,'ascii').compare(parts[i])!==0)fail('RAW_DIFF_INVALID');
    const match=/^:(000000|100644|100755|120000|160000) (000000|100644|100755|120000|160000) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT])$/.exec(header);
    const name=parts[i+1];if(!match||!name.length||name.length>4096)fail('RAW_DIFF_INVALID');
    const [,old_mode,new_mode,old_blob_sha,new_blob_sha,status]=match;
    entries.push({raw_path_b64:name.toString('base64'),change_type:{A:'ADD',D:'DELETE',M:'MODIFY',T:'TYPE_CHANGE'}[status],
      old_mode,new_mode,old_blob_sha,new_blob_sha});
  }
  return entries;
}
export async function collectGitDiff({gitDirectory,baseSha,headSha}){
  if(typeof gitDirectory!=='string'||!path.isAbsolute(gitDirectory)||gitDirectory.length>4096||gitDirectory.includes('\0')||!OID.test(baseSha)||!OID.test(headSha))fail('GIT_INPUT_INVALID');
  const result={status:'PARTIAL',base_commit_sha:baseSha,head_commit_sha:headSha,merge_base_sha:'',changed_entries:[],unknowns:[]};
  try{
    const format=(await git(gitDirectory,['rev-parse','--show-object-format'])).toString('ascii').trim();
    if(format!=='sha1'){result.unknowns.push(finding('UNSUPPORTED_GIT_OBJECT_FORMAT'));return result;}
    for(const oid of [baseSha,headSha]){
      const resolved=(await git(gitDirectory,['rev-parse','--verify',oid+'^{commit}'])).toString('ascii').trim();
      if(resolved!==oid)throw new Error('commit');
    }
  }catch{result.unknowns.push(finding('COMMIT_UNAVAILABLE'));return result;}
  try{
    await git(gitDirectory,['fsck','--no-reflogs','--no-dangling','--no-progress',baseSha,headSha]);
  }catch{result.unknowns.push(finding('GIT_OBJECT_INTEGRITY_NOT_ESTABLISHED'));return result;}
  let provisionalMergeBase;
  try{
    const bases=(await git(gitDirectory,['merge-base','--all',baseSha,headSha])).toString('ascii').trim().split('\n');
    if(bases.length!==1||!OID.test(bases[0])){result.unknowns.push(finding('AMBIGUOUS_MERGE_BASE'));return result;}
    provisionalMergeBase=bases[0];
  }catch{result.unknowns.push(finding('MERGE_BASE_UNAVAILABLE'));return result;}
  try{
    const shallow=(await git(gitDirectory,['rev-parse','--is-shallow-repository'])).toString('ascii').trim();
    if(shallow!=='true'&&shallow!=='false')throw new Error('shallow');
    if(shallow==='true'){
      // Hidden parents below an observed ancestor of the candidate cannot add
      // another best common ancestor. Competing truncated arms remain unknown.
      const ancestry=(await git(gitDirectory,['rev-list','--parents',baseSha,headSha,'--'])).toString('ascii').trim();
      let rootsChecked=0;
      for(const line of ancestry.split('\n')){
        if(!/^[0-9a-f]{40}(?: [0-9a-f]{40})*$/.test(line))throw new Error('ancestry');
        if(line.length!==40)continue;
        if(++rootsChecked>128)throw new Error('ancestry root limit');
        const commit=await git(gitDirectory,['cat-file','commit',line],GIT_LIMITS.maxBlobBytes);
        const headers=commit.toString('utf8').split('\n\n',1)[0];
        if(/^parent /m.test(headers)){
          await git(gitDirectory,['merge-base','--is-ancestor',line,provisionalMergeBase]);
        }
      }
    }
  }catch{result.unknowns.push(finding('SHALLOW_ANCESTRY_NOT_ESTABLISHED'));return result;}
  result.merge_base_sha=provisionalMergeBase;
  try{
    const raw=await git(gitDirectory,['diff','--raw','-z','--no-renames','--no-ext-diff','--no-textconv','--abbrev=40',result.merge_base_sha,headSha,'--']);
    result.changed_entries=parseRawGitDiff(raw);
  }catch{result.unknowns.push(finding('DIFF_UNAVAILABLE_OR_LIMIT'));return result;}
  const seen=new Set();let total=0;
  for(const entry of result.changed_entries){
    for(const side of ['old','new']){
      const mode=entry[side+'_mode'],oid=entry[side+'_blob_sha'];
      if(oid===ZERO)continue;
      const source=JSON.stringify(['git',oid]);
      if(mode==='160000'){result.unknowns.push(finding('GITLINK_CONTENT_NOT_OBSERVED',source));continue;}
      if(seen.has(oid))continue;seen.add(oid);
      try{
        const sizeText=(await git(gitDirectory,['cat-file','-s',oid])).toString('ascii').trim();
        if(!/^(?:0|[1-9][0-9]*)$/.test(sizeText))throw new Error('size');
        const size=Number(sizeText);
        if(size>GIT_LIMITS.maxBlobBytes||total+size>GIT_LIMITS.maxTotalBlobBytes){
          result.unknowns.push(finding('BLOB_INSPECTION_LIMIT',source));continue;
        }
        const blob=await git(gitDirectory,['cat-file','blob',oid],GIT_LIMITS.maxBlobBytes+1);
        if(blob.length!==size)throw new Error('size');total+=size;
        if(blob.subarray(0,43).toString('ascii').startsWith('version https://git-lfs.github.com/spec/v1'))
          result.unknowns.push(finding('LFS_CONTENT_NOT_OBSERVED',source));
      }catch{result.unknowns.push(finding('BLOB_UNAVAILABLE',source));}
    }
  }
  result.status=result.unknowns.length?'PARTIAL':'VALID';return result;
}
export async function preparePublicGitStore({owner,repo,baseSha,headSha}){
  if(typeof owner!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)||typeof repo!=='string'||
    ! /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo)||repo.includes('..')||!OID.test(baseSha)||!OID.test(headSha))fail('GIT_INPUT_INVALID');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-public-objects-'));
  const cleanup=()=>fs.rm(directory,{recursive:true,force:true});
  try{
    await execute('/usr/bin/git',[...CONFIG,'init','--bare',directory],{env:ENV,maxBuffer:1024*1024,timeout:20000});
    await git(directory,['fetch','--no-tags','--no-write-fetch-head','--depth=128','https://github.com/'+owner+'/'+repo+'.git',baseSha,headSha],2*1024*1024,60000,true);
    return{gitDirectory:directory,cleanup};
  }catch{
    await cleanup();throw Object.assign(new Error('PUBLIC_GIT_OBJECTS_UNAVAILABLE'),{code:'PUBLIC_GIT_OBJECTS_UNAVAILABLE'});
  }
}
