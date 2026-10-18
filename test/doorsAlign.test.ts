// Every street door is one door: where the facade paints a door (src/render/tsl/facade.ts, `paintedDoors`), the
// interior has its real door, the same width, and the other way round (Arnd 22:26: "some houses have 2 doors over
// each other. One opens and one is just a prop"). A sample here; whole towns in test/slow/doorsAlign.slow.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { flatsDoor, type BuildingDesc } from '../src/plan/building';
import { eachBuilding, eachFarmBuilding } from '../src/plan/placeGraph';
import { doorMismatches } from './doorsAlign';

const town = planTown({ seed: 1, size: 0 });

test('doors: every painted street door is a real one and every real one is painted (a sample, the flats over shops among it)', () => {
  const sample: BuildingDesc[] = [];
  let k = 0, flats = 0;
  eachBuilding(town.cells, (b) => {
    if (flatsDoor(b) && flats < 2) { flats++; sample.push(b); } else if (k++ % 60 === 0) sample.push(b);
  });
  eachFarmBuilding(town.rural, (b, code) => { if (code % 16 < 2 && sample.length < 10) sample.push(b); });
  assert.ok(flats >= 2, `${flats} flats over shops`);
  assert.deepEqual(doorMismatches(sample), []);
});
