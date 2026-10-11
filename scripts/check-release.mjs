import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const MIT_BODY_SHA256='9471f26dd46801decd2525d1fd32b162c82e24c149f809428d2df875819e6c76';
export const REQUIRED_PACK_FILES=Object.freeze([
  'LICENSE','README.md','package.json','action.yml','bin/action.mjs','bin/trustpr.mjs',
  ...['action-setup','artifact-binding','artifact-bytes','check-selection','git-diff',
    'github-http-transport','github-read-adapter','github-rest-client','human-renderer',
    'product-falsifier','provenance-attestation','receipt','runtime','strict-json','test-execution']
    .map(name=>'src/'+name+'.mjs')
]);
function fail(code){throw Object.assign(new Error(code),{code});}
export function validateMitLicense(content){
  if(typeof content!=='string'||content.length>10000)fail('MIT_LICENSE_BODY_MISMATCH');
  if(/COPYRIGHT_HOLDER_MUST_BE_VERIFIED_AND_APPROVED|\[.*HOLDER.*\]/.test(content))fail('LICENSE_COPYRIGHT_HOLDER_NOT_VERIFIED');
  const ownerLine=/^Copyright \(c\) 2026 [^\r\n]+$/m;
  if(!ownerLine.test(content))fail('MIT_COPYRIGHT_LINE_INVALID');
  const holder=content.match(ownerLine)[0].slice('Copyright (c) 2026 '.length);
  if(!holder.trim()||/[\x00-\x1f\x7f]/.test(holder))fail('MIT_COPYRIGHT_LINE_INVALID');
  const normalized=content.replace(ownerLine,'Copyright (c) 2026 [COPYRIGHT_HOLDER_MUST_BE_VERIFIED_AND_APPROVED]');
  if(crypto.createHash('sha256').update(normalized).digest('hex')!==MIT_BODY_SHA256)fail('MIT_LICENSE_BODY_MISMATCH');
  return {body:'MIT',copyright_holder:holder,ownership_attested:false};
}
export function validatePackReport(data){
  if(!Array.isArray(data)||data.length!==1||!Array.isArray(data[0]?.files))fail('INVALID_PACK_REPORT');
  const names=data[0].files.map(f=>f.path);
  if(new Set(names).size!==names.length)fail('DUPLICATE_PACK_FILE');
  const required=REQUIRED_PACK_FILES;
  if(required.some(n=>!names.includes(n)))fail('REQUIRED_PACK_FILE_MISSING');
  for(const n of names){
    if(typeof n!=='string'||n.includes('..')||n.startsWith('/')||/[\\\x00-\x1f\x7f]/.test(n)||
      !required.includes(n))fail('UNEXPECTED_PACK_FILE');
  }
  return {files:names.length};
}
export async function checkRelease(root=path.resolve(import.meta.dirname,'..')){
  let license;try{license=await fs.readFile(path.join(root,'LICENSE'),'utf8');}catch{fail('LICENSE_MISSING');}
  const result=validateMitLicense(license);
  try{await fs.lstat(path.join(root,'RUNTIME_SOURCE_MANIFEST.json'));fail('INTERNAL_RUNTIME_MANIFEST_PRESENT');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  if(pkg.private!==true)fail('PRIVATE_CANDIDATE_REQUIRED');
  if(pkg.license!=='MIT')fail('MIT_PACKAGE_LICENSE_REQUIRED');
  if(Object.keys(pkg.bin??{}).length!==1||pkg.bin?.trustpr!=='bin/trustpr.mjs')fail('CLI_PACKAGE_ENTRYPOINT_INVALID');
  const lifecycle=['preinstall','install','postinstall','prepare','prepack','postpack',
    'prepublish','prepublishOnly','publish','postpublish'];
  if(lifecycle.some(key=>Object.hasOwn(pkg.scripts??{},key)))fail('UNREVIEWED_LIFECYCLE_SCRIPT');
  if(Object.keys(pkg.dependencies??{}).length||Object.keys(pkg.devDependencies??{}).length||
    Object.keys(pkg.optionalDependencies??{}).length||Object.keys(pkg.peerDependencies??{}).length)fail('UNREVIEWED_DEPENDENCIES');
  const packed=await promisify(execFile)('npm',['pack','--dry-run','--json','--ignore-scripts'],
    {cwd:root,timeout:30000,maxBuffer:2*1024*1024});
  return {...result,...validatePackReport(JSON.parse(packed.stdout)),publication_authorized:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  checkRelease().then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{
    const code=/^[A-Z][A-Z0-9_]+$/.test(e.code??'')?e.code:'RELEASE_GATE_FAILED';
    process.stderr.write('TrustPR: '+code+'\n');process.exitCode=1;
  });
}
