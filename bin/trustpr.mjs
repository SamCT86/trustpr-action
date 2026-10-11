#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseStrictJson} from '../src/strict-json.mjs';
import {verifyReceipt} from '../src/receipt.mjs';
import {renderTrustPrMarkdown} from '../src/human-renderer.mjs';
import {createGithubHttpRequest} from '../src/github-http-transport.mjs';
import {createGithubRestClient} from '../src/github-rest-client.mjs';
import {runTrustPr} from '../src/runtime.mjs';
const HELP=`TrustPR — read-only evidence receipts, never merge authorization.
Node.js 24 and /usr/bin/git are required.

  node bin/trustpr.mjs --repo OWNER/REPO --pr NUMBER [--base-sha SHA --head-sha SHA]
                       [--git-directory /absolute/path/to/.git] [--output NEW_DIRECTORY]
  node bin/trustpr.mjs --demo [--output NEW_DIRECTORY]
  node bin/trustpr.mjs --verify-receipt receipt.json [--output NEW_DIRECTORY]

GITHUB_TOKEN is optional for public API reads. No token is accepted on the command line.
Only api.github.com receives credentials; public Git-object fetches use no credentials.
No checkout, PR-code execution, GitHub writes, or merge permission.
JSON goes to stdout. --output creates a new directory with receipt.json and summary.md.
Integrity verification does not authenticate the receipt or verify its factual claims.
`;
function failure(code){throw Object.assign(new Error(code),{code});}
function options(args){
  const out={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(['--help','--demo'].includes(key)){if(Object.hasOwn(out,key))failure('CLI_ARGUMENT_INVALID');out[key]=true;continue;}
    if(!['--repo','--pr','--base-sha','--head-sha','--git-directory','--output','--verify-receipt'].includes(key)||
      Object.hasOwn(out,key)||i+1>=args.length||args[i+1].startsWith('--'))failure('CLI_ARGUMENT_INVALID');
    out[key]=args[++i];
  }
  if(out['--help']&&Object.keys(out).length!==1)failure('CLI_ARGUMENT_INVALID');
  if(out['--demo']&&Object.keys(out).some(k=>!['--demo','--output'].includes(k)))failure('CLI_ARGUMENT_INVALID');
  if(out['--verify-receipt']&&Object.keys(out).some(k=>!['--verify-receipt','--output'].includes(k)))failure('CLI_ARGUMENT_INVALID');
  return out;
}
export function resultText(receipt,token=''){
  verifyReceipt(receipt);
  const json=JSON.stringify(receipt,null,2)+'\n',markdown=renderTrustPrMarkdown(receipt);
  if(token&&(json.includes(token)||markdown.includes(token)||receipt.core.observed.changed_entries.some(e=>Buffer.from(e.raw_path_b64,'base64').includes(Buffer.from(token)))))
    failure('CREDENTIAL_IN_OUTPUT');
  return{json,markdown};
}
export async function writeResult(receipt,outputDirectory,token=''){
  const result=resultText(receipt,token);
  if(outputDirectory){
    const directory=path.resolve(outputDirectory);if(/[\x00-\x1f\x7f]/.test(directory))failure('OUTPUT_PATH_INVALID');
    try{await fs.mkdir(directory);}catch{failure('OUTPUT_DIRECTORY_MUST_BE_NEW');}
    await fs.writeFile(path.join(directory,'receipt.json'),result.json,{flag:'wx',mode:0o600});
    await fs.writeFile(path.join(directory,'summary.md'),result.markdown,{flag:'wx',mode:0o600});
  }
  return result;
}
export async function syntheticDemo(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-demo-'));
  const execute=promisify(execFile);
  const env={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'TrustPR demo',
    GIT_AUTHOR_EMAIL:'demo@example.invalid',GIT_COMMITTER_NAME:'TrustPR demo',GIT_COMMITTER_EMAIL:'demo@example.invalid'};
  const git=async args=>(await execute('/usr/bin/git',['-c','core.hooksPath=/dev/null',...args],{cwd:directory,env,maxBuffer:1024*1024,timeout:20000})).stdout.trim();
  try{
    await git(['init','-q']);await fs.writeFile(path.join(directory,'example.md'),'Before the change.\n');
    await git(['add','example.md']);await git(['commit','-qm','demo base']);const base=await git(['rev-parse','HEAD']);
    await fs.writeFile(path.join(directory,'example.md'),'After the change.\n');
    await git(['add','example.md']);await git(['commit','-qm','demo head']);const head=await git(['rev-parse','HEAD']);
    const snapshot={repository_id:'1',pull_request_number:'1',base_repository_id:'1',head_repository_id:'1',base_commit_sha:base,head_commit_sha:head};
    const empty=async()=>({items:[],next:null,reported_total_count:0,provider_complete:true});
    const client={getPullRequest:async()=>({...snapshot}),listCheckSuites:empty,listCheckRunsForSuite:empty,listWorkflowRuns:empty,listArtifacts:empty};
    return await runTrustPr({owner:'demo',repo:'synthetic',prNumber:'1',expectedBaseSha:base,expectedHeadSha:head},
      {client,gitDirectory:path.join(directory,'.git'),source:'SYNTHETIC_DEMO'});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
export async function main(args=process.argv.slice(2)){
  const opts=options(args);if(opts['--help']){process.stdout.write(HELP);return;}
  let receipt,token='';
  if(opts['--demo'])receipt=await syntheticDemo();
  else if(opts['--verify-receipt']){
    const stat=await fs.stat(opts['--verify-receipt']);if(!stat.isFile()||stat.size>8*1024*1024)failure('RECEIPT_INPUT_LIMIT');
    receipt=parseStrictJson(await fs.readFile(opts['--verify-receipt']));verifyReceipt(receipt);
  }else{
    if(!opts['--repo']||!opts['--pr'])failure('CLI_ARGUMENT_INVALID');
    const parts=opts['--repo'].split('/');if(parts.length!==2)failure('CLI_ARGUMENT_INVALID');
    const target={owner:parts[0],repo:parts[1],prNumber:opts['--pr'],
      ...(opts['--base-sha']?{expectedBaseSha:opts['--base-sha']}:{ }),...(opts['--head-sha']?{expectedHeadSha:opts['--head-sha']}:{ })};
    token=process.env.GITHUB_TOKEN??'';const client=createGithubRestClient(createGithubHttpRequest({token}));
    receipt=await runTrustPr(target,{client,gitDirectory:opts['--git-directory']});
  }
  const result=await writeResult(receipt,opts['--output'],token);process.stdout.write(result.json);
}
if(process.argv[1]&&(await fs.realpath(path.resolve(process.argv[1])).catch(()=>null))===fileURLToPath(import.meta.url))
  main().catch(error=>{const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code??'')?error.code:'RUNTIME_FAILED';process.stderr.write('TrustPR: '+code+'\n');process.exitCode=1;});
