// Bounded, read-only CI fixture verifier. Not part of the distributed CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseStrictJson} from '../src/strict-json.mjs';
import {verifyReceipt} from '../src/receipt.mjs';
const execute=promisify(execFile);
const fixtures={
  'same-repository':{repo:'openai/openai-python',pr:'4041',
    base:'9301e319ea33ef28fba380f39a289dedc14652c1',head:'83833ea92b0da18e51e32f1d39650aeff691430f'},
  fork:{repo:'psf/requests',pr:'7586',
    base:'f361ead047be5cb873174218582f7d8b9fcd9f49',head:'9820a0c297d4c3e3f7359b617b5082f24c63c79e'}
};
function fail(code){throw new Error(code);}
const kind=process.env.LIVE_KIND;
if(!Object.hasOwn(fixtures,kind))fail('LIVE_FIXTURE_INVALID');
const {repo,pr,base,head}=fixtures[kind];
const bin=process.env.TRUSTPR_INSTALLED_BIN,temp=process.env.RUNNER_TEMP;
if(!bin||!temp||!path.isAbsolute(bin)||!path.isAbsolute(temp))fail('LIVE_ENV_INVALID');
const token=process.env.GITHUB_TOKEN??'';
if(token.length>1000||/[\x00-\x20\x7f]/.test(token))fail('LIVE_TOKEN_INVALID');
const prefix='https://api.github.com/repos/'+repo+'/pulls/'+pr;
const get=async suffix=>{
  const url=prefix+suffix;
  const response=await fetch(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000),
    headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
      ...(token?{Authorization:'Bearer '+token}:{})}});
  if(!response.ok||response.url!==url)fail('LIVE_ORACLE_READ_FAILED');
  // These two fixed fixtures are small; enforce the same bounded JSON policy as the CLI.
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>8*1024*1024)fail('LIVE_ORACLE_LIMIT');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return parseStrictJson(Buffer.concat(chunks,size));
};
const before=await get('');
if(before.base.sha!==base||before.head.sha!==head)fail('LIVE_FIXTURE_GENERATION_CHANGED');
if((before.base.repo.id!==before.head.repo.id)!==(kind==='fork'))fail('LIVE_FIXTURE_KIND_CHANGED');
const files=await get('/files?per_page=100');
if(!Array.isArray(files)||files.length!==before.changed_files||files.length>=100)fail('LIVE_FILES_NOT_COMPLETE');
const output=path.join(temp,'trustpr-live');
await execute(bin,['--repo',repo,'--pr',pr,'--base-sha',base,'--head-sha',head,'--output',output],
  {timeout:240000,maxBuffer:8*1024*1024});
const receipt=parseStrictJson(await fs.readFile(path.join(output,'receipt.json')));
verifyReceipt(receipt);
const after=await get('');
if(after.base.sha!==base||after.head.sha!==head
  || receipt.core.subject.base_commit_sha!==base||receipt.core.subject.head_commit_sha!==head
  || receipt.core.subject.repository_id!==String(before.base.repo.id)||receipt.core.subject.pull_request_number!==pr
  || receipt.core.validity.status!=='PARTIAL'
  || !receipt.core.unknowns.some(x=>x.stable_code==='TEST_EXECUTION_NOT_ESTABLISHED')
  || receipt.core.unknowns.some(x=>['GIT_DIFF_NOT_COMPLETE','MERGE_BASE_UNAVAILABLE',
    'PUBLIC_GIT_OBJECTS_UNAVAILABLE'].includes(x.stable_code)))fail('LIVE_RECEIPT_INCOMPLETE_OR_SUBJECT_CHANGED');
const expected=[...new Set(files.flatMap(f=>f.status==='renamed'?[f.previous_filename,f.filename]:[f.filename]))].sort();
const observed=receipt.core.observed.changed_entries.map(x=>Buffer.from(x.raw_path_b64,'base64').toString('utf8')).sort();
if(JSON.stringify(observed)!==JSON.stringify(expected))fail('LIVE_GIT_PATH_ORACLE_MISMATCH');
const verified=path.join(temp,'trustpr-live-verified');
await execute(bin,['--verify-receipt',path.join(output,'receipt.json'),'--output',verified]);
for(const name of ['receipt.json','summary.md'])
  if(!(await fs.readFile(path.join(output,name))).equals(await fs.readFile(path.join(verified,name))))
    fail('LIVE_BYTE_ROUNDTRIP_MISMATCH');
console.log(JSON.stringify({kind,repo,pr,subject:receipt.core.subject,core_digest:receipt.integrity.core_digest,
  paths:observed,status:receipt.core.validity.status,authenticity:receipt.authenticity,
  policy_binding:receipt.core.declared.policy_binding,byte_roundtrip:'PASS'}));
