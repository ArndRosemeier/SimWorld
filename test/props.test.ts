import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundOf } from '../src/build/drawnGround';
import { planTown } from '../src/plan/town';
import type { MeshData } from '../src/build/meshBuilder';
import { VEHICLE_SPECS } from '../src/build/vehicles';
import { FURNITURE_KINDS, FURNITURE_SPECS, buildFurniture, furnitureModel } from '../src/build/furniture';
import { LAMP_STRIDE, PROP_STRIDE, lampsOf, propFar, propInstances, propModel } from '../src/build/streetProps';
import { PICTURES, SLOT_SIZES, SlotPacker, pictureRect, slotRect, type AtlasRect, type Slot, type SlotSize } from '../src/build/textAtlasLayout';
import { townRoads } from '../src/plan/roads';
import { placeGraphOf } from '../src/plan/placeGraph';
import { clockSpots, signFootprints, signSpots } from '../src/plan/signs';
import { BOARD_KINDS } from '../src/sim/placeKinds';
import { SIGN_STRIDE, signInstances } from '../src/build/signs';
import { distSqPointSeg, pointInPoly } from '../src/geom/geom2';
import { BAY_LENGTH, SETBACK } from '../src/plan/cell';
import { footprintsOf } from '../src/plan/footprints';
import { box, cylinder, lathe, sphere, torus, icosphere, tube, CatmullRom, xform, M, type Prim } from '../src/build/prims';

/** Indices in range, finite positions, unit normals, the kind's attributes in full. */
function assertSound(d: MeshData, specs: { name: string; size: number }[], what: string): void {
  const P = d.attrs.position.array, N = d.attrs.normal.array, I = d.index, nv = P.length / 3;
  assert.ok(nv > 0 && I.length > 0 && I.length % 3 === 0, `${what}: ${nv} vertices, ${I.length} indices`);
  assert.deepEqual(Object.keys(d.attrs).sort(), ['position', 'normal', ...specs.map((s) => s.name)].sort(), what);
  for (const s of specs) assert.equal(d.attrs[s.name].array.length, nv * s.size, `${what}: ${s.name}`);
  for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) assert.fail(`${what}: position ${i} is ${P[i]}`);
  for (let i = 0; i < N.length; i += 3) if (!(Math.abs(Math.hypot(N[i], N[i + 1], N[i + 2]) - 1) < 1e-3)) assert.fail(`${what}: normal of vertex ${i / 3}`);
  for (let i = 0; i < I.length; i++) if (I[i] >= nv) assert.fail(`${what}: index ${I[i]} of ${nv}`);
}

/** Outward normals: the normal of each vertex points away from the solid's centre (convex solids). */
function assertOutward(p: Prim, what: string): void {
  let cx = 0, cy = 0, cz = 0;
  const n = p.pos.length / 3;
  for (let i = 0; i < n; i++) { cx += p.pos[i * 3] / n; cy += p.pos[i * 3 + 1] / n; cz += p.pos[i * 3 + 2] / n; }
  for (let t = 0; t < p.idx.length; t += 3) {
    const [a, b, c] = [p.idx[t] * 3, p.idx[t + 1] * 3, p.idx[t + 2] * 3];
    const ux = p.pos[b] - p.pos[a], uy = p.pos[b + 1] - p.pos[a + 1], uz = p.pos[b + 2] - p.pos[a + 2];
    const vx = p.pos[c] - p.pos[a], vy = p.pos[c + 1] - p.pos[a + 1], vz = p.pos[c + 2] - p.pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-9) continue;
    const mx = (p.pos[a] + p.pos[b] + p.pos[c]) / 3 - cx, my = (p.pos[a + 1] + p.pos[b + 1] + p.pos[c + 1]) / 3 - cy, mz = (p.pos[a + 2] + p.pos[b + 2] + p.pos[c + 2]) / 3 - cz;
    assert.ok(fx * mx + fy * my + fz * mz > 0, `${what}: triangle ${t / 3} winds inwards`);
    const nx = p.nrm[a], ny = p.nrm[a + 1], nz = p.nrm[a + 2];
    assert.ok(nx * fx + ny * fy + nz * fz > -1e-9, `${what}: triangle ${t / 3} normal against its winding`);
  }
}

test('the solids wind outwards with their normals (as three.js builds them), also moved and turned', () => {
  assertOutward(box(1, 2, 3), 'box');
  assertOutward(cylinder(0.5, 0.7, 2, 12), 'cylinder');
  assertOutward(sphere(1, 12, 8), 'sphere');
  assertOutward(icosphere(1, 2), 'icosphere');
  assertOutward(lathe([[0, 0], [1, 0], [1, 1], [0, 1]], 16), 'lathe (profile bottom to top)');
  assertOutward(xform(box(1, 1, 1), M(3, 1, 2, 0.4, 1.1, -0.3, 2, 1, 0.5)), 'box turned, stretched');
  // Torus and tube are not convex: check the normals against the winding only.
  for (const [p, w] of [[torus(1, 0.2, 8, 16), 'torus'], [tube(new CatmullRom([[0, 0, 0], [0, 1, 0.3], [0.5, 2, 0]]), 12, 0.1, 8), 'tube']] as [Prim, string][]) {
    for (let t = 0; t < p.idx.length; t += 3) {
      const [a, b, c] = [p.idx[t] * 3, p.idx[t + 1] * 3, p.idx[t + 2] * 3];
      const ux = p.pos[b] - p.pos[a], uy = p.pos[b + 1] - p.pos[a + 1], uz = p.pos[b + 2] - p.pos[a + 2];
      const vx = p.pos[c] - p.pos[a], vy = p.pos[c + 1] - p.pos[a + 1], vz = p.pos[c + 2] - p.pos[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (Math.hypot(fx, fy, fz) < 1e-9) continue;
      assert.ok(p.nrm[a] * fx + p.nrm[a + 1] * fy + p.nrm[a + 2] * fz > 0, `${w}: triangle ${t / 3}`);
    }
  }
});

test('every furniture kind and variant builds a sound mesh with valid material ids, deterministically', () => {
  for (const kind of FURNITURE_KINDS) for (const v of [0, 1]) {
    const m = furnitureModel(kind, v), what = `${kind}:${v}`;
    assertSound(m.mesh, FURNITURE_SPECS, what);
    assert.ok(m.height > 0 && m.radius > 0, what);
    const F = m.mesh.attrs.aFurn.array;
    for (let i = 0; i < F.length; i += 3) {
      if (!(Number.isInteger(F[i]) && F[i] >= 0 && F[i] <= 11)) assert.fail(`${what}: material ${F[i]}`);
      if (!(F[i + 1] >= 0 && F[i + 1] <= 1)) assert.fail(`${what}: emissive ${F[i + 1]}`);
      if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(F[i + 2])) assert.fail(`${what}: sub-material ${F[i + 2]}`);
    }
  }
  for (const kind of ['trafficLight', 'statue', 'playground'] as const) {
    const a = buildFurniture(kind, 1).mesh, b = buildFurniture(kind, 1).mesh;
    assert.deepEqual(a.attrs.position.array, b.attrs.position.array, kind);
    assert.deepEqual(a.index, b.index, kind);
  }
});

// One small town for the file (planning it is the expensive part).
const town = planTown({ seed: 3, size: 0 });

test('the town\'s props become instance lists of buildable models, on the ground, deterministic', () => {
  const groups = propInstances(town.cells, groundOf(town));
  assert.deepEqual(propInstances(town.cells, groundOf(town)), groups);
  const keys = groups.map((g) => g.model);
  assert.equal(new Set(keys).size, keys.length, 'one list per model');
  for (const k of ['f:lampModern:0', 'f:trafficLight:', 'v:sedan:'] as const) assert.ok(keys.some((m) => m.startsWith(k)), `${k} in ${keys.join(' ')}`);
  let cars = 0;
  for (const g of groups) {
    const I = g.inst;
    assert.ok(I.length > 0 && I.length % PROP_STRIDE === 0, g.model);
    for (let o = 0; o < I.length; o += PROP_STRIDE) {
      const x = I[o], y = I[o + 1], z = I[o + 2], h = town.terrain.height(x, z);
      if (!(Number.isFinite(y) && y >= h - 0.01 && y < h + 1)) assert.fail(`${g.model} at ${x}, ${z}: y ${y}, ground ${h}`);
      for (let k = 5; k < 8; k++) if (!(I[o + k] >= 0 && I[o + k] <= 1)) assert.fail(`${g.model}: colour ${I[o + k]}`);
      if (g.model.startsWith('v:')) { cars++; assert.ok(I[o + 5] + I[o + 6] + I[o + 7] > 0, 'every car has its paint'); }
    }
  }
  assert.ok(cars > 50, `${cars} parked cars`);
  // Without the kerb cars (the traffic stands its household cars there) only the car parks' remain.
  const lots = propInstances(town.cells, groundOf(town), { kerbCars: false }).filter((g) => g.model.startsWith('v:')).reduce((n, g) => n + g.inst.length / PROP_STRIDE, 0);
  assert.ok(lots < cars, `${lots} cars in the car parks of ${cars}`);
  assertSound(propModel('f:bench:0'), FURNITURE_SPECS, 'propModel');
  assertSound(propFar(keys.find((k) => k.startsWith('v:'))!)!, VEHICLE_SPECS, 'far vehicle');
  assert.equal(propFar('f:bench:0'), null);
  // Every lamp head: above its lamp's foot, by the light's height in the model.
  const lamps = lampsOf(groups), feet = groups.filter((g) => g.model.startsWith('f:lamp'));
  assert.ok(lamps.length > 0 && lamps.length % LAMP_STRIDE === 0);
  assert.ok(lamps.length / LAMP_STRIDE >= feet.reduce((n, g) => n + g.inst.length / PROP_STRIDE, 0), 'a head per lamp at least');
  for (let o = 0; o < lamps.length; o += LAMP_STRIDE) {
    const h = town.terrain.height(lamps[o], lamps[o + 2]);
    if (!(lamps[o + 1] > h + 3 && lamps[o + 1] < h + 12 && [0, 1, 2].includes(lamps[o + 3]))) assert.fail(`lamp head ${o / LAMP_STRIDE}: y ${lamps[o + 1]} over ${h}, kind ${lamps[o + 3]}`);
  }
});

test('the text atlas: pictures at the top left, lettering slots handed out round them, none overlapping, reused when given back', () => {
  const packer = new SlotPacker(), sizes = Object.keys(SLOT_SIZES) as SlotSize[];
  const slots: Slot[] = [];
  // Fill it with a mix of sizes until nothing fits.
  for (let k = 0; ; k++) {
    const s = packer.take(sizes[k % sizes.length]) ?? sizes.map((z) => packer.take(z)).find((x) => x) ?? null;
    if (!s) break;
    slots.push(s);
  }
  // Nearly all of the atlas but the pictures is lettering (2048 × 4096 less 1024 × 1024).
  const area = slots.reduce((a, s) => a + s.w * s.h, 0);
  assert.ok(area > 0.95 * (2048 * 4096 - 1024 * 1024), `${slots.length} slots, ${area} px`);
  const rects: [AtlasRect, string][] = [
    ...Array.from({ length: PICTURES }, (_, i) => [pictureRect(i), `picture ${i}`] as [AtlasRect, string]),
    ...slots.map((s, i) => [slotRect(s), `slot ${i} (${s.size})`] as [AtlasRect, string]),
  ];
  for (const [[u0, v0, u1, v1], w] of rects) assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u0 < u1 && v0 < v1, w);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, b] = [rects[i][0], rects[j][0]];
    if (!(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1])) assert.fail(`${rects[i][1]} overlaps ${rects[j][1]}`);
  }
  packer.give(slots[3]);
  assert.deepEqual(packer.take(slots[3].size), slots[3]);
  assert.equal(packer.take(slots[3].size), null);
});

// ---- signs (src/plan/signs.ts, src/build/signs.ts), on the same town ----

const roads = townRoads(town);

test('signs: every workplace has its sign on its front, every home a board spot, corners and gateways clear of the road', () => {
  const spots = signSpots(town, roads);
  const workplaces = town.cells.flatMap((c) => c.buildings).filter((b) => (b.amenity && b.amenity !== 'vacant') || b.shopfront).length;
  assert.equal(spots.fronts.length, workplaces);
  for (const f of spots.fronts) {
    const b = town.cells[f.code >>> 16].buildings[f.code & 0xffff];
    // On the wall (just outside the footprint, not inside), under the eaves, of a sensible size.
    assert.ok(!pointInPoly(b.poly, f.x, f.z) || f.style === 'hanging', `front ${f.code} (${f.style}) inside its building`);
    assert.ok(f.y > 1 && f.y < b.groundH + (b.floors - 1) * b.floorH, `front ${f.code} at ${f.y} m`);
    assert.ok(f.width > 0.3 && f.width < 30 && f.height > 0.04 && f.height < 2, `front ${f.code} ${f.width} × ${f.height}`);
  }
  assert.ok(spots.homes.length > 100);
  assert.ok(spots.corners.length >= 10, `${spots.corners.length} corners`);
  for (const c of [...spots.corners, ...spots.gateways]) {
    const hit = roads.nearest(c.x, c.z, 30);
    if (hit) assert.ok(hit.d > roads.lines[hit.li].width / 2 - 0.3, `sign at ${c.x.toFixed(1)}, ${c.z.toFixed(1)} on the carriageway (${hit.d.toFixed(2)} m from the centre)`);
  }
  for (const c of spots.corners) assert.notEqual(c.blades[0].street, c.blades[1].street);
  assert.ok(spots.gateways.length >= 1, 'a town sign on a road into town');
  assert.equal(spots.sites.length, town.macro.landmarks.length);
  // Street-name posts stand in the kerb strip, with the lamps: within a metre of a kerb.
  for (const c of spots.corners) {
    const hit = roads.nearest(c.x, c.z, 30)!, L = roads.lines[hit.li];
    assert.ok(hit.d - L.width / 2 < 1.0, `corner post ${(hit.d - L.width / 2).toFixed(2)} m in from the kerb`);
  }
  // Posters on lamp posts: a few per street, on the pavement side of a post.
  assert.ok(spots.posters.length >= 10, `${spots.posters.length} lamp posters`);
  for (const p of spots.posters) {
    const hit = roads.nearest(p.x, p.z, 30)!;
    assert.ok(hit.d > roads.lines[hit.li].width / 2, `poster at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} over the carriageway`);
    assert.ok(p.k < 3);
  }
});

test('signs: instance lists tie every sign to what it says, on the ground or the wall', () => {
  const graph = placeGraphOf(town);
  const data = signInstances(town, roads, graph.places, 'Testford');
  let n = 0;
  for (const g of data.groups) {
    assert.equal(g.inst.length % SIGN_STRIDE, 0, g.model);
    for (let o = 0; o < g.inst.length; o += SIGN_STRIDE, n++) {
      const [x, y, z] = [g.inst[o], g.inst[o + 1], g.inst[o + 2]], w = g.inst[o + 6];
      assert.ok(Number.isInteger(w) && w >= 0 && w < data.what.length, `${g.model}: what ${w}`);
      const h = town.terrain.height(x, z);
      // (Up to a town hall tower's clock.)
      if (!(y > h - 1.5 && y < h + 45)) assert.fail(`${g.model} at ${y.toFixed(2)} over ground ${h.toFixed(2)}`);
    }
  }
  assert.ok(n > 300, `${n} sign instances`);
  const shops = graph.places.filter((p) => p.kind !== 'house' && p.kind !== 'apartments' && p.building >= 0 && p.building < 0x40000000).length;
  assert.ok(data.what.filter((w) => w.t === 'front').length >= shops * 0.95, 'nearly every workplace has its sign');
  assert.ok(data.what.some((w) => w.t === 'street') && data.what.some((w) => w.t === 'town' && w.back));
  // A notice board at (nearly) every board place, its pins tied to that place.
  const boardPlaces = graph.places.filter((p) => BOARD_KINDS.includes(p.kind));
  // The notice boards' and other signs' legs and posts are footprints for the walkers.
  const spots = signSpots(town, roads, graph.places), fp = signFootprints(spots);
  assert.ok(spots.boards.length >= boardPlaces.length * 0.8 && fp.length / 3 >= spots.corners.length + spots.sites.length * 2, `${fp.length / 3} sign footprints`);
  const pinned = new Set(data.what.flatMap((w) => (w.t === 'notice' && !w.every && w.k === 5 ? [w.place] : [])));
  assert.ok(pinned.size >= boardPlaces.length * 0.8, `${pinned.size} boards for ${boardPlaces.length} board places`);
  assert.ok(data.what.some((w) => w.t === 'notice' && w.every), 'posters on the lamp posts');
  // Public clocks: on the church tower (and the town hall's tower, the station's gable), looking out of the building.
  const clocks = clockSpots(town);
  const church = town.macro.landmarks.find((l) => l.kind === 'church')!;
  assert.ok(clocks.some((c) => Math.hypot(c.x - church.x, c.z - church.z) < church.hu + church.hv), 'a clock on the church');
  for (const c of clocks) {
    const lm = town.macro.landmarks.filter((l) => l.kind === 'townhall' || l.kind === 'church' || l.kind === 'station')
      .sort((a, b) => Math.hypot(c.x - a.x, c.z - a.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
    const h = town.terrain.height(c.x, c.z);
    assert.ok(c.size > 1 && c.y > h + 4, `a clock up on the ${lm.kind}`);
    // Its front (-sin yaw, -cos yaw) faces away from the site's middle (towers stand at the front).
    assert.ok(-Math.sin(c.yaw) * (c.x - lm.x) - Math.cos(c.yaw) * (c.z - lm.z) > -0.5, `the ${lm.kind}'s clock faces out`);
  }
  assert.equal(data.what.filter((w) => w.t === 'clock').length, 1, 'all clocks show the one time');
  // The council's works boards (by the road into town, at the sports ground) and the shops' sale signs and banners.
  assert.ok(spots.works.some((w) => w.at === 'gateway') && data.what.some((w) => w.t === 'works'), 'a works board by the road into town');
  for (const w of spots.works) assert.ok(spots.gateways.every((g) => Math.hypot(g.x - w.x, g.z - w.z) > 3), 'the works board stands clear of the town sign');
  const fascias = data.what.filter((w) => w.t === 'front' && w.style === 'fascia').length;
  assert.equal(data.what.filter((w) => w.t === 'sale').length, fascias, 'a sale sign spot in every shop window');
  assert.equal(data.what.filter((w) => w.t === 'banner').length, fascias, 'a banner spot under every fascia');
});

test('parked cars stand in kerbside bays, on the carriageway, clear of the cross streets', () => {
  const { cells } = planTown({ seed: 2, size: 0 });
  let cars = 0, bays = 0;
  for (const p of cells) {
    const inBay = new Set(p.parking.filter((b) => b.car).map((b) => `${b.x},${b.z}`));
    for (const b of p.parking) {
      bays++;
      for (let k = 0; k < p.streets.length; k++) {
        if (k === b.street) continue;
        const o = p.streets[k], clear = o.width / 2 + SETBACK + BAY_LENGTH / 2;
        for (let i = 0; i + 3 < o.pts.length; i += 2) {
          const d = Math.sqrt(distSqPointSeg(b.x, b.z, o.pts[i], o.pts[i + 1], o.pts[i + 2], o.pts[i + 3]));
          if (d < clear) assert.fail(`cell ${p.id}: a bay ${d.toFixed(1)} m from street ${k}'s centre line (${clear.toFixed(1)} needed)`);
        }
      }
      assert.ok(onCarriageway(p, b.x, b.z), `cell ${p.id}: bay off the carriageway`);
    }
    for (let i = 0; i < p.props.length; i += 6) {
      if (p.props[i] !== 6 && p.props[i] !== 32) continue; // PropType.ParkedCar, KerbCar
      // (Cars in the car parks of the supermarket and the sports grounds stand off the streets.)
      if (!onCarriageway(p, p.props[i + 1], p.props[i + 2])) continue;
      cars++;
      assert.ok(inBay.has(`${p.props[i + 1]},${p.props[i + 2]}`), `cell ${p.id}: a parked car outside the bays`);
    }
  }
  assert.ok(cars > 30 && bays > cars, `${cars} cars in ${bays} bays`);
});

test('the walk along a sidewalk stays clear of the street furniture, and the footprints say where things stand', () => {
  const { cells } = planTown({ seed: 2, size: 0 });
  let probes = 0;
  for (const p of cells) {
    const fp = footprintsOf([p]), C = fp.circles, near: number[] = [];
    for (const v of C) assert.ok(Number.isFinite(v));
    // Walking line: 1.5 m in from the kerb (past the furniture strip), every 2 m along both sides.
    for (const st of p.streets) {
      if (st.sidewalk < 1.6 + 1.5 || st.cls === 4) continue; // RoadClass.Path
      // (Not round the corners at its ends, where another street's furniture strip begins.)
      let total = 0, acc = 0;
      for (let i = 0; i + 3 < st.pts.length; i += 2) total += Math.hypot(st.pts[i + 2] - st.pts[i], st.pts[i + 3] - st.pts[i + 1]);
      for (let i = 0; i + 3 < st.pts.length; i += 2, acc += Math.hypot(st.pts[i] - st.pts[i - 2], st.pts[i + 1] - st.pts[i - 1])) {
        const ax = st.pts[i], az = st.pts[i + 1], dx = st.pts[i + 2] - ax, dz = st.pts[i + 3] - az, L = Math.hypot(dx, dz);
        for (let s = 1; s < L; s += 2) for (const side of [-1, 1]) {
          if (acc + s < st.width + 4 || acc + s > total - st.width - 4) continue;
          const off = st.width / 2 + 1.5, x = ax + (dx / L) * s - (dz / L) * off * side, z = az + (dz / L) * s + (dx / L) * off * side;
          for (const c of fp.circlesNear(x, z, 0.1, near)) {
            if (Math.hypot(C[c * 3] - x, C[c * 3 + 1] - z) >= C[c * 3 + 2] + 0.1) continue;
            const t = fp.kinds[c];
            if (STREET_FURNITURE.has(t)) assert.fail(`cell ${p.id}: prop type ${t} stands in the walk at ${x.toFixed(1)}, ${z.toFixed(1)}`);
          }
          probes++;
        }
      }
    }
  }
  assert.ok(probes > 1000, `${probes} probes`);
});

/** Types the street furniture pass puts along the kerb: lamps, trees, benches, bins, hydrants, mailboxes, planters. */
const STREET_FURNITURE = new Set([0, 1, 2, 3, 4, 13, 19]);
function onCarriageway(p: { carriageway: { outer: number[]; holes: number[][] }[] }, x: number, z: number): boolean {
  return p.carriageway.some((c) => pointInPoly(c.outer, x, z) && !c.holes.some((h) => pointInPoly(h, x, z)));
}
