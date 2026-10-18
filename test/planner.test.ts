import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown, PEOPLE_PER_HOME, VACANT_SHARE } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { planCell } from '../src/plan/cell';
import { crossingsOf, crossingSetback } from '../src/plan/crossings';
import { flatsDoor, isSliver, MIN_FLAT_FLOOR } from '../src/plan/building';
import { frontDoor } from '../src/plan/terrace';
import { careHomeRooms, siteToWorld } from '../src/plan/landmarks';
import { decorInstances, DECOR_STRIDE } from '../src/build/decorProps';
import { amenityCounts } from '../src/plan/amenities';
import { CARE_ROOMS_PER_PERSON } from '../src/sim/placeKinds';
import { closestOnPolyline, pointInPoly, polyArea } from '../src/geom/geom2';

// Two towns of different sizes (planning them is the expensive part).
const towns = [planTown({ seed: 11, size: 1 }), planTown({ seed: 3, size: 0.3 })];

test('shop fronts: about one general shop per 85 inhabitants, a few empty, every service there', () => {
  for (const t of towns) {
    const bs = t.cells.flatMap((c) => c.buildings);
    const pop = t.dwellings * PEOPLE_PER_HOME;
    const fronts = bs.filter((b) => b.shopfront);
    const of = (k: string) => bs.filter((b) => b.amenity === k).length;
    const shops = of('shop'), vacant = of('vacant');
    assert.ok(shops >= pop / 85 * 0.8 && shops <= pop / 85 * 1.15, `${shops} shops for ${Math.round(pop)} people`);
    assert.ok(vacant >= 1 && vacant <= fronts.length * 0.08, `${vacant} of ${fronts.length} fronts empty`);
    assert.ok(vacant <= Math.round(VACANT_SHARE * fronts.length));
    for (const [k, n] of amenityCounts(pop, t.terrain.profile.warmth)) assert.ok(of(k) >= n, `${k}: ${of(k)} of ${n}`);
    for (const b of fronts) assert.ok(b.amenity, 'every shop front has a use');
  }
});

test('a care home on a residential edge, a petrol station on an arterial, the supermarket with its car park', () => {
  for (const t of towns) {
    const { macro } = t;
    const pop = t.dwellings * PEOPLE_PER_HOME;
    const g = placeGraphOf(t);
    const lm = (k: string) => { const l = macro.landmarks.filter((l) => l.kind === k); assert.equal(l.length, 1, k); return l[0]; };
    const place = (k: string) => { const p = g.places.filter((p) => p.kind === k); assert.equal(p.length, 1, k); return p[0]; };
    // The care home: about 2.5 rooms per 100 inhabitants, as many as its storeys hold.
    const care = lm('carehome'), home = place('carehome');
    assert.ok(care.cell < 0 || ['suburban', 'rowhouses', 'apartments', 'park'].includes(macro.cells[care.cell].district), 'among the houses');
    assert.ok(care.p.floors >= 2 && care.p.floors <= 3);
    assert.equal(home.homes, Math.min(careHomeRooms(care), Math.max(8, Math.round(pop * CARE_ROOMS_PER_PERSON))));
    assert.ok(home.homes >= pop * 0.02, `${home.homes} rooms for ${Math.round(pop)} people`);
    // The petrol station: out towards the edge, its forecourt on an arterial (or its own road out).
    const petrol = lm('petrol');
    place('petrol');
    const R = Math.max(...macro.boundary);
    assert.ok(Math.hypot(petrol.x - macro.core[0], petrol.z - macro.core[1]) > R * 0.6, 'towards the edge');
    if (petrol.cell >= 0) {
      const [fx, fz] = siteToWorld(petrol, 0, -petrol.hv);
      const e = macro.edges.map((e) => ({ e, d: closestOnPolyline(e.pts, fx, fz).d })).sort((a, b) => a.d - b.d)[0];
      assert.ok(e.d < e.e.width / 2 + e.e.sidewalk + 14, `forecourt ${e.d.toFixed(1)} m from the arterial`);
    } else assert.ok(petrol.road && petrol.road.length >= 4);
    // The supermarket: towards the edge, with a car park in front (cars parked on its site).
    const sm = lm('supermarket');
    place('supermarket');
    assert.ok(Math.hypot(sm.x - macro.core[0], sm.z - macro.core[1]) > R * 0.4);
    assert.ok(sm.p.park >= 15, 'a car park');
  }
});

test('no sliver of a lot carries more than one storey', () => {
  for (const t of towns) for (const c of t.cells) for (const b of c.buildings) {
    if (b.style === 'church') continue;
    if (Math.abs(polyArea(b.poly)) < MIN_FLAT_FLOOR || isSliver(b.poly)) assert.equal(b.floors, 1, `${b.style} of ${Math.round(Math.abs(polyArea(b.poly)))} m² with ${b.floors} floors`);
  }
});

test('zebra crossings: deterministic, on their street, a little back from the junction, across it', () => {
  const t = towns[1];
  let n = 0;
  t.cells.forEach((plan, i) => {
    const xs = crossingsOf(plan);
    if (i < 3) assert.deepEqual(crossingsOf(planCell(t.macro, t.macro.cells[i], t.terrain)), xs, 'the same from a cell planned again');
    for (const c of xs) {
      const st = plan.streets[c.street];
      const hit = closestOnPolyline(st.pts, c.x, c.z);
      assert.ok(hit.d < 0.05, 'on the centreline');
      const L = closestOnPolyline(st.pts, st.pts[c.end ? st.pts.length - 2 : 0], st.pts[c.end ? st.pts.length - 1 : 1]).s;
      assert.ok(Math.abs(Math.abs(hit.s - L) - crossingSetback(st.width)) < 0.5, 'set back from the end');
      assert.equal(c.width, st.width);
      // The heading runs along the street.
      const k = Math.min(hit.seg * 2, st.pts.length - 4), dx = st.pts[k + 2] - st.pts[k], dz = st.pts[k + 3] - st.pts[k + 1];
      assert.ok(Math.abs(Math.sin(c.heading) * dx + Math.cos(c.heading) * dz) / Math.hypot(dx, dz) > 0.95, 'along the street');
      n++;
    }
  });
  assert.ok(n > 20, `${n} crossings`);
});

test('every street door opens outdoors, never into its own or a neighbouring building', () => {
  let doors = 0;
  for (const t of towns) for (const c of t.cells) c.buildings.forEach((b, bi) => {
    const fd = flatsDoor(b);
    for (const d of fd ? [frontDoor(b), frontDoor(b, fd)] : [frontDoor(b)]) {
      doors++;
      const hit = c.buildings.findIndex((o) => pointInPoly(o.poly, d.x, d.z));
      assert.equal(hit, -1, `cell ${c.id} building ${bi}: its door at ${d.x.toFixed(1)}, ${d.z.toFixed(1)} opens into building ${hit}`);
    }
  });
  assert.ok(doors > 500, `${doors} doors`);
});

test('houses: a driveway beside most, on their lot, its car spot clear of buildings and its mouth clear of parked cars', () => {
  const t = towns[0];
  const houses = t.cells.flatMap((c) => c.buildings.filter((b) => b.style === 'house'));
  const drives = t.cells.flatMap((c) => c.driveways);
  assert.ok(drives.length >= houses.length * 0.4, `${drives.length} driveways for ${houses.length} houses`);
  for (const c of t.cells) {
    for (const d of c.driveways) {
      const b = c.buildings[d.building];
      assert.equal(b.style, 'house');
      assert.ok(pointInPoly(c.lots[b.id].poly, d.x, d.z), 'the car spot is on the lot');
      assert.ok(!c.buildings.some((o) => pointInPoly(o.poly, d.x, d.z)), 'and in no building');
      const s = c.streets[d.street];
      assert.ok(closestOnPolyline(s.pts, d.mx, d.mz).d < s.width / 2 + s.sidewalk + 2.5, 'the mouth is behind a sidewalk');
      const at = closestOnPolyline(s.pts, d.mx, d.mz).s;
      for (const p of c.parking) if (p.street === d.street) assert.ok(Math.abs(closestOnPolyline(s.pts, p.x, p.z).s - at) > 3.5, 'no parking bay across a driveway');
    }
    assert.ok(c.paths.every((p) => Math.abs(polyArea(p.outer)) > 2));
    // Garages, carports and garden fences stand on free ground, off the houses.
    for (let i = 0; i < c.props.length; i += 6) {
      const t = c.props[i];
      if (t !== 34 && t !== 33) continue;
      const x = c.props[i + 1], z = c.props[i + 2];
      assert.ok(!c.buildings.some((b) => pointInPoly(b.poly, x, z)), 'a garage or fence in a house');
      assert.ok(!c.carriageway.some((r) => pointInPoly(r.outer, x, z) && !r.holes.some((h) => pointInPoly(h, x, z))), 'a garage or fence on the road');
    }
  }
});

test('holiday decorations: pumpkins and lights at the homes, a tree and stalls on the square, bunting near it', () => {
  const t = towns[0], g = placeGraphOf(t);
  const sq = g.places.find((p) => p.kind === 'square') ?? g.places.find((p) => p.kind === 'park')!;
  const groups = decorInstances(t.cells, t.terrain, sq);
  const count = (model: string) => (groups.find((x) => x.model === model)?.inst.length ?? 0) / DECOR_STRIDE;
  const homes = t.cells.reduce((n, c) => n + c.buildings.filter((b) => b.style === 'house').length, 0);
  assert.ok(count('f:pumpkin:0') >= homes, `${count('f:pumpkin:0')} pumpkins for ${homes} houses`);
  assert.ok(count('f:stringLights:0') + count('f:stringLights:1') > homes, 'lights along the houses');
  assert.equal(count('f:xmasTree:0'), 1);
  assert.ok(count('f:marketStall:0') >= 6, `${count('f:marketStall:0')} stalls`);
  assert.ok(count('f:bunting:0') > 10, 'bunting near the square');
  const feet = t.cells.flatMap((c) => c.buildings.map((b) => b.poly));
  for (const gr of groups) for (let o = 0; o < gr.inst.length; o += DECOR_STRIDE) {
    if (gr.model.startsWith('f:stringLights')) continue; // (on the wall itself)
    assert.ok(!feet.some((p) => pointInPoly(p, gr.inst[o], gr.inst[o + 2])), `${gr.model} inside a building`);
  }
});
