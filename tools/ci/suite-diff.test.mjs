import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suiteDiff } from './suite-diff.mjs';

test('suite diff: total change and the files that moved most, new and gone files marked', () => {
  const base = { totalMs: 20000, tests: 100, files: { 'a.ts': 3000, 'b.ts': 1000, 'gone.ts': 500 } };
  const head = { totalMs: 21500, tests: 104, files: { 'a.ts': 3050, 'b.ts': 2200, 'new.ts': 800 } };
  const out = suiteDiff(base, head).join('\n');
  assert.match(out, /Fast suite: 21\.5 s\*\* \(main 20\.0 s, \+1\.5 s; 104 tests, main 100\)/);
  assert.match(out, /\| b\.ts \| 1\.0 s \| 2\.2 s \| \+1\.2 s \|/);
  assert.match(out, /\| new\.ts \| new \| 0\.8 s \|/);
  assert.match(out, /\| gone\.ts \| 0\.5 s \| gone \| −0\.5 s \|/);
  assert.doesNotMatch(out, /a\.ts/, 'a 50 ms move is noise');
});
