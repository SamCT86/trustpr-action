import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseStrictJson} from '../src/strict-json.mjs';
import {runTrustPr} from '../src/runtime.mjs';
import {createGithubHttpRequest} from '../src/github-http-transport.mjs';
import {createGithubRestClient} from '../src/github-rest-client.mjs';
import {writeResult} from './trustpr.mjs';
function fail(code){throw Object.assign(new Error(code),{code});}
export async function runAction({client: suppliedClient,gitDirectory,env=process.env}={}){
  if(env.GITHUB_EVENT_NAME!=='pull_request')fail('ACTION_EVENT_FORBIDDEN');
  const eventPath=env.GITHUB_EVENT_PATH;if(!eventPath)fail('ACTION_EVENT_UNAVAILABLE');
  const stat=await fs.stat(eventPath);if(!stat.isFile()||stat.size>8*1024*1024)fail('ACTION_EVENT_LIMIT');
  const event=parseStrictJson(await fs.readFile(eventPath));
  const repository=env.INPUT_REPOSITORY??'',number=env['INPUT_PULL-REQUEST-NUMBER']??'',
    base=env['INPUT_BASE-SHA']??'',head=env['INPUT_HEAD-SHA']??'';
  if(repository!==event.repository?.full_name||number!==String(event.pull_request?.number??'')||
    base!==event.pull_request?.base?.sha||head!==event.pull_request?.head?.sha)fail('ACTION_EVENT_SUBJECT_MISMATCH');
  const [owner,repo,...extra]=repository.split('/');if(extra.length)fail('ACTION_EVENT_SUBJECT_MISMATCH');
  gitDirectory??=env['INPUT_GIT-DIRECTORY']||undefined;
  if(gitDirectory!==undefined){
    if(typeof gitDirectory!=='string'||!path.isAbsolute(gitDirectory)||gitDirectory.length>4096||/[\x00-\x1f\x7f]/.test(gitDirectory))
      fail('ACTION_GIT_DIRECTORY_INVALID');
    const directory=await fs.stat(gitDirectory).catch(()=>null);
    if(!directory?.isDirectory())fail('ACTION_GIT_DIRECTORY_INVALID');
  }
  const token=env.INPUT_TOKEN??env.GITHUB_TOKEN??'';
  const target={owner,repo,prNumber:number,expectedBaseSha:base,expectedHeadSha:head,repositoryId:String(event.repository.id)};
  const client=suppliedClient??createGithubRestClient(createGithubHttpRequest({token}));const receipt=await runTrustPr(target,{client,gitDirectory});
  const temp=env.RUNNER_TEMP??os.tmpdir();if(!path.isAbsolute(temp)||/[\x00-\x1f\x7f]/.test(temp))fail('ACTION_TEMP_INVALID');
  const directory=path.join(temp,'trustpr-'+randomUUID());const output=await writeResult(receipt,directory,token);
  if(env.GITHUB_STEP_SUMMARY)await fs.appendFile(env.GITHUB_STEP_SUMMARY,output.markdown);
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,
    'receipt-path='+path.join(directory,'receipt.json')+'\nsummary-path='+path.join(directory,'summary.md')+'\nreceipt-status='+receipt.core.validity.status+'\n');
  process.stdout.write('TrustPR receipt: '+receipt.core.validity.status+'; UNAUTHENTICATED; POLICY_UNBOUND; no merge authorization.\n');
  const status=receipt.core.validity.status;
  if(status==='PARTIAL')process.stdout.write('::warning title=TrustPR evidence incomplete::Receipt PARTIAL; no merge authorization.\n');
  if(status==='INVALID'||status==='STALE')fail('ACTION_EVIDENCE_INVALID_OR_STALE');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
runAction().catch(error=>{const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code??'')?error.code:'ACTION_FAILED';process.stderr.write('TrustPR: '+code+'\n');process.exitCode=1;});
