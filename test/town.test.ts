import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown, dwellingTarget } from '../src/plan/town';
import { MAP_WATER, townMapOf } from '../src/plan/townMap';
import { inSite, siteToWorld, type LandmarkKind } from '../src/plan/landmarks';
import { EATERY_OF, amenityCounts } from '../src/plan/amenities';
import { dwellingsOf } from '../src/plan/building';
import { buildMacroPlan } from '../src/plan/macro';
import { planCell } from '../src/plan/cell';
import { Terrain } from '../src/world/terrain';
import { makeProfile } from '../src/world/settings';
import { pointInPoly, closestOnPolyline } from '../src/geom/geom2';
import { FARM_RING, RoadKind } from '../src/world/rural';
import { RAIL_HW } from '../src/plan/rail';
import { placeGraphOf, buildingRef } from '../src/plan/placeGraph';
import { PLACE_KINDS } from '../src/sim/places';
import { createWorld } from '../src/sim/synth';
import { regionOf } from '../src/plan/region';
import { groundAt, soundAt, soundMapOf } from '../src/audio/soundMap';

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
  const kinds: LandmarkKind[] = ['townhall', 'church', 'school', 'kindergarten', 'clinic', 'fire', 'supermarket', 'sports', 'station', 'carehome', 'petrol'];
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
    assert.equal(b.eatery ?? 0, (b.amenity && EATERY_OF[b.amenity]) || 0);
  }
  const eats = cells.reduce((s, c) => s + c.eateries.length, 0);
  assert.equal(eats, buildings.filter((b) => b.eatery).length);
});

test('the place graph: every home, workplace and street on one connected road network', () => {
  const g = placeGraphOf(town);
  assert.deepEqual(placeGraphOf(town), g, 'deterministic');
  // One network: every node reachable from node 0.
  const adj = g.nodes.map((): number[] => []);
  for (const e of g.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); assert.ok(e.length > 0 && e.walk > 0 && e.walk <= 1); }
  const seen = new Set([0]), stack = [0];
  while (stack.length) for (const v of adj[stack.pop()!]) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  assert.equal(seen.size, g.nodes.length, 'connected');
  // Places: valid kinds and ids, unique names, near their node, every household housed once.
  assert.equal(new Set(g.places.map((p) => p.name)).size, g.places.length, 'unique names');
  for (const [i, p] of g.places.entries()) {
    assert.equal(p.id, i);
    assert.ok(PLACE_KINDS.includes(p.kind), p.kind);
    if (p.kind === 'woods' || p.kind === 'field') continue; // off the road, a walk out
    assert.ok(Math.hypot(g.nodes[p.node].x - p.x, g.nodes[p.node].z - p.z) < 160, `${p.name} near its road`);
    assert.ok(p.street, `${p.name} has an address`);
  }
  // (The care home's rooms are homes too, but not households the planner counts.)
  assert.equal(g.places.reduce((s, p) => s + (p.kind === 'carehome' ? 0 : p.homes), 0), town.dwellings);
  for (const k of ['townhall', 'church', 'school', 'kindergarten', 'doctor', 'fire', 'police', 'supermarket', 'station', 'sports', 'pub', 'farm', 'carehome', 'petrol'] as const)
    assert.ok(g.places.some((p) => p.kind === k), k);
  const ref = buildingRef(g.places.find((p) => p.kind === 'pub')!.building);
  assert.ok(ref && 'cell' in ref && cells[ref.cell].buildings[ref.index].amenity, 'building codes point at the building');
  // Every named street is a place.
  for (const p of g.places) if (p.street) assert.ok(g.places.some((q) => q.kind === 'street' && q.name === p.street), p.street);
  // The society sim takes it as it is: the population lives here and fills the jobs.
  const w = createWorld(g, 1);
  const people = w.people.first.length;
  assert.ok(people > town.dwellings * 1.6 && people < town.dwellings * 3.2, `${people} people in ${town.dwellings} homes`);
  const inTown = w.jobs.filter((j) => w.graph.places[j.place].kind !== 'away');
  assert.ok(inTown.filter((j) => j.holder >= 0).length / inTown.length > 0.9, 'jobs in town filled');
  for (const p of g.places) assert.ok(w.travel.minutes(0, p.id) < 180, `${p.name} reachable`);
});

test('the region follows the town: the big city lies along the railway, nothing out there lies in the sea', () => {
  const region = regionOf(town);
  assert.deepEqual(regionOf(town), region);
  assert.equal(region.places[0].kind, 'city');
  const c0 = macro.centres[0], rail = macro.rail!;
  const east = rail.pts[0] - c0.x, north = -(rail.pts[1] - c0.z);
  const railBearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  const cityBearing = { north: 0, 'north-east': 45, east: 90, 'south-east': 135, south: 180, 'south-west': 225, west: 270, 'north-west': 315 }[region.places[0].dir];
  const off = Math.abs(((cityBearing - railBearing + 540) % 360) - 180);
  assert.ok(off <= 45, `city ${region.places[0].dir}, rail at ${railBearing.toFixed(0)}°`);
});

test('the sound map hears the town: bells at the church tower, gardens in the suburbs, water by the river, country outside', () => {
  const map = soundMapOf(town);
  for (const lm of macro.landmarks.filter((l) => l.kind === 'church')) {
    assert.ok(map.sources.some((s) => s.kind === 'church' && s.x === lm.x && s.z === lm.z && s.y > lm.base + 10), 'bells up in the tower');
  }
  assert.equal(map.sources.filter((s) => s.kind === 'farm').length, rural.farms.length);
  assert.ok(map.sources.some((s) => s.kind === 'garden'));
  const centre = soundAt(map, macro.centres[0].x, macro.centres[0].z);
  assert.ok(centre.built > 0.2 && centre.rural < 0.2, `centre ${JSON.stringify(centre)}`);
  const far = soundAt(map, terrain.profile.radius + 2000, 0);
  assert.ok(far.rural > 0.8 && far.built < 0.05, `country ${JSON.stringify(far)}`);
  for (const river of terrain.rivers) {
    let best = 0;
    for (let i = 0; i < river.pts.length; i += 2) if (Math.hypot(river.pts[i], river.pts[i + 1]) < Math.hypot(river.pts[best], river.pts[best + 1])) best = i;
    if (Math.hypot(river.pts[best], river.pts[best + 1]) < terrain.profile.radius + 1000) assert.ok(soundAt(map, river.pts[best], river.pts[best + 1]).water > 0.5, 'river heard');
  }
  assert.ok(Math.abs(groundAt(map, 0, 0) - terrain.height(0, 0)) < 3);
});

test('the town map: every street in town has its name printed along it, landmarks by name, water where the terrain has it', () => {
  const m = townMapOf(town);
  assert.ok(m.roads.length > 20 && m.buildingEnds.length > 100);
  const named = new Set(m.roads.filter((r) => r.street >= 0).map((r) => r.street));
  for (const s of named) assert.ok(m.streets[s].length > 0, `${m.streets[s].name} has a place for its name`);
  assert.equal(m.landmarks.length, town.macro.landmarks.length);
  // A building code finds its outline (the minimap fills in your home and the building you are in).
  const ci = town.cells.findIndex((c, i) => i > 0 && c.buildings.length > 1);
  const i = m.cellFirst[ci] + 1, at = i ? m.buildingEnds[i - 1] : 0;
  assert.deepEqual(Array.from(m.buildings.subarray(at, m.buildingEnds[i])), Array.from(Float32Array.from(town.cells[ci].buildings[1].poly)));
  const k = m.ground.indexOf(MAP_WATER);
  if (k >= 0) {
    const cell = (2 * m.half) / m.n;
    assert.ok(town.terrain.isWater(m.cx - m.half + ((k % m.n) + 0.5) * cell, m.cz - m.half + (Math.floor(k / m.n) + 0.5) * cell));
  }
});
