import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {REQUIRED_PACK_FILES} from '../scripts/check-release.mjs';

const root=path.resolve(import.meta.dirname,'..');
const safeUrl='https://github.com/SamCT86/trustpr-action/blob/main/';

function brokenPackedLinks(markdown,packedFiles){
  // Scan ordinary Markdown links, excluding the fenced command examples.
  const prose=markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
  const hrefs=[...prose.matchAll(/\]\(([^\s)]+)(?:\s+["'][^"']+["'])?\)/g)].map(m=>m[1]);
  return hrefs.filter(href=>{
    if(/^(?:https?:\/\/|mailto:|#)/i.test(href))return false;
    if(/^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(href))return true;
    const filename=href.split(/[?#]/)[0].replace(/^\.\//,'');
    return !packedFiles.includes(filename);
  });
}

test('npm-packed README sends beginners to existing public docs, not missing local pages',async()=>{
  const readme=await fs.readFile(path.join(root,'README.md'),'utf8');
  assert.deepEqual(brokenPackedLinks(readme,REQUIRED_PACK_FILES),[]);
  for(const target of ['START-HERE.md','REAL-PUBLIC-EXAMPLE.md'])
    assert.ok(readme.includes(']('+safeUrl+target+')'),target);
});

test('guard catches broken local links while allowing a bundled file and a section anchor',()=>{
  assert.deepEqual(brokenPackedLinks(
    '[setup](START-HERE.md) [example](REAL-PUBLIC-EXAMPLE.md) [license](LICENSE) [details](#faq)',
    REQUIRED_PACK_FILES),['START-HERE.md','REAL-PUBLIC-EXAMPLE.md']);
});
