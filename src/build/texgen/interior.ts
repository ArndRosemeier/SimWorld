/**
 * Interior layers (InteriorMat 0..10): floor finishes, wall finishes and two neutral surfaces for
 * furniture. Every layer is near neutral and light (about 0.8): the interior shader multiplies it
 * by the room's or the piece's colour (src/render/tsl/interior.ts), so one wood floor serves oak
 * and walnut, one wallpaper every colour. Same orientation conventions as facades (row 0 = v = 0;
 * on walls +v is up; on floors v runs along the planks).
 *
 * New in SimWorld (Scale drew its interiors with canvas textures, src/interior/InteriorBuilder.ts).
 */
import { TNoise, Tex, mix, newCell, rnd, smooth, worley } from './core';
import { blockDist, newHit, randomCourses, runningBond, type Hit } from './layout';

type Gen = (t: Tex) => void;

/** Square tiles of `size` m on a grid (the bonds stagger alternate courses): the hit's block and id. */
function gridAt(x: number, y: number, size: number, hit: Hit): Hit {
  const i = Math.floor(x / size), j = Math.floor(y / size);
  hit.x0 = i * size; hit.x1 = hit.x0 + size; hit.y0 = j * size; hit.y1 = hit.y0 + size;
  hit.x = x; hit.y = y; hit.id = j * 4096 + i; hit.course = j; hit.block = i;
  return hit;
}

/** Layers of the interior family, in order (the build layer's `aLayer`). */
export const enum InteriorMat {
  WoodFloor = 0,
  FloorTile = 1,
  Carpet = 2,
  Concrete = 3,
  StoneFloor = 4,
  Marble = 5,
  Paint = 6,
  Wallpaper = 7,
  WallTile = 8,
  Fabric = 9,
  Wood = 10,
}

/** Fine wood grain along x (lines of `ly` metres), its tone in about [-1, 1]. */
function grain(n: TNoise, n2: TNoise, u: number, v: number): number {
  const w = v + n.fbm(u, v, 0.5, 3) * 0.02;
  const lines = Math.sin((w * n.W) / 0.0035 + n2.fbm(u, v, 0.3, 3) * 6);
  return lines * 0.5 + n2.fbm(u, v, 0.8, 4, 0.5, 0.01) * 0.8;
}

/** Oiled floor boards, 14 cm wide, staggered ends. */
const woodFloor: Gen = (t) => {
  const W = t.W, lay = runningBond(W, Math.round(W / 0.14), 2, 9101, 0.25, 0.37), hit = newHit();
  const n1 = new TNoise(9102, W), n2 = new TNoise(9103, W), n3 = new TNoise(9104, W);
  t.each((u, v, x, y, idx) => {
    lay.at(x, y, hit);
    const ra = rnd(9105, hit.id), rb = rnd(9106, hit.id);
    const e = blockDist(hit, 0.0008, 0.001);
    const mask = smooth(-0.0005, 0.0012, e);
    const g = grain(n1, n2, u + ra * 0.37, v);
    const tone = 0.82 * (1 + (ra - 0.5) * 0.22 + g * 0.06 + n3.fbm(u, v, 0.3, 3) * 0.04);
    const wear = smooth(0.2, 0.7, n3.fbm(u, v, 0.9, 3)) * 0.05;
    const h = (0.0004 + (rb - 0.5) * 0.0002 + g * 0.00005) * mask;
    const k = mix(0.35, tone * (1 + wear), mask);
    t.set(idx, k * 1.04, k, k * 0.95, mix(0.9, 0.55 - wear * 0.5 + g * 0.03, mask), h);
  });
};

/** Glazed square floor tiles, 30 cm, light grout. */
const floorTile: Gen = (t) => {
  const W = t.W, hit = newHit(), sz = W / Math.round(W / 0.3);
  const n1 = new TNoise(9202, W), n2 = new TNoise(9203, W);
  t.each((u, v, x, y, idx) => {
    gridAt(x, y, sz, hit);
    const ra = rnd(9204, hit.id);
    const e = blockDist(hit, 0.0025, 0.002);
    const mask = smooth(-0.001, 0.001, e);
    const bevel = smooth(0.0, 0.004, e);
    const tone = 0.84 * (1 + (ra - 0.5) * 0.05 + n1.fbm(u, v, 0.08, 3) * 0.025);
    const grout = 0.66 + n2.fbm(u, v, 0.05, 2) * 0.04;
    const k = mix(grout, tone, mask);
    t.set(idx, k, k, k * 0.98, mix(0.95, 0.22 + n2.fbm(u, v, 0.4, 2) * 0.05, mask), (bevel * 0.002 - 0.0015) * 1);
  });
};

/** Short-pile carpet: fibre speckle and a soft tufted relief. */
const carpet: Gen = (t) => {
  const W = t.W, n1 = new TNoise(9301, W), n2 = new TNoise(9302, W);
  t.each((u, v, _x, _y, idx) => {
    const fib = rnd(9303, idx) - 0.5;
    const tuft = n1.fbm(u, v, 0.012, 2);
    const k = 0.8 * (1 + fib * 0.16 + tuft * 0.08 + n2.fbm(u, v, 0.5, 3) * 0.04);
    t.set(idx, k, k, k, 0.98, tuft * 0.0008 + fib * 0.0002);
  });
};

/** Sealed concrete floor: cloudy trowel marks, a few pores. */
const concrete: Gen = (t) => {
  const W = t.W, n1 = new TNoise(9401, W), n2 = new TNoise(9402, W), n3 = new TNoise(9403, W), cell = newCell();
  const fp = Math.round(W / 0.02);
  t.each((u, v, _x, _y, idx) => {
    worley(9404, u * fp, v * fp, fp, fp, 1, cell);
    const pore = (cell.id & 255) < 18 ? 1 - smooth(0.05, 0.16, cell.f1) : 0;
    const cloud = n1.fbm(u, v, 0.7, 5) * 0.07 + n2.ridged(u, v, 0.4, 3) * 0.04;
    const k = 0.78 * (1 + cloud + (rnd(9405, idx) - 0.5) * 0.03) * (1 - pore * 0.3);
    t.set(idx, k, k, k * 0.99, 0.62 + n3.fbm(u, v, 0.6, 3) * 0.08 + pore * 0.2, n3.fbm(u, v, 0.05, 2) * 0.0003 - pore * 0.001);
  });
};

/** Stone flags in random courses. */
const stoneFloor: Gen = (t) => {
  const W = t.W, lay = randomCourses(W, [0.6, 0.6, 0.6, 0.6], 0.45, 0.9, 9501), hit = newHit();
  const n1 = new TNoise(9502, W), n2 = new TNoise(9503, W);
  t.each((u, v, x, y, idx) => {
    lay.at(x, y, hit);
    const ra = rnd(9504, hit.id);
    const e = blockDist(hit, 0.003, 0.004) + n1.fbm(u, v, 0.03, 2) * 0.001;
    const mask = smooth(-0.001, 0.002, e);
    const tone = 0.8 * (1 + (ra - 0.5) * 0.14 + n1.fbm(u, v, 0.25, 4) * 0.06 + (rnd(9505, idx) - 0.5) * 0.04);
    const k = mix(0.5, tone, mask);
    t.set(idx, k * 1.02, k, k * 0.96, mix(0.95, 0.7 + n2.fbm(u, v, 0.3, 3) * 0.08, mask), mask * (0.003 + (ra - 0.5) * 0.001 + n2.fbm(u, v, 0.1, 3) * 0.0004));
  });
};

/** Polished marble slabs, 60 cm, with soft grey veins. */
const marble: Gen = (t) => {
  const W = t.W, hit = newHit(), sz = W / Math.round(W / 0.6);
  const n1 = new TNoise(9602, W), n2 = new TNoise(9603, W);
  t.each((u, v, x, y, idx) => {
    gridAt(x, y, sz, hit);
    const ra = rnd(9604, hit.id);
    const e = blockDist(hit, 0.001, 0.001);
    const mask = smooth(-0.0005, 0.0008, e);
    const vein = n1.ridged(u + n2.fbm(u, v, 0.6, 4) * 0.12, v + n2.fbm(u + 0.3, v, 0.6, 4) * 0.12, 0.5, 3, 0.45);
    const cloud = n2.fbm(u, v, 0.35, 4);
    const k = 0.86 * (1 - smooth(0.55, 0.92, vein) * 0.16 + cloud * 0.04 + (ra - 0.5) * 0.03);
    t.set(idx, mix(0.6, k, mask), mix(0.6, k, mask), mix(0.6, k * 0.99, mask), mix(0.8, 0.12, mask), mask * 0.0005);
  });
};

/** Painted plaster: a faint roller stipple. */
const paint: Gen = (t) => {
  const W = t.W, n1 = new TNoise(9701, W), n2 = new TNoise(9702, W);
  t.each((u, v, _x, _y, idx) => {
    const st = n1.fbm(u, v, 0.006, 2) * 0.5 + n2.fbm(u, v, 0.25, 3, 0.5, 0.6) * 0.5;
    const k = 0.82 * (1 + st * 0.025 + (rnd(9703, idx) - 0.5) * 0.01);
    t.set(idx, k, k, k, 0.85 + st * 0.05, st * 0.00015);
  });
};

/** Wallpaper: a quiet vertical stripe with a small repeating motif. */
const wallpaper: Gen = (t) => {
  const W = t.W, n1 = new TNoise(9801, W), stripes = Math.round(W / 0.106);
  t.each((u, v, _x, _y, idx) => {
    const s = (u * stripes) % 1;
    const stripe = smooth(0.42, 0.46, s) - smooth(0.54, 0.58, s);
    // A small diamond between the stripes, every 16 cm up (distances in metres).
    const dx = Math.min(s, 1 - s) * (W / stripes), rows = Math.round(W / 0.16), dy = Math.abs(((v * rows) % 1) - 0.5) * (W / rows);
    const motif = 1 - smooth(0.009, 0.012, dx + dy);
    const k = 0.83 * (1 - stripe * 0.07 - motif * 0.08 + n1.fbm(u, v, 0.3, 2) * 0.01);
    t.set(idx, k, k * 0.995, k * 0.985, 0.82, (stripe + motif) * 0.00008 + (rnd(9802, idx) - 0.5) * 0.00002);
  });
};

/** Glazed wall tiles, 15 cm, white grout. */
const wallTile: Gen = (t) => {
  const W = t.W, hit = newHit(), sz = W / Math.round(W / 0.15);
  const n1 = new TNoise(9902, W);
  t.each((u, v, x, y, idx) => {
    gridAt(x, y, sz, hit);
    const e = blockDist(hit, 0.0015, 0.0015);
    const mask = smooth(-0.0008, 0.0008, e), bevel = smooth(0, 0.003, e);
    const k = mix(0.78, 0.86 * (1 + (rnd(9903, hit.id) - 0.5) * 0.03 + n1.fbm(u, v, 0.05, 2) * 0.01), mask);
    t.set(idx, k, k, k, mix(0.9, 0.12, mask), bevel * 0.0012);
  });
};

/** Upholstery and soft furnishing: a fine weave. */
const fabric: Gen = (t) => {
  const W = t.W, n1 = new TNoise(10001, W), threads = Math.round(W / 0.004);
  t.each((u, v, _x, _y, idx) => {
    const a = Math.sin(u * threads * Math.PI * 2), b = Math.sin(v * threads * Math.PI * 2);
    const weave = (a * b) * 0.5 + 0.5;
    const k = 0.8 * (1 + (weave - 0.5) * 0.08 + n1.fbm(u, v, 0.1, 3) * 0.03 + (rnd(10002, idx) - 0.5) * 0.04);
    t.set(idx, k, k, k, 0.95, weave * 0.0002);
  });
};

/** Furniture wood: grain without boards. */
const wood: Gen = (t) => {
  const W = t.W, n1 = new TNoise(10101, W), n2 = new TNoise(10102, W);
  t.each((u, v, _x, _y, idx) => {
    const g = grain(n1, n2, u, v);
    const k = 0.8 * (1 + g * 0.07 + n2.fbm(u, v, 0.4, 3) * 0.03);
    t.set(idx, k * 1.03, k, k * 0.95, 0.55 + g * 0.04, g * 0.00004);
  });
};

export const INTERIORS: { W: number; gen: Gen; normal: number; aoK: number; aoR: [number, number] }[] = [
  { W: 2.4, gen: woodFloor, normal: 1, aoK: 60, aoR: [0.004, 0.02] },
  { W: 1.2, gen: floorTile, normal: 1, aoK: 50, aoR: [0.004, 0.02] },
  { W: 1.0, gen: carpet, normal: 0.6, aoK: 30, aoR: [0.004, 0.02] },
  { W: 3.0, gen: concrete, normal: 0.8, aoK: 40, aoR: [0.006, 0.03] },
  { W: 2.4, gen: stoneFloor, normal: 1, aoK: 50, aoR: [0.006, 0.03] },
  { W: 2.4, gen: marble, normal: 1, aoK: 40, aoR: [0.004, 0.02] },
  { W: 2.0, gen: paint, normal: 0.6, aoK: 20, aoR: [0.006, 0.03] },
  { W: 1.06, gen: wallpaper, normal: 0.5, aoK: 20, aoR: [0.004, 0.02] },
  { W: 0.9, gen: wallTile, normal: 1, aoK: 50, aoR: [0.003, 0.015] },
  { W: 0.5, gen: fabric, normal: 0.5, aoK: 20, aoR: [0.002, 0.01] },
  { W: 1.0, gen: wood, normal: 0.6, aoK: 20, aoR: [0.003, 0.015] },
];
