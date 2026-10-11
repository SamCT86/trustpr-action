import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gitFixture} from './runtime-helper.mjs';
import {runTrustPr} from '../src/runtime.mjs';
import {verifyReceipt} from '../src/receipt.mjs';
import {createGithubHttpRequest} from '../src/github-http-transport.mjs';
import {createGithubRestClient} from '../src/github-rest-client.mjs';
import {runAction} from '../bin/action.mjs';
import {resultText} from '../bin/trustpr.mjs';
const execute=promisify(execFile);
function provider(f,{changedHead=false,denied=false}={}){
  const calls=[];let snapshots=0;
  const request=createGithubHttpRequest({token:'fixture-secret-token',fetchImpl:async url=>{
    calls.push(String(url));const u=new URL(url);
    if(u.pathname==='/repos/acme/widget/pulls/42'){
      if(denied)return new Response('never echo this body',{status:401});
      snapshots++;
      return Response.json({number:42,base:{sha:f.base,repo:{id:77}},head:{sha:changedHead&&snapshots>1?'f'.repeat(40):f.head,repo:{id:88}}});
    }
    if(u.pathname.endsWith('/check-suites'))return Response.json({total_count:1,check_suites:[{id:20,head_sha:f.head,app:{id:30,slug:'github-actions'}}]});
    if(u.pathname.endsWith('/check-runs'))return Response.json({total_count:1,check_runs:[{id:10,name:'unit tests',head_sha:f.head,status:'completed',conclusion:'success',check_suite:{id:20},app:{id:30,slug:'github-actions'}}]});
    if(u.pathname.endsWith('/actions/runs'))return Response.json({total_count:1,workflow_runs:[{id:40,check_suite_id:20,workflow_id:50,head_sha:f.head,run_attempt:1,status:'completed',conclusion:'success',path:'.github/workflows/ci.yml@main'}]});
    if(u.pathname.endsWith('/artifacts'))return Response.json({total_count:1,artifacts:[{id:60,expired:false,digest:'sha256:'+'a'.repeat(64),workflow_run:{id:40}}]});
    throw new Error('unexpected fixture route');
  }});
  return {client:createGithubRestClient(request),calls};
}
test('complete runtime composes pinned HTTP, GitHub collector, raw Git diff and deterministic receipt',async t=>{
  const f=await gitFixture(t),p=provider(f);
  const target={owner:'acme',repo:'widget',prNumber:'42',expectedBaseSha:f.base,expectedHeadSha:f.head};
  const receipt=await runTrustPr(target,{client:p.client,gitDirectory:f.gitDirectory});
  assert.equal(receipt.core.subject.head_commit_sha,f.head);
  assert.equal(receipt.core.observed.changed_entries.length,2);
  assert.equal(receipt.core.observed.checks[0].check_run_id,'10');
  assert.equal(receipt.core.observed.artifacts[0].verification_state,'METADATA_ONLY');
  assert.equal(receipt.core.validity.status,'PARTIAL');
  assert.ok(receipt.core.unknowns.some(x=>x.stable_code==='ARTIFACT_BYTES_NOT_RETRIEVED'));
  assert.equal(verifyReceipt(receipt).merge_authorized,false);
  assert.equal(p.calls.length,6);
  assert.equal(resultText(receipt).markdown,resultText(receipt).markdown);
  assert.ok(!resultText(receipt).json.includes('fixture-secret-token'));
});
test('S1 change and API authentication failure produce honest receipts',async t=>{
  const f=await gitFixture(t),target={owner:'acme',repo:'widget',prNumber:'42',expectedBaseSha:f.base,expectedHeadSha:f.head};
  const stale=await runTrustPr(target,{client:provider(f,{changedHead:true}).client,gitDirectory:f.gitDirectory});
  assert.equal(stale.core.validity.status,'STALE');
  const denied=await runTrustPr(target,{client:provider(f,{denied:true}).client,gitDirectory:f.gitDirectory});
  assert.equal(denied.core.validity.status,'INVALID');
  assert.equal(denied.authenticity,'UNAUTHENTICATED');
});
test('CLI demo creates two usable files and standalone strict verification rejects duplicate keys',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-command-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const output=path.join(temp,'result');
  const demo=await execute(process.execPath,['bin/trustpr.mjs','--demo','--output',output],{cwd:path.resolve(import.meta.dirname,'..'),env:{PATH:'/usr/bin:/bin'}});
  const receipt=JSON.parse(demo.stdout);
  assert.equal(receipt.core.declared.evidence_source,'SYNTHETIC_DEMO');
  assert.equal(verifyReceipt(receipt).status,'INTEGRITY_VALID');
  assert.match(await fs.readFile(path.join(output,'summary.md'),'utf8'),/UNAUTHENTICATED/);
  const verified=await execute(process.execPath,['bin/trustpr.mjs','--verify-receipt',path.join(output,'receipt.json')],{cwd:path.resolve(import.meta.dirname,'..')});
  assert.deepEqual(JSON.parse(verified.stdout),receipt);
  const hostile=path.join(temp,'duplicate.json');await fs.writeFile(hostile,'{"a":1,"a":2}');
  await assert.rejects(execute(process.execPath,['bin/trustpr.mjs','--verify-receipt',hostile],{cwd:path.resolve(import.meta.dirname,'..')}),e=>e.stderr.includes('DUPLICATE_JSON_KEY'));
  await assert.rejects(execute(process.execPath,['bin/trustpr.mjs','--demo','--output',output],{cwd:path.resolve(import.meta.dirname,'..')}),e=>e.stderr.includes('OUTPUT_DIRECTORY_MUST_BE_NEW'));
});
test('Action runs a read-only fork event through the real runtime and writes runner outputs',async t=>{
  const f=await gitFixture(t),p=provider(f);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-action-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const event=path.join(temp,'event.json'),output=path.join(temp,'outputs'),summary=path.join(temp,'summary');
  await fs.writeFile(event,JSON.stringify({repository:{id:77,full_name:'acme/widget'},pull_request:{number:42,base:{sha:f.base},head:{sha:f.head}}}));
  const env={GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,INPUT_REPOSITORY:'acme/widget',
    'INPUT_PULL-REQUEST-NUMBER':'42','INPUT_BASE-SHA':f.base,'INPUT_HEAD-SHA':f.head,INPUT_TOKEN:'fixture-secret-token',
    RUNNER_TEMP:temp,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary};
  await runAction({client:p.client,gitDirectory:f.gitDirectory,env});
  const entries=Object.fromEntries((await fs.readFile(output,'utf8')).trim().split('\n').map(x=>x.split('=')));
  const receipt=JSON.parse(await fs.readFile(entries['receipt-path'],'utf8'));
  assert.equal(receipt.core.validity.status,'PARTIAL');
  assert.equal(receipt.core.subject.repository_id,'77');
  assert.ok(!(await fs.readFile(summary,'utf8')).includes('fixture-secret-token'));
});
test('Action rejects pull_request_target and subject substitution before any provider request',async()=>{
  let called=false;
  await assert.rejects(runAction({client:{getPullRequest:()=>{called=true;}},env:{GITHUB_EVENT_NAME:'pull_request_target'}}),/ACTION_EVENT_FORBIDDEN/);
  assert.equal(called,false);
});


test('Action subject substitution is rejected before any provider call',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-event-mismatch-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const event=path.join(directory,'event.json');
  await fs.writeFile(event,JSON.stringify({repository:{id:77,full_name:'acme/widget'},pull_request:{number:42,base:{sha:'a'.repeat(40)},head:{sha:'b'.repeat(40)}}}));
  let calls=0;
  await assert.rejects(runAction({client:{getPullRequest:()=>{calls++;}},env:{GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,INPUT_REPOSITORY:'acme/widget','INPUT_PULL-REQUEST-NUMBER':'42','INPUT_BASE-SHA':'a'.repeat(40),'INPUT_HEAD-SHA':'c'.repeat(40)}}),/ACTION_EVENT_SUBJECT_MISMATCH/);
  assert.equal(calls,0);
});
