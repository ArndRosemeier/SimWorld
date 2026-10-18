/**
 * The vegetation textures, generated in a texture worker (pure, no DOM):
 *  - the bark atlas: `BARK_STRIPS` columns (linden/maple, oak/chestnut, birch, plane, pine, palm,
 *    cypress, ginkgo/shrub), each tiling vertically and around the branch; albedo and normal map;
 *  - the leaf atlas: 4 × 4 cells of twig clusters, needle tufts, sprays and palm fronds with
 *    alpha, colours dilated into the transparent texels so mip-mapping keeps no dark fringes.
 * Row 0 is v = 0 (no flip on upload). In the leaf atlas row 0 is the top of the drawing, as on
 * the canvas Scale drew it on: the cards' uvs (src/build/vegetation.ts `cellUV`) expect that.
 *
 * Ported from Scale (src/props/vegetation.ts, "Procedural textures"): the canvas drawing runs on
 * the small painter in src/build/paint2d.ts instead of a DOM canvas.
 */
import { Rng, clamp, hash2i, hashToFloat, lerp as mix, smoothstep as smooth } from '@futuremagic/core';
import { Paint2D, hsla, type RGBA } from './paint2d';

export interface VegAtlas { width: number; height: number; albedo: Uint8Array; normal?: Uint8Array }

// ---------------------------------------------------------------------------------------------
// Periodic noise for the bark
// ---------------------------------------------------------------------------------------------

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
const imod = (a: number, b: number) => ((a % b) + b) % b;

/** Periodic value noise in [0,1]; x period px, y period py (integers). */
function pnoise(seed: number, x: number, y: number, px: number, py: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const h = (i: number, j: number) => hashToFloat(hash2i(seed, imod(i, px), imod(j, py)));
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function pfbm(seed: number, x: number, y: number, px: number, py: number, oct: number): number {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * pnoise(seed + o * 101, x * f, y * f, px * f, py * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

/** Periodic worley: returns [f1, f2, id]. */
function pworley(seed: number, x: number, y: number, px: number, py: number, jitter = 0.9): [number, number, number] {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const h = hash2i(seed, imod(cx, px), imod(cy, py));
    const fx = cx + 0.5 + (hashToFloat(h) - 0.5) * jitter;
    const fy = cy + 0.5 + (hashToFloat(Math.imul(h, 2654435761)) - 0.5) * jitter;
    const dd = Math.hypot(fx - x, fy - y);
    if (dd < f1) { f2 = f1; f1 = dd; id = h; } else if (dd < f2) f2 = dd;
  }
  return [f1, f2, id];
}

type RGBH = [number, number, number, number];

function barkPixel(strip: number, u: number, v: number): RGBH {
  // u in [0,1) around the branch, v in [0,1) along (one tile = 4 circumferences)
  switch (strip) {
    case 0: { // linden / maple: interlaced shallow furrows
      const n = pfbm(11, u * 9 + pfbm(12, u * 4, v * 3, 4, 3, 2) * 1.5, v * 5, 9, 5, 4);
      const ridge = 1 - Math.abs(2 * n - 1);
      const fine = pfbm(13, u * 40, v * 60, 40, 60, 2);
      const h = Math.pow(ridge, 1.6) * 0.8 + fine * 0.2;
      const lich = smooth(0.62, 0.75, pfbm(14, u * 3, v * 5, 3, 5, 3));
      const r = mix(0.16, 0.42, h), g = mix(0.14, 0.39, h), b = mix(0.12, 0.35, h);
      return [mix(r, 0.42, lich * 0.5), mix(g, 0.46, lich * 0.5), mix(b, 0.3, lich * 0.5), h];
    }
    case 1: { // oak / chestnut: deep blocky fissures
      const warpU = pfbm(21, u * 5, v * 4, 5, 4, 2) * 0.6;
      const [f1, f2] = pworley(22, u * 7 + warpU, v * 7, 7, 7, 0.85);
      const crack = smooth(0.0, 0.16, f2 - f1);
      const fine = pfbm(23, u * 30, v * 50, 30, 50, 3);
      const plate = pfbm(24, u * 14, v * 12, 14, 12, 2);
      const h = crack * (0.65 + 0.35 * plate) * 0.85 + fine * 0.15;
      return [mix(0.09, 0.36, h), mix(0.08, 0.33, h), mix(0.07, 0.29, h), h];
    }
    case 2: { // birch: white with dark lenticels and black patches
      const lent = smooth(0.66, 0.72, pfbm(31, u * 7, v * 140, 7, 140, 2));
      const patch = smooth(0.66, 0.7, pfbm(32, u * 3 + pfbm(35, u * 6, v * 20, 6, 20, 2) * 0.8, v * 9, 3, 9, 4));
      const fine = pfbm(33, u * 24, v * 90, 24, 90, 2);
      const warm = pfbm(34, u * 4, v * 10, 4, 10, 2);
      let r = 0.86 - fine * 0.1 + warm * 0.04, g = 0.85 - fine * 0.1, b = 0.8 - fine * 0.1 - warm * 0.04;
      const dark = Math.max(lent * 0.75, patch);
      r = mix(r, 0.12, dark); g = mix(g, 0.11, dark); b = mix(b, 0.11, dark);
      return [r, g, b, 0.7 - dark * 0.45 + fine * 0.15];
    }
    case 3: { // plane: camouflage patches
      const wu = u * 4 + (pfbm(41, u * 6, v * 12, 6, 12, 3) - 0.5) * 1.3;
      const wv = v * 9 + (pfbm(42, u * 6, v * 12, 6, 12, 3) - 0.5) * 2.6;
      const [f1, f2, id] = pworley(43, wu, wv, 4, 9, 0.95);
      const pal: [number, number, number][] = [[0.5, 0.5, 0.38], [0.8, 0.77, 0.62], [0.55, 0.5, 0.4], [0.66, 0.67, 0.53], [0.42, 0.44, 0.34], [0.74, 0.72, 0.6]];
      const c = pal[id % pal.length];
      const edge = smooth(0.0, 0.07, f2 - f1);
      const fine = pfbm(44, u * 30, v * 60, 30, 60, 2);
      const k = (0.85 + 0.15 * edge) * (0.92 + fine * 0.16);
      return [c[0] * k, c[1] * k, c[2] * k, 0.5 + (id % 3) * 0.08 + fine * 0.1 + edge * 0.1];
    }
    case 4: { // pine: reddish plates
      const [f1, f2, id] = pworley(51, u * 5 + pfbm(52, u * 5, v * 5, 5, 5, 2) * 0.5, v * 8, 5, 8, 0.9);
      const crack = smooth(0.0, 0.1, f2 - f1);
      const fine = pfbm(53, u * 30, v * 40, 30, 40, 2);
      const red = hashToFloat(id) * 0.5 + 0.5;
      const h = crack * (0.7 + fine * 0.3);
      return [mix(0.12, 0.5 * red + 0.12, h), mix(0.09, 0.3 * red + 0.07, h), mix(0.08, 0.2 * red + 0.06, h), h];
    }
    case 5: { // palm: horizontal leaf-scar rings, fibrous
      const ringV = v * 22 + (pfbm(61, u * 3, v * 22, 3, 22, 2) - 0.5) * 0.5;
      const fr = ringV - Math.floor(ringV);
      const ring = smooth(0.0, 0.18, fr) * smooth(1.0, 0.75, fr);
      const fib = pfbm(62, u * 60, v * 22, 60, 22, 2);
      const h = ring * 0.75 + fib * 0.25;
      return [mix(0.22, 0.52, h), mix(0.19, 0.47, h), mix(0.15, 0.39, h), h];
    }
    case 6: { // cypress: stringy fibrous strips
      const n = pfbm(71, u * 26 + pfbm(72, u * 4, v * 3, 4, 3, 2) * 3, v * 3, 26, 3, 3);
      const ridge = 1 - Math.abs(2 * n - 1);
      const g2 = pfbm(73, u * 5, v * 8, 5, 8, 2);
      const h = Math.pow(ridge, 1.3);
      return [mix(0.16, 0.46 - g2 * 0.1, h), mix(0.11, 0.33, h), mix(0.09, 0.27 + g2 * 0.05, h), h];
    }
    default: { // ginkgo / shrub: grey, fine furrows
      const n = pfbm(81, u * 14, v * 7, 14, 7, 4);
      const ridge = 1 - Math.abs(2 * n - 1);
      const fine = pfbm(82, u * 40, v * 60, 40, 60, 2);
      const h = Math.pow(ridge, 2) * 0.7 + fine * 0.3;
      return [mix(0.2, 0.43, h), mix(0.18, 0.4, h), mix(0.16, 0.36, h), h];
    }
  }
}

/** Bark strip `s` (of BARK_STRIPS): `sw` × `sh` texels, sRGB albedo and a tangent-space normal map (one texture job each). */
export function barkStrip(s: number, sw = 128, sh = 512): VegAtlas {
  const col = new Uint8Array(sw * sh * 4), nor = new Uint8Array(sw * sh * 4), hgt = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const px = barkPixel(s, x / sw, y / sh);
    const i = y * sw + x;
    col[i * 4] = clamp(px[0] * 255, 0, 255);
    col[i * 4 + 1] = clamp(px[1] * 255, 0, 255);
    col[i * 4 + 2] = clamp(px[2] * 255, 0, 255);
    col[i * 4 + 3] = 255;
    hgt[i] = px[3];
  }
  // Scale's slopes are per texel at 128 × 512: the same relief at other sizes.
  const strength = [3.5, 5, 1.2, 1.2, 4, 3, 3.5, 2.5][s] * (sw / 128);
  const at = (xx: number, yy: number) => hgt[imod(yy, sh) * sw + imod(xx, sw)];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * sw + x) * 4;
    nor[i] = ((-dx / len) * 0.5 + 0.5) * 255;
    nor[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
    nor[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    nor[i + 3] = 255;
  }
  return { width: sw, height: sh, albedo: col, normal: nor };
}

/** The strips side by side: the bark atlas (strip s in columns [s * sw, (s + 1) * sw)). */
export function packBark(strips: readonly VegAtlas[]): VegAtlas {
  const sw = strips[0].width, sh = strips[0].height, W = sw * strips.length;
  const albedo = new Uint8Array(W * sh * 4), normal = new Uint8Array(W * sh * 4);
  strips.forEach((st, s) => {
    for (let y = 0; y < sh; y++) {
      albedo.set(st.albedo.subarray(y * sw * 4, (y + 1) * sw * 4), (y * W + s * sw) * 4);
      normal.set(st.normal!.subarray(y * sw * 4, (y + 1) * sw * 4), (y * W + s * sw) * 4);
    }
  });
  return { width: W, height: sh, albedo, normal };
}

// ---------------------------------------------------------------------------------------------
// Leaf atlas
// ---------------------------------------------------------------------------------------------

/** Autumn colour per leaf atlas cell (sRGB, a = whether it turns; evergreens and fronds never). */
export const LEAF_AUTUMN: readonly [number, number, number, number][] = [
  [0.62, 0.42, 0.12, 1], // plane: dull ochre-brown
  [0.85, 0.7, 0.18, 1], // linden: yellow
  [0.85, 0.22, 0.06, 1], // maple: red-orange
  [0.5, 0.3, 0.1, 1], // oak: russet
  [0.92, 0.78, 0.2, 1], // birch: golden
  [0.72, 0.45, 0.14, 1], // chestnut: orange-brown
  [1.0, 0.82, 0.12, 1], // ginkgo: bright yellow
  [0.75, 0.3, 0.12, 1], // shrub
  [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
];
/** Leaf atlas cells of the conifers (needles, sprays, comb): less light through them. */
export const CONIFER_CELLS: readonly number[] = [8, 9, 10];

/** Side of the leaf atlas in texels (4 × 4 cells of 256). */
export const LEAF_ATLAS_SIZE = 1024;

type Pt = [number, number];
type HSL = [number, number, number];
const deg = Math.PI / 180;

const hslC = (c: HSL, a = 1, dl = 0): RGBA => hsla(c[0], c[1], c[2], a, dl);

/** Polygon for an elongated leaf: base (0,0), tip (0,-len); hw(t) half width as fraction of width. */
function leafPoly(len: number, width: number, hw: (t: number) => number, teeth = 0, toothAmp = 0): Pt[] {
  const N = 36;
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let w = hw(t) * width * 0.5;
    if (teeth > 0) w *= 1 + toothAmp * (((t * teeth) % 1) - 0.5);
    right.push([w, -t * len]);
  }
  const left = right.slice(0, -1).reverse().map(([x, y]) => [-x, y] as Pt);
  return [...right, ...left];
}

/** Palmate polygon centred on the petiole attachment, lobes pointing up (angle 0 = up). */
function palmPoly(R: number, lobes: { a: number; l: number }[], lobeW: number, base: number, sharp: number, teeth: number): Pt[] {
  const pts: Pt[] = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const phi = -Math.PI + (i / N) * Math.PI * 2;
    let r = base;
    for (const lb of lobes) {
      let dd = Math.abs(phi - lb.a);
      dd = Math.min(dd, Math.PI * 2 - dd);
      const k = Math.max(0, 1 - dd / lobeW);
      r = Math.max(r, base + (lb.l - base) * Math.pow(k, sharp));
    }
    const bottom = Math.abs(Math.abs(phi) - Math.PI);
    if (bottom < 0.5) r *= 0.35 + 0.65 * (bottom / 0.5);
    r *= 1 + 0.035 * Math.sin(phi * teeth);
    pts.push([Math.sin(phi) * r * R, -Math.cos(phi) * r * R]);
  }
  return pts;
}

function fillLeaf(g: Paint2D, poly: Pt[], col: HSL, len: number, veins: { from: Pt; to: Pt }[], rng: Rng): void {
  g.beginPath();
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
  const lgt = rng.range(-5, 6);
  g.fillStyle = hslC(col, 1, lgt);
  g.fill();
  g.save();
  g.clip();
  // fold shading across the midrib + base-to-tip gradient (pseudo normals)
  let maxX = 1;
  for (const p of poly) maxX = Math.max(maxX, Math.abs(p[0]));
  const gr = g.createLinearGradient(-maxX, 0, maxX, 0);
  gr.addColorStop(0, [0, 0, 0, 0.22]);
  gr.addColorStop(0.48, [0, 0, 0, 0]);
  gr.addColorStop(0.52, [1, 1, 230 / 255, 0.06]);
  gr.addColorStop(1, [1, 1, 220 / 255, 0]);
  g.fillStyle = gr;
  g.fillRect(-maxX, -len * 1.5, maxX * 2, len * 2);
  const gv = g.createLinearGradient(0, 0, 0, -len);
  gv.addColorStop(0, [0, 0, 0, 0.12]);
  gv.addColorStop(0.5, [1, 1, 200 / 255, 0.04]);
  gv.addColorStop(1, [0, 0, 0, 0.08]);
  g.fillStyle = gv;
  g.fillRect(-maxX, -len * 1.5, maxX * 2, len * 2);
  // veins
  g.strokeStyle = hslC(col, 0.5, 9);
  for (const v of veins) {
    g.lineWidth = Math.max(0.6, len * 0.012);
    g.beginPath();
    g.moveTo(v.from[0], v.from[1]);
    g.lineTo(v.to[0], v.to[1]);
    g.stroke();
  }
  g.restore();
  // Scale's last stroke: the current path, which is the last vein (the outline when there are none).
  g.strokeStyle = hslC(col, 0.55, -10);
  g.lineWidth = 0.9;
  g.stroke();
}

function midribVeins(len: number, width: number, n: number, hw: (t: number) => number): { from: Pt; to: Pt }[] {
  const out: { from: Pt; to: Pt }[] = [{ from: [0, 0], to: [0, -len * 0.96] }];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const w = hw(Math.min(1, t + 0.1)) * width * 0.45;
    out.push({ from: [0, -t * len], to: [w, -(t + 0.12) * len] });
    out.push({ from: [0, -t * len], to: [-w, -(t + 0.12) * len] });
  }
  return out;
}

type LeafFn = (g: Paint2D, s: number, rng: Rng) => void;

function ovalLeaf(col: HSL, len: number, width: number, hw: (t: number) => number, teeth = 0, toothAmp = 0, veins = 5): LeafFn {
  return (g, s, rng) => {
    const l = len * s, w = width * s;
    fillLeaf(g, leafPoly(l, w, hw, teeth, toothAmp), col, l, midribVeins(l, w, veins, hw), rng);
  };
}

function palmateLeaf(col: HSL, R: number, lobes: { a: number; l: number }[], lobeW: number, base: number, sharp: number, teeth: number): LeafFn {
  return (g, s, rng) => {
    const r = R * s;
    const poly = palmPoly(r, lobes, lobeW, base, sharp, teeth);
    const veins = lobes.map((lb) => ({ from: [0, 0] as Pt, to: [Math.sin(lb.a) * lb.l * r * 0.9, -Math.cos(lb.a) * lb.l * r * 0.9] as Pt }));
    fillLeaf(g, poly, col, r * 1.6, veins, rng);
  };
}

function withJitter(c: HSL, rng: Rng, dh = 6, ds = 6, dl = 4): HSL {
  return [c[0] + rng.range(-dh, dh), clamp(c[1] + rng.range(-ds, ds), 0, 100), c[2] + rng.range(-dl, dl)];
}

/** A stroked line from (ax, ay) to (bx, by). */
function line(g: Paint2D, ax: number, ay: number, bx: number, by: number): void {
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
}

/** Draws a twig with leaves inside a cell. Origin = bottom centre of the cell. */
function drawTwigCell(
  g: Paint2D, rng: Rng,
  o: { nodes: number; twigLen: number; bend: number; spread: [number, number]; opposite?: boolean; petiole: number; size: [number, number]; leaf: (rng: Rng) => LeafFn; twigW: number; tip?: boolean; startT?: number; twigCol?: HSL },
): void {
  const C = 256;
  const twig: Pt[] = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    twig.push([o.bend * Math.sin(t * Math.PI * 0.9) * C + Math.sin(t * 9) * 3, -t * o.twigLen * C]);
  }
  g.strokeStyle = hslC(o.twigCol ?? [28, 22, 26]);
  for (let i = 0; i < N; i++) {
    g.lineWidth = o.twigW * (1 - (i / N) * 0.6);
    line(g, twig[i][0], twig[i][1], twig[i + 1][0], twig[i + 1][1]);
  }
  const at = (t: number): [Pt, number] => {
    const f = t * N;
    const i = Math.min(N - 1, Math.floor(f));
    const k = f - i;
    const p: Pt = [twig[i][0] + (twig[i + 1][0] - twig[i][0]) * k, twig[i][1] + (twig[i + 1][1] - twig[i][1]) * k];
    return [p, Math.atan2(twig[i + 1][0] - twig[i][0], -(twig[i + 1][1] - twig[i][1]))];
  };
  const leavesToDraw: { p: Pt; a: number; s: number }[] = [];
  const st = o.startT ?? 0.15;
  for (let k = 0; k < o.nodes; k++) {
    const t = st + (1 - st) * (k / Math.max(1, o.nodes - (o.tip ? 0 : 1))) * (o.tip ? 0.92 : 1);
    const [p, ta] = at(Math.min(1, t));
    const sides = o.opposite ? [-1, 1] : [k % 2 === 0 ? -1 : 1];
    for (const sd of sides) {
      const a = ta + sd * rng.range(o.spread[0], o.spread[1]) * deg;
      const sz = rng.range(o.size[0], o.size[1]) * (0.75 + 0.35 * Math.sin(Math.PI * (0.25 + 0.6 * t)));
      leavesToDraw.push({ p, a, s: sz });
    }
  }
  if (o.tip) {
    const [p, ta] = at(1);
    leavesToDraw.push({ p, a: ta + rng.range(-8, 8) * deg, s: o.size[1] });
  }
  for (const lf of leavesToDraw) {
    g.save();
    g.translate(lf.p[0], lf.p[1]);
    g.rotate(lf.a);
    if (o.petiole > 0) {
      g.strokeStyle = hslC([70, 30, 30]);
      g.lineWidth = 1.6;
      line(g, 0, 0, 0, -o.petiole * lf.s);
      g.translate(0, -o.petiole * lf.s);
    }
    o.leaf(rng)(g, lf.s, rng);
    g.restore();
  }
}

function drawNeedleTuft(g: Paint2D, rng: Rng, col: HSL, len: number, nNeedle: number, twigLen: number): void {
  g.strokeStyle = hslC([25, 30, 24]);
  g.lineWidth = 4;
  line(g, 0, 0, 0, -twigLen);
  const needles: { x: number; y: number; a: number; l: number; c: HSL }[] = [];
  for (let i = 0; i < nNeedle; i++) {
    const t = Math.pow(rng.float(), 0.7);
    const y = -twigLen * (0.15 + 0.85 * t);
    const a = rng.sign() * rng.range(12, 62) * deg * (1 - 0.5 * t);
    needles.push({ x: rng.range(-2, 2), y, a, l: len * rng.range(0.7, 1.05), c: withJitter(col, rng, 8, 8, 7) });
  }
  needles.sort((a, b) => a.l - b.l);
  for (const n of needles) {
    g.strokeStyle = hslC(n.c);
    g.lineWidth = rng.range(1.6, 2.4);
    g.beginPath();
    g.moveTo(n.x, n.y);
    const ex = n.x + Math.sin(n.a) * n.l, ey = n.y - Math.cos(n.a) * n.l;
    g.quadraticCurveTo(n.x + Math.sin(n.a) * n.l * 0.5, n.y - Math.cos(n.a) * n.l * 0.55 - 3, ex, ey);
    g.stroke();
    g.strokeStyle = hslC(n.c, 0.6, 12);
    g.lineWidth = 0.7;
    g.stroke();
  }
}

function drawCypressSpray(g: Paint2D, rng: Rng, x: number, y: number, ang: number, len: number, depth: number, col: HSL): void {
  const steps = Math.max(3, Math.round(len / 5));
  let px = x, py = y;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const nx = px + Math.sin(ang) * (len / steps), ny = py - Math.cos(ang) * (len / steps);
    const w = (2.2 + depth * 1.5) * (1 - t * 0.5);
    g.fillStyle = hslC(withJitter(col, rng, 5, 5, 5), 1, t * 8);
    g.beginPath();
    g.ellipse(nx, ny, w, w * 1.6, ang);
    g.fill();
    if (depth > 0 && i > 0 && i % 2 === 0) {
      const sd = (i / 2) % 2 === 0 ? 1 : -1;
      drawCypressSpray(g, rng, nx, ny, ang + sd * rng.range(35, 55) * deg, len * rng.range(0.35, 0.55) * (1 - t * 0.6), depth - 1, col);
    }
    px = nx; py = ny;
  }
}

function drawFrond(g: Paint2D, rng: Rng, w: number, h: number, col: HSL, dead: boolean): void {
  const cy = h / 2;
  const nL = 62;
  const leaflets: { x: number; side: number; l: number; a: number; c: HSL }[] = [];
  for (let i = 0; i < nL; i++) {
    const t = (i + 0.5) / nL;
    const x = 6 + t * (w - 12);
    const l = (h / 2 - 6) * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.55) * (t < 0.06 ? 0.4 : 1) * rng.range(0.85, 1.0);
    for (const side of [-1, 1]) leaflets.push({ x, side, l, a: (dead ? rng.range(20, 50) : rng.range(42, 58)) * deg, c: withJitter(col, rng, 5, 6, 5) });
  }
  for (const lf of leaflets) {
    const ex = lf.x + Math.cos(lf.a) * lf.l, ey = cy + lf.side * Math.sin(lf.a) * lf.l;
    g.save();
    g.translate(lf.x, cy);
    g.rotate(Math.atan2(ey - cy, ex - lf.x) + Math.PI / 2);
    const len = Math.hypot(ex - lf.x, ey - cy);
    const poly = leafPoly(len, dead ? 5 : 7.5, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.6));
    g.beginPath();
    g.moveTo(poly[0][0], poly[0][1]);
    for (const p of poly) g.lineTo(p[0], p[1]);
    g.closePath();
    g.fillStyle = hslC(lf.c);
    g.fill();
    g.strokeStyle = hslC(lf.c, 0.7, 10);
    g.lineWidth = 0.8;
    line(g, 0, 0, 0, -len);
    g.restore();
  }
  g.strokeStyle = hslC(dead ? [30, 25, 40] : [65, 30, 42]);
  g.lineWidth = 4;
  line(g, 0, cy, w, cy);
}

/** The leaf atlas (LEAF_ATLAS_SIZE², straight sRGB RGBA8, row 0 the top of the drawing). */
export function leafAtlas(): VegAtlas {
  const S = LEAF_ATLAS_SIZE, C = 256;
  const g = new Paint2D(S, S);
  const rng = Rng.from('leaf-atlas');
  const cell = (i: number, w: number, draw: () => void) => {
    const cx = (i % 4) * C, cy = Math.floor(i / 4) * C;
    g.save();
    g.beginPath(); g.rect(cx + 3, cy + 3, C * w - 6, C - 6); g.clip();
    g.translate(cx + (C * w) / 2, cy + C - 4);
    draw();
    g.restore();
  };
  const ov = (t: number) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.8);
  // 0 plane: large palmate, shallow lobes
  cell(0, 1, () => drawTwigCell(g, rng.fork('plane'), {
    nodes: 4, twigLen: 0.42, bend: 0.03, spread: [40, 70], petiole: 26, size: [0.85, 1.0], twigW: 5, tip: true, startT: 0.35,
    leaf: (r) => palmateLeaf(withJitter([88, 42, 32], r), 46, [{ a: 0, l: 1.15 }, { a: -0.95, l: 1.0 }, { a: 0.95, l: 1.0 }, { a: -1.9, l: 0.62 }, { a: 1.9, l: 0.62 }], 0.62, 0.55, 1.3, 26),
  }));
  // 1 linden: heart leaves
  cell(1, 1, () => drawTwigCell(g, rng.fork('linden'), {
    nodes: 7, twigLen: 0.8, bend: 0.06, spread: [45, 80], petiole: 12, size: [0.75, 1.0], twigW: 3.5, tip: true,
    leaf: (r) => ovalLeaf(withJitter([88, 44, 28], r), 62, 60, (t) => Math.pow(Math.sin(Math.PI * Math.pow(0.08 + 0.92 * t, 0.7)), 0.75), 22, 0.07, 4),
  }));
  // 2 maple: sharp 5-lobed, opposite
  cell(2, 1, () => drawTwigCell(g, rng.fork('maple'), {
    nodes: 3, twigLen: 0.45, bend: 0.02, spread: [50, 75], opposite: true, petiole: 30, size: [0.8, 1.0], twigW: 4.5, tip: true, startT: 0.3,
    leaf: (r) => palmateLeaf(withJitter([96, 48, 28], r), 40, [{ a: 0, l: 1.15 }, { a: -0.85, l: 1.05 }, { a: 0.85, l: 1.05 }, { a: -1.75, l: 0.7 }, { a: 1.75, l: 0.7 }], 0.42, 0.38, 1.9, 14),
  }));
  // 3 oak: lobed leaves clustered near the tip
  cell(3, 1, () => drawTwigCell(g, rng.fork('oak'), {
    nodes: 7, twigLen: 0.5, bend: 0.04, spread: [15, 75], petiole: 4, size: [0.8, 1.0], twigW: 4.5, tip: true, startT: 0.55,
    leaf: (r) => ovalLeaf(withJitter([82, 38, 25], r), 92, 48, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.7) * (0.55 + 0.45 * Math.pow(Math.abs(Math.sin(t * Math.PI * 4.5)), 0.6)), 0, 0, 4),
  }));
  // 4 birch: small serrated deltoid leaves on a drooping twig
  cell(4, 1, () => {
    const r = rng.fork('birch');
    for (const [dx, bend, len] of [[-50, -0.12, 0.85], [45, 0.1, 0.8], [0, 0.02, 0.95]] as [number, number, number][]) {
      g.save();
      g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 7, twigLen: len, bend, spread: [40, 70], petiole: 8, size: [0.75, 1.0], twigW: 2, tip: true, twigCol: [20, 25, 22],
        leaf: (rr) => ovalLeaf(withJitter([84, 46, 31], rr), 36, 26, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.9), 14, 0.14, 3),
      });
      g.restore();
    }
  });
  // 5 chestnut: palmate compound leaves (7 leaflets)
  cell(5, 1, () => {
    const r = rng.fork('chestnut');
    const compound = (x: number, y: number, a: number, s: number) => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.strokeStyle = hslC([60, 30, 32]); g.lineWidth = 2.4;
      line(g, 0, 0, 0, -38 * s);
      g.translate(0, -38 * s);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const la = (-1 + (2 * i) / (n - 1)) * 1.45;
        const ll = (1 - (0.45 * Math.abs(la)) / 1.45) * 78 * s;
        g.save(); g.rotate(la);
        ovalLeaf(withJitter([90, 44, 27], r), ll, ll * 0.42, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 1.35)), 0.75), 24, 0.08, 6)(g, 1, r);
        g.restore();
      }
      g.restore();
    };
    g.strokeStyle = hslC([28, 22, 26]); g.lineWidth = 5;
    line(g, 0, 0, 0, -70);
    compound(0, -60, -0.7, 0.9);
    compound(0, -70, 0.75, 0.88);
    compound(0, -70, 0.02, 1.0);
  });
  // 6 ginkgo: fan leaves on spur shoots
  cell(6, 1, () => {
    const r = rng.fork('ginkgo');
    const fan: LeafFn = (gg, s, rr) => {
      const R = 34 * s;
      const pts: Pt[] = [[0, 0]];
      for (let i = 0; i <= 30; i++) {
        const a = (-58 + (116 * i) / 30) * deg;
        let rad = R * (1 + 0.04 * Math.sin(i * 1.7));
        if (Math.abs(a) < 0.12) rad *= 0.78 + 0.22 * (Math.abs(a) / 0.12);
        pts.push([Math.sin(a) * rad, -Math.cos(a) * rad]);
      }
      const veins: { from: Pt; to: Pt }[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (-50 + (100 * i) / 8) * deg;
        veins.push({ from: [0, 0], to: [Math.sin(a) * R * 0.95, -Math.cos(a) * R * 0.95] });
      }
      fillLeaf(gg, pts, withJitter([70, 52, 40], rr), R, veins, rr);
    };
    g.strokeStyle = hslC([28, 15, 32]); g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(6, -120); g.lineTo(2, -190); g.stroke();
    const spurs: [number, number, number][] = [[2, -60, -1], [5, -110, 1], [4, -160, -1], [2, -195, 0]];
    for (const [sx, sy, side] of spurs) {
      const n = r.int(4, 5);
      for (let k = 0; k < n; k++) {
        const a = side * 0.7 + (-0.9 + (1.8 * k) / (n - 1)) * (side === 0 ? 1 : 0.8);
        g.save(); g.translate(sx, sy); g.rotate(a);
        g.strokeStyle = hslC([70, 30, 35]); g.lineWidth = 1.4;
        line(g, 0, 0, 0, -26);
        g.translate(0, -26);
        fan(g, r.range(0.85, 1.1), r);
        g.restore();
      }
    }
  });
  // 7 shrub (deciduous): dense small leaves on 3 twigs
  cell(7, 1, () => {
    const r = rng.fork('shrub');
    for (const [dx, bend, len] of [[-40, -0.1, 0.8], [40, 0.1, 0.78], [0, 0.0, 0.92]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 10, twigLen: len, bend, spread: [35, 75], petiole: 3, size: [0.8, 1.0], twigW: 2.5, tip: true,
        leaf: (rr) => ovalLeaf(withJitter([92, 38, 29], rr), 30, 17, ov, 0, 0, 2),
      });
      g.restore();
    }
  });
  // 8 pine needle tufts (umbrella pine)
  cell(8, 1, () => {
    const r = rng.fork('pine');
    for (const [dx, a, s] of [[-45, -0.35, 0.85], [45, 0.35, 0.85], [0, 0, 1]] as [number, number, number][]) {
      g.save(); g.translate(dx * 0.6, 0); g.rotate(a);
      drawNeedleTuft(g, r, [118, 28, 25], 95 * s, 170, 150 * s);
      g.restore();
    }
  });
  // 9 cypress scale-leaf sprays
  cell(9, 1, () => {
    const r = rng.fork('cypress');
    for (const [dx, a] of [[-30, -0.35], [30, 0.35], [0, 0], [-10, -0.12], [12, 0.15]] as [number, number][]) {
      drawCypressSpray(g, r, dx, -4, a, r.range(170, 230), 2, [118, 30, 16]);
    }
  });
  // 10 spruce / conical pine branchlet (flat, comb needles)
  cell(10, 1, () => {
    const r = rng.fork('spruce');
    const col: HSL = [135, 26, 22];
    const axis = (x: number, y: number, a: number, len: number, depth: number) => {
      const steps = Math.round(len / 4);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const px = x + Math.sin(a) * len * t, py = y - Math.cos(a) * len * t;
        for (const sd of [-1, 1]) {
          const na = a + sd * r.range(50, 80) * deg;
          const nl = r.range(11, 16) * (1 - t * 0.3);
          g.strokeStyle = hslC(withJitter(col, r, 6, 6, 6));
          g.lineWidth = 1.8;
          line(g, px, py, px + Math.sin(na) * nl, py - Math.cos(na) * nl);
        }
        if (depth > 0 && i > 2 && i % 4 === 0) {
          const sd = (i / 4) % 2 === 0 ? 1 : -1;
          axis(px, py, a + sd * 50 * deg, len * (1 - t) * 0.55, depth - 1);
        }
      }
      g.strokeStyle = hslC([25, 30, 28]); g.lineWidth = 2;
      line(g, x, y, x + Math.sin(a) * len, y - Math.cos(a) * len);
    };
    axis(0, 0, 0, 236, 1);
  });
  // 11 boxwood / evergreen shrub
  cell(11, 1, () => {
    const r = rng.fork('box');
    for (const [dx, bend, len] of [[-45, -0.12, 0.75], [45, 0.12, 0.75], [-15, -0.03, 0.9], [18, 0.04, 0.88]] as [number, number, number][]) {
      g.save(); g.translate(dx, 0);
      drawTwigCell(g, r, {
        nodes: 12, twigLen: len, bend, spread: [30, 70], opposite: true, petiole: 0, size: [0.8, 1.0], twigW: 2, tip: true,
        leaf: (rr) => ovalLeaf(withJitter([105, 42, 21], rr), 19, 11, (t) => Math.pow(Math.sin(Math.PI * t), 0.7), 0, 0, 0),
      });
      g.restore();
    }
  });
  // 12–13 palm frond (2 cells wide), 14–15 dead frond
  for (const [ci, dead] of [[12, false], [14, true]] as [number, boolean][]) {
    const cx = (ci % 4) * C, cy = Math.floor(ci / 4) * C;
    g.save();
    g.beginPath(); g.rect(cx + 3, cy + 3, C * 2 - 6, C - 6); g.clip();
    g.translate(cx + 3, cy);
    drawFrond(g, rng.fork('frond', ci), C * 2 - 6, C, dead ? [34, 38, 36] : [82, 40, 30], dead);
    g.restore();
  }
  const d = g.imageData();
  dilate(d, S);
  return { width: S, height: S, albedo: d };
}

/** Spread colours into the transparent texels (10 passes), so mip-mapping does not bleed dark fringes. */
function dilate(d: Uint8Array, S: number): void {
  const valid = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) valid[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  for (let pass = 0; pass < 10; pass++) {
    const next = valid.slice();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (valid[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const j = yy * S + xx;
        if (!valid[j]) continue;
        r += d[j * 4]; gg += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
      }
      if (n) {
        d[i * 4] = r / n; d[i * 4 + 1] = gg / n; d[i * 4 + 2] = b / n;
        next[i] = 1;
      }
    }
    valid.set(next);
  }
}
