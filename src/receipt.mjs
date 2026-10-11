import { computeCoreDigest,renderTrustPrMarkdown } from './human-renderer.mjs';
import { assertScalarString } from './strict-json.mjs';

export const RUNTIME_VERSION='TRUSTPR_RUNTIME_REBASELINE_20261007_V1';
const OID=/^[0-9a-f]{40}$/;
const ID=/^[1-9][0-9]{0,19}$/;
const isId=value=>typeof value==='string'&&ID.test(value);
const isOid=value=>typeof value==='string'&&OID.test(value);
const STATES=new Set(['VALID','PARTIAL','STALE','INVALID']);
const SUBJECT=['base_commit_sha','head_commit_sha','merge_base_sha','pull_request_number','repository_id'];
const REQUIRED=['git_diff','github_metadata'];
function fail(code){throw Object.assign(new TypeError(code),{code});}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function closed(value,keys,code){
  if(!object(value)||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))fail(code);
}
function code(value){if(typeof value!=='string'||! /^[A-Z][A-Z0-9_]{0,79}$/.test(value))fail('INVALID_REASON_CODE');return value;}
function list(value){
  if(!Array.isArray(value)||value.length>10000)fail('RECEIPT_LIST_LIMIT');
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))fail('SPARSE_RECEIPT_LIST');
  return value;
}
function text(value){assertScalarString(value);if(Buffer.byteLength(value)>4096)fail('RECEIPT_STRING_LIMIT');return value;}
function record(codeValue,source){return{stable_code:code(codeValue),field_or_source_tuple:text(source)};}
export function validateTarget(target){
  if(!object(target))fail('TARGET_INVALID');
  for(const key of Object.keys(target))if(!['owner','repo','prNumber','expectedBaseSha','expectedHeadSha','repositoryId'].includes(key))fail('TARGET_INVALID');
  if(typeof target.owner!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(target.owner))fail('TARGET_INVALID');
  if(typeof target.repo!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(target.repo)||target.repo.includes('..'))fail('TARGET_INVALID');
  if(typeof target.prNumber!=='string'||!isId(target.prNumber)||!Number.isSafeInteger(Number(target.prNumber)))fail('TARGET_INVALID');
  for(const key of ['expectedBaseSha','expectedHeadSha'])if(target[key]!==undefined&&!isOid(target[key]))fail('TARGET_INVALID');
  if(target.repositoryId!==undefined&&!isId(target.repositoryId))fail('TARGET_INVALID');
  return target;
}
export function snapshotIdentity(subject){
  closed(subject,SUBJECT,'INVALID_SUBJECT_SHAPE');
  for(const key of SUBJECT)text(subject[key]);
  return computeCoreDigest(SUBJECT.map(key=>[key,subject[key]]));
}
function validateChanged(entry){
  closed(entry,['raw_path_b64','change_type','old_mode','new_mode','old_blob_sha','new_blob_sha'],'INVALID_CHANGED_ENTRY');
  if(typeof entry.raw_path_b64!=='string'||entry.raw_path_b64.length>8192)fail('INVALID_PATH_BASE64');
  const bytes=Buffer.from(entry.raw_path_b64,'base64');
  if(!bytes.length||bytes.length>4096||bytes.includes(0)||bytes.toString('base64')!==entry.raw_path_b64)fail('INVALID_PATH_BASE64');
  if(!['ADD','DELETE','MODIFY','TYPE_CHANGE'].includes(entry.change_type))fail('INVALID_CHANGE_TYPE');
  for(const key of ['old_mode','new_mode'])if(!['000000','100644','100755','120000','160000'].includes(entry[key]))fail('INVALID_GIT_MODE');
  for(const key of ['old_blob_sha','new_blob_sha'])if(!isOid(entry[key]))fail('INVALID_GIT_OID');
  return entry;
}
function selectedCheck(check,head){
  if(check?.provider!=='github'||!isId(check.check_run_id??'')||!isOid(check.head_sha??''))fail('INVALID_CHECK_RECORD');
  if(!['queued','in_progress','completed','pending','waiting','requested'].includes(check.status))fail('INVALID_CHECK_STATUS');
  if(check.conclusion!==null&&!['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure'].includes(check.conclusion))fail('INVALID_CHECK_CONCLUSION');
  const out={provider:'github',check_run_id:check.check_run_id,head_sha:check.head_sha,status:check.status,conclusion:check.conclusion,verification_state:'PROVIDER_ASSERTED'};
  for(const key of ['check_suite_id','workflow_run_id','run_attempt'])if(check[key]!==undefined&&check[key]!==null){
    if(!isId(check[key]))fail('INVALID_CHECK_ID');out[key]=check[key];
  }
  return out;
}
function selectedArtifact(artifact){
  if(artifact?.provider!=='github'||!isId(artifact.artifact_id??''))fail('INVALID_ARTIFACT_RECORD');
  const out={provider:'github',artifact_id:artifact.artifact_id,verification_state:'METADATA_ONLY'};
  for(const key of ['producing_run_id','attempt'])if(artifact[key]!==undefined&&artifact[key]!==null){
    if(!isId(artifact[key]))fail('INVALID_ARTIFACT_ID');out[key]=artifact[key];
  }
  if(!['available','expired'].includes(artifact.retention_state))fail('INVALID_ARTIFACT_RETENTION');
  out.retention_state=artifact.retention_state;
  if(typeof artifact.provider_digest==='string'&&/^sha256:[0-9a-f]{64}$/.test(artifact.provider_digest))out.provider_digest=artifact.provider_digest;
  return out;
}
export function buildReceipt({target,evidence,diff,source='GITHUB_READONLY'}){
  validateTarget(target);
  if(!['GITHUB_READONLY','SYNTHETIC_DEMO'].includes(source))fail('EVIDENCE_SOURCE_INVALID');
  if(!object(evidence)||!object(evidence.validity)||!STATES.has(evidence.validity.status))fail('EVIDENCE_INVALID');
  const s0=evidence.s0,s1=evidence.s1;
  const subject={repository_id:s0?.repository_id??target.repositoryId??'',pull_request_number:target.prNumber,
    base_commit_sha:s0?.base_commit_sha??target.expectedBaseSha??'',head_commit_sha:s0?.head_commit_sha??target.expectedHeadSha??'',
    merge_base_sha:diff?.merge_base_sha??''};
  const reasons=list(evidence.validity.reasons??[]).map(reason=>({code:code(reason.code)}));
  let invalid=evidence.validity.status==='INVALID',stale=evidence.validity.status==='STALE';
  const unknowns=[record('TEST_EXECUTION_NOT_ESTABLISHED','checks')];
  if(!s0||!s1)unknowns.push(record('SNAPSHOT_NOT_COMPLETE','github_snapshot'));
  if(s0){
    if(!isId(s0.repository_id)||s0.repository_id!==s0.base_repository_id||s0.pull_request_number!==target.prNumber||
      !isOid(s0.base_commit_sha)||!isOid(s0.head_commit_sha))invalid=true;
    if((target.repositoryId&&s0.repository_id!==target.repositoryId)||(target.expectedBaseSha&&s0.base_commit_sha!==target.expectedBaseSha)||
      (target.expectedHeadSha&&s0.head_commit_sha!==target.expectedHeadSha)){invalid=true;reasons.push({code:'REQUEST_SUBJECT_MISMATCH'});}
  }
  if(s0&&s1&&['repository_id','pull_request_number','base_repository_id','head_repository_id','base_commit_sha','head_commit_sha'].some(key=>s0[key]!==s1[key])){
    stale=true;reasons.push({code:'SNAPSHOT_CHANGED'});
  }
  if(!diff||!['VALID','PARTIAL','INVALID'].includes(diff.status))fail('DIFF_RESULT_INVALID');
  if(diff.status==='INVALID')invalid=true;
  if(diff.base_commit_sha!==subject.base_commit_sha||diff.head_commit_sha!==subject.head_commit_sha){invalid=true;reasons.push({code:'DIFF_SUBJECT_MISMATCH'});}
  if(diff.status!=='VALID')unknowns.push(record('GIT_DIFF_NOT_COMPLETE','git_diff'));
  for(const entry of list(diff.unknowns??[]))unknowns.push(record(entry.stable_code,entry.field_or_source_tuple));
  const changed=list(diff.changed_entries??[]).map(validateChanged);
  const checks=list(evidence.observed?.checks??[]).map(check=>selectedCheck(check,subject.head_commit_sha));
  if(checks.some(check=>check.head_sha!==subject.head_commit_sha)){invalid=true;reasons.push({code:'CHECK_HEAD_MISMATCH'});}
  for(const check of checks)if(check.workflow_run_id&&check.run_attempt===undefined)
    unknowns.push(record('CHECK_ATTEMPT_NOT_ESTABLISHED',JSON.stringify(['github',check.check_run_id])));
  const artifacts=list(evidence.observed?.artifacts??[]).map(selectedArtifact);
  for(const artifact of artifacts){
    const source=JSON.stringify(['github',artifact.artifact_id]);
    unknowns.push(record('ARTIFACT_BYTES_NOT_RETRIEVED',source));
    if(artifact.attempt===undefined)unknowns.push(record('ARTIFACT_ATTEMPT_NOT_ESTABLISHED',source));
  }
  for(const entry of list(evidence.collection_evidence??[]))if(entry.complete===false){
    const source=String(entry.collection_kind??'github');
    unknowns.push(record('GITHUB_COLLECTION_INCOMPLETE',source));
    if(typeof entry.failure_code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(entry.failure_code))
      unknowns.push(record(entry.failure_code,source));
  }
  if(!isOid(subject.merge_base_sha))unknowns.push(record('MERGE_BASE_UNAVAILABLE','git_diff'));
  const status=invalid?'INVALID':stale?'STALE':unknowns.length||evidence.validity.status==='PARTIAL'||diff.status!=='VALID'?'PARTIAL':'VALID';
  if(status==='PARTIAL'&&!reasons.length)reasons.push({code:'EVIDENCE_NOT_COMPLETE'});
  const uniqueReasons=[...new Map(reasons.map(r=>[r.code,r])).values()].sort((a,b)=>a.code.localeCompare(b.code,'en'));
  const uniqueUnknowns=[...new Map(unknowns.map(r=>[JSON.stringify(r),r])).values()].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  const core={subject,snapshot_identity:snapshotIdentity(subject),
    declared:{policy_binding:'POLICY_UNBOUND',required_evidence:[...REQUIRED],evidence_source:source,runtime_version:RUNTIME_VERSION},
    observed:{changed_entries:changed,checks,artifacts},unknowns:uniqueUnknowns,inferred:[],validity:{status,reasons:uniqueReasons}};
  const receipt={receipt_schema_version:'trustpr-receipt-v1',authenticity:'UNAUTHENTICATED',integrity:{algorithm:'sha256',core_digest:computeCoreDigest(core)},core};
  verifyReceipt(receipt);return receipt;
}
export function verifyReceipt(receipt){
  closed(receipt,['receipt_schema_version','authenticity','integrity','core'],'INVALID_RECEIPT_SHAPE');
  if(receipt.receipt_schema_version!=='trustpr-receipt-v1')fail('UNSUPPORTED_RECEIPT_SCHEMA');
  if(receipt.authenticity!=='UNAUTHENTICATED')fail('AUTHENTICITY_NOT_SUPPORTED');
  closed(receipt.integrity,['algorithm','core_digest'],'INVALID_INTEGRITY');
  if(receipt.integrity.algorithm!=='sha256'||typeof receipt.integrity.core_digest!=='string'||! /^[0-9a-f]{64}$/.test(receipt.integrity.core_digest))fail('INVALID_INTEGRITY');
  const core=receipt.core;
  closed(core,['subject','snapshot_identity','declared','observed','unknowns','inferred','validity'],'INVALID_CORE_SHAPE');
  closed(core.subject,SUBJECT,'INVALID_SUBJECT_SHAPE');
  if(!isId(core.subject.pull_request_number))fail('INVALID_PR_NUMBER');
  if(core.subject.repository_id!==''&&!isId(core.subject.repository_id))fail('INVALID_REPOSITORY_ID');
  for(const key of ['base_commit_sha','head_commit_sha','merge_base_sha'])if(core.subject[key]!==''&&!isOid(core.subject[key]))fail('INVALID_SUBJECT_OID');
  if(core.snapshot_identity!==snapshotIdentity(core.subject))fail('SNAPSHOT_IDENTITY_MISMATCH');
  closed(core.declared,['policy_binding','required_evidence','evidence_source','runtime_version'],'INVALID_DECLARED');
  if(core.declared.policy_binding!=='POLICY_UNBOUND')fail('POLICY_BINDING_NOT_SUPPORTED');
  if(JSON.stringify(core.declared.required_evidence)!==JSON.stringify(REQUIRED)||!['GITHUB_READONLY','SYNTHETIC_DEMO'].includes(core.declared.evidence_source)||
    core.declared.runtime_version!==RUNTIME_VERSION)fail('INVALID_DECLARED');
  closed(core.observed,['changed_entries','checks','artifacts'],'INVALID_OBSERVED');
  list(core.observed.changed_entries).forEach(validateChanged);
  for(const check of list(core.observed.checks)){
    const selected=selectedCheck(check,core.subject.head_commit_sha);
    if(computeCoreDigest(selected)!==computeCoreDigest(check))fail('INVALID_CHECK_SHAPE');
    if(check.head_sha!==core.subject.head_commit_sha&&core.validity.status!=='INVALID')fail('CHECK_HEAD_MISMATCH');
  }
  for(const artifact of list(core.observed.artifacts))if(computeCoreDigest(selectedArtifact(artifact))!==computeCoreDigest(artifact))fail('INVALID_ARTIFACT_SHAPE');
  for(const entry of [...list(core.unknowns),...list(core.inferred)]){
    closed(entry,['stable_code','field_or_source_tuple'],'INVALID_FINDING_SHAPE');code(entry.stable_code);text(entry.field_or_source_tuple);
  }
  closed(core.validity,['status','reasons'],'INVALID_VALIDITY');
  if(!STATES.has(core.validity.status))fail('INVALID_VALIDITY_STATUS');
  for(const reason of list(core.validity.reasons)){closed(reason,['code'],'INVALID_REASON_SHAPE');code(reason.code);}
  if(core.validity.status==='VALID'&&(core.unknowns.length||SUBJECT.some(key=>core.subject[key]==='')))fail('VALID_WITH_UNKNOWN_EVIDENCE');
  if(computeCoreDigest(core)!==receipt.integrity.core_digest)fail('CORE_DIGEST_MISMATCH');
  renderTrustPrMarkdown(receipt);
  return {status:'INTEGRITY_VALID',authenticity:'UNAUTHENTICATED',policy_binding:'POLICY_UNBOUND',merge_authorized:false};
}
