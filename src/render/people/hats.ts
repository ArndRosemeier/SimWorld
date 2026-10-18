/**
 * Hats that fit the head they sit on (Arnd: "the caps are wrong, head shines through often and they look
 * goofy"). Each is built over the head's measured shape (`BodyFit.head`, the humanoid package's
 * headwear.ts) instead of over a sphere: the crown follows the skull a fabric's thickness out, from the
 * hat's band (the brow at the front, lower at the back) up, so no skin pokes through on any head. The
 * hair above the band is under the hat (the wardrobe's `hairBand` cuts it there); below it, it shows.
 *
 * Head-socket space throughout: +z forward, +y up, origin between the ears; metres. Sizes that are
 * not the head's own scale with it (`k`: a child's cap is smaller).
 */
import { bandElevation, bandPlane, bandY, hairAt, headPoint, skullAt, type HatBand, type HeadShape } from '@futuremagic/humanoid';
import { v3add as add, v3cross as cross, v3dot as dot, v3norm as norm, v3scale as mul, v3sub as sub } from '@futuremagic/core';
import type { MeshBuilder } from '../../build/meshBuilder';

type Rgb = [number, number, number];
type V3 = [number, number, number];
type Plane = [number, number, number, number];

/** Where each hat's edge sits (a cap's peak at the brow, a beanie a little lower at the back). */
export const BANDS = {
  cap: { front: 0.18, back: 0.1 },
  beanie: { front: 0.3, back: -0.05 },
  witchHat: { front: 0.45, back: 0.3 },
} satisfies Record<string, HatBand>;

/** Where the hair is cut under each hat: at its band, or lower where a brim hangs over it. */
export const HAIR_BANDS = { ...BANDS, witchHat: { front: 0.3, back: 0.15 } } satisfies Record<string, HatBand>;

/** An adult's head radius: sizes that are not the head's own scale by the head over this. */
const ADULT_HEAD = 0.095;

/** A colour darkened (k < 1) or lightened. */
export const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/**
 * A grid surface (rows × cols points, the columns wrapping round when `wrap`), its normals from its own
 * shape, each face turned toward `outside(p)` (the direction its outside faces there).
 */
function surface(mb: MeshBuilder, pts: V3[][], col: (r: number, c: number) => Rgb, wrap: boolean, outside: (p: V3) => V3): void {
  const R = pts.length, C = pts[0].length;
  const pt = (r: number, c: number) => pts[Math.max(0, Math.min(R - 1, r))][wrap ? (c + C) % C : Math.max(0, Math.min(C - 1, c))];
  const idx: number[][] = [];
  for (let r = 0; r < R; r++) {
    idx.push([]);
    for (let c = 0; c < C; c++) {
      const p = pts[r][c];
      let n = cross(sub(pt(r, c + 1), pt(r, c - 1)), sub(pt(r + 1, c), pt(r - 1, c)));
      const o = outside(p);
      if (Math.hypot(n[0], n[1], n[2]) < 1e-12) n = o;
      n = norm(n);
      if (dot(n, o) < 0) n = mul(n, -1);
      const k = col(r, c);
      mb.set('color', k[0], k[1], k[2]);
      idx[r].push(mb.v(p[0], p[1], p[2], n[0], n[1], n[2]));
    }
  }
  for (let r = 0; r + 1 < R; r++) for (let c = 0; c < (wrap ? C : C - 1); c++) {
    const c1 = (c + 1) % C;
    const a = idx[r][c], b = idx[r][c1], d = idx[r + 1][c], e = idx[r + 1][c1];
    const pa = pts[r][c], pb = pts[r][c1], pd = pts[r + 1][c];
    const face = cross(sub(pb, pa), sub(pd, pa));
    const facing = Math.hypot(face[0], face[1], face[2]) < 1e-14 ? cross(sub(pts[r + 1][c1], pd), sub(pa, pd)) : face;
    if (dot(facing, outside(pa)) >= 0) mb.quad(a, b, e, d);
    else mb.quad(a, d, e, b);
  }
}

/** A head shape's outward direction at a point (from its centre). */
const outFrom = (h: HeadShape) => (p: V3): V3 => norm(sub(p, h.c));

/**
 * A crown over the skull from a band up: `cols` round, `rows` up, each point `off(az, t)` out from the
 * skull (t: 0 at the band, 1 at the top). Returns its edge ring (the band's points, under the hat's
 * edge) and the skull's at the band (where its lip closes onto the head).
 */
function crown(mb: MeshBuilder, h: HeadShape, plane: Plane, cols: number, rows: number, off: (az: number, t: number) => number, col: (az: number, t: number) => Rgb): { edge: V3[]; az: number[]; e0: number[] } {
  const az: number[] = [], e0: number[] = [];
  for (let c = 0; c < cols; c++) {
    az.push((c / cols) * Math.PI * 2);
    e0.push(bandElevation(h, plane, az[c], off(az[c], 0)));
  }
  const pts: V3[][] = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    pts.push(az.map((a, c) => {
      const el = e0[c] + (Math.PI / 2 - e0[c]) * t;
      return headPoint(h, a, el, skullAt(h, a, el) + off(a, t));
    }));
  }
  surface(mb, pts, (r, c) => col(az[c], r / rows), true, outFrom(h));
  // The edge turns in onto the head (no seeing up inside it).
  const lip: V3[][] = [pts[0], az.map((a, c) => headPoint(h, a, e0[c], skullAt(h, a, e0[c]) + 0.0015))];
  surface(mb, lip, (_, c) => shade(col(az[c], 0), 0.6), true, () => [0, -1, 0]);
  return { edge: pts[0], az, e0 };
}

/** A baseball cap: six panels over the skull, a button on top, a stiff curved peak at the brow. */
export function capMesh(mb: MeshBuilder, h: HeadShape, c: Rgb, under: Rgb): void {
  const k = h.radius / ADULT_HEAD;
  const plane = bandPlane(h, BANDS.cap);
  // The front panels stand up a little (a structured cap), the rest lies on the head.
  const off = (az: number, t: number) => 0.009 + 0.009 * Math.max(0, Math.cos(az)) ** 2 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * k;
  const seam = (az: number) => { const s = (((az / (Math.PI / 3)) % 1) + 1) % 1; return Math.min(s, 1 - s) < 0.04; };
  const { edge, az } = crown(mb, h, plane, 48, 12, off, (a, t) => (seam(a) && t > 0.05 ? shade(c, 0.78) : t < 0.06 ? shade(c, 0.88) : c));
  // The button.
  const topR = skullAt(h, 0, Math.PI / 2) + off(0, 1);
  const b = headPoint(h, 0, Math.PI / 2, topR);
  dome(mb, b[0], b[1] - 0.002, b[2], 0.008 * k, 0.005 * k, 0.008 * k, c, 10);
  // The peak: from the front of the band, forward and a little down, its sides curving lower.
  const A = 1.2, L = 0.072 * k, thick = 0.004 * k;
  const span = 13, steps = 6;
  const top: V3[][] = [], bot: V3[][] = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const rowT: V3[] = [], rowB: V3[] = [];
    for (let i = 0; i <= span; i++) {
      const a = -A + (2 * A * i) / span;
      const e = edgeAt(edge, az, a);
      const d = norm([e[0] - h.c[0], 0, e[2] - h.c[2]]);
      const len = L * Math.cos((a / A) * Math.PI * 0.5) ** 0.55;
      const drop = len * u * 0.2 + 0.022 * k * (a / A) ** 2 * u;
      const p: V3 = [e[0] + d[0] * len * u, e[1] - drop, e[2] + d[2] * len * u];
      rowT.push(p);
      rowB.push([p[0], p[1] - thick, p[2]]);
    }
    top.push(rowT); bot.push(rowB);
  }
  surface(mb, top, () => c, false, () => [0, 1, 0]);
  surface(mb, bot, () => under, false, () => [0, -1, 0]);
  surface(mb, [top[steps], bot[steps]], () => shade(c, 0.8), false, (p) => norm([p[0] - h.c[0], 0, p[2] - h.c[2]]));
}

/** A crown's edge point toward azimuth `a` (between its columns). */
function edgeAt(edge: V3[], az: number[], a: number): V3 {
  const n = az.length, f = (((a / (Math.PI * 2)) * n) % n + n) % n, i = Math.floor(f), w = f - i;
  return add(mul(edge[i], 1 - w), mul(edge[(i + 1) % n], w));
}

/** A knitted beanie: snug over the skull, a folded ribbed cuff, slouching a little at the back; maybe a bobble. */
export function beanieMesh(mb: MeshBuilder, h: HeadShape, c: Rgb, c2: Rgb, bobble: boolean): void {
  const k = h.radius / ADULT_HEAD;
  const plane = bandPlane(h, BANDS.beanie);
  const CUFF = 0.3, cols = 64;
  const off = (az: number, t: number) => (0.008 + (t < CUFF ? 0.004 * Math.sin((t / CUFF) * Math.PI) ** 0.5 : 0) + 0.012 * t ** 2 + 0.012 * Math.max(0, -Math.cos(az)) * Math.sin(Math.PI * t)) * Math.min(1, k * 1.1);
  const rib = (az: number) => Math.round((az / (Math.PI * 2)) * cols) % 2 === 0;
  crown(mb, h, plane, cols, 14, off, (a, t) => (t < CUFF ? (rib(a) ? shade(c, 0.86) : c) : Math.abs(t - CUFF) < 0.04 ? shade(c, 0.72) : c));
  if (bobble) {
    const p = headPoint(h, Math.PI, Math.PI / 2 - 0.15, skullAt(h, Math.PI, Math.PI / 2 - 0.15) + off(Math.PI, 0.95) + 0.018 * k);
    dome(mb, p[0], p[1], p[2], 0.03 * k, 0.028 * k, 0.03 * k, c2, 12, 1);
  }
}

/** A witch's hat: a crown that stands over the head, tapering to a bent point, a wide wavy brim and a band. */
export function witchHatMesh(mb: MeshBuilder, h: HeadShape, c: Rgb, band: Rgb, seed: number): void {
  const k = h.radius / ADULT_HEAD;
  const plane = bandPlane(h, BANDS.witchHat);
  const cols = 40;
  const az: number[] = [], e0: number[] = [], ring: number[] = [];
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    az.push(a);
    e0.push(bandElevation(h, plane, a, 0.004));
    // The crown's foot stands clear of the widest of the skull above the band.
    let w = 0;
    for (let s = 0; s <= 12; s++) {
      const el = e0[i] + ((Math.PI / 2 - e0[i]) * s) / 12;
      w = Math.max(w, (skullAt(h, a, el) + 0.004) * Math.cos(el));
    }
    ring.push(w + 0.008);
  }
  const yRing = (i: number) => bandY(plane, h.c[0] + Math.sin(az[i]) * ring[i], h.c[2] + Math.cos(az[i]) * ring[i]);
  const straight = h.top + 0.02 * k, apex = straight + 0.2 * k, bend = 0.05 * k;
  const rows = 16;
  const pts: V3[][] = [];
  for (let r = 0; r <= rows; r++) {
    const u = r / rows;
    pts.push(az.map((a, i) => {
      const y0 = yRing(i), y = y0 + (apex - y0) * u;
      const up = Math.min(1, Math.max(0, (y - straight) / (apex - straight)));
      const rad = ring[i] * (y <= straight ? 1 - 0.04 * (y - y0) / Math.max(0.01, straight - y0) : 0.96 * (1 - up) ** 1.15);
      return [h.c[0] + Math.sin(a) * rad, y - bend * 0.4 * up ** 2, h.c[2] + Math.cos(a) * rad - bend * up ** 2];
    }));
  }
  surface(mb, pts, (r) => (r === 0 ? band : shade(c, 0.9 + 0.1 * (r / rows))), true, (p) => norm([p[0] - h.c[0], 0.15, p[2] - h.c[2]]));
  // The band round its foot.
  const bh = 0.03 * k;
  surface(mb, [az.map((a, i) => [h.c[0] + Math.sin(a) * (ring[i] + 0.002), yRing(i), h.c[2] + Math.cos(a) * (ring[i] + 0.002)] as V3),
    az.map((a, i) => [h.c[0] + Math.sin(a) * (ring[i] * 0.995 + 0.002), yRing(i) + bh, h.c[2] + Math.cos(a) * (ring[i] * 0.995 + 0.002)] as V3)],
    () => band, true, (p) => norm([p[0] - h.c[0], 0, p[2] - h.c[2]]));
  // The brim: from the head at the band out past the crown's foot, drooping in a few soft waves.
  const W = 0.15 * k, steps = 6, thick = 0.004 * k, ph = (seed % 97) * 0.13;
  const top: V3[][] = [], bot: V3[][] = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const rowT: V3[] = [], rowB: V3[] = [];
    az.forEach((a, i) => {
      const inner = Math.max(0.001, (skullAt(h, a, e0[i]) + 0.002) * Math.cos(e0[i]));
      const rad = inner + (ring[i] + W - inner) * u;
      const x = h.c[0] + Math.sin(a) * rad, z = h.c[2] + Math.cos(a) * rad;
      const out = Math.max(0, rad - ring[i]) / W;
      const y = bandY(plane, x, z) - 0.002 - out ** 2 * (0.012 + 0.012 * Math.sin(a * 3 + ph)) * k;
      rowT.push([x, y, z]);
      rowB.push([x, y - thick, z]);
    });
    top.push(rowT); bot.push(rowB);
  }
  surface(mb, top, () => c, true, () => [0, 1, 0]);
  surface(mb, bot, () => shade(c, 0.7), true, () => [0, -1, 0]);
  surface(mb, [top[steps], bot[steps]], () => shade(c, 0.8), true, (p) => norm([p[0] - h.c[0], 0, p[2] - h.c[2]]));
}

/** A cat's ears on a hair band: the band over the top of the head pressed into the hair, two pointed ears standing up out of it. */
export function earsMesh(mb: MeshBuilder, h: HeadShape, c: Rgb, inner: Rgb): void {
  const k = h.radius / ADULT_HEAD;
  // The band runs over the head from ear to ear, a little behind the crown.
  const tilt = -0.25;
  const along = (phi: number): V3 => norm([Math.sin(phi), Math.cos(phi) * Math.cos(tilt), Math.cos(phi) * Math.sin(tilt)]);
  const onHead = (d: V3, lift: number): V3 => {
    const az = Math.atan2(d[0], d[2]), el = Math.asin(Math.max(-1, Math.min(1, d[1])));
    const s = skullAt(h, az, el), hr = hairAt(h, az, el);
    return headPoint(h, az, el, s + 0.005 + (hr - s) * 0.35 + lift);
  };
  const N = 24, w = 0.006 * k;
  const rowA: V3[] = [], rowB: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const phi = -1.35 + (2.7 * i) / N, d = along(phi);
    const side = norm(cross(d, [1, 0, 0]));
    const p = onHead(d, 0);
    rowA.push(add(p, mul(side, w))); rowB.push(add(p, mul(side, -w)));
  }
  surface(mb, [rowA, rowB], () => c, false, outFrom(h));
  for (const s of [-1, 1]) {
    // Standing out of the hair: their feet in it a little, not buried.
    const d = along(s * 0.62), az = Math.atan2(d[0], d[2]), el = Math.asin(d[1]);
    const base = headPoint(h, az, el, skullAt(h, az, el) + 0.004 + (hairAt(h, az, el) - skullAt(h, az, el)) * 0.7);
    // The ear: a flattened pyramid, its face forward, leaning out a little.
    const upDir = norm(add(d, [s * 0.15, 0, 0])), fwd = norm(sub([0, 0, 1], mul(upDir, upDir[2])));
    const right = norm(cross(upDir, fwd));
    const half = 0.024 * k, depth = 0.008 * k, tall = 0.058 * k;
    const tip = add(base, add(mul(upDir, tall), mul(fwd, -depth * 0.5)));
    const fl = add(base, add(mul(right, -half), mul(fwd, depth))), fr = add(base, add(mul(right, half), mul(fwd, depth)));
    const bl = add(base, add(mul(right, -half), mul(fwd, -depth))), br = add(base, add(mul(right, half), mul(fwd, -depth)));
    const tri3 = (a: V3, b: V3, t: V3, col: Rgb, ref: V3) => {
      let n = norm(cross(sub(b, a), sub(t, a)));
      const flip = dot(n, ref) < 0;
      if (flip) n = mul(n, -1);
      mb.set('color', col[0], col[1], col[2]);
      const i0 = mb.v(...a, ...n), i1 = mb.v(...b, ...n), i2 = mb.v(...t, ...n);
      if (flip) mb.tri(i0, i2, i1); else mb.tri(i0, i1, i2);
    };
    tri3(fl, fr, tip, inner, fwd);
    tri3(br, bl, tip, c, mul(fwd, -1));
    tri3(bl, fl, tip, c, mul(right, -1));
    tri3(fr, br, tip, c, right);
    // A rim round the pink inside.
    const il = add(fl, mul(sub(tip, fl), 0.12)), ir = add(fr, mul(sub(tip, fr), 0.12));
    tri3(fl, il, tip, c, fwd);
    tri3(ir, fr, tip, c, fwd);
  }
}

/** A whole ellipsoid (or its top `frac`) round (x, y, z): small round parts. */
export function dome(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, rz: number, c: Rgb, seg: number, frac = 0.5): void {
  mb.set('color', c[0], c[1], c[2]);
  const rings = Math.max(2, Math.round(seg / 2));
  const first = mb.v(x, y + ry, z, 0, 1, 0);
  let prev: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const th = (i / rings) * Math.PI * frac, sy = Math.cos(th), sr = Math.sin(th);
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, cx = Math.cos(a) * sr, cz = Math.sin(a) * sr;
      const nx = cx / rx, ny = sy / ry, nz = cz / rz, nl = Math.hypot(nx, ny, nz) || 1;
      ring.push(mb.v(x + cx * rx, y + sy * ry, z + cz * rz, nx / nl, ny / nl, nz / nl));
    }
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      if (i === 1) mb.tri(first, ring[k1], ring[k]);
      else mb.quad(prev[k], prev[k1], ring[k1], ring[k]);
    }
    prev = ring;
  }
}
