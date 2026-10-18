import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTakeovers } from './takeoverCheck';

// Whole towns at four times of day: test/slow/takeover.slow.test.ts. Indoors: test/walkIndoors.test.ts.
test('takeover: anyone taken over out of doors (on the street, at a doorstep, on the road to the city) stands on the ground, outside every building, and can walk off', async () => {
  const r = await checkTakeovers([3], [[8, 20], [17, 50]], 4);
  assert.ok(r.checked > 60 && r.outOfTown > 0, `a broad sample (${r.checked} taken over, ${r.outOfTown} on the road out of town)`);
  assert.deepEqual(r.problems.slice(0, 12), [], `${r.problems.length} of ${r.checked}`);
});
