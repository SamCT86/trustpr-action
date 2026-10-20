import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubRestClient} from '../src/github-rest-client.mjs';
import {collectGithubReadEvidence} from '../src/github-read-adapter.mjs';
import {buildReceipt} from '../src/receipt.mjs';
const H='a'.repeat(40),B='b'.repeat(40),target={owner:'o',repo:'r',prNumber:'2'};
function fixture(kind, records, paged=false){
  return createGithubRestClient(async req=>{
    if(req.path.endsWith('/pulls/2'))return {data:{number:2,base:{sha:B,repo:{id:1}},head:{sha:H,repo:{id:1}}}};
    const name=req.path.endsWith('/check-suites')?'check_suites':req.path.endsWith('/check-runs')?'check_runs':req.path.endsWith('/actions/runs')?'workflow_runs':'artifacts';
    const defaults={check_suites:[{id:20,head_sha:H}],check_runs:[],workflow_runs:[{id:40,workflow_id:50,head_sha:H,run_attempt:1}],artifacts:[]};
    const page=req.query?.page??1;
    const chosen=name===kind?records:defaults[name];
    return {data:{[name]:name===kind&&paged?[chosen[page-1]]:chosen,total_count:chosen.length},nextPage:name===kind&&paged&&page<chosen.length?page+1:null};
  });
}
function receipt(evidence){return buildReceipt({target,evidence,diff:{status:'VALID',base_commit_sha:B,head_commit_sha:H,merge_base_sha:B,changed_entries:[],unknowns:[]}});}
test('duplicate provider identities within or across pages never establish complete collection',async()=>{
  const records={check_suites:{id:20,head_sha:H},check_runs:{id:10,check_suite:{id:20},head_sha:H,name:'unit',status:'completed',conclusion:'success'},workflow_runs:{id:40,workflow_id:50,head_sha:H,run_attempt:1},artifacts:{id:60,expired:false,workflow_run:{id:40}}};
  for(const [kind,record] of Object.entries(records))for(const paged of [false,true]){
    const evidence=await collectGithubReadEvidence(fixture(kind,[record,record],paged),target);
    const collection=evidence.collection_evidence.find(x=>x.collection_kind===kind);
    assert.equal(collection.complete,false);assert.equal(collection.item_count,'1');
    assert.equal(collection.failure_code,'PROVIDER_DUPLICATE_IDENTITY');
    assert.equal(evidence.validity.status,'PARTIAL');
    assert.ok(receipt(evidence).core.unknowns.some(x=>x.stable_code==='PROVIDER_DUPLICATE_IDENTITY'&&x.field_or_source_tuple===kind));
  }
});
test('conflicting duplicate identities preserve the known foreign generation and fail closed',async()=>{
  const evidence=await collectGithubReadEvidence(fixture('workflow_runs',[{id:40,workflow_id:50,head_sha:H,run_attempt:1},{id:40,workflow_id:50,head_sha:'f'.repeat(40),run_attempt:1}]),target);
  assert.equal(evidence.validity.status,'INVALID');
  const collection=evidence.collection_evidence.find(x=>x.collection_kind==='workflow_runs');
  assert.equal(collection.complete,false);assert.equal(collection.failure_code,'PROVIDER_IDENTITY_CONFLICT');
});
test('endpoint suite/run mismatches retain valid neighboring evidence and explicit incomplete diagnostics',async()=>{
  for(const kind of ['check_runs','artifacts']){
    const good=kind==='check_runs'?{id:10,check_suite:{id:20},head_sha:H,name:'unit',status:'completed',conclusion:'success'}:{id:60,expired:false,workflow_run:{id:40}};
    const bad=kind==='check_runs'?{...good,id:11,check_suite:{id:21}}:{...good,id:61,workflow_run:{id:41}};
    const evidence=await collectGithubReadEvidence(fixture(kind,[bad,good]),target);
    assert.equal(evidence.validity.status,'PARTIAL');
    const collection=evidence.collection_evidence.find(x=>x.collection_kind===kind);
    assert.equal(collection.complete,false);assert.equal(collection.failure_code,'PROVIDER_RESPONSE_INVALID');assert.equal(collection.item_count,'1');
    const observed=kind==='check_runs'?evidence.observed.checks:evidence.observed.artifacts;
    assert.equal(observed.length,1);
    assert.ok(receipt(evidence).core.unknowns.some(x=>x.stable_code==='PROVIDER_RESPONSE_INVALID'&&x.field_or_source_tuple===kind));
  }
});
