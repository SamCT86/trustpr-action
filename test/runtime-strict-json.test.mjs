import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/strict-json.mjs';

test('strict parser rejects direct and escaped-equivalent duplicate keys', () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}'])
    assert.throws(() => parseStrictJson(Buffer.from(input)), /DUPLICATE_JSON_KEY/);
});
test('strict parser rejects malformed bytes, lone surrogates, fractional and unsafe numbers', () => {
  assert.throws(() => parseStrictJson(Buffer.from([0x22,0xc0,0xaf,0x22])), /INVALID_UTF8/);
  for (const input of ['"\\ud800"', '"\\udc00"', '1.0', '1e0', '9007199254740992', 'NaN', '{"a":01}'])
    assert.throws(() => parseStrictJson(input));
});
test('strict parser preserves prototype keys as data and accepts scalar Unicode', () => {
  const parsed = parseStrictJson('{"__proto__":{"safe":true},"emoji":"😀","n":-7}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.__proto__.safe, true);
  assert.equal(parsed.emoji, '😀');
  assert.equal(parsed.n, -7);
});
test('strict parser enforces depth, size and trailing-input boundaries', () => {
  assert.throws(() => parseStrictJson('['.repeat(66)+'0'+']'.repeat(66)), /JSON_DEPTH_LIMIT/);
  assert.throws(() => parseStrictJson('true false'), /TRAILING_JSON_INPUT/);
  assert.throws(() => parseStrictJson(Buffer.alloc(9*1024*1024,32)), /JSON_BYTE_LIMIT/);
});
