import { parseStrictJson,JSON_LIMITS } from './strict-json.mjs';
const ORIGIN='https://api.github.com';
function failure(code,status,extra={}) {return Object.assign(new Error(code),{code,...(status===undefined?{}:{status}),...extra});}
const OWNER=/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function requestUrl({method,path,query}) {
  if(method!=='GET'||typeof path!=='string'||!path.startsWith('/repos/')||/[?#\\\x00-\x20]/.test(path))throw failure('REQUEST_BOUNDARY');
  const segments=path.split('/');
  let owner,repo;try{owner=decodeURIComponent(segments[2]);repo=decodeURIComponent(segments[3]);}catch{throw failure('REQUEST_BOUNDARY');}
  if(!OWNER.test(owner)||!REPO.test(repo)||repo.includes('..'))throw failure('REQUEST_BOUNDARY');
  const tail=segments.slice(4).join('/');
  if(!/^(?:pulls\/[1-9][0-9]*|commits\/[0-9a-f]{40}\/check-suites|check-suites\/[1-9][0-9]*\/check-runs|actions\/runs(?:\/[1-9][0-9]*\/artifacts)?)$/.test(tail))throw failure('REQUEST_BOUNDARY');
  const url=new URL(path,ORIGIN);
  if(url.origin!==ORIGIN)throw failure('REQUEST_BOUNDARY');
  if(query!==undefined) {
    if(!query||typeof query!=='object'||Array.isArray(query))throw failure('REQUEST_BOUNDARY');
    for(const [key,val] of Object.entries(query)) {
      if(key==='page'&&Number.isSafeInteger(val)&&val>=1&&val<=100)url.searchParams.set(key,String(val));
      else if(key==='per_page'&&val===100)url.searchParams.set(key,'100');
      else if(key==='head_sha'&&typeof val==='string'&&/^[0-9a-f]{40}$/.test(val))url.searchParams.set(key,val);
      else throw failure('REQUEST_BOUNDARY');
    }
  }
  return url;
}
function nextPage(link,current) {
  if(!link)return null;
  if(link.length>16384)throw failure('PAGINATION_BOUNDARY');
  const next=[...link.matchAll(/<([^>]+)>\s*;\s*rel="next"/g)];
  if(!next.length)return null;if(next.length!==1)throw failure('PAGINATION_BOUNDARY');
  let url;try{url=new URL(next[0][1]);}catch{throw failure('PAGINATION_BOUNDARY');}
  if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.pathname!==current.pathname)throw failure('PAGINATION_BOUNDARY');
  const allowed=new Set([...current.searchParams.keys(),'page']);
  for(const key of url.searchParams.keys()) {
    if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)throw failure('PAGINATION_BOUNDARY');
    if(key!=='page'&&url.searchParams.get(key)!==current.searchParams.get(key))throw failure('PAGINATION_BOUNDARY');
  }
  for(const key of current.searchParams.keys())
    if(key!=='page'&&url.searchParams.get(key)!==current.searchParams.get(key))throw failure('PAGINATION_BOUNDARY');
  const text=url.searchParams.get('page');const page=Number(text);
  if(!/^[1-9][0-9]*$/.test(text??'')||page!==Number(current.searchParams.get('page')??1)+1||page>100)throw failure('PAGINATION_BOUNDARY');
  return page;
}
async function responseBytes(response) {
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>JSON_LIMITS.maxBytes)throw failure('RESPONSE_BYTE_LIMIT');
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>JSON_LIMITS.maxBytes)throw failure('RESPONSE_BYTE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,size);
}
export function createGithubHttpRequest({token='',fetchImpl=globalThis.fetch,maxRequests=500}={}) {
  if(typeof token!=='string'||token.length>1000||/[\x00-\x20\x7f]/.test(token))throw failure('TOKEN_INPUT_INVALID');
  if(typeof fetchImpl!=='function'||!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>500)throw failure('TRANSPORT_INPUT_INVALID');
  let requests=0;const totalDeadline=AbortSignal.timeout(180000);
  return async input=>{
    const url=requestUrl(input);if(++requests>maxRequests)throw failure('REQUEST_COUNT_LIMIT');
    let response;
    try {
      response=await fetchImpl(url,{method:'GET',redirect:'manual',
        headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'TrustPR-runtime-rebaseline',...(token?{Authorization:'Bearer '+token}:{})},
        signal:AbortSignal.any([totalDeadline,AbortSignal.timeout(20000)])});
    } catch {throw failure('TRANSIENT_FAILURE');}
    if(response.status>=300&&response.status<400)throw failure('REDIRECT_REJECTED');
    if(response.url) {
      const final=new URL(response.url);
      if(final.origin!==url.origin||final.pathname!==url.pathname||final.search!==url.search)throw failure('RESPONSE_ORIGIN_MISMATCH');
    }
    if(!response.ok) {
      await response.body?.cancel().catch(()=>{});
      const retry=Number(response.headers.get('retry-after'));
      const rate=response.status===429||(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0');
      throw failure(rate?'RATE_LIMITED':'GITHUB_HTTP_ERROR',rate?429:response.status,
        rate&&Number.isFinite(retry)&&retry>=0?{retryAfterMs:Math.min(retry*1000,3600000)}:{});
    }
    const bytes=await responseBytes(response);
    return {data:parseStrictJson(bytes),nextPage:nextPage(response.headers.get('link'),url)};
  };
}
