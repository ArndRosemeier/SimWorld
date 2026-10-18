/**
 * Taking over anyone out of doors, in four towns at four times of a Monday, and everyone against the sim in six
 * towns at ten times of a week (slow tier, by hand only, about two
 * minute). CI checks the pieces (test/takeover.test.ts).
 *
 *   npm run test:slow -- test/slow/takeover.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTakeovers } from './takeoverCheck';
import { auditTakeovers } from './takeoverAudit';

test('takeover: everyone out of doors in four towns stands on the ground and can walk off', async () => {
  const r = await checkTakeovers([1, 2, 3, 4], [[7, 40], [8, 20], [12, 40], [17, 50]], 1);
  console.log(`${r.checked} taken over, ${r.waiting} waited for (in a vehicle or out of town), ${r.problems.length} problems`);
  assert.deepEqual(r.problems.slice(0, 20), [], `${r.problems.length} of ${r.checked}`);
});

test('takeover: in six towns at ten times of a week, everyone is taken over where the sim has them, or waited for', () => {
  const D = 24 * 60, times = [450, 500, 559, 660, 780, 940, 1070, 1260, 5 * D + 660, 6 * D + 600];
  const audit = auditTakeovers([1, 2, 3, 4, 5, 6], times);
  for (const [k, r] of Object.entries(audit)) console.log(`${k}: ${r.n}, wrong before ${r.oldWrong}, wrong now ${r.newWrong}, at the door of a building with no inside yet ${r.atDoor}`);
  assert.deepEqual(Object.values(audit).flatMap((r) => r.examples), []);
});
