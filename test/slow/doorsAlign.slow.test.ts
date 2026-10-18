/**
 * Every building of three towns, town and farm buildings: each painted street door is a real door and each real door
 * is painted (slow tier, by hand: npm run test:slow -- test/slow/doorsAlign.slow.test.ts; CI checks a sample in
 * test/doorsAlign.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../../src/plan/town';
import type { BuildingDesc } from '../../src/plan/building';
import { eachBuilding, eachFarmBuilding } from '../../src/plan/placeGraph';
import { doorMismatches } from '../doorsAlign';

test('doors: in three whole towns every painted street door is a real one and every real one is painted', () => {
  const bad: string[] = [];
  for (const seed of [1, 2, 3]) {
    const town = planTown({ seed, size: 0 }), all: BuildingDesc[] = [];
    eachBuilding(town.cells, (b) => all.push(b));
    eachFarmBuilding(town.rural, (b) => all.push(b));
    bad.push(...doorMismatches(all).map((m) => `seed ${seed}: ${m}`));
  }
  assert.deepEqual(bad, []);
});
