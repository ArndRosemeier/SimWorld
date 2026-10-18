/**
 * Bicycles for the town's cyclists (src/traffic: kind 'bicycle'): a diamond frame of round tubes,
 * spoked wheels, a fork, handlebars, saddle, cranks and pedals, a lamp at the front and one at the
 * back. Variants: 0 a town bike (upright bars, mudguards, a rack), 1 a sports bike (low flat bars,
 * thin tyres), 2 a child's bike (smaller), 3 a town bike with a basket. The rider sits on it
 * (`BIKE_SADDLE`; drawn by the people view).
 *
 * Built for the `VEHICLE` kind like the road vehicles (src/build/vehicles.ts: `aPart` per vertex
 * from `VPart`, the paint and lights per instance). Conventions as theirs: metres, origin at the
 * middle of the footprint on the road, forward −Z, right +X, up +Y.
 *
 * New in SimWorld. Pure.
 */
import { v3cross as cross, v3norm as norm } from '@futuremagic/core';
import { MeshBuilder, type MeshData } from './meshBuilder';
import { VEHICLE_SPECS, VPart } from './vehicles';

type P3 = [number, number, number];

/** Wheel radius (m, to the tyre's outside), half the wheelbase, for a grown-up's bike (a child's is SMALL of it). */
const WHEEL = 0.34, HALF_BASE = 0.52, SMALL = 0.78;

/** Where the saddle's top is (y up from the road, z along the bike), by variant: the rider's seat. */
export function bikeSaddle(variant: number): { y: number; z: number } {
  const k = variant === 2 ? SMALL : 1;
  return { y: (variant === 1 ? 0.95 : 0.92) * k, z: 0.14 * k };
}

/** A bicycle's mesh. */
export function bicycle(variant: number): MeshData {
  const mb = new MeshBuilder(VEHICLE_SPECS);
  const k = variant === 2 ? SMALL : 1, sport = variant === 1;
  const s = (p: P3): P3 => [p[0] * k, p[1] * k, p[2] * k];
  const R = WHEEL * k, rear: P3 = [0, R, HALF_BASE * k], front: P3 = [0, R, -HALF_BASE * k];
  // The frame: bottom bracket, seat cluster, head tube; the stays to the back wheel, the fork to the front.
  const bb = s([0, 0.3, 0.02]), seat = s([0, 0.78, 0.1]), headTop = s([0, sport ? 0.8 : 0.84, -0.4]), headLow = s([0, 0.66, -0.36]);
  const tube = sport ? 0.016 : 0.019;
  mb.set('aPart', VPart.Paint);
  rod(mb, bb, seat, tube * 1.1);
  rod(mb, seat, headTop, tube);
  rod(mb, bb, headLow, tube * 1.2);
  rod(mb, headLow, headTop, tube * 1.4);
  for (const x of [-0.05, 0.05]) {
    rod(mb, [x * k, bb[1], bb[2]], [x * k, rear[1], rear[2]], tube * 0.7);
    rod(mb, [x * 0.5 * k, seat[1] - 0.03, seat[2] + 0.01], [x * k, rear[1], rear[2]], tube * 0.6);
    rod(mb, [x * 0.6 * k, headLow[1], headLow[2]], [x * k, front[1], front[2] - 0.03], tube * 0.8);
  }
  // Saddle on its post; the stem and the bars with their grips.
  const sad = bikeSaddle(variant);
  mb.set('aPart', VPart.Chrome);
  rod(mb, seat, [0, sad.y - 0.03, sad.z], 0.012);
  mb.set('aPart', VPart.Plastic);
  mb.box(0, sad.y - 0.02, sad.z + 0.02 * k, 0.07 * k, 0.025, 0.1 * k);
  mb.box(0, sad.y - 0.02, sad.z - 0.1 * k, 0.025 * k, 0.02, 0.05 * k);
  const bar: P3 = sport ? [0, headTop[1] + 0.06 * k, headTop[2] - 0.1 * k] : [0, headTop[1] + 0.16 * k, headTop[2] + 0.02 * k];
  mb.set('aPart', VPart.Chrome);
  rod(mb, headTop, bar, 0.014);
  const W = (sport ? 0.24 : 0.29) * k;
  rod(mb, [-W, bar[1], bar[2] + (sport ? 0 : 0.06 * k)], [W, bar[1], bar[2] + (sport ? 0 : 0.06 * k)], 0.012);
  mb.set('aPart', VPart.Rubber);
  for (const x of [-1, 1]) rod(mb, [x * W, bar[1], bar[2] + (sport ? 0 : 0.06 * k)], [x * (W - 0.11 * k), bar[1], bar[2] + (sport ? 0 : 0.06 * k)], 0.017);
  // Cranks and pedals (one forward, one back), the chainring.
  mb.set('aPart', VPart.Chrome);
  const crank = 0.17 * k;
  for (const x of [-1, 1]) {
    const pz = bb[2] - x * crank, px = x * 0.09 * k;
    rod(mb, [px, bb[1], bb[2]], [px, bb[1], pz], 0.011);
    mb.set('aPart', VPart.Rubber);
    mb.box(px + x * 0.05 * k, bb[1], pz, 0.045 * k, 0.012, 0.03 * k);
    mb.set('aPart', VPart.Chrome);
  }
  chainring(mb, [0.07 * k, bb[1], bb[2]], 0.1 * k, 0.008, VPart.Chrome);
  // The wheels.
  for (const c of [rear, front]) spokedWheel(mb, c, R, sport ? 0.012 : 0.02);
  // Town bikes: mudguards, a rack (and a basket on variant 3); every bike its lamps.
  if (!sport) {
    mb.set('aPart', VPart.Paint);
    for (const c of [rear, front]) arc(mb, c, R + 0.03, c === rear ? -0.3 : 1.2, c === rear ? 2.0 : 3.6, 0.028 * k);
    if (variant !== 2) {
      mb.set('aPart', VPart.Chrome);
      const rt = rear[2] + 0.05 * k, ry = R + 0.06 * k + R;
      for (const x of [-0.08, 0.08]) {
        rod(mb, [x * k, ry, seat[2] + 0.04], [x * k, ry, rt + 0.06], 0.006);
        rod(mb, [x * k, ry, rt], [x * k, rear[1], rear[2]], 0.006);
      }
    }
    if (variant === 3) {
      mb.set('aPart', VPart.Plastic);
      const by = bar[1] - 0.12, bz = bar[2] - 0.2;
      mb.box(0, by - 0.11, bz, 0.17, 0.006, 0.13);
      for (const x of [-1, 1]) mb.box(x * 0.17, by, bz, 0.006, 0.11, 0.13);
      for (const z of [-1, 1]) mb.box(0, by, bz + z * 0.13, 0.17, 0.11, 0.006);
    }
  }
  mb.set('aPart', VPart.Headlight);
  mb.box(0, headTop[1] - 0.04, headTop[2] - 0.05, 0.03, 0.025, 0.025);
  mb.set('aPart', VPart.Taillight);
  mb.box(0, sad.y - 0.12, sad.z + 0.17 * k, 0.025, 0.02, 0.012);
  return mb.build();
}

/** A round rod (six sides) from a to b of radius r. */
function rod(mb: MeshBuilder, a: P3, b: P3, r: number): void {
  const d: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  if (L < 1e-5) return;
  const t: P3 = [d[0] / L, d[1] / L, d[2] / L];
  // Two directions across the rod.
  const h: P3 = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(t, h)), v = cross(t, u);
  const N = 6;
  let base = -1;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
    const n: P3 = [u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn];
    const i0 = mb.v(a[0] + n[0] * r, a[1] + n[1] * r, a[2] + n[2] * r, ...n, i / N, 0);
    mb.v(b[0] + n[0] * r, b[1] + n[1] * r, b[2] + n[2] * r, ...n, i / N, L);
    if (base < 0) base = i0;
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    mb.quad(base + i * 2, base + j * 2, base + j * 2 + 1, base + i * 2 + 1);
  }
}

/** The point a share `f` of the way round a circle about the x axis at c (radius r), from +z (f 0) up (f ¼). */
function around(c: P3, r: number, f: number): P3 {
  const a = f * Math.PI * 2;
  return [c[0], c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r];
}

/** A ring about the x axis at c (radius `R`) of rods `r` thick, as `part`. */
function chainring(mb: MeshBuilder, c: P3, R: number, r: number, part: number): void {
  mb.set('aPart', part);
  for (let i = 0; i < 14; i++) rod(mb, around(c, R, i / 14), around(c, R, (i + 1) / 14), r);
}

/** A spoked wheel at c (radius R to the tyre's outside, tyre `t` thick). */
function spokedWheel(mb: MeshBuilder, c: P3, R: number, t: number): void {
  // The tyre and the rim: rods round the circle.
  const N = 20;
  const pt = (r: number, i: number): P3 => around(c, r, i / N);
  mb.set('aPart', VPart.Rubber);
  for (let i = 0; i < N; i++) rod(mb, pt(R - t, i), pt(R - t, i + 1), t);
  mb.set('aPart', VPart.Chrome);
  for (let i = 0; i < N; i++) rod(mb, pt(R - 2 * t - 0.012, i), pt(R - 2 * t - 0.012, i + 1), 0.008);
  // Hub and spokes.
  rod(mb, [c[0] - 0.05, c[1], c[2]], [c[0] + 0.05, c[1], c[2]], 0.018);
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 0.035 : -0.035;
    rod(mb, [c[0] + side, c[1], c[2]], pt(R - 2 * t - 0.012, (i * N) / 12 + 0.5), 0.0035);
  }
}

/** A mudguard: a strip round the wheel at c, radius r, from angle a0 to a1 (0 towards +z, π/2 up), `w` half wide (both faces). */
function arc(mb: MeshBuilder, c: P3, r: number, a0: number, a1: number, w: number): void {
  const N = 10;
  for (let i = 0; i < N; i++) {
    const A = around(c, r, (a0 + ((a1 - a0) * i) / N) / (Math.PI * 2)), B = around(c, r, (a0 + ((a1 - a0) * (i + 1)) / N) / (Math.PI * 2));
    const n = norm([0, (A[1] + B[1]) / 2 - c[1], (A[2] + B[2]) / 2 - c[2]]);
    const i0 = mb.v(A[0] - w, A[1], A[2], ...n), i1 = mb.v(A[0] + w, A[1], A[2], ...n), i2 = mb.v(B[0] + w, B[1], B[2], ...n), i3 = mb.v(B[0] - w, B[1], B[2], ...n);
    mb.quad(i0, i1, i2, i3);
    mb.quad(i3, i2, i1, i0);
  }
}
