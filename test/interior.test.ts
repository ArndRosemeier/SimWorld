import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { dwellingsOf, flatsDoor, type BuildingDesc } from '../src/plan/building';
import { PLACE_KIND_OF } from '../src/plan/amenities';
import { defaultStaff } from '../src/sim/placeKinds';
import { pointInPoly, polyArea } from '../src/geom/geom2';
import { planInterior, peakStaff, storeyFacade, workOf, type Interior } from '../src/interior/building';
import { MeshBuilder } from '../src/build/meshBuilder';
import { INTERIOR_SPECS, LAMP, buildCutaway, buildIndoors } from '../src/build/interior';
import { indoorsOf, STREET_DOOR_H, type Box } from '../src/interior/indoors';
import { buildingTiers, windowOpenings } from '../src/build/massing';

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
  const office = all.filter((b) => b.amenity === 'office').sort((a, b) => Math.abs(polyArea(b.poly)) * b.floors - Math.abs(polyArea(a.poly)) * a.floors)[0];
  const big = planInterior(office, { staff: [{ role: 'clerk', count: 30, days: 0x1f, start: 540, end: 1020, minAge: 18 }], capacity: 40 });
  assert.ok(big.spots.filter((p) => p.use === 'work' || p.use === 'serve').length >= 30);
});

test('flats over a shop have their own street door, where the facade paints it, and a hall to the stairs with no door into the shop where one fits', () => {
  const over = all.filter((b) => flatsDoor(b)).slice(0, 12).map((b) => planInterior(b));
  for (const I of over) assert.equal(I.doors.length, 2, 'the shop\'s door and the flats\'');
  // A step in from a street door: in the stairs hall?
  const inHall = (I: (typeof over)[number], d: { x: number; z: number }) => {
    const g = I.storeys[0], hall = g.rooms.find((r) => r.type === 'stairs');
    if (!hall) return false;
    const c = g.poly.reduce((a, v, i) => (a[i & 1] += v / (g.poly.length / 2), a), [0, 0]);
    const k = 0.5 / Math.hypot(c[0] - d.x, c[1] - d.z);
    return pointInPoly(hall.poly, d.x + (c[0] - d.x) * k, d.z + (c[1] - d.z) * k);
  };
  const halls = over.filter((I) => inHall(I, I.doors.find((d) => d.homes)!));
  assert.ok(halls.length >= 4, `${halls.length} buildings with a flats hall`);
  for (const I of halls.slice(0, 6)) {
    const g = I.storeys[0], hall = g.rooms.find((r) => r.type === 'stairs')!;
    assert.ok(g.flights.length === 2, 'the stairs go up from the hall');
    // The flats' door lands in the hall, the shop's does not.
    for (const d of I.doors) assert.equal(inHall(I, d), d.homes, `door ${JSON.stringify(d)}`);
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

/** Whether (x, y, z) lies inside box c (grown by r across). */
function inBox(c: Box, x: number, y: number, z: number, r = 0): boolean {
  const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return Math.abs(dx * cs - dz * sn) <= c.hx + r && Math.abs(dx * sn + dz * cs) <= c.hz + r && Math.abs(y - c.y) <= c.hy;
}

test('indoors: the street doors open through solid outer walls, and every room, stair and spot is there to walk to', () => {
  for (const b of [...homes, works[0]]) {
    const I = planInterior(b), base = 10, ind = indoorsOf(I, base);
    const what = `${b.style} ${b.use}`;
    assert.equal(ind.storeys.length, I.storeys.length);
    assert.equal(ind.slabs.length, I.storeys.length + 1, `${what}: a floor per storey and the roof`);
    assert.equal(ind.ramps.length, I.storeys.reduce((n, s) => n + s.flights.length, 0), `${what}: a ramp per flight`);
    assert.ok(ind.spots.every((p) => p.y === base + I.storeys[p.floor].y), `${what}: spots at their floor's height`);
    const blocked = (x: number, z: number, y = base + 1) => ind.colliders.some((c) => inBox(c, x, y, z, 0.25));
    assert.ok(ind.doors.length >= 1, `${what}: a street door`);
    for (const d of ind.doors) {
      // Through the doorway: from a step outside to a step inside, nothing in the way at chest height.
      for (const k of [0.6, 0, -0.3]) assert.ok(!blocked(d.x + d.nx * k, d.z + d.nz * k), `${what}: door at ${d.x.toFixed(1)},${d.z.toFixed(1)} open ${k} m out`);
      assert.ok(ind.colliders.some((c) => inBox(c, d.x - d.nx * 0.1, base + STREET_DOOR_H + 0.2, d.z - d.nz * 0.1, 0.15)), `${what}: a lintel over the door`);
      // Beside the doorway the wall is solid.
      const sx = -d.nz, sz = d.nx, aside = d.w / 2 + 0.4;
      assert.ok(blocked(d.x + sx * aside - d.nx * 0.1, d.z + sz * aside - d.nz * 0.1) || blocked(d.x - sx * aside - d.nx * 0.1, d.z - sz * aside - d.nz * 0.1), `${what}: wall beside the door`);
    }
    // Every outer wall piece is a collider; furniture you walk into is too.
    for (const s of I.storeys) for (const f of s.furniture) if (f.kind === 'bed' || f.kind === 'sofa' || f.kind === 'counter') {
      assert.ok(ind.colliders.some((c) => inBox(c, f.x, base + s.y + Math.min(0.3, f.h / 2), f.z)), `${what}: ${f.kind} is solid`);
    }
    const mb = new MeshBuilder(INTERIOR_SPECS);
    buildIndoors(mb, I, ind);
    assert.ok(!mb.empty, `${what}: a mesh`);
  }
});

test('indoors: the outer walls open where the facade has its windows, every storey of a house looks out', () => {
  for (const b of homes.slice(0, 3)) {
    const I = planInterior(b), ind = indoorsOf(I, 10, windowOpenings(b));
    for (let f = 0; f < I.storeys.length; f++) {
      const ws = ind.outer.filter((w) => w.floor === f);
      assert.ok(ws.some((w) => w.windows.length > 0), `${b.style} floor ${f}: a window`);
      for (const w of ws) {
        const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
        let at = 0;
        for (const [s0, s1, h0, h1] of w.windows) {
          assert.ok(s0 >= at && s0 < s1 && s1 <= L && w.y0 < h0 && h0 < h1 && h1 < w.y1, `${b.style} floor ${f}: opening ${[s0, s1, h0, h1]} in ${L.toFixed(2)} × ${w.y0}–${w.y1}`);
          at = s1;
        }
      }
    }
    const mb = new MeshBuilder(INTERIOR_SPECS);
    buildIndoors(mb, I, ind);
    assert.ok(!mb.empty);
  }
});

test('houses: a few big rooms, not many small ones (three bedrooms to a floor, four to a house at most)', () => {
  const houses = all.filter((b) => !workOf(b) && dwellingsOf(b) === 1 && b.floors >= 2).slice(0, 16);
  assert.ok(houses.length >= 10, `houses looked at (${houses.length})`);
  for (const b of houses) {
    const I = planInterior(b), beds = (rooms: { type: string }[]) => rooms.filter((r) => r.type === 'bedroom').length;
    assert.ok(beds(I.storeys.flatMap((s) => s.rooms)) <= 4, `${b.id}: ${beds(I.storeys.flatMap((s) => s.rooms))} bedrooms`);
    for (const s of I.storeys) assert.ok(beds(s.rooms) <= 3, `${b.id} floor ${s.floor}: ${beds(s.rooms)} bedrooms`);
  }
});
