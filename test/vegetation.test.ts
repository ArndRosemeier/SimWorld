import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundOf } from '../src/build/drawnGround';
import { planTown } from '../src/plan/town';
import type { MeshData } from '../src/build/meshBuilder';
import { BARK_SPECS, FAR_SPECS, LEAF_SPECS, VEG_MODELS, buildVegModel, vegModelIndex } from '../src/build/vegetation';
import { FOREST_STRIDE, ForestGen, townTrees } from '../src/build/forest';
import { Paint2D } from '../src/build/paint2d';
import { barkStrip, packBark } from '../src/build/vegetationTex';

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

// (Three parts: about 12 ms a model.)
for (const part of [0, 1, 2]) test(`every vegetation model builds sound wood, leaves and far hull (part ${part + 1} of 3)`, () => {
  VEG_MODELS.forEach((m, i) => {
    if (i % 3 !== part) return;
    const what = `${m.species} ${m.variant}`, d = buildVegModel(i);
    assertSound(d.leaves, LEAF_SPECS, `${what} leaves`);
    assertSound(d.far, FAR_SPECS, `${what} far`);
    if (d.wood.index.length) assertSound(d.wood, BARK_SPECS, `${what} wood`);
    assert.ok(d.height > 0.5 && d.height < 40 && d.crownRadius > 0.3, `${what}: ${d.height} m tall`);
    // the far hull stands on the ground and reaches about the tree's height
    const P = d.far.attrs.position.array;
    let y0 = Infinity, y1 = -Infinity;
    for (let k = 1; k < P.length; k += 3) { y0 = Math.min(y0, P[k]); y1 = Math.max(y1, P[k]); }
    assert.ok(y0 < 0.5 && Math.abs(y1 - d.height) < d.height * 0.4, `${what}: far hull ${y0}…${y1} for ${d.height}`);
  });
});

test('vegetation models are deterministic', () => {
  const i = vegModelIndex('oak', 1), a = buildVegModel(i), b = buildVegModel(i);
  assert.deepEqual(a.leaves.attrs.position.array, b.leaves.attrs.position.array);
  assert.deepEqual(a.wood.index, b.wood.index);
});

const town = planTown({ seed: 3, size: 0 });

test("the town's trees stand on its props, deterministic, with known models", () => {
  const a = townTrees(town.cells, town.terrain, groundOf(town)), b = townTrees(town.cells, town.terrain, groundOf(town));
  assert.ok(a.length > 0 && a.length % FOREST_STRIDE === 0);
  assert.deepEqual(a, b);
  for (let o = 0; o < a.length; o += FOREST_STRIDE) {
    assert.ok(Number.isInteger(a[o + 5]) && a[o + 5] >= 0 && a[o + 5] < VEG_MODELS.length, `model ${a[o + 5]}`);
    assert.ok(Math.abs(a[o + 1] - town.terrain.height(a[o], a[o + 2])) < 1, 'on the ground');
  }
});

test('a forest tile is deterministic and stays inside its tile', () => {
  // just outside the town (planned round the origin)
  const x0 = town.terrain.profile.radius + 300, z0 = -128;
  const a = new ForestGen(town.land, town.macro).tile(x0, z0, 256), b = new ForestGen(town.land, town.macro).tile(x0, z0, 256);
  assert.deepEqual(a, b);
  for (let o = 0; o < a.length; o += FOREST_STRIDE) {
    assert.ok(a[o] >= x0 && a[o] <= x0 + 256 && a[o + 2] >= z0 && a[o + 2] <= z0 + 256, 'inside');
    assert.ok(a[o + 3] > 0 && a[o + 5] >= 0 && a[o + 5] < VEG_MODELS.length);
  }
});

test('Paint2D fills a rectangle and an ellipse (a 10-gon at this size) by their areas', () => {
  const p = new Paint2D(32, 32);
  p.fillStyle = [255, 0, 0, 1];
  p.beginPath(); p.rect(4, 4, 8, 8); p.fill();
  p.beginPath(); p.ellipse(24, 24, 6, 6, 0); p.fill();
  const px = p.imageData();
  let rect = 0, disc = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const a = px[(y * 32 + x) * 4 + 3] / 255;
    if (x < 16 && y < 16) rect += a; else disc += a;
  }
  assert.ok(Math.abs(rect - 64) < 0.5, `rect ${rect}`);
  assert.ok(Math.abs(disc - 5 * 36 * Math.sin(Math.PI / 5)) < 0.5, `disc ${disc}`);
});

test('bark strips pack into one atlas, deterministic', () => {
  const s = [barkStrip(0, 16, 32), barkStrip(1, 16, 32)];
  assert.deepEqual(barkStrip(0, 16, 32).albedo, s[0].albedo);
  const atlas = packBark(s);
  assert.equal(atlas.width, 32);
  assert.equal(atlas.height, 32);
  assert.equal(atlas.albedo.length, 32 * 32 * 4);
  assert.ok(atlas.normal && atlas.normal.length === atlas.albedo.length);
});
