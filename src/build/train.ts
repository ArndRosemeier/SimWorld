/**
 * Railcars for the trains past the town (src/traffic/trains.ts): a cab car (the driver's cab at
 * the front, −Z) and a middle car, of an invented regional multiple unit. The body is one cross
 * section swept along the car, with the band of side windows, two pairs of doors a side, a band of
 * the second livery colour below the windows, a rounded roof with its equipment, and gangways at
 * the coupled ends. The cab end leans back into a raked windscreen and rounds off in plan, with
 * head and tail lamps. Under it: the frame, two bogies and their wheels on the rails.
 *
 * Built for the `VEHICLE` kind like the road vehicles (src/build/vehicles.ts: `aPart` per vertex
 * from `VPart`; the paint and lights per instance). Conventions as theirs: metres, origin at the
 * middle of the car on the rail heads, forward −Z, right +X, up +Y.
 *
 * New in SimWorld. Pure.
 */
import { MeshBuilder, type MeshData } from './meshBuilder';
import { VEHICLE_SPECS, VPart } from './vehicles';

/** Half the body length (m; the car is TRAIN_CAR over its gangways), the cab's nose length. */
const HALF = 10, NOSE = 2.3;
/** The body's cross section, right half, from the skirt to the middle of the roof: x, y. */
const SECTION: [number, number][] = [
  [1.34, 1.0], [1.44, 1.14], [1.47, 1.42], [1.47, 1.62], [1.46, 1.76], [1.43, 2.56], [1.4, 2.74], [1.3, 3.28], [1.06, 3.6], [0.56, 3.77], [0, 3.81],
];
/** Rows of SECTION (by the index of their lower point): skirt, side, livery band, sill, windows, above them, roof. */
const SKIRT = 0, BAND = 2, WINDOWS = 4;
/** Window bays (m) and pillars, doors (centres from the middle, width). */
const BAY = 1.7, PILLAR = 0.22, DOOR_W = 1.3, DOORS = [-6.2, 6.2];
/** Bogie centres from the middle, wheel base, wheel radius, gauge. */
const BOGIE = 7, BASE = 2.5, WHEEL = 0.46, GAUGE = 1.435;

/** A railcar's mesh: variant 0 a cab car, 1 a middle car. */
export function trainCar(variant: number): MeshData {
  const mb = new MeshBuilder(VEHICLE_SPECS);
  const cab = variant === 0;
  carBody(mb, cab);
  // The coupled ends: a closed end wall and the gangway bellows.
  for (const end of cab ? [1] : [-1, 1]) {
    endWall(mb, end * HALF, end);
    mb.set('aPart', VPart.Rubber);
    mb.box(0, 2.1, end * (HALF + 0.12), 0.62, 1.05, 0.13);
  }
  if (cab) nose(mb);
  // Under the floor: the frame and its tanks between the bogies, then the bogies with their wheels.
  mb.set('aPart', VPart.Undercarriage);
  mb.box(0, 0.86, 0, 1.25, 0.14, HALF - 0.3);
  mb.box(0, 0.62, 0, 1.0, 0.24, 3.6);
  for (const zb of [-BOGIE, BOGIE]) {
    mb.box(0, 0.62, zb, 1.08, 0.2, BASE / 2 + 0.45);
    for (const dz of [-BASE / 2, BASE / 2]) for (const sx of [-1, 1]) wheel(mb, (sx * GAUGE) / 2, zb + dz);
  }
  // On the roof: the cooling and air units.
  mb.set('aPart', VPart.Paint);
  for (const z of [-3.2, 3.2]) mb.box(0, 3.86, z, 0.72, 0.12, 1.5);
  return mb.build();
}

/** The body sides and roof from z0 to z1 (−HALF + NOSE on a cab car), each quad its own part. */
function carBody(mb: MeshBuilder, cab: boolean): void {
  const z0 = cab ? -HALF + NOSE : -HALF, z1 = HALF;
  // Cuts along the car: the window pillars and the door edges.
  const cuts = new Set<number>([z0, z1]);
  for (const d of DOORS) { cuts.add(d - DOOR_W / 2); cuts.add(d + DOOR_W / 2); }
  for (let z = z0 + 0.6; z < z1 - 0.6; z += BAY) { cuts.add(z); cuts.add(z + PILLAR); }
  const zs = [...cuts].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i], zb = zs[i + 1], zm = (za + zb) / 2;
    const door = DOORS.some((d) => Math.abs(zm - d) < DOOR_W / 2);
    const pillar = !door && [...cuts].some((c) => zm > c && zm < c + PILLAR && cuts.has(c + PILLAR) && c - z0 > 0.5);
    const glass = !pillar && zm > z0 + 0.6 && zm < z1 - 0.6;
    for (let j = 0; j + 1 < SECTION.length; j++) {
      const part = j === SKIRT ? VPart.Plastic : door && j >= 1 && j <= WINDOWS ? VPart.Livery : j === BAND ? VPart.Livery : j === WINDOWS && glass ? VPart.Glass : VPart.Paint;
      const [xa, ya] = SECTION[j], [xb, yb] = SECTION[j + 1];
      for (const s of [-1, 1]) quad(mb, part, s, [s * xa, ya, za], [s * xb, yb, za], [s * xb, yb, zb], [s * xa, ya, zb]);
    }
  }
}

/** A flat end wall at z (facing `dir` along z). */
function endWall(mb: MeshBuilder, z: number, dir: number): void {
  mb.set('aPart', VPart.Paint);
  const c = mb.v(0, 2.2, z, 0, 0, dir);
  const ring: number[] = [];
  for (const s of [1, -1]) {
    const pts = s > 0 ? SECTION : [...SECTION].reverse();
    for (const [x, y] of pts) ring.push(mb.v(s * x, y, z, 0, 0, dir));
  }
  for (let i = 0; i + 1 < ring.length; i++) {
    if (dir > 0) mb.tri(c, ring[i], ring[i + 1]);
    else mb.tri(c, ring[i + 1], ring[i]);
  }
}

/** Where the cab's front is at height y (z): upright below the windscreen, raked back above it, rounding into the roof. */
const frontZ = (y: number): number => -HALF + (y < 1.75 ? 0 : y < 2.9 ? (y - 1.75) * 0.75 : 0.86 + (y - 2.9) * 1.25);

/** The cab end: rings from the front to the full section, rounded in plan; the front face, lamps and windscreen. */
function nose(mb: MeshBuilder): void {
  const us = [0, 0.18, 0.42, 0.7, 1];
  const sectionAt = (u: number): [number, number, number][] => SECTION.map(([x, y]) => {
    const k = 1 - 0.22 * (1 - u) ** 2;
    return [x * k, y, frontZ(y) + (-HALF + NOSE - frontZ(y)) * u];
  });
  for (let r = 0; r + 1 < us.length; r++) {
    const A = sectionAt(us[r]), B = sectionAt(us[r + 1]);
    for (let j = 0; j + 1 < SECTION.length; j++) {
      // The cab's side window just behind the windscreen.
      const part = j === SKIRT ? VPart.Plastic : j === BAND ? VPart.Livery : j === WINDOWS && r >= 2 ? VPart.Glass : VPart.Paint;
      for (const s of [-1, 1]) {
        const m = (p: [number, number, number]): [number, number, number] => [s * p[0], p[1], p[2]];
        quad(mb, part, s, m(A[j]), m(A[j + 1]), m(B[j + 1]), m(B[j]));
      }
    }
  }
  // The front face: rows of the front ring joined across, the windscreen in the middle rows.
  const F = sectionAt(0);
  for (let j = 0; j + 1 < SECTION.length; j++) {
    const [xa, ya, za] = F[j], [xb, yb, zb] = F[j + 1];
    const part = j === WINDOWS ? VPart.Glass : j === BAND || j === BAND + 1 ? VPart.Livery : j === SKIRT ? VPart.Plastic : VPart.Paint;
    quad(mb, part, 1, [-xa, ya, za], [-xb, yb, zb], [xb, yb, zb], [xa, ya, za]);
  }
  // The lamps: head lamps outboard, tail lamps beside them, just proud of the face.
  const zl = frontZ(1.3) - 0.03;
  for (const s of [-1, 1]) {
    mb.set('aPart', VPart.Headlight);
    mb.box(s * 0.92, 1.3, zl, 0.17, 0.09, 0.04);
    mb.set('aPart', VPart.Taillight);
    mb.box(s * 1.2, 1.3, zl, 0.07, 0.07, 0.04);
  }
  mb.set('aPart', VPart.Headlight);
  mb.box(0, 3.25, frontZ(3.25) - 0.02, 0.12, 0.07, 0.04);
  // The coupler under the nose.
  mb.set('aPart', VPart.Undercarriage);
  mb.box(0, 0.95, -HALF - 0.25, 0.2, 0.15, 0.35);
}

/** A flat-shaded quad (corners in order round it), its outward side on side `s` (±1 in x: the corners wind the other way on the left). */
function quad(mb: MeshBuilder, part: number, s: number, a: number[], b: number[], c: number[], d: number[]): void {
  const [p, q, r, t] = s > 0 ? [a, b, c, d] : [a, d, c, b];
  const ux = r[0] - p[0], uy = r[1] - p[1], uz = r[2] - p[2], vx = t[0] - q[0], vy = t[1] - q[1], vz = t[2] - q[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  mb.set('aPart', part);
  const i = mb.v(p[0], p[1], p[2], nx, ny, nz), j = mb.v(q[0], q[1], q[2], nx, ny, nz), k = mb.v(r[0], r[1], r[2], nx, ny, nz), m = mb.v(t[0], t[1], t[2], nx, ny, nz);
  mb.quad(i, j, k, m);
}

/** One wheel at (x, z) on the rail: an eight-sided disc, axle along x. */
function wheel(mb: MeshBuilder, x: number, z: number): void {
  const N = 8, w = 0.07, s = Math.sign(x);
  // Round the rim: height and offset along the car.
  const rim: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    rim.push([WHEEL + WHEEL * Math.sin(a), WHEEL * Math.cos(a)]);
  }
  for (let i = 0; i < N; i++) {
    const [ya, da] = rim[i], [yb, db] = rim[(i + 1) % N];
    quad(mb, VPart.Undercarriage, 1, [x - w, ya, z + da], [x + w, ya, z + da], [x + w, yb, z + db], [x - w, yb, z + db]);
  }
  // The outer face.
  mb.set('aPart', VPart.Undercarriage);
  const c = mb.v(x + s * w, WHEEL, z, s, 0, 0);
  const ring = rim.map(([y, d]) => mb.v(x + s * w, y, z + d, s, 0, 0));
  for (let i = 0; i < N; i++) if (s < 0) mb.tri(c, ring[i], ring[(i + 1) % N]); else mb.tri(c, ring[(i + 1) % N], ring[i]);
}
