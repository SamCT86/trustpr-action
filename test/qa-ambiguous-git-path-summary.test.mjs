import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReceipt,verifyReceipt} from '../src/receipt.mjs';
import {renderTrustPrMarkdown,computeCoreDigest} from '../src/human-renderer.mjs';
import {renderActionStepSummary} from '../bin/action.mjs';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const target={owner:'example',repo:'repo',prNumber:'10',repositoryId:'100',expectedBaseSha:A,expectedHeadSha:B};
const snapshot={repository_id:'100',base_repository_id:'100',head_repository_id:'100',
  pull_request_number:'10',base_commit_sha:A,head_commit_sha:B};
function make(path){
  const diff={status:'VALID',base_commit_sha:A,head_commit_sha:B,merge_base_sha:C,
    changed_entries:[{raw_path_b64:Buffer.from(path,'utf8').toString('base64'),
      change_type:'ADD',old_mode:'000000',new_mode:'100644',
      old_blob_sha:'0'.repeat(40),new_blob_sha:D}],unknowns:[]};
  const evidence={s0:snapshot,s1:snapshot,observed:{checks:[],artifacts:[]},
    collection_evidence:[],validity:{status:'PARTIAL',reasons:[{code:'TEST_EXECUTION_NOT_ESTABLISHED'}]}};
  return buildReceipt({target,diff,evidence});
}
for(const [label,gitPath,warn] of [
  ['ASCII','README.md',false],
  ['accented UTF-8','résumé.md',false],
  ['emoji','🐳.md',false],
  ['Mongolian vowel separator','README\u180e.md',true],
  ['Hangul filler','README\u3164.md',true],
  ['Hangul jungseong filler','README\u1160.md',true],
  ['zero-width joiner','README\u200d.md',true],
  ['BOM','README\ufeff.md',true],
  ['combining grapheme joiner','README\u034f.md',true],
  ['Unicode line separator','README\u2028.md',true],
  ['Unicode paragraph separator','README\u2029.md',true]
]){
  test('Action filename caution: '+label,()=>{
    const receipt=make(gitPath),before=structuredClone(receipt.core);
    const digest=receipt.integrity.core_digest;
    const canonical=renderTrustPrMarkdown(receipt);
    const interactive=renderActionStepSummary(receipt,canonical);
    assert.equal(interactive.includes('**Filename caution:**'),warn);
    assert.match(interactive,/\*\*Result: PARTIAL\.\*\*/);
    assert.match(interactive,/counts are not test results/);
    assert.match(interactive,/GitHub checks can include TrustPR itself/);
    assert.match(interactive,/TrustPR never authorizes merging/);
    if(warn)assert.ok(interactive.includes('raw_path_b64'));
    assert.ok(interactive.includes(canonical.trimEnd()));
    assert.deepEqual(receipt.core,before);
    assert.equal(receipt.integrity.core_digest,digest);
    assert.equal(verifyReceipt(receipt).merge_authorized,false);
    assert.equal(renderTrustPrMarkdown(receipt),canonical);
  });
}
test('sparse test-only receipt retains previous Step Summary behavior',()=>{
  const synthetic={core:{validity:{status:'PARTIAL'},observed:{changed_entries:[{}],checks:[]}}};
  assert.doesNotMatch(renderActionStepSummary(synthetic,'# canonical\n'),/Filename caution/);
});
test('more than one ambiguous changed path is counted without changing evidence',()=>{
  const receipt=make('a\u180e.md');
  receipt.core.observed.changed_entries.push({
    ...receipt.core.observed.changed_entries[0],
    raw_path_b64:Buffer.from('b\u3164.md').toString('base64')
  });
  receipt.integrity.core_digest=computeCoreDigest(receipt.core);
  const canonical=renderTrustPrMarkdown(receipt);
  assert.match(renderActionStepSummary(receipt,canonical),/2 changed paths contain/);
  assert.equal(verifyReceipt(receipt).merge_authorized,false);
});
