// Lane2: fail closed if the public no-terminal recipe drifts from released
// GitHub Action v0.1.0 inputs, outputs or read-only permissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
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
 assert.ok(yaml.includes('SamCT86/trustpr-action@3ac08375bed6380285fcfd8019cef0cb7931dda8'),
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
