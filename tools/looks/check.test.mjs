import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotDrift } from './check.mjs';

const base = { mean: [0.4, 0.45, 0.35], hist: [0, 0.1, 0.2, 0.3, 0.2, 0.1, 0.1, 0], black: 0.01, white: 0.01, magenta: 0 };

test('looks shots: a small change passes, a darkened town and magenta fail', () => {
  assert.deepEqual(shotDrift({ ...base, mean: [0.42, 0.44, 0.36] }, base), []);
  const dark = shotDrift({ mean: [0.2, 0.25, 0.18], hist: [0.3, 0.3, 0.2, 0.1, 0.1, 0, 0, 0], black: 0.2, white: 0.01, magenta: 0 }, base);
  assert.ok(dark.some((d) => /r mean/.test(d)) && dark.some((d) => /histogram/.test(d)) && dark.some((d) => /black share/.test(d)));
  assert.match(shotDrift({ ...base, magenta: 0.02 }, null)[0], /magenta/);
});
