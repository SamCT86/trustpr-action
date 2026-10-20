import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubHttpRequest} from '../src/github-http-transport.mjs';

const path='/repos/SamCT86/trustpr-action/pulls/1';
function request(status,headers={}){
 return createGithubHttpRequest({fetchImpl:async()=>new Response(JSON.stringify({message:'API response'}),{status,headers})});
}
async function errorFrom(http){
 try {await http({method:'GET',path});assert.fail('should throw');}
 catch(error){if(error.code==='ERR_ASSERTION')throw error;return error;}
}

test('secondary 403 Retry-After with positive primary quota is RATE_LIMITED',async()=>{
 const e=await errorFrom(request(403,{'retry-after':'60','x-ratelimit-remaining':'100'}));
 assert.equal(e.code,'RATE_LIMITED');
 assert.equal(e.status,429);
 assert.equal(e.retryAfterMs,60000);
});
test('403 ordinary permission denial remains GITHUB_HTTP_ERROR 403',async()=>{
 const e=await errorFrom(request(403,{'x-ratelimit-remaining':'100'}));
 assert.equal(e.code,'GITHUB_HTTP_ERROR');assert.equal(e.status,403);
});
test('403 primary exhaustion remains RATE_LIMITED',async()=>{
 const e=await errorFrom(request(403,{'x-ratelimit-remaining':'0'}));
 assert.equal(e.code,'RATE_LIMITED');
});
test('429 remains RATE_LIMITED and numeric Retry-After stays bounded',async()=>{
 const e=await errorFrom(request(429,{'retry-after':'36000'}));
 assert.equal(e.code,'RATE_LIMITED');assert.equal(e.retryAfterMs,3600000);
});
test('invalid retry header must not turn ordinary 403 into rate-limit',async()=>{
 for(const retry of ['','not-a-number','-5']){
   const e=await errorFrom(request(403,{'retry-after':retry,'x-ratelimit-remaining':'100'}));
   assert.equal(e.code,'GITHUB_HTTP_ERROR');
 }
});
test('malformed Retry-After must not expose provider body or grant automatic retry',async()=>{
 const e=await errorFrom(request(403,{'retry-after':'Infinity','x-ratelimit-remaining':'101'}));
 assert.equal(e.code,'GITHUB_HTTP_ERROR');
 assert.equal(JSON.stringify(e).includes('API response'),false);
});
