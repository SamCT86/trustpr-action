import test from 'node:test';
import assert from 'node:assert/strict';
import {renderActionStepSummary} from '../bin/action.mjs';

function fixture(status='PARTIAL', files=[], checks=[], unknowns=[]){
  return {core:{validity:{status},observed:{changed_entries:files,checks},unknowns}};
}

test('an unavailable Git diff never presents zero as a complete PR total',()=>{
  const summary=renderActionStepSummary(fixture('PARTIAL',[],[],[
    {stable_code:'GIT_DIFF_NOT_COMPLETE'}
  ]),'# Unchanged V1 summary\n');
  assert.match(summary,/0 changed files observed/);
  assert.match(summary,/0 GitHub check records observed/);
  assert.match(summary,/not completeness claims or test results/);
  assert.doesNotMatch(summary,/0 changed files and 0 GitHub check records/);
  assert.match(summary,/never authorizes merging/);
});

test('missing provider checks remain zero observed, not zero actual',()=>{
  const summary=renderActionStepSummary(fixture('PARTIAL',[{}],[],[
    {stable_code:'GITHUB_COLLECTION_INCOMPLETE'}
  ]),'# Unchanged V1 summary\n');
  assert.match(summary,/1 changed file observed/);
  assert.match(summary,/0 GitHub check records observed/);
  assert.match(summary,/not completeness claims/);
});

test('complete empty diff is accurately expressed as zero observed',()=>{
  const summary=renderActionStepSummary(fixture('VALID'), '# Unchanged V1 summary\n');
  assert.match(summary,/\*\*Result: VALID\.\*\*/);
  assert.match(summary,/0 changed files observed and 0 GitHub check records observed/);
  assert.match(summary,/not completeness claims/);
});

test('nonzero records and collector check are not proof tests executed',()=>{
  const summary=renderActionStepSummary(fixture('PARTIAL',[{},{}],[{}]),'# Unchanged V1 summary\n');
  assert.match(summary,/2 changed files observed and 1 GitHub check record observed/);
  assert.match(summary,/GitHub checks can include TrustPR itself/);
  assert.match(summary,/That tests ran/);
  assert.doesNotMatch(summary,/all tests passed/);
});

test('all statuses retain meaning and unknown status is rejected',()=>{
  for(const status of ['VALID','PARTIAL','STALE','INVALID']){
    const summary=renderActionStepSummary(fixture(status,[{}],[{}]),'# Unchanged V1 summary\n');
    assert.match(summary,new RegExp('\\*\\*Result: '+status+'\\.\\*\\*'));
    assert.match(summary,/no team-approval policy/);
    assert.match(summary,/# Unchanged V1 summary/);
  }
  assert.throws(()=>renderActionStepSummary(fixture('APPROVED'),'# never'),e=>e.code==='ACTION_SUMMARY_STATUS_INVALID');
});
