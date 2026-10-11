import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAction} from '../bin/action.mjs';
import {verifyReceipt} from '../src/receipt.mjs';
import {gitFixture} from './runtime-helper.mjs';

async function actionFixture(t, status, fork=false) {
  const f=await gitFixture(t);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trustpr-action-outcome-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const event=path.join(temp,'event.json');
  await fs.writeFile(event,JSON.stringify({repository:{id:77,full_name:'acme/widget'},
    pull_request:{number:42,base:{sha:f.base},head:{sha:f.head}}}));
  const env={GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,INPUT_REPOSITORY:'acme/widget',
    'INPUT_PULL-REQUEST-NUMBER':'42','INPUT_BASE-SHA':f.base,'INPUT_HEAD-SHA':f.head,
    RUNNER_TEMP:temp,GITHUB_OUTPUT:path.join(temp,'outputs'),GITHUB_STEP_SUMMARY:path.join(temp,'summary')};
  let snapshots=0;
  const snapshot={repository_id:'77',pull_request_number:'42',base_repository_id:'77',
    head_repository_id:fork?'88':'77',base_commit_sha:f.base,head_commit_sha:f.head};
  const empty=async()=>({items:[],next:null,reported_total_count:0,provider_complete:true});
  const client={getPullRequest:async()=>{
    snapshots++;
    return {...snapshot,
      ...(status==='INVALID'?{repository_id:'99'}:{}),
      ...(status==='STALE'&&snapshots>1?{head_commit_sha:'f'.repeat(40)}:{})};
  },listCheckSuites:empty,listCheckRunsForSuite:empty,listWorkflowRuns:empty,listArtifacts:empty};
  return {f,temp,env,client};
}

for(const status of ['INVALID','STALE']) test(`Action ${status} fails after writing verifiable receipt and summary`,async t=>{
  const x=await actionFixture(t,status);
  await assert.rejects(runAction({client:x.client,gitDirectory:x.f.gitDirectory,env:x.env}),
    e=>e.code==='ACTION_EVIDENCE_INVALID_OR_STALE');
  const outputs=Object.fromEntries((await fs.readFile(x.env.GITHUB_OUTPUT,'utf8')).trim().split('\n').map(l=>l.split('=')));
  assert.equal(outputs['receipt-status'],status);
  const receipt=JSON.parse(await fs.readFile(outputs['receipt-path'],'utf8'));
  assert.equal(receipt.core.validity.status,status);
  assert.equal(verifyReceipt(receipt).merge_authorized,false);
  const summary=await fs.readFile(x.env.GITHUB_STEP_SUMMARY,'utf8');
  assert.match(summary,new RegExp(status));
  assert.match(summary,/UNAUTHENTICATED/);
  assert.match(summary,/POLICY_UNBOUND/);
  await assert.rejects(fs.stat(path.join(x.f.dir,'executed-pr-code')),{code:'ENOENT'});
});

for(const fork of [false,true]) test(`Action coherent ${fork?'fork':'same-repo'} evidence remains PARTIAL and succeeds`,async t=>{
  const x=await actionFixture(t,'PARTIAL',fork);
  await runAction({client:x.client,gitDirectory:x.f.gitDirectory,env:x.env});
  const outputs=Object.fromEntries((await fs.readFile(x.env.GITHUB_OUTPUT,'utf8')).trim().split('\n').map(l=>l.split('=')));
  const receipt=JSON.parse(await fs.readFile(outputs['receipt-path'],'utf8'));
  assert.equal(outputs['receipt-status'],'PARTIAL');
  assert.equal(receipt.core.validity.status,'PARTIAL');
  assert.ok(receipt.core.unknowns.some(x=>x.stable_code==='TEST_EXECUTION_NOT_ESTABLISHED'));
  assert.equal(verifyReceipt(receipt).merge_authorized,false);
  await assert.rejects(fs.stat(path.join(x.f.dir,'executed-pr-code')),{code:'ENOENT'});
});

test('Action input uses caller-fetched Git objects offline and preserves exact changed blobs',async t=>{
  const x=await actionFixture(t,'PARTIAL');
  x.env['INPUT_GIT-DIRECTORY']=x.f.gitDirectory;
  await runAction({client:x.client,env:x.env});
  const outputs=Object.fromEntries((await fs.readFile(x.env.GITHUB_OUTPUT,'utf8')).trim().split('\n').map(l=>l.split('=')));
  const receipt=JSON.parse(await fs.readFile(outputs['receipt-path'],'utf8'));
  assert.equal(receipt.core.subject.merge_base_sha,x.f.base);
  assert.equal(receipt.core.subject.head_commit_sha,x.f.head);
  assert.equal(receipt.core.observed.changed_entries.length,2);
  assert.ok(!receipt.core.unknowns.some(x=>x.stable_code==='PUBLIC_GIT_OBJECTS_UNAVAILABLE'));
  await assert.rejects(fs.stat(path.join(x.f.dir,'executed-pr-code')),{code:'ENOENT'});
});

test('Action rejects malformed Git directory input before any provider request',async t=>{
  const x=await actionFixture(t,'PARTIAL');let calls=0;
  const client={getPullRequest:async()=>{calls++;throw new Error('must not read');}};
  for(const directory of ['relative/.git',x.f.gitDirectory+'\n','/missing-trustpr-object-directory']){
    x.env['INPUT_GIT-DIRECTORY']=directory;
    await assert.rejects(runAction({client,env:x.env}),e=>e.code==='ACTION_GIT_DIRECTORY_INVALID');
  }
  assert.equal(calls,0);
});
