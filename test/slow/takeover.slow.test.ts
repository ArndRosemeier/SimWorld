/**
 * Taking over anyone out of doors, in four towns at four times of a Monday (slow tier, by hand only). CI checks a
 * sample of one town (test/takeover.test.ts).
 *
 *   npm run test:slow -- test/slow/takeover.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTakeovers } from '../takeoverCheck';

test('takeover: everyone out of doors in four towns stands on the ground and can walk off', async () => {
  const r = await checkTakeovers([1, 2, 3, 4], [[7, 40], [8, 20], [12, 40], [17, 50]], 1);
  console.log(`${r.checked} taken over, ${r.outOfTown} on the road out of town, ${r.problems.length} problems`);
  assert.deepEqual(r.problems.slice(0, 20), [], `${r.problems.length} of ${r.checked}`);
});
