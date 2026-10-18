import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { pointInPoly } from '../src/geom/geom2';
import { planInterior } from '../src/interior/building';
import { indoorsOf } from '../src/interior/indoors';
import { landmarkBody } from '../src/interior/landmark';
import { buildingOf, buildingRef, eachFarmBuilding, isBarn, placeGraphOf } from '../src/plan/placeGraph';
import { cutOff } from '../src/interior/reach';
import { buildingBase, windowOpenings } from '../src/build/massing';

const town = planTown({ seed: 1, size: 0 });

test('public buildings: every one but the sports ground has a walk-in body furnished for its kind', () => {
  const seen: string[] = [];
  for (const lm of town.macro.landmarks) {
    const body = landmarkBody(lm, town.terrain);
    if (lm.kind === 'sports') { assert.equal(body, null, lm.kind); continue; }
    assert.ok(body, `${lm.kind} has a body`);
    const I = planInterior(body.b, body.place);
    assert.ok(I.doors.length > 0, `${lm.kind}: a street door`);
    const ind = indoorsOf(I, lm.base, body.windows);
    assert.ok(ind.outer.some((w) => w.windows.length), `${lm.kind}: windows in its walls`);
    const kinds = new Set(I.storeys.flatMap((s) => s.rooms.map((r) => r.type)));
    const furn = I.storeys.flatMap((s) => s.furniture);
    for (const d of I.doors) assert.ok(I.storeys[0].poly.length >= 8 && Number.isFinite(d.x), `${lm.kind}: door placed`);
    for (const f of furn) assert.ok(I.storeys.some((s) => pointInPoly(s.poly, f.x, f.z)), `${lm.kind}: ${f.kind} inside`);
    for (const p of I.spots) assert.ok(pointInPoly(I.storeys[p.floor].poly, p.x, p.z), `${lm.kind}: a ${p.use} spot inside`);
    if (lm.kind === 'church') {
      const altar = furn.find((f) => f.kind === 'altar'), door = I.doors[0];
      assert.ok(kinds.has('nave') && altar, 'church: a nave with its altar');
      const far = (f: { x: number; z: number }) => Math.hypot(f.x - door.x, f.z - door.z);
      for (const p of furn.filter((f) => f.kind === 'pew')) assert.ok(far(p) < far(altar), 'church: the pews between the door and the altar');
      assert.ok(ind.spots.filter((p) => p.use === 'sit').length >= 10, 'church: pews to sit on');
    }
    if (lm.kind === 'school') assert.ok(I.storeys.every((s) => s.rooms.some((q) => q.type === 'classroom')), 'school: classrooms on every floor');
    if (lm.kind === 'clinic') assert.ok(kinds.has('consulting'), 'clinic: a consulting room');
    if (lm.kind === 'carehome') assert.ok(ind.spots.some((p) => p.use === 'sleep'), 'care home: beds');
    if (lm.kind === 'townhall') {
      // Its own wide door in the middle of the front, the counters, the council chamber with the bench and the councillors' seats.
      assert.ok(Math.abs(I.doors[0].w - 2.4) < 0.01, `town hall: a wide front door (${I.doors[0].w})`);
      assert.ok(kinds.has('lobby') && kinds.has('chamber') && kinds.has('office'), `town hall: ${[...kinds].join(', ')}`);
      assert.ok(furn.some((f) => f.kind === 'counter' && f.use === 'serve'), 'town hall: counters');
      const chamber = I.storeys[0].rooms.find((q) => q.type === 'chamber')!;
      const inChamber = I.spots.filter((p) => p.floor === 0 && pointInPoly(chamber.poly, p.x, p.z));
      assert.ok(inChamber.filter((p) => p.use === 'sit').length >= 8, `town hall: councillors' seats (${inChamber.length})`);
      assert.ok(inChamber.some((p) => p.use === 'work'), "town hall: the mayor's chair");
    }
    seen.push(lm.kind);
  }
  assert.ok(seen.includes('church') && seen.includes('school'), `seen ${seen.join(', ')}`);
});

test('farms: the farm works in its barn and the family lives in the farmhouse, each with its own building code; every farm building can be walked in', () => {
  const g = placeGraphOf(town);
  let barns = 0, houses = 0;
  eachFarmBuilding(town.rural, (b, code) => {
    assert.equal(buildingOf(town, code), b, 'the code points at the building');
    const work = g.places.find((p) => p.building === code && !p.homes), home = g.places.find((p) => p.building === code && p.homes);
    if (work) assert.equal(work.kind, 'farm');
    if (home) assert.equal(home.kind, 'farmhouse');
    if (!work && !home) return; // (a shed or a second barn: nobody's place; the takeover check walks into those)
    const I = planInterior(b, work ? { staff: work.staff, capacity: work.capacity, kind: 'farm' } : undefined);
    assert.ok(I.doors.length > 0, `${code}: a door`);
    const cut = cutOff(indoorsOf(I, buildingBase(b, town.terrain).base, windowOpenings(b)), I);
    assert.deepEqual([cut.doors.length, cut.spots.length, cut.rooms.length], [0, 0, 0], `${code}: everything reaches the door`);
    if (work) {
      barns++;
      assert.ok(isBarn(b) && I.storeys[0].rooms.some((q) => q.type === 'barn'), 'the farm: a barn floor');
      const kinds = new Set(I.storeys[0].furniture.map((f) => f.kind));
      assert.ok(kinds.has('stall') && kinds.has('hayBale'), `the barn: stalls and hay (${[...kinds].join(', ')})`);
      assert.ok(I.spots.filter((p) => p.use === 'work').length >= 2, 'the barn: places to work');
    } else {
      houses++;
      assert.equal(I.units.length, 1, 'the farmhouse: one family home');
      assert.ok(I.spots.some((p) => p.use === 'sleep'), 'the farmhouse: beds');
    }
  });
  assert.ok(barns > 0 && barns === houses, `${barns} barns, ${houses} farmhouses`);
  const ref = buildingRef(g.places.find((p) => p.kind === 'farm')!.building);
  assert.ok(ref && 'farm' in ref && ref.index >= 0, 'a farm building code decodes to its farm and index');
});
