import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaches } from './budget-reporter.mjs';

const B = { perTestMs: 1000, perFileMs: 3000, totalMs: 60000 };

test('budget: within limits is green', () => {
  assert.deepEqual(breaches([{ name: 'a', file: 'f', ms: 900 }], new Map([['f', 2900]]), 30000, B, 1), []);
});

test('budget: a slow test, a slow file and a slow suite are each named', () => {
  const out = breaches([{ name: 'a', file: 'f', ms: 1500 }], new Map([['f', 3500]]), 61000, B, 1);
  assert.equal(out.length, 3);
  assert.match(out[0], /test over 1000 ms: 1500 ms {2}a/);
  assert.match(out[1], /file over 3000 ms/);
  assert.match(out[2], /suite over 60000 ms/);
});

test('budget: the scale factor loosens every limit', () => {
  assert.deepEqual(breaches([{ name: 'a', file: 'f', ms: 1500 }], new Map([['f', 3500]]), 61000, B, 2), []);
});
