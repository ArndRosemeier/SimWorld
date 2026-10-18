import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Mesh, Object3D } from 'three/webgpu';
import { bandPlane, buildBody, loadHumanAssets, randomAppearance, setHumanAssetBase, toSocket, type BodyData } from '@futuremagic/humanoid';
import { WARDROBE } from '../src/render/people/wardrobe';
import { BANDS } from '../src/render/people/hats';

// The humanoid assets come from disk (node's fetch does not read file:// URLs).
const base = new URL('../vendor/assetgenerator/packages/humanoid/assets/', import.meta.url);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string | URL) => {
  if (!String(u).startsWith('file:')) return realFetch(u);
  const b = readFileSync(fileURLToPath(String(u)));
  return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}) as typeof fetch;
setHumanAssetBase(base.href);

type V3 = [number, number, number];
const vis = { shape: 'cloth', seed: 3, primary: [0.6, 0.2, 0.2] as V3, secondary: [0.1, 0.1, 0.1] as V3, accent: [0.1, 0.1, 0.1] as V3, material: 'plain', glow: 0, wear: 0.1 };

/** A hat's triangles (head-socket space), binned by azimuth round the head's centre. */
function triangles(o: Object3D, c: V3): { tris: V3[][]; bins: number[][] } {
  const tris: V3[][] = [];
  o.traverse((m) => {
    const g = (m as Mesh).geometry;
    if (!g) return;
    const p = g.attributes.position, idx = g.index!, off = (m as Mesh).position;
    const v = (i: number): V3 => [p.getX(i) + off.x, p.getY(i) + off.y, p.getZ(i) + off.z];
    for (let i = 0; i < idx.count; i += 3) tris.push([v(idx.getX(i)), v(idx.getX(i + 1)), v(idx.getX(i + 2))]);
  });
  const N = 36, bins: number[][] = Array.from({ length: N }, () => []);
  const binOf = (p: V3) => Math.floor(((Math.atan2(p[0] - c[0], p[2] - c[2]) / (Math.PI * 2)) * N + N) % N);
  tris.forEach((t, k) => {
    const near = Math.min(...t.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2])));
    const bs = new Set(t.map(binOf));
    // Near the axis a triangle can face any way: in every bin.
    if (near < 0.02) bins.forEach((b) => b.push(k));
    else {
      const [lo, hi] = [Math.min(...bs), Math.max(...bs)];
      const span = hi - lo > N / 2 ? [...bs] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      for (const b of span) for (const d of [-1, 0, 1]) bins[(b + d + N) % N].push(k);
    }
  });
  return { tris, bins };
}

/** How far out from `c` along `dir` the outermost of `ks` triangles is (−1: none there). */
function hitOut(c: V3, dir: V3, tris: V3[][], ks: number[]): number {
  let best = -1;
  for (const k of ks) {
    const [a, b, d] = tris[k];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > best) best = t;
  }
  return best;
}

/** The skull points (head-socket space) above a hat's band, every `step`th. */
function skullAbove(b: BodyData, as: Awaited<ReturnType<typeof loadHumanAssets>>, plane: [number, number, number, number], step: number): V3[] {
  const head = as.boneByName.get('head')!, out: V3[] = [];
  for (let v = 0; v < as.manifest.groups.tongue[0]; v += step) {
    if (as.skinIdx[v * 4] !== head || as.skinW[v * 4] < 128) continue;
    const p = toSocket(b.sockets.head, b.pos, v * 3);
    if (plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] > plane[3] + 0.002) out.push(p);
  }
  return out;
}

test('hats fit the head: no skull pokes through any hat on any head, and caps and beanies sit on it, not perched', async () => {
  const as = await loadHumanAssets();
  // A spread of heads: men and women, a child, an old man, a heavy and a slight build.
  const people = [
    randomAppearance('human', 11, { gender: 0.96, age: 0.5 }),
    { ...randomAppearance('human', 12, { gender: 0.04, age: 0.45 }), weight: 0.9 },
    randomAppearance('human', 13, { gender: 0.5, age: 0.12 }),
    { ...randomAppearance('human', 14, { gender: 0.96, age: 0.9 }), weight: 0.1 },
  ];
  for (const app of people) {
    const b = buildBody(as, app), h = b.fit.head!;
    for (const id of ['cap', 'beanie', 'witchHat'] as const) {
      const spec = WARDROBE.resolve(id, vis)!;
      const part = spec.layers[0];
      assert.equal(part.kind, 'rigid');
      const hat = part.kind === 'rigid' ? part.build(b.fit) : null!;
      const { tris, bins } = triangles(hat, h.c);
      assert.ok(tris.every((t) => t.every((p) => p.every(Number.isFinite))), `${id}: every point is a number`);
      const skull = skullAbove(b, as, bandPlane(h, BANDS[id]), 1);
      assert.ok(skull.length > 60, `${id}: the skull over the band`);
      let worst = Infinity, top = 0, topN = 0;
      for (const p of skull) {
        const d: V3 = [p[0] - h.c[0], p[1] - h.c[1], p[2] - h.c[2]], r = Math.hypot(...d);
        const dir: V3 = [d[0] / r, d[1] / r, d[2] / r];
        const bin = Math.floor(((Math.atan2(dir[0], dir[2]) / (Math.PI * 2)) * 36 + 36) % 36);
        const out = hitOut(h.c, dir, tris, bins[bin]);
        const gap = out - r;
        worst = Math.min(worst, gap);
        if (dir[1] > 0.7) { top += gap; topN++; }
      }
      const who = `${id} on age ${app.age.toFixed(2)} gender ${app.gender.toFixed(2)}`;
      assert.ok(worst >= 0.002, `${who}: the skull comes within ${(worst * 1000).toFixed(1)} mm of the outside (or through it)`);
      if (id !== 'witchHat') assert.ok(topN > 0 && top / topN < 0.03, `${who}: the crown stands ${((top / topN) * 1000).toFixed(0)} mm off the head (perched)`);
    }
  }
});
