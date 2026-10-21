// Lane2: fail closed if the public no-terminal recipe drifts from released
// GitHub Action v0.1.1 inputs, outputs or read-only permissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
function assertSafeBeginnerWorkflow(yaml){
 // Bound actual executable steps and pin their exact trusted Actions.
 assert.equal((yaml.match(/^ {6}-\s+/gm)||[]).length,2,'only the Action and artifact uploader steps');
 assert.doesNotMatch(yaml,/^\s*(?:-\s*)?(?:run|shell|pull_request_target|workflow_run):/m);
 assert.doesNotMatch(yaml,/^\s*[\w-]+:\s*write\s*$/m,'no write-granted token scopes');
 assert.doesNotMatch(yaml,/^\s*permissions:\s*write-all\s*$/m,'no write-all shortcut');
 assert.doesNotMatch(yaml,/^ {4}permissions:/m,'no job-level permissions override');
 assert.match(yaml,/^ {4}runs-on: ubuntu-latest$/m);
 assert.match(yaml,/^ {4}timeout-minutes: 10$/m);
 assert.match(yaml,/^ {8}uses: SamCT86\/trustpr-action@95d913eccbce6ccb547c293deaa8711272148e93$/m);
 assert.match(yaml,/^ {8}uses: actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f$/m);
}

test('published beginner guide gives one usable PR workflow with no shell or write permission',async()=>{
 const source=await fs.readFile(path.join(root,'START-HERE.md'),'utf8');
 const samples=[...source.matchAll(/```yaml\n([\s\S]*?)\n```/g)];
 assert.equal(samples.length,1,'exactly one unambiguous copy/paste workflow');
 const yaml=samples[0][1];
 assert.match(yaml,/^name: TrustPR receipt\n/);
 assert.match(yaml,/^on:\n  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]/m);
 for(const line of ['actions: read','checks: read','contents: read','pull-requests: read'])
  assert.ok(yaml.includes('  '+line+'\n'),'required read-only '+line);
 assert.doesNotMatch(yaml,/^\s*(?:id-token|issues|deployments|contents|packages|pull-requests): write\s*$/m);
 assert.doesNotMatch(yaml,/^\s*(?:run|shell|pull_request_target|workflow_run):/m);
 assert.equal((yaml.match(/\buses: /g)||[]).length,2,'Action + uploader only');
 assertSafeBeginnerWorkflow(yaml);
 assert.ok(yaml.includes('SamCT86/trustpr-action@95d913eccbce6ccb547c293deaa8711272148e93'),
  'pinned public prerelease SHA required');
 assert.ok(yaml.includes('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'),
  'pinned official uploader required');
 assert.ok(yaml.includes('always() && steps.receipt.outputs.receipt-path !='),
  'must save receipts even on intentional INVALID/STALE status');
 assert.ok(yaml.includes('if-no-files-found: error'));
 assert.ok(yaml.includes('retention-days: 7'));
 assert.ok(yaml.includes('github.event.pull_request.base.sha'));
 assert.ok(yaml.includes('github.event.pull_request.head.sha'));
 assert.ok(yaml.includes('steps.receipt.outputs.receipt-path'));
 assert.ok(yaml.includes('steps.receipt.outputs.summary-path'));
 assert.ok(source.includes('free')||source.includes('Free'));
 assert.ok(source.includes('not a pass')||source.includes('not a merge')||source.includes('not an automatic'));
 assert.ok(source.includes('UNAUTHENTICATED')&&source.includes('POLICY_UNBOUND'));
});
test('beginner workflow guard rejects unsafe substitutions and extra executable steps',async()=>{
 const source=await fs.readFile(path.join(root,'START-HERE.md'),'utf8');
 const yaml=[...source.matchAll(/```yaml\n([\s\S]*?)\n```/g)][0][1];
 const invalid=[
  ['extra shell step',yaml.replace('    steps:\n','    steps:\n      - run: echo unsafe\n')],
  ['extra shell key',yaml.replace('    steps:\n','    steps:\n      - shell: bash\n')],
  ['job permissions escalation',yaml.replace('  trustpr:\n','  trustpr:\n    permissions: write-all\n')],
  ['workflow permissions escalation',yaml.replace('  contents: read\n','  contents: write\n')],
  ['self-hosted runner',yaml.replace('runs-on: ubuntu-latest','runs-on: self-hosted')],
  ['unbounded timeout',yaml.replace('timeout-minutes: 10','timeout-minutes: 360')],
  ['substituted Action',yaml.replace('SamCT86/trustpr-action@95d913eccbce6ccb547c293deaa8711272148e93','attacker/action@95d913eccbce6ccb547c293deaa8711272148e93')],
  ['unpinned uploader',yaml.replace('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f','actions/upload-artifact@v4')],
  ['wrong trigger',yaml.replace('  pull_request:','  workflow_run:')]
 ];
 assertSafeBeginnerWorkflow(yaml);
 for(const [scenario,mutated] of invalid){
  assert.notEqual(mutated,yaml,'test mutation must change the actual recipe: '+scenario);
  assert.throws(()=>assertSafeBeginnerWorkflow(mutated),{name:'AssertionError'},scenario);
 }
});

test('newcomer recipe names only the actual Action input/output public contract',async()=>{
 const guide=await fs.readFile(path.join(root,'START-HERE.md'),'utf8');
 const manifest=await fs.readFile(path.join(root,'action.yml'),'utf8');
 for(const input of ['repository','pull-request-number','base-sha','head-sha'])
  assert.match(manifest,new RegExp('^  '+input+':$','m'),'GitHub Action input '+input);
 for(const output of ['receipt-path','summary-path'])
  assert.match(manifest,new RegExp('^  '+output+':$','m'),'GitHub Action output '+output);
 for(const input of ['repository','pull-request-number','base-sha','head-sha'])
  assert.ok(guide.includes('          '+input+':'),'documented input '+input);
 for(const output of ['receipt-path','summary-path'])
  assert.ok(guide.includes('steps.receipt.outputs.'+output),'documented output '+output);
});
