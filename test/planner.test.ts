import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown, PEOPLE_PER_HOME, VACANT_SHARE } from '../src/plan/town';
import { placeGraphOf } from '../src/plan/placeGraph';
import { planCell } from '../src/plan/cell';
import { crossingsOf, crossingSetback } from '../src/plan/crossings';
import { flatsDoor, isSliver, MIN_FLAT_FLOOR } from '../src/plan/building';
import { frontDoor } from '../src/plan/terrace';
import { careHomeRooms, siteToWorld } from '../src/plan/landmarks';
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
