import test from 'node:test';
import assert from 'node:assert/strict';
import {bindArtifactsToRuns} from '../src/artifact-binding.mjs';
import {selectLogicalChecks} from '../src/check-selection.mjs';
import {deriveTestExecutionEvidence} from '../src/test-execution.mjs';

const head='a'.repeat(40);
const run={provider:'github',workflow_run_id:'opaque/run:1',run_attempt:'1',head_sha:head};
const artifact={provider:'github',artifact_id:'artifact-1',producing_run_id:run.workflow_run_id,attempt:'1',retention_state:'available'};
const check={...run,immutable_workflow_identity:'workflow-1',logical_job_identity:'unit',check_run_id:'check-1',
  app_identity:'actions',status:'completed',conclusion:'success'};
const execution={...run,check_run_id:check.check_run_id,command:'npm test',exit_code:'0',evidence_id:'opaque/evidence:1'};

test('contradictory duplicate run identities remain unknown in either order and after extra duplicate',()=>{
  for(const conflict of [{...run,head_sha:'b'.repeat(40)},{...run,check_suite_id:'different-suite'}]) {
    const expected=bindArtifactsToRuns([artifact],[run,conflict],head);
    assert.equal(expected.partial,true);
    assert.equal(expected.items[0].verification_state,'UNKNOWN');
    assert.equal(expected.items[0].reason,'PRODUCING_RUN_AMBIGUOUS');
    assert.deepEqual(bindArtifactsToRuns([artifact],[conflict,run],head),expected);
    assert.deepEqual(bindArtifactsToRuns([artifact],[run,conflict,run],head),expected);
  }
});

test('identical duplicate run identities deduplicate despite object key order',()=>{
  const reordered=Object.fromEntries(Object.entries(run).reverse());
  assert.deepEqual(bindArtifactsToRuns([artifact],[run,reordered],head),bindArtifactsToRuns([artifact],[run],head));
  assert.equal(bindArtifactsToRuns([artifact],[run,reordered],head).partial,false);
});

test('artifact binding rejects missing and coercible identities on artifacts and runs independently',()=>{
  const invalid=[undefined,null,'',' ',[],['github'],{}, {toString:()=> 'github'}, 1,true];
  for(const value of invalid) {
    for(const field of ['provider','producing_run_id','attempt','artifact_id']) {
      const out=bindArtifactsToRuns([{...artifact,[field]:value}],[run],head);
      assert.equal(out.partial,true,`artifact ${field}`);
      assert.equal(out.items[0].verification_state,'UNKNOWN',`artifact ${field}`);
    }
    for(const field of ['provider','workflow_run_id','run_attempt','head_sha']) {
      const out=bindArtifactsToRuns([artifact],[{...run,[field]:value}],head);
      assert.equal(out.partial,true,`run ${field}`);
      assert.equal(out.items[0].verification_state,'UNKNOWN',`run ${field}`);
    }
    const out=bindArtifactsToRuns([artifact],[run],value);
    assert.equal(out.partial,true);
    assert.equal(out.items[0].verification_state,'UNKNOWN');
  }
});

test('matching invalid artifact and run identity cannot alias into an immutable binding',()=>{
  for(const value of [undefined,null,'',[],{},1]) {
    const out=bindArtifactsToRuns([{...artifact,provider:value,producing_run_id:value}],
      [{...run,provider:value,workflow_run_id:value}],head);
    assert.equal(out.partial,true);
    assert.equal(out.items[0].verification_state,'UNKNOWN');
  }
  for(const value of [undefined,null,[],Object.assign([],{...artifact}),1,'artifact']) {
    const out=bindArtifactsToRuns([value],[run],head);
    assert.equal(out.partial,true);
    assert.equal(out.items[0].verification_state,'UNKNOWN');
  }
  for(const value of [undefined,null,[],Object.assign([],{...run}),1,'run']) {
    const out=bindArtifactsToRuns([artifact],[value],head);
    assert.equal(out.partial,true);
    assert.equal(out.items[0].verification_state,'UNKNOWN');
  }
});

test('missing run head blocks its tuple even beside a valid duplicate in either order',()=>{
  const invalid={...run,head_sha:null};
  const expected=bindArtifactsToRuns([artifact],[run,invalid],head);
  assert.equal(expected.partial,true);
  assert.equal(expected.items[0].reason,'PRODUCING_RUN_IDENTITY_INVALID');
  assert.deepEqual(bindArtifactsToRuns([artifact],[invalid,run],head),expected);
  assert.equal(bindArtifactsToRuns([artifact],[run],head).items[0].verification_state,'IMMUTABLE_ID_MATCH');
});

test('separate producing runs never rank by attempt, for equal or differing conclusions',()=>{
  for(const conclusion of ['success','failure']) {
    const first={...check,run_attempt:'2'};
    const second={...check,workflow_run_id:'other-run',check_run_id:'check-2',conclusion};
    for(const items of [[first,second],[second,first]]) {
      const selected=selectLogicalChecks(items,head);
      assert.equal(selected.groups[0].state,'AMBIGUOUS');
      assert.equal(selected.groups[0].selected,null);
      assert.equal(selected.partial,true);
    }
  }
});

test('multiple attempts with missing run identity cannot establish attempt ordering',()=>{
  for(const workflow_run_id of [undefined,null,'',' ']) {
    const selected=selectLogicalChecks([
      {...check,workflow_run_id},
      {...check,workflow_run_id,run_attempt:'2',check_run_id:'check-2'}
    ],head);
    assert.equal(selected.groups[0].state,'AMBIGUOUS');
    assert.equal(selected.partial,true);
  }
});

test('within one opaque run, exact integer attempt ordering and historical retention remain valid',()=>{
  const items=[{...check,conclusion:'failure'},{...check,run_attempt:'9007199254740993',check_run_id:'check-2'}];
  const selected=selectLogicalChecks(items,head);
  assert.equal(selected.groups[0].state,'SATISFIABLE');
  assert.equal(selected.groups[0].selected.run_attempt,'9007199254740993');
  assert.equal(selected.groups[0].attempts.length,2);
  assert.equal(selected.partial,false);
});

test('execution requires established identities and payload before observation',()=>{
  for(const field of ['provider','workflow_run_id','run_attempt','head_sha','check_run_id','command','evidence_id']) {
    for(const value of [undefined,null,'',' ']) {
      const evidence={...execution,[field]:value};
      const subject={...check};
      if(['provider','workflow_run_id','run_attempt','head_sha','check_run_id'].includes(field)) subject[field]=value;
      const result=deriveTestExecutionEvidence([subject],[evidence],head)[0];
      assert.equal(result.state,'UNKNOWN',field+':'+String(value));
      assert.equal('command' in result,false);
    }
  }
  for(const exit_code of [undefined,null,'','zero','0.0','01',false,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(deriveTestExecutionEvidence([check],[{...execution,exit_code}],head)[0].state,'UNKNOWN');
  }
  assert.equal(deriveTestExecutionEvidence([check],[{...execution,head_sha:'not-a-head'}],'not-a-head')[0].state,'UNKNOWN');
});

test('execution match remains exact in provider/run/attempt/head, with valid integer payloads',()=>{
  for(const field of ['provider','workflow_run_id','run_attempt','head_sha','check_run_id']) {
    const value=field==='head_sha'?'b'.repeat(40):field==='run_attempt'?'2':'other';
    assert.equal(deriveTestExecutionEvidence([check],[{...execution,[field]:value}],head)[0].state,'UNKNOWN');
  }
  for(const exit_code of ['0','1',0,1,-1,'-1']) {
    const out=deriveTestExecutionEvidence([check],[{...execution,exit_code}],head)[0];
    assert.equal(out.state,'OBSERVED');
    assert.equal(out.exit_code,exit_code);
    assert.equal(out.evidence_id,execution.evidence_id);
  }
});
