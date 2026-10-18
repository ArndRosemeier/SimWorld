import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown, dwellingTarget } from '../src/plan/town';
import { inSite, siteToWorld, type LandmarkKind } from '../src/plan/landmarks';
import { PLACES, amenityCounts, weekly, openAt, type PlaceKind } from '../src/plan/amenities';
import { dwellingsOf } from '../src/plan/building';
import { buildMacroPlan } from '../src/plan/macro';
import { planCell } from '../src/plan/cell';
import { Terrain } from '../src/world/terrain';
import { makeProfile } from '../src/world/settings';
import { pointInPoly, closestOnPolyline } from '../src/geom/geom2';
import { FARM_RING, RoadKind } from '../src/world/rural';
import { RAIL_HW } from '../src/plan/rail';

// One small town shared by the file (planning it is the expensive part).
const town = planTown({ seed: 1, size: 0 });
const { macro, cells, rural, terrain, land } = town;
const buildings = cells.flatMap((c) => c.buildings);

test('planning is deterministic', () => {
  const t = new Terrain(makeProfile({ seed: 7, size: 0 }));
  const a = buildMacroPlan(t), b = buildMacroPlan(new Terrain(makeProfile({ seed: 7, size: 0 })));
  assert.deepEqual(a.nodes.map((n) => [n.x, n.z]), b.nodes.map((n) => [n.x, n.z]));
  assert.deepEqual(a.landmarks.map((l) => [l.kind, l.x, l.z, l.angle]), b.landmarks.map((l) => [l.kind, l.x, l.z, l.angle]));
  assert.deepEqual(a.rail?.pts, b.rail?.pts);
  const c0 = planCell(a, a.cells[0], t), c1 = planCell(b, b.cells[0], t);
  assert.deepEqual(c0.buildings.map((x) => [x.style, x.floors, x.poly]), c1.buildings.map((x) => [x.style, x.floors, x.poly]));
});

test('the town houses about the planned number of households', () => {
  const T = dwellingTarget(0);
  assert.ok(town.dwellings >= T * 0.9 && town.dwellings <= T * 1.1, `${town.dwellings} households for a target of ${T}`);
  assert.equal(town.dwellings, buildings.reduce((s, b) => s + dwellingsOf(b), 0) + rural.farms.length);
});

test('every public building has a site: in its cell or outside the town with an access road', () => {
  const kinds: LandmarkKind[] = ['townhall', 'church', 'school', 'kindergarten', 'clinic', 'fire', 'supermarket', 'sports', 'station'];
  for (const k of kinds) assert.equal(macro.landmarks.filter((l) => l.kind === k).length, 1, k);
  for (const lm of macro.landmarks) {
    const [x, z] = siteToWorld(lm, 0, 0);
    if (lm.cell >= 0) assert.ok(pointInPoly(macro.cells[lm.cell].poly, x, z), `${lm.kind} in its cell`);
    else {
      assert.ok(land.edge(x, z) > 0, `${lm.kind} outside the town`);
      assert.ok(lm.road && lm.road.length >= 4, `${lm.kind} has an access road`);
    }
    // No two sites overlap, and no building stands on one.
    for (const o of macro.landmarks) if (o !== lm) assert.ok(!inSite(o, lm.x, lm.z), `${lm.kind} clear of ${o.kind}`);
  }
  for (const b of buildings) for (let i = 0; i < b.poly.length; i += 2) {
    const lm = macro.landmarks.find((l) => inSite(l, b.poly[i], b.poly[i + 1], -1));
    assert.ok(!lm, `a building corner on the ${lm?.kind} site`);
  }
});

test('the railway passes outside the town and the station stands by it', () => {
  const rail = macro.rail!;
  assert.ok(rail, 'a railway');
  for (let i = 0; i < rail.pts.length; i += 2) assert.ok(land.edge(rail.pts[i], rail.pts[i + 1]) > 30, 'outside the town');
  const st = macro.landmarks.find((l) => l.kind === 'station')!;
  const [px, pz] = siteToWorld(st, 0, st.hv);
  assert.ok(closestOnPolyline(rail.pts, px, pz).d < RAIL_HW + 3, 'the platform edge is at the track');
});

test('the countryside: roads out to the edge of the world, farms in the farm ring with tracks', () => {
  const out = rural.roads.filter((r) => r.kind === RoadKind.Main && r.site < 0);
  assert.ok(out.length >= 2, `${out.length} roads out`);
  for (const r of out) {
    const n = r.pts.length;
    assert.ok(Math.max(Math.abs(r.pts[n - 2]), Math.abs(r.pts[n - 1])) > terrain.worldExtent - 400, 'reaches the edge');
  }
  assert.ok(rural.farms.length > 0);
  for (const f of rural.farms) {
    const e = land.edge(f.x, f.z);
    assert.ok(e >= FARM_RING[0] && e <= FARM_RING[1], `farm ${Math.round(e)} m out`);
    assert.equal(rural.roads[f.road].farm, f.id);
    assert.ok(rural.layout(f.id).buildings.length >= 2, 'a farmhouse and a barn');
  }
  for (const c of rural.crossings) assert.ok(closestOnPolyline(macro.rail!.pts, c.x, c.z).d < 1, 'level crossings are on the line');
});

test('every service a town needs is in a building, and eateries have their kind', () => {
  const have = new Map<string, number>();
  for (const b of buildings) if (b.amenity) have.set(b.amenity, (have.get(b.amenity) ?? 0) + 1);
  for (const [k, n] of amenityCounts(town.dwellings * 2.2, terrain.profile.warmth)) assert.ok((have.get(k) ?? 0) >= n, `${k}: ${have.get(k) ?? 0} of ${n}`);
  for (const b of buildings) {
    if (b.shopfront) assert.ok(b.amenity, 'every shop front has a use');
    assert.equal(b.eatery ?? 0, (b.amenity && PLACES[b.amenity].eatery) || 0);
  }
  const eats = cells.reduce((s, c) => s + c.eateries.length, 0);
  assert.equal(eats, buildings.filter((b) => b.eatery).length);
});

test('the place table: hours parse, public places are staffed', () => {
  for (const [k, p] of Object.entries(PLACES) as [PlaceKind, (typeof PLACES)[PlaceKind]][]) {
    if (p.hours) assert.ok(weekly(p.hours).length > 0, k);
    for (const s of p.staff) {
      if (s.shifts) weekly(s.shifts);
      assert.ok(s.count(1000) >= 1 && s.minAge >= 16, `${k} ${s.role}`);
    }
    if (p.hours && k !== 'park' && k !== 'plaza') assert.ok(p.staff.length > 0, `${k} is staffed`);
  }
});

test('weekly hours: ranges, lists, spans past midnight', () => {
  const h = weekly('Mo-Fr 8-18; Sa,Su 10-12.5; Fr 20-26');
  assert.equal(h.length, 8);
  assert.ok(openAt(h, 0, 8) && !openAt(h, 0, 18) && openAt(h, 6, 12.25) && !openAt(h, 6, 13));
  assert.ok(openAt(h, 4, 23) && openAt(h, 5, 1.5) && !openAt(h, 5, 2));
  assert.throws(() => weekly('Mo-Fx 8-18'));
  assert.throws(() => weekly('Fr-Mo 8-18'));
  assert.throws(() => weekly('Mo 18-8'));
});
