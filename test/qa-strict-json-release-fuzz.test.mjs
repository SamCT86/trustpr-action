// Independent MIKE Lane 2 reproducible E1 strict-JSON parser QA.
// No GitHub network, PR code execution, billing, owner code edits or release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJson} from '../src/strict-json.mjs';

function seedRandom(seed=0x5f3759df){
 let x=seed;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
}
const adversarialStrings=['abc','','quotes"','backslash\\','U+2028\u2028','surrogate😀','<script>',
 '../../evil','__proto__','constructor','a\u0000b'];
test('12,000 seeded canonical integer JSON graphs survive parser exactly (includes proto and Unicode)',()=>{
 const next=seedRandom(),choose=values=>values[next()%values.length];
 function value(depth=0){
  const family=depth>4?next()%4:next()%6;
  if(family===0)return(next()%200000)-100000;
  if(family===1)return choose(adversarialStrings);
  if(family===2)return !!(next()%2);
  if(family===3)return null;
  if(family===4)return Array.from({length:next()%5},()=>value(depth+1));
  const obj=Object.create(null);
  for(let i=0,n=next()%5;i<n;i++)obj[choose(adversarialStrings)+i]=value(depth+1);
  return obj;
 }
 for(let i=0;i<12000;i++){
  const encoded=JSON.stringify(value());
  const parsed=parseStrictJson(encoded);
  assert.equal(JSON.stringify(parsed),encoded,'fuzz case '+i);
 }
});
test('invalid JSON, unsafe numbers, duplicate keys and malformed UTF-8 are always rejected',()=>{
 const hostile=[
  '{"a":1,"a":2}','{"__proto__":0,"__proto__":1}',
  '[1,]','{"a":1,}','01','-01','1.01','0e3','NaN','Infinity',
  '[1,,2]','"\\ud800"','"\\udc00"','{"a":1} trailing','nullnull',
  '/* comment */ null','[true false]',
  '{"x":9007199254740992}','{"x":-9007199254740992}'
 ];
 for(const source of hostile)assert.throws(()=>parseStrictJson(source),undefined,source);
 for(const bytes of [
  Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),
  Buffer.from([0xff]),Buffer.from([0xe2,0x82]),Buffer.from([0x00])
 ])assert.throws(()=>parseStrictJson(bytes),undefined,bytes.toString('hex'));
 assert.throws(()=>parseStrictJson(' '.repeat(8*1024*1024+1)),/JSON_BYTE_LIMIT/);
 assert.throws(()=>parseStrictJson('['.repeat(66)+']'.repeat(66)),/JSON_DEPTH_LIMIT/);
});
