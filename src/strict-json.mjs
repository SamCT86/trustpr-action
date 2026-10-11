import { TextDecoder } from 'node:util';

export const STRICT_JSON_FORMAT = 'TRUSTPR_BOUNDED_INTEGER_JSON_V1';
export const JSON_LIMITS = Object.freeze({maxBytes:8*1024*1024,maxDepth:64,maxNodes:100000});
function fail(code) { throw Object.assign(new TypeError(code),{code}); }
export function assertScalarString(value) {
  if(typeof value!=='string') fail('INVALID_STRING');
  for(let i=0;i<value.length;i++) {
    const x=value.charCodeAt(i);
    if(x>=0xd800&&x<=0xdbff) {
      const y=value.charCodeAt(++i);
      if(!(y>=0xdc00&&y<=0xdfff)) fail('INVALID_UNICODE');
    } else if(x>=0xdc00&&x<=0xdfff) fail('INVALID_UNICODE');
  }
  return value;
}
export function parseStrictJson(input) {
  let bytes;
  if(typeof input==='string') {assertScalarString(input);bytes=Buffer.from(input,'utf8');}
  else if(Buffer.isBuffer(input)||input instanceof Uint8Array) bytes=Buffer.from(input);
  else fail('JSON_INPUT_TYPE');
  if(bytes.length>JSON_LIMITS.maxBytes) fail('JSON_BYTE_LIMIT');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{fail('INVALID_UTF8');}
  let pos=0,nodes=0;
  function ws(){while(/[\x20\x09\x0a\x0d]/.test(text[pos]??'!'))pos++;}
  function string() {
    const start=pos++;
    while(pos<text.length) {
      const ch=text[pos++];
      if(ch==='"') {
        let value;try{value=JSON.parse(text.slice(start,pos));}catch{fail('INVALID_JSON_STRING');}
        return assertScalarString(value);
      }
      if(ch==='\\') {if(pos>=text.length)fail('INVALID_JSON_STRING');pos++;}
      else if(ch.charCodeAt(0)<32)fail('INVALID_JSON_STRING');
    }
    fail('INVALID_JSON_STRING');
  }
  function value(depth) {
    if(depth>JSON_LIMITS.maxDepth)fail('JSON_DEPTH_LIMIT');
    if(++nodes>JSON_LIMITS.maxNodes)fail('JSON_NODE_LIMIT');
    ws();const ch=text[pos];
    if(ch==='"')return string();
    if(ch==='{') {
      pos++;ws();const out=Object.create(null);
      if(text[pos]==='}'){pos++;return out;}
      while(true) {
        if(text[pos]!=='"')fail('INVALID_JSON_OBJECT');
        const key=string();
        if(Object.hasOwn(out,key))fail('DUPLICATE_JSON_KEY');
        ws();if(text[pos++]!==':')fail('INVALID_JSON_OBJECT');
        out[key]=value(depth+1);ws();
        const end=text[pos++];if(end==='}')return out;
        if(end!==',')fail('INVALID_JSON_OBJECT');ws();
      }
    }
    if(ch==='[') {
      pos++;ws();const out=[];
      if(text[pos]===']'){pos++;return out;}
      while(true) {
        out.push(value(depth+1));ws();const end=text[pos++];
        if(end===']')return out;if(end!==',')fail('INVALID_JSON_ARRAY');
      }
    }
    for(const [token,result] of [['true',true],['false',false],['null',null]]) {
      if(text.startsWith(token,pos)){pos+=token.length;return result;}
    }
    const match=/^-?(?:0|[1-9][0-9]*)/.exec(text.slice(pos));
    if(!match)fail('INVALID_JSON_VALUE');
    pos+=match[0].length;
    if(/[.eE]/.test(text[pos]??'!'))fail('NON_INTEGER_JSON_NUMBER');
    const number=Number(match[0]);if(!Number.isSafeInteger(number))fail('UNSAFE_JSON_INTEGER');
    return Object.is(number,-0)?0:number;
  }
  const result=value(0);ws();if(pos!==text.length)fail('TRAILING_JSON_INPUT');
  return result;
}
