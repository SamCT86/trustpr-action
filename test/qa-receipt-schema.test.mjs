import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReceipt,verifyReceipt,validateTarget} from '../src/receipt.mjs';
import {computeCoreDigest,renderTrustPrMarkdown} from '../src/human-renderer.mjs';
import {parseStrictJson} from '../src/strict-json.mjs';

const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
function fixture(){
  const snapshot={repository_id:'77',pull_request_number:'42',base_repository_id:'77',head_repository_id:'88',base_commit_sha:a,head_commit_sha:b};
  return {target:{owner:'acme',repo:'widget',prNumber:'42'},evidence:{s0:{...snapshot},s1:{...snapshot},validity:{status:'VALID',reasons:[]},observed:{
    checks:[{provider:'github',check_run_id:'10',check_suite_id:'20',workflow_run_id:'30',run_attempt:'1',head_sha:b,status:'completed',conclusion:'success'}],
    artifacts:[{provider:'github',artifact_id:'40',producing_run_id:'30',attempt:'1',retention_state:'available'}]
  }},diff:{status:'VALID',base_commit_sha:a,head_commit_sha:b,merge_base_sha:c,changed_entries:[{raw_path_b64:Buffer.from('safe.txt').toString('base64'),change_type:'MODIFY',old_mode:'100644',new_mode:'100644',old_blob_sha:a,new_blob_sha:b}],unknowns:[]}};
}
const paths=[
  ['subject','repository_id'],['subject','pull_request_number'],
  ...['base_commit_sha','head_commit_sha','merge_base_sha'].map(k=>['subject',k]),
  ...['old_blob_sha','new_blob_sha'].map(k=>['observed','changed_entries',0,k]),
  ...['check_run_id','check_suite_id','workflow_run_id','run_attempt','head_sha'].map(k=>['observed','checks',0,k]),
  ...['artifact_id','producing_run_id','attempt'].map(k=>['observed','artifacts',0,k])
];
test('saved receipt identity fields reject JSON arrays and numbers despite regex-compatible coercion',()=>{
  for(const path of paths){
    const original=buildReceipt(fixture());
    let record=original.core;for(const part of path.slice(0,-1))record=record[part];
    const key=path.at(-1),value=record[key];
    for(const replacement of [[value],...( /^[0-9]+$/.test(value)?[Number(value)]:[])]){
      const receipt=parseStrictJson(JSON.stringify(original));
      let target=receipt.core;for(const part of path.slice(0,-1))target=target[part];
      target[key]=replacement;receipt.integrity.core_digest=computeCoreDigest(receipt.core);
      assert.throws(()=>verifyReceipt(receipt),{name:'TypeError'},path.join('.'));
    }
  }
  const receipt=buildReceipt(fixture());receipt.integrity.core_digest=[receipt.integrity.core_digest];
  assert.throws(()=>verifyReceipt(receipt),{code:'INVALID_INTEGRITY'});
});
test('target and builder enforce scalar ID/OID types before retaining malformed records',()=>{
  for(const [key,value] of [['repositoryId',['77']],['repositoryId',77],['expectedBaseSha',[a]],['expectedHeadSha',[b]]])
    assert.throws(()=>validateTarget({...fixture().target,[key]:value}),{code:'TARGET_INVALID'});
  for(const path of paths.filter(p=>p[0]==='observed')){
    const f=fixture();let record=path[1]==='changed_entries'?f.diff:f.evidence;
    const mapped=path[1]==='changed_entries'?path.slice(1):path;
    for(const part of mapped.slice(0,-1))record=record[part];
    record[mapped.at(-1)]=[record[mapped.at(-1)]];
    assert.throws(()=>buildReceipt(f),{name:'TypeError'},path.join('.'));
  }
});
test('digest rejects sparse arrays at any depth instead of colliding with empty arrays',()=>{
  for(const value of [new Array(1),[0,,1],{nested:new Array(1)},[new Array(1)]])
    assert.throws(()=>computeCoreDigest(value),{code:'SPARSE_CANONICAL_ARRAY'});
  const inherited=new Array(1);Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:'inherited'}));
  assert.throws(()=>computeCoreDigest(inherited),{code:'SPARSE_CANONICAL_ARRAY'});
  assert.throws(()=>computeCoreDigest([undefined]),{code:'NON_JCS_VALUE'});
  assert.equal(computeCoreDigest([]),computeCoreDigest(parseStrictJson('[]')));
});
test('receipt lists reject holes before validation and digest, including builder inputs',()=>{
  for(const path of [['observed','changed_entries'],['observed','checks'],['observed','artifacts'],['unknowns'],['inferred'],['validity','reasons']]){
    const receipt=buildReceipt(fixture());let record=receipt.core;for(const part of path.slice(0,-1))record=record[part];
    record[path.at(-1)]=new Array(1);
    assert.throws(()=>verifyReceipt(receipt),{code:'SPARSE_RECEIPT_LIST'});
    assert.throws(()=>renderTrustPrMarkdown(receipt),{code:'SPARSE_CANONICAL_ARRAY'});
  }
  const f=fixture();f.diff.changed_entries=new Array(1);
  assert.throws(()=>buildReceipt(f),{code:'SPARSE_RECEIPT_LIST'});
});
test('legitimate receipt survives JSON roundtrip with the same digest and authority boundaries',()=>{
  const receipt=buildReceipt(fixture()),parsed=parseStrictJson(JSON.stringify(receipt));
  assert.equal(computeCoreDigest(parsed.core),receipt.integrity.core_digest);
  assert.equal(renderTrustPrMarkdown(parsed),renderTrustPrMarkdown(receipt));
  assert.deepEqual(verifyReceipt(parsed),{status:'INTEGRITY_VALID',authenticity:'UNAUTHENTICATED',policy_binding:'POLICY_UNBOUND',merge_authorized:false});
});
