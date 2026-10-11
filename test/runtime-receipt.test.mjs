import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, verifyReceipt, snapshotIdentity } from '../src/receipt.mjs';
import { computeCoreDigest, renderTrustPrMarkdown } from '../src/human-renderer.mjs';
const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
export function fixture() {
  return {
    target:{owner:'acme',repo:'widget',prNumber:'42',expectedBaseSha:a,expectedHeadSha:b},
    evidence:{s0:{repository_id:'77',pull_request_number:'42',base_repository_id:'77',head_repository_id:'88',base_commit_sha:a,head_commit_sha:b},
      s1:{repository_id:'77',pull_request_number:'42',base_repository_id:'77',head_repository_id:'88',base_commit_sha:a,head_commit_sha:b},
      observed:{checks:[],artifacts:[]},validity:{status:'VALID',reasons:[]},collection_evidence:[]},
    diff:{status:'VALID',base_commit_sha:a,head_commit_sha:b,merge_base_sha:c,changed_entries:[],unknowns:[]}
  };
}
test('receipt binds typed subject, deterministic digest, unbound policy and unauthenticated origin',()=>{
  const r=buildReceipt(fixture());
  assert.equal(r.authenticity,'UNAUTHENTICATED');
  assert.equal(r.core.declared.policy_binding,'POLICY_UNBOUND');
  assert.equal(r.core.validity.status,'PARTIAL');
  assert.ok(r.core.unknowns.some(x=>x.stable_code==='TEST_EXECUTION_NOT_ESTABLISHED'));
  assert.equal(verifyReceipt(r).status,'INTEGRITY_VALID');
  assert.equal(buildReceipt(fixture()).integrity.core_digest,r.integrity.core_digest);
  assert.match(renderTrustPrMarkdown(r),/VALID does not mean safe to merge/);
});
test('snapshot typed tuple does not collide on concatenation-equivalent values',()=>{
  const subject={repository_id:'1',pull_request_number:'23',base_commit_sha:a,head_commit_sha:b,merge_base_sha:c};
  assert.notEqual(snapshotIdentity(subject),snapshotIdentity({...subject,repository_id:'12',pull_request_number:'3'}));
});

test('receipt exposes unknown artifact attempt instead of claiming the latest run attempt',()=>{
  const f=fixture();f.evidence.observed.artifacts=[{provider:'github',artifact_id:'60',producing_run_id:'40',attempt:null,retention_state:'available'}];
  const r=buildReceipt(f);
  assert.equal(r.core.validity.status,'PARTIAL');
  assert.equal(r.core.observed.artifacts[0].attempt,undefined);
  assert.ok(r.core.unknowns.some(x=>x.stable_code==='ARTIFACT_ATTEMPT_NOT_ESTABLISHED'&&x.field_or_source_tuple===JSON.stringify(['github','60'])));
  assert.equal(verifyReceipt(r).merge_authorized,false);
});

test('receipt leaves a correlated check attempt unknown without provider attempt evidence',()=>{
  const f=fixture();f.evidence.observed.checks=[{provider:'github',check_run_id:'10',workflow_run_id:'40',head_sha:b,status:'completed',conclusion:'success',run_attempt:null}];
  const r=buildReceipt(f);
  assert.equal(r.core.validity.status,'PARTIAL');
  assert.equal(r.core.observed.checks[0].run_attempt,undefined);
  assert.ok(r.core.unknowns.some(x=>x.stable_code==='CHECK_ATTEMPT_NOT_ESTABLISHED'));
  assert.equal(verifyReceipt(r).merge_authorized,false);
});
test('changed expected head and mismatched diff subject fail INVALID',()=>{
  const f=fixture();f.target.expectedHeadSha=c;assert.equal(buildReceipt(f).core.validity.status,'INVALID');
  const g=fixture();g.diff.head_commit_sha=c;assert.equal(buildReceipt(g).core.validity.status,'INVALID');
});
test('stale snapshot and missing diff evidence never become VALID',()=>{
  const f=fixture();f.evidence.s1.head_commit_sha=c;f.evidence.validity={status:'STALE',reasons:[{code:'SNAPSHOT_CHANGED'}]};
  assert.equal(buildReceipt(f).core.validity.status,'STALE');
  const g=fixture();g.diff={status:'PARTIAL',base_commit_sha:a,head_commit_sha:b,merge_base_sha:'',changed_entries:[],unknowns:[{stable_code:'COMMIT_UNAVAILABLE',field_or_source_tuple:'git'}]};
  assert.equal(buildReceipt(g).core.validity.status,'PARTIAL');
});
test('receipt rewrite plus recomputed digest does not upgrade authenticity; explicit upgrades rejected',()=>{
  const r=buildReceipt(fixture());r.core.observed.checks=[];r.integrity.core_digest=computeCoreDigest(r.core);
  assert.equal(verifyReceipt(r).status,'INTEGRITY_VALID');assert.equal(r.authenticity,'UNAUTHENTICATED');
  r.authenticity='CRYPTOGRAPHICALLY_VERIFIED';assert.throws(()=>verifyReceipt(r),/AUTHENTICITY/);
});
test('tampered receipt, snapshot identity, policy or unsafe record shape fails closed',()=>{
  const r=buildReceipt(fixture());r.core.subject.pull_request_number='43';
  assert.throws(()=>verifyReceipt(r));
  const p=buildReceipt(fixture());p.core.declared.policy_binding='BOUND';p.integrity.core_digest=computeCoreDigest(p.core);
  assert.throws(()=>verifyReceipt(p),/POLICY/);
});


test('receipt record insertion order does not affect digest validation',()=>{
  const f=fixture();f.evidence.observed.checks=[{provider:'github',check_run_id:'10',head_sha:b,status:'completed',conclusion:'success'}];
  const receipt=buildReceipt(f);
  receipt.core.observed.checks[0]=Object.fromEntries(Object.entries(receipt.core.observed.checks[0]).reverse());
  assert.equal(verifyReceipt(receipt).status,'INTEGRITY_VALID');
});

test('receipt preserves collection failure diagnostics without accepting provider error text',()=>{
  const f=fixture();
  f.evidence.validity={status:'PARTIAL',reasons:[{code:'COLLECTION_INCOMPLETE'}]};
  f.evidence.collection_evidence=[
    {collection_kind:'check_suites',complete:false,failure_code:'PROVIDER_RESPONSE_INVALID'},
    {collection_kind:'artifacts',complete:false,failure_code:'PERMISSION_DENIED'},
    {collection_kind:'workflow_runs',complete:false,failure_code:'raw provider error text'}
  ];
  const receipt=buildReceipt(f);
  const unknowns=receipt.core.unknowns;
  assert.ok(unknowns.some(item=>item.stable_code==='PROVIDER_RESPONSE_INVALID'&&item.field_or_source_tuple==='check_suites'));
  assert.ok(unknowns.some(item=>item.stable_code==='PERMISSION_DENIED'&&item.field_or_source_tuple==='artifacts'));
  assert.ok(unknowns.some(item=>item.stable_code==='GITHUB_COLLECTION_INCOMPLETE'&&item.field_or_source_tuple==='workflow_runs'));
  assert.equal(JSON.stringify(receipt).includes('raw provider error text'),false);
  assert.equal(verifyReceipt(receipt).status,'INTEGRITY_VALID');
  assert.ok(renderTrustPrMarkdown(receipt).includes('PROVIDER\\_RESPONSE\\_INVALID'));
});
