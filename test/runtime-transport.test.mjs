import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubHttpRequest } from '../src/github-http-transport.mjs';
const path='/repos/acme/widget/pulls/42';
test('transport sends credentials only to a pinned API GET and rejects redirects', async () => {
  const calls=[];
  const request=createGithubHttpRequest({token:'private-test-token',fetchImpl:async (url,options)=>{
    calls.push([String(url),options]);return new Response('{}',{status:302,headers:{location:'https://evil.invalid'}});
  }});
  await assert.rejects(request({method:'GET',path}), /REDIRECT_REJECTED/);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0][0]).origin,'https://api.github.com');
  assert.equal(calls[0][1].redirect,'manual');
  assert.equal(calls[0][1].headers.Authorization,'Bearer private-test-token');
  for(const bad of ['https://evil.invalid','//evil.invalid/x','/repos/acme/widget/../../x','/repos/acme/widget/pulls/42?x=1'])
    await assert.rejects(request({method:'GET',path:bad}), /REQUEST_BOUNDARY/);
  await assert.rejects(request({method:'POST',path}), /REQUEST_BOUNDARY/);
  assert.equal(calls.length,1);
});
test('transport validates Link pagination without following untrusted destinations', async () => {
  const request=createGithubHttpRequest({fetchImpl:async()=>new Response('{"total_count":0,"check_suites":[]}',{
    headers:{link:'<https://api.github.com/repos/acme/widget/commits/'+ 'a'.repeat(40)+'/check-suites?per_page=100&page=2>; rel="next"'}
  })});
  const result=await request({method:'GET',path:'/repos/acme/widget/commits/'+ 'a'.repeat(40)+'/check-suites',query:{per_page:100,page:1}});
  assert.equal(result.nextPage,2);
  const bad=createGithubHttpRequest({fetchImpl:async()=>new Response('{}',{headers:{link:'<https://evil.invalid/x?page=2>; rel="next"'}})});
  await assert.rejects(bad({method:'GET',path}), /PAGINATION_BOUNDARY/);
});
test('transport rejects duplicate JSON keys and redacts provider error bodies', async () => {
  const duplicate=createGithubHttpRequest({fetchImpl:async()=>new Response('{"a":1,"a":2}')});
  await assert.rejects(duplicate({method:'GET',path}), /DUPLICATE_JSON_KEY/);
  const denied=createGithubHttpRequest({token:'secret-value',fetchImpl:async()=>new Response('secret-value',{status:401})});
  await assert.rejects(denied({method:'GET',path}), e=>e.status===401&&!JSON.stringify(e).includes('secret-value')&&!e.message.includes('secret-value'));
});
test('transport bounds body size and normalizes rate limiting', async () => {
  const large=createGithubHttpRequest({fetchImpl:async()=>new Response('{}',{headers:{'content-length':'9000000'}})});
  await assert.rejects(large({method:'GET',path}), /RESPONSE_BYTE_LIMIT/);
  const rate=createGithubHttpRequest({fetchImpl:async()=>new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','retry-after':'2'}})});
  await assert.rejects(rate({method:'GET',path}), e=>e.status===429&&e.retryAfterMs===2000);
});
