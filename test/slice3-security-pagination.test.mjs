import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubRestClient } from '../src/github-rest-client.mjs';
import { collectGithubReadEvidence } from '../src/github-read-adapter.mjs';

const B='a'.repeat(40), H='b'.repeat(40);

test('hostile owner/repo/id characters stay inside encoded path segments', async()=>{
  const calls=[];
  const client=createGithubRestClient(async req=>{calls.push(req); return {data:{number:42,base:{sha:B,repo:{id:1}},head:{sha:H,repo:{id:2}}}};});
  await client.getPullRequest({owner:'a/b',repo:'../r?#',prNumber:'42/../x'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
  assert.equal(calls[0].path.includes('/a/b/'),false);
  assert.equal(calls[0].path.includes('/../'),false);
  assert.equal(calls[0].path.includes('?'),false);
  assert.equal(calls[0].path.includes('#'),false);
  assert.match(calls[0].path,/%2F/i);
});

test('cross-origin next cursor is rejected and never requested', async()=>{
  let calls=0;
  const client=createGithubRestClient(async req=>{calls++; return {data:{total_count:0,check_suites:[]},nextPage:'https://evil.example/p2'};});
  const page=await client.listCheckSuites({owner:'o',repo:'r',headSha:H,cursor:null}).catch(error=>error);
  assert.equal(calls,1);
  assert.equal(page instanceof Error,true);
});