/**
 * A building's stair core and lift: planned once from the ground floor and kept through every
 * storey the footprint allows, both clear of the way in from the street door. The stairs are a
 * switchback in a band along a side wall at one end of the long axis; the lift sits at the other
 * end. Also the way in behind the street door, which no wall or furniture may block.
 *
 * Ported from Scale (src/interior/InteriorGen.ts: planCores, planLift, planStair, doorWay,
 * stairsOf and the local Frame).
 */
import { minAreaRect, polyArea, pointInPoly, type Poly } from '../geom/geom2';
import { intersection } from '../geom/clip';
import type { BuildingDesc } from '../plan/building';
import type { FloorPlan } from './types';

/**
 * A building's stair core (planned once from the ground floor, like the lift): a switchback in a
 * band along one side wall at one end of the long axis. Local frame: origin at the near end on the
 * band's centre line, u along the first flight (towards the facade), v across. Lane A (v < 0)
 * climbs the first half storey to a landing at the far end, lane B (v > 0) climbs back to the next
 * floor's near landing; a wall stands between the lanes and along the side open to the stair hall.
 */
export interface StairCore {
  cx: number; cz: number; ux: number; uz: number;
  /** Length (near landing + run + far landing), lane width, gap between the lanes. */
  len: number; w: number; g: number;
  near: number; run: number;
  /** Which side (±1 in v) faces the stair hall (the other is the building's side wall). */
  open: number;
}

/** Core-local (u, v) → world (x, z). */
export function coreP(c: StairCore, u: number, v: number): [number, number] {
  return [c.cx + c.ux * u - c.uz * v, c.cz + c.uz * u + c.ux * v];
}

/** The core's footprint (world polygon), optionally from u0 on. */
export function coreRect(c: StairCore, u0 = 0, m = 0): number[] {
  const b = c.w + c.g / 2;
  return [...coreP(c, u0 - m, -b - m), ...coreP(c, c.len + m, -b - m), ...coreP(c, c.len + m, b + m), ...coreP(c, u0 - m, b + m)];
}

/** Elevator shaft (world coordinates): centre, u axis (doors face +u), half extents. */
export interface LiftShaft {
  cx: number; cz: number; ux: number; uz: number; hu: number; hv: number;
}

/** Corners of the shaft (CCW-agnostic quad), optionally grown by m. */
export function liftRect(l: LiftShaft, m = 0): number[] {
  const vx = -l.uz, vz = l.ux, out: number[] = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.push(l.cx + l.ux * su * (l.hu + m) + vx * sv * (l.hv + m), l.cz + l.uz * su * (l.hu + m) + vz * sv * (l.hv + m));
  }
  return out;
}

const LIFT_HU = 1.0, LIFT_HV = 1.1;
/** Free floor in front of the lift doors (m). */
export const LANDING = 1.8;

/**
 * Where a building's elevator goes (once per building, from the ground-floor footprint):
 * at one end of the long axis, slid inwards until shaft and landing fit the footprint.
 */
export function planLift(b: BuildingDesc, poly: Poly, door: Door | null = null): LiftShaft | null {
  if (b.floors < 2) return null;
  // Never in the way in from the street door (no lift when only that spot fits: the stairs go up).
  return liftAt(b, poly, door && doorWay(poly, door, 2.2, 0.75));
}

function liftAt(b: BuildingDesc, poly: Poly, way: Poly | null): LiftShaft | null {
  // (SimWorld: a town's blocks of four storeys and more have a lift; houses never.)
  if (b.floors < 4 || b.style === 'house' || b.style === 'rowhouse') return null;
  const F = new Frame(poly);
  if (F.hu < 3 || F.hv < 1.6) return null;
  // The exact shaft (with margin, corners and edge midpoints) and its landing must be inside.
  const candidate = (u0: number, v: number): LiftShaft => {
    const c = F.P(u0 + LIFT_HU, v);
    return { cx: c[0], cz: c[1], ux: F.ux, uz: F.uz, hu: LIFT_HU, hv: LIFT_HV };
  };
  const fits = (u0: number, v: number) => {
    const r = liftRect(candidate(u0, v), 0.15);
    for (let k = 0; k < 8; k += 2) {
      const n = (k + 2) % 8;
      if (!pointInPoly(poly, r[k], r[k + 1]) || !pointInPoly(poly, (r[k] + r[n]) / 2, (r[k + 1] + r[n + 1]) / 2)) return false;
    }
    for (const dv of [-LIFT_HV, 0, LIFT_HV]) {
      const q = F.P(u0 + LIFT_HU * 2 + LANDING, v + dv);
      if (!pointInPoly(poly, q[0], q[1])) return false;
    }
    return !way || !overlaps(r, way);
  };
  const vOff = Math.max(0, F.hv - LIFT_HV - 0.3);
  for (let inset = 0.15; inset < F.hu - 1; inset += 0.5) {
    for (const v of [vOff, -vOff, 0]) {
      if (fits(-F.hu + inset, v)) return candidate(-F.hu + inset, v);
    }
  }
  return null;
}

/** A street door: its centre on the facade. */
export type Door = { x: number; z: number };

/**
 * The way in behind a street door: a quad `half` to either side of the door centre, from just
 * outside the facade to `depth` m into the storey (along the inward normal of the outline edge
 * nearest the door), or null when the door is not on the outline.
 */
export function doorWay(poly: Poly, door: Door, depth: number, half: number): Poly | null {
  const n = poly.length >> 1;
  let best = Infinity, ex = 0, ez = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2], az = poly[i * 2 + 1], dx = poly[j * 2] - ax, dz = poly[j * 2 + 1] - az;
    const L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((door.x - ax) * dx + (door.z - az) * dz) / L2));
    const d = Math.hypot(ax + dx * t - door.x, az + dz * t - door.z);
    if (d < best) { best = d; const L = Math.sqrt(L2); ex = dx / L; ez = dz / L; }
  }
  if (best > 1) return null;
  // Inward: the side of the edge the storey lies on.
  let nx = -ez, nz = ex;
  if (!pointInPoly(poly, door.x + nx * (best + 0.3), door.z + nz * (best + 0.3))) { nx = -nx; nz = -nz; }
  const P = (s: number, d: number): [number, number] => [door.x + ex * s + nx * d, door.z + ez * s + nz * d];
  return [...P(-half, -0.3), ...P(half, -0.3), ...P(half, depth), ...P(-half, depth)];
}

/** Do two convex quads overlap? */
export function overlaps(a: Poly, b: Poly): boolean {
  const s = intersection([a], [b]);
  return s.some((q) => Math.abs(polyArea(q.outer)) > 0.01);
}

/** Steps no higher than this (m), treads this deep. */
const RISE = 0.175, TREAD = 0.27;

/**
 * Where a building's stairs go (once per building, from the ground floor; null for single storeys
 * and churches): at the end of the long axis away from the lift, along a side wall, as far as
 * the footprint allows. `maxH`: the tallest storey (sizes the flights).
 */
export function planStair(b: BuildingDesc, poly: Poly, lift: LiftShaft | null, maxH: number, door: Door | null = null): StairCore | null {
  if (b.floors < 2 || b.style === 'church') return null;
  // Never in the way in from the street door; where no spot keeps it clear, the first that fits
  // (and planFloor opens up the hall wall in front of the door).
  const way = door && doorWay(poly, door, 2.2, 0.75);
  return (way && stairAt(poly, lift, maxH, way)) || stairAt(poly, lift, maxH, null);
}

/**
 * Lift and stairs of a building together, both clear of the way in from the street door: when the
 * stairs only keep it clear without the lift, the building goes without the lift.
 */
export function planCores(b: BuildingDesc, poly: Poly, maxH: number, door: Door | null): { lift: LiftShaft | null; stair: StairCore | null } {
  const stairs = b.floors >= 2 && b.style !== 'church';
  // A roomy way in first, then (small and oddly cut houses) narrower ones that still let one walk
  // in. Where even a step inside the door would run into the stairs, the house goes without them
  // (the lift alone takes people up when it fits).
  let liftOnly: LiftShaft | null = null;
  for (const [depth, half] of [[2.2, 0.75], [1.6, 0.5], [1.0, 0.4]]) {
    const way = door && doorWay(poly, door, depth, half);
    if (!way) break;
    const lift = liftAt(b, poly, way);
    if (!stairs) return { lift, stair: null };
    const st = stairAt(poly, lift, maxH, way);
    if (st) return { lift, stair: st };
    const alone = lift && stairAt(poly, null, maxH, way);
    if (alone) return { lift: null, stair: alone };
    liftOnly ??= lift;
    if (depth === 1) return { lift: liftOnly, stair: null };
  }
  const lift = planLift(b, poly);
  return { lift, stair: planStair(b, poly, lift, maxH) };
}

function stairAt(poly: Poly, lift: LiftShaft | null, maxH: number, way: Poly | null): StairCore | null {
  const F = new Frame(poly);
  // The end away from the lift (the lift sits at the -u end when there is one).
  const liftEnd = lift ? Math.sign((lift.cx - F.cx) * F.ux + (lift.cz - F.cz) * F.uz) || -1 : 0;
  const lr = lift ? liftRect(lift, LANDING + 0.6) : null;
  // A comfortable core first, then a compact one for narrow houses (narrower, steeper, shorter landings).
  for (const [w, g, near, far, rise, tread, hall] of [[1.1, 0.12, 1.3, 1.25, RISE, TREAD, 1.2], [0.9, 0.08, 1.0, 1.0, 0.19, 0.25, 0.9]]) {
    const run = Math.max(2.2, Math.ceil(maxH / 2 / rise) * tread);
    const len = near + run + far, band = 2 * w + g;
    if (F.hu * 2 < len + hall + 1 || F.hv * 2 < band + 0.5) continue;
    for (const end of liftEnd ? [-liftEnd] : [1, -1]) {
      for (const side of [1, -1]) {
        for (let inset = 0.15; inset < F.hu * 2 - len - hall; inset += 0.5) {
          const uF = end * (F.hu - inset), uN = uF - end * len;
          const vc = side * (F.hv - 0.15 - band / 2);
          const [cx, cz] = F.P(uN, vc);
          const c: StairCore = { cx, cz, ux: end * F.ux, uz: end * F.uz, len, w, g, near, run, open: -side * end };
          const r = coreRect(c, 0, 0.1);
          let ok = true;
          for (let k = 0; k < 8 && ok; k += 2) {
            const n = (k + 2) % 8;
            if (!pointInPoly(poly, r[k], r[k + 1]) || !pointInPoly(poly, (r[k] + r[n]) / 2, (r[k + 1] + r[n + 1]) / 2)) ok = false;
          }
          // Room in front of it for the stair hall.
          const h = coreP(c, -hall, 0);
          if (!pointInPoly(poly, h[0], h[1])) ok = false;
          if (ok && lr) for (let k = 0; k < 8; k += 2) if (pointInPoly(lr, r[k], r[k + 1]) || pointInPoly(r, lr[k], lr[k + 1])) ok = false;
          if (ok && way && overlaps(r, way)) ok = false;
          if (ok) return c;
        }
      }
    }
  }
  return null;
}

/** Does the stair core lie inside a storey's outline? */
export function coreFits(c: StairCore, poly: Poly): boolean {
  const r = coreRect(c, 0, 0.02);
  for (let k = 0; k < r.length; k += 2) if (!pointInPoly(poly, r[k], r[k + 1])) return false;
  return true;
}

/** Local frame (OBB) of a polygon: u along the long axis, v across. */
export class Frame {
  readonly cx: number; readonly cz: number; readonly ux: number; readonly uz: number; readonly hu: number; readonly hv: number;
  constructor(poly: Poly) {
    const o = minAreaRect(poly);
    let ux = o.ux, uz = o.uz, hu = o.hu, hv = o.hv;
    if (hv > hu) { ux = -o.uz; uz = o.ux; const t = hu; hu = hv; hv = t; }
    this.cx = o.cx; this.cz = o.cz; this.ux = ux; this.uz = uz; this.hu = hu; this.hv = hv;
  }
  P(u: number, v: number): [number, number] {
    return [this.cx + this.ux * u - this.uz * v, this.cz + this.uz * u + this.ux * v];
  }
  rect(u0: number, v0: number, u1: number, v1: number): Poly {
    return [...this.P(u0, v0), ...this.P(u1, v0), ...this.P(u1, v1), ...this.P(u0, v1)];
  }
  get yaw(): number { return Math.atan2(this.ux, this.uz); }
}

/**
 * The stairs of one storey in its core: the enclosure wall on the hall side, the wall between
 * the lanes, and (going up) the two half flights with the landing between them; at the bottom of
 * the core the space under lane B is closed, at the top the opening over lane A is railed off.
 */
export function stairsOf(plan: FloorPlan, c: StairCore, y: number, h: number, up: boolean, below: boolean): void {
  const band = 2 * c.w + c.g, vb = band / 2, mid = -vb + c.w + c.g / 2;
  const wall = (u0: number, v0: number, u1: number, v1: number) => {
    const a = coreP(c, u0, v0), b = coreP(c, u1, v1);
    plan.walls.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], doors: [], solid: true });
  };
  // Enclosure along the hall side past the near landing, along the outer side and across the far end
  // (the facade may stand a little further off: nobody walks off the landing).
  wall(c.near, c.open * vb, c.len, c.open * vb);
  wall(0, -c.open * vb, c.len, -c.open * vb);
  wall(c.len, -vb, c.len, vb);
  if (!up && !below) return;
  // Between the lanes.
  wall(c.near, mid, c.near + c.run, mid);
  if (!below) wall(c.near, mid, c.near, vb); // nothing under lane B at the bottom
  if (!up) { wall(c.near, -vb, c.near, mid); return; } // the opening over lane A at the top
  const half = h / 2;
  const la = coreP(c, c.near, -vb + c.w / 2), lb = coreP(c, c.near + c.run, vb - c.w / 2);
  plan.flights.push({ x: la[0], z: la[1], dx: c.ux, dz: c.uz, width: c.w, run: c.run, y0: y, y1: y + half });
  plan.flights.push({ x: lb[0], z: lb[1], dx: -c.ux, dz: -c.uz, width: c.w, run: c.run, y0: y + half, y1: y + h });
  const L = [...coreP(c, c.near + c.run, -vb), ...coreP(c, c.len, -vb), ...coreP(c, c.len, vb), ...coreP(c, c.near + c.run, vb)];
  plan.landings.push({ poly: L, y: y + half });
  plan.stairHole = coreRect(c, c.near - 0.02);
}
