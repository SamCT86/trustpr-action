// Independent E1 QA: public-read-only GitHub HTTP boundary, no real traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubHttpRequest} from '../src/github-http-transport.mjs';

const good='/repos/acme/widget/pulls/42';
function harness({body='{}',status=200,headers={},maxRequests=500}={}){
 const calls=[];
 const fetchImpl=async (url,opts)=>{
  calls.push({url:String(url),method:opts.method,redirect:opts.redirect,
   auth:opts.headers.Authorization??null,signal:opts.signal});
  return new Response(body,{status,headers});
 };
 return{calls,request:createGithubHttpRequest({token:'test-token-NEVER_LOG',fetchImpl,maxRequests})};
}
test('request URL families reject credentials, SSRF tricks, off-origin routes and writes before fetch',async()=>{
 const h=harness();
 const invalid=[
  '/repos/acme/%2Fwidget/pulls/42','/repos/%2Facme/widget/pulls/42',
  '/repos/acme/%2E%2E/pulls/42','/repos/acme/widget/pulls/0',
  '/repos/acme/widget/pulls/42/extra','/repos/acme/widget/pulls/42?token=x',
  '/repos/acme/widget/pulls/42#evil','//evil.example/repos/acme/widget/pulls/42',
  'https://api.github.com/repos/acme/widget/pulls/42',
  '/repos/acme/widget/pulls/42\\@evil.test','/repos/acme/widget/issues/42',
  '/repos/acme/widget/pulls/42%00','/repos/acme/widget/pulls/-1',
  '/repos/acme/widget/pulls/42%2Fartifacts'
 ];
 for(const path of invalid)await assert.rejects(h.request({method:'GET',path}),
   e=>e.code==='REQUEST_BOUNDARY',path);
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])
  await assert.rejects(h.request({method,path:good}),e=>e.code==='REQUEST_BOUNDARY');
 for(const query of [{page:0},{page:101},{page:'1'},{per_page:50},
  {other:'https://evil.test'},{head_sha:'a'.repeat(39)}])
  await assert.rejects(h.request({method:'GET',path:good,query}),e=>e.code==='REQUEST_BOUNDARY');
 assert.equal(h.calls.length,0,'no unauthorized or redirected request reached transport');
});
test('the only allowed read targets canonical API GitHub and sends no provider writes',async()=>{
 const h=harness({body:'{"ok":true}'});
 const result=await h.request({method:'GET',path:good,query:{page:1,per_page:100}});
 assert.equal(result.data.ok,true);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url,'https://api.github.com/repos/acme/widget/pulls/42?page=1&per_page=100');
 assert.equal(h.calls[0].method,'GET');
 assert.equal(h.calls[0].redirect,'manual');
 assert.equal(h.calls[0].auth,'Bearer test-token-NEVER_LOG');
 assert.equal(JSON.stringify(result).includes('test-token-NEVER_LOG'),false);
});
test('pagination cross-origin, credentials and query mutation are rejected, never fetched',async()=>{
 const nextUrls=[
  'https://evil.example/repos/acme/widget/pulls/42?page=2',
  'https://api.github.com.evil.example/repos/acme/widget/pulls/42?page=2',
  'https://user:pass@api.github.com/repos/acme/widget/pulls/42?page=2',
  'https://api.github.com/repos/acme/widget/pulls/99?page=2',
  'https://api.github.com/repos/acme/widget/pulls/42?per_page=1&page=2',
  'https://api.github.com/repos/acme/widget/pulls/42?page=1000',
  'https://api.github.com/repos/acme/widget/pulls/42?page=2&evil=1',
  'https://api.github.com/repos/acme/widget/pulls/42?page=2#fragment'
 ];
 for(const next of nextUrls){
  const h=harness({headers:{link:'<'+next+'>; rel="next"'}});
  await assert.rejects(h.request({method:'GET',path:good,query:{page:1,per_page:100}}),
   e=>e.code==='PAGINATION_BOUNDARY',next);
  assert.equal(h.calls.length,1,'transport did not follow attacker URL');
 }
});
test('provider malformed JSON and oversized content cannot enter trusted records',async()=>{
 for(const body of ['{"a":1,"a":2}','{"x":1.5}','{"x": 9007199254740992}']){
  const h=harness({body});
  await assert.rejects(h.request({method:'GET',path:good}));
  assert.equal(h.calls.length,1);
 }
 const tooBig=harness({body:'{}',headers:{'content-length':String(8*1024*1024+1)}});
 await assert.rejects(tooBig.request({method:'GET',path:good}),
  e=>e.code==='RESPONSE_BYTE_LIMIT');
});
test('bounded request count never retries or secretly issues a second HTTP request',async()=>{
 const h=harness({maxRequests:1});
 await h.request({method:'GET',path:good});
 await assert.rejects(h.request({method:'GET',path:good}),
  e=>e.code==='REQUEST_COUNT_LIMIT');
 assert.equal(h.calls.length,1);
});
