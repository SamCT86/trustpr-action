import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReceipt,verifyReceipt} from '../src/receipt.mjs';
import {renderTrustPrMarkdown,verifyTrustPrMarkdown} from '../src/human-renderer.mjs';

test('leading UTF-8 BOM is a filename character and remains visibly distinct in the summary',()=>{
  const a='a'.repeat(40),b='b'.repeat(40),snapshot={repository_id:'77',pull_request_number:'42',base_repository_id:'77',head_repository_id:'88',base_commit_sha:a,head_commit_sha:b};
  const paths=['safe.txt','\ufeffsafe.txt','\ufeff','dir/\ufeffsafe.txt','\\ufeffsafe.txt'];
  const receipt=buildReceipt({target:{owner:'acme',repo:'widget',prNumber:'42'},evidence:{s0:snapshot,s1:{...snapshot},validity:{status:'VALID',reasons:[]},observed:{checks:[],artifacts:[]}},diff:{status:'VALID',base_commit_sha:a,head_commit_sha:b,merge_base_sha:a,changed_entries:paths.map(path=>({raw_path_b64:Buffer.from(path).toString('base64'),change_type:'MODIFY',old_mode:'100644',new_mode:'100644',old_blob_sha:a,new_blob_sha:b})),unknowns:[]}});
  const summary=renderTrustPrMarkdown(receipt);
  const changed=summary.split('## Changed entries\n')[1].split('\n## Checks')[0].trim().split('\n');
  assert.equal(new Set(changed).size,paths.length);
  assert.equal(changed[0],'- safe\\.txt — MODIFY');
  assert.equal(changed[1],'- \\\\ufeffsafe\\.txt (raw_path_b64=77u/c2FmZS50eHQ=) — MODIFY');
  assert.equal(changed[2],'- \\\\ufeff (raw_path_b64=77u/) — MODIFY');
  assert.equal(changed[4],'- \\\\ufeffsafe\\.txt — MODIFY');
  assert.equal(summary.includes('\ufeff'),false);
  assert.deepEqual(receipt.core.observed.changed_entries.map(e=>Buffer.from(e.raw_path_b64,'base64').toString('utf8')),paths);
  assert.equal(verifyReceipt(receipt).status,'INTEGRITY_VALID');
  assert.equal(verifyTrustPrMarkdown(receipt,summary).status,'MATCH');
});
