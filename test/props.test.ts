import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import type { MeshData } from '../src/build/meshBuilder';
import { FURNITURE_KINDS, FURNITURE_SPECS, buildFurniture, furnitureModel } from '../src/build/furniture';
import { PROP_STRIDE, propInstances, propModel } from '../src/build/streetProps';
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
      if (![0, 1, 2, 3, 4, 5, 7, 8, 9, 10].includes(F[i + 2])) assert.fail(`${what}: sub-material ${F[i + 2]}`);
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
  const groups = propInstances(town.cells, town.terrain);
  assert.deepEqual(propInstances(town.cells, town.terrain), groups);
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
  assertSound(propModel('f:bench:0'), FURNITURE_SPECS, 'propModel');
});
