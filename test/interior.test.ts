import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { dwellingsOf, flatsDoor, type BuildingDesc } from '../src/plan/building';
import { PLACE_KIND_OF } from '../src/plan/amenities';
import { defaultStaff } from '../src/sim/placeKinds';
import { pointInPoly, polyArea } from '../src/geom/geom2';
import { planInterior, peakStaff, storeyFacade, type Interior } from '../src/interior/building';
import { MeshBuilder } from '../src/build/meshBuilder';
import { INTERIOR_SPECS, LAMP, buildCutaway } from '../src/build/interior';
import { buildingTiers } from '../src/build/massing';

// One small town shared by the file (planning it is the expensive part); a few buildings of it.
const town = planTown({ seed: 1, size: 0 });
const all = town.cells.flatMap((c) => c.buildings);
const plain = (b: BuildingDesc) => b.poly.length === 8 && Math.abs(polyArea(b.poly)) > 80;
const first = (ok: (b: BuildingDesc) => boolean) => {
  const b = all.find(ok);
  assert.ok(b, 'the town has such a building');
  return b;
};
const homes = [
  first((b) => b.style === 'house' && b.floors >= 2 && plain(b)),
  first((b) => b.style === 'house' && b.floors === 1 && plain(b)),
  first((b) => b.style !== 'house' && b.units >= 2 && !b.shopfront && plain(b) && dwellingsOf(b) > 0),
  first((b) => !!b.shopfront && dwellingsOf(b) > 0 && plain(b)),
];
const works = (['cafe', 'bakery', 'office', 'garage', 'butcher'] as const).map((a) => first((b) => b.amenity === a));

test('every home has a living room, a toilet, somewhere to cook and a bed, and there are as many as the planner counts', () => {
  for (const b of homes) {
    const I = planInterior(b);
    assert.equal(I.units.length, dwellingsOf(b), `${b.style} ${b.use}: homes`);
    const has = I.units.map(() => new Set<string>());
    for (const s of I.storeys) {
      for (const r of s.rooms) if (r.unit >= 0) has[r.unit].add(r.type);
      for (const f of s.furniture) if (f.unit !== undefined && f.unit >= 0) has[f.unit].add(f.kind);
    }
    has.forEach((h, i) => {
      const what = `${b.style} ${b.use} home ${i}: ${[...h].join(' ')}`;
      assert.ok(h.has('living'), what);
      assert.ok(h.has('toilet'), what);
      assert.ok(h.has('kitchenRow'), what);
      assert.ok(h.has('bed') || h.has('bedDouble'), what);
    });
    I.units.forEach((u) => assert.ok(u.sleeps >= 1 && u.area > 15, JSON.stringify(u)));
  }
});

test('a storey is cut into rooms that cover it without overlapping, furniture stands inside, and the same building plans the same', () => {
  for (const b of [...homes, works[0]]) {
    const I = planInterior(b);
    for (const s of I.storeys) {
      const total = s.rooms.reduce((a, r) => a + Math.abs(polyArea(r.poly)), 0), floor = Math.abs(polyArea(s.poly));
      assert.ok(Math.abs(total - floor) < floor * 0.03, `${b.style} floor ${s.floor}: rooms ${total.toFixed(1)} of ${floor.toFixed(1)} m²`);
      for (const f of s.furniture) assert.ok(pointInPoly(s.poly, f.x, f.z), `${f.kind} outside floor ${s.floor}`);
    }
    assert.equal(JSON.stringify(planInterior(b)), JSON.stringify(I));
  }
});

test('a workplace has a place to work for everyone on shift at once, and a café has seats', () => {
  for (const b of works) {
    const I: Interior = planInterior(b);
    const kind = PLACE_KIND_OF[b.amenity!]!;
    const staff = peakStaff(defaultStaff(kind));
    const work = I.spots.filter((p) => p.unit < 0 && (p.use === 'work' || p.use === 'serve')).length;
    assert.ok(work >= staff, `${b.amenity}: ${work} workplaces for ${staff} staff`);
    if (b.amenity === 'cafe') assert.ok(I.spots.filter((p) => p.use === 'sit').length >= 8, 'café seats');
  }
  // The sim's own staff and capacity, when given, size the workplace.
  const office = works[2];
  const big = planInterior(office, { staff: [{ role: 'clerk', count: 30, days: 0x1f, start: 540, end: 1020, minAge: 18 }], capacity: 40 });
  assert.ok(big.spots.filter((p) => p.use === 'work' || p.use === 'serve').length >= 30);
});

test('flats over a shop have their own street door and a hall to the stairs with no door into the shop', () => {
  const over = all.filter((b) => flatsDoor(b)).slice(0, 12).map((b) => planInterior(b)).filter((I) => I.doors.length === 2);
  assert.ok(over.length >= 4, `${over.length} buildings with a flats door`);
  for (const I of over.slice(0, 6)) {
    const g = I.storeys[0], hall = g.rooms.find((r) => r.type === 'stairs');
    assert.ok(hall && g.flights.length === 2, 'the stairs go up from the hall');
    // A step in from each street door: the flats' lands in the hall, the shop's does not.
    const inside = (d: { x: number; z: number }) => {
      const c = g.poly.reduce((a, v, i) => (a[i & 1] += v / (g.poly.length / 2), a), [0, 0]);
      const k = 0.5 / Math.hypot(c[0] - d.x, c[1] - d.z);
      return pointInPoly(hall.poly, d.x + (c[0] - d.x) * k, d.z + (c[1] - d.z) * k);
    };
    for (const d of I.doors) assert.equal(inside(d), d.homes, `door ${JSON.stringify(d)}`);
    // No inner door opens onto the hall.
    for (const w of g.walls) for (const [t0, t1] of w.doors) {
      const t = (t0 + t1) / 2, x = w.ax + (w.bx - w.ax) * t, z = w.az + (w.bz - w.az) * t, L = Math.hypot(w.bx - w.ax, w.bz - w.az);
      const nx = -(w.bz - w.az) / L * 0.3, nz = (w.bx - w.ax) / L * 0.3;
      assert.ok(!pointInPoly(hall.poly, x + nx, z + nz) && !pointInPoly(hall.poly, x - nx, z - nz), 'a door into the flats hall');
    }
  }
});

test('the cutaway of a storey is a sound textured mesh', () => {
  for (const [b, floor] of [[works[0], 0], [homes[2], 1]] as const) {
    const I = planInterior(b);
    const tiers = buildingTiers(b);
    const mb = new MeshBuilder(INTERIOR_SPECS);
    buildCutaway(mb, I, floor, 10, I.storeys.map((_, k) => storeyFacade(b, k, tiers)));
    const d = mb.build();
    const P = d.attrs.position.array, N = d.attrs.normal.array, C = d.attrs.aTint.array, L = d.attrs.aLayer.array, UV = d.attrs.uv.array, I3 = d.index, nv = P.length / 3;
    assert.ok(nv > 1000, `${nv} vertices`);
    assert.equal(C.length, nv * 3);
    assert.equal(UV.length, nv * 2);
    for (let i = 0; i < nv; i++) if (!(Number.isInteger(L[i]) && L[i] >= 0 && L[i] <= LAMP)) assert.fail(`layer of vertex ${i}: ${L[i]}`);
    for (let i = 0; i < UV.length; i++) if (!Number.isFinite(UV[i])) assert.fail(`uv ${i}`);
    for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) assert.fail(`position ${i}`);
    for (let i = 0; i < N.length; i += 3) if (!(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-3)) assert.fail(`normal of vertex ${i / 3}`);
    for (let t = 0; t < I3.length; t++) if (I3[t] >= nv) assert.fail(`index ${t}`);
    // Round the ground-floor level given (10; the stairs' soffit reaches a little under it), below the storey's top.
    assert.ok(d.bounds[1] >= 9.5 && d.bounds[4] < 10 + I.storeys[floor].y + I.storeys[floor].height + 0.5, `${d.bounds}`);
  }
});
