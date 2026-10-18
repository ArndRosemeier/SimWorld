/**
 * Every building of three whole towns can be left (slow tier, by hand only: about half a minute). For each building:
 * no street door cut off from inside, every storey joined to the street, and few rooms, beds or seats walled in
 * (a ratchet over all three towns; lower it as the floor plans get better). Prints what is still cut off, to look
 * into with src/interior/reach.ts `cutOff`. CI checks a sample of one town (test/walkIndoors.test.ts).
 *
 *   npm run test:slow -- test/slow/wayOut.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../../src/plan/town';
import { planInterior } from '../../src/interior/building';
import { indoorsOf } from '../../src/interior/indoors';
import { cutOff } from '../../src/interior/reach';
import { buildingBase, windowOpenings } from '../../src/build/massing';

/** Buildings over seeds 1-3 with a room, bed or seat still cut off (9 of 914 when this was written). */
const RATCHET = 9;

test('every building of three towns can be left', () => {
  const cut: string[] = [];
  let n = 0;
  for (const seed of [1, 2, 3]) {
    const town = planTown({ seed, size: 0 });
    town.cells.forEach((c, ci) => c.buildings.forEach((b, bi) => {
      const I = planInterior(b), r = cutOff(indoorsOf(I, buildingBase(b, town.terrain).base, windowOpenings(b)), I);
      const what = `seed ${seed} ${ci}/${bi} ${b.style} ${b.use}${b.shopfront ? '+shop' : ''}`;
      n++;
      assert.deepEqual(r.doors, [], `${what}: a street door one cannot get to from inside`);
      I.storeys.forEach((s, f) => {
        const open = s.rooms.filter((q) => !q.sealed).length, lost = r.rooms.filter(([g]) => g === f).length;
        assert.ok(open === 0 || lost < open, `${what}: no way to floor ${f}`);
      });
      if (r.rooms.length || r.spots.length) cut.push(`${what}: rooms ${r.rooms.map(([f, j]) => `${f}:${I.storeys[f].rooms[j].type}`).join(',') || '-'}, spots ${r.spots.length}/${I.spots.length}`);
    }));
  }
  console.log(`${cut.length} of ${n} buildings with something cut off:\n${cut.join('\n')}`);
  assert.ok(cut.length <= RATCHET, `${cut.length} buildings with something cut off (at most ${RATCHET})`);
});
