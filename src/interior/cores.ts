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
import { intersection, largest, unionPos } from '../geom/clip';
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
  const f = doorFrame(poly, door);
  return f && hallway(door, f, -half, half, depth);
}

/** A door's frame: along the outline edge nearest it (e) and into the storey (n); null when the door is not on the outline. */
function doorFrame(poly: Poly, door: Door): DoorFrame | null {
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
  return { ex, ez, nx, nz };
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
 * stairs only keep it clear without the lift, the building goes without the lift. With `flats`
 * (src/plan/building.ts flatsDoor: homes over a shop) the stairs go where a hall from that door
 * reaches them without crossing the shop, and `entry` is that hall (the ground floor's stair hall
 * with the hallway from the door); such a building has no lift.
 */
export function planCores(b: BuildingDesc, poly: Poly, maxH: number, door: Door | null, flats: Door | null = null): { lift: LiftShaft | null; stair: StairCore | null; entry: Poly | null } {
  const stairs = b.floors >= 2 && b.style !== 'church';
  if (stairs && flats) {
    const got = entryCores(poly, maxH, door, flats);
    if (got) return { lift: null, ...got };
  }
  // A roomy way in first, then (small and oddly cut houses) narrower ones that still let one walk
  // in. Where even a step inside the door would run into the stairs, the house goes without them
  // (the lift alone takes people up when it fits).
  let liftOnly: LiftShaft | null = null;
  for (const [depth, half] of [[2.2, 0.75], [1.6, 0.5], [1.0, 0.4]]) {
    const way = door && doorWay(poly, door, depth, half);
    if (!way) break;
    const lift = liftAt(b, poly, way);
    if (!stairs) return { lift, stair: null, entry: null };
    const st = stairAt(poly, lift, maxH, way);
    if (st) return { lift, stair: st, entry: null };
    const alone = lift && stairAt(poly, null, maxH, way);
    if (alone) return { lift: null, stair: alone, entry: null };
    liftOnly ??= lift;
    if (depth === 1) return { lift: liftOnly, stair: null, entry: null };
  }
  const lift = planLift(b, poly);
  return { lift, stair: planStair(b, poly, lift, maxH), entry: null };
}

/** Floor area (m²) under which the stair hall is only the landing at the foot of the flights. */
export const SMALL_FLOOR = 70;

/**
 * The stair hall of a storey (core-local quad, world coordinates): the landing at the foot of the
 * flights and, on a floor of SMALL_FLOOR or more (and `strip`), a strip along the core's open
 * side; the core itself included.
 */
export function stairHall(c: StairCore, poly: Poly, strip = true): Poly {
  const small = !strip || Math.abs(polyArea(poly)) < SMALL_FLOOR;
  const bw = c.w + c.g / 2, side = small ? 0 : 1.2, foot = small ? 1.1 : 1.4;
  const v0 = c.open > 0 ? -bw : -bw - side, v1 = c.open > 0 ? bw + side : bw;
  return [...coreP(c, -foot, v0), ...coreP(c, c.len, v0), ...coreP(c, c.len, v1), ...coreP(c, -foot, v1)];
}

/** Hallway from the flats' door: as wide as the door and as the stair hall needs, at most this long (m). */
const ENTRY_HALF = 0.6, ENTRY_MAX = 16;

/**
 * The stair core whose hall the shortest hallway from the flats' door reaches (straight in from
 * the door, not through the core, clear of the shop's way in), and the hall with that hallway.
 * The hallway runs along the side wall when the door is close to it (no sliver of shop beside it).
 */
function entryCores(poly: Poly, maxH: number, door: Door | null, flats: Door): { stair: StairCore; entry: Poly } | null {
  const f = doorFrame(poly, flats);
  if (!f) return null;
  // (The shop's way in roomy, else narrower, as for the stairs of any building.)
  for (const [depth, half] of [[2.2, 0.75], [1.6, 0.5], [1.0, 0.4]]) {
    const got = entryFor(poly, maxH, door && doorWay(poly, door, depth, half), flats, f);
    if (got) return got;
  }
  return null;
}

function entryFor(poly: Poly, maxH: number, way: Poly | null, flats: Door, f: DoorFrame): { stair: StairCore; entry: Poly } | null {
  // The hallway's span along the facade: the door's width, out to the corner when that is near.
  let sl = -ENTRY_HALF, sr = ENTRY_HALF;
  for (const sgn of [-1, 1]) {
    let reach = 0;
    while (reach < 2.4 && pointInPoly(poly, flats.x + f.ex * sgn * (ENTRY_HALF + reach + 0.2) + f.nx * 0.3, flats.z + f.ez * sgn * (ENTRY_HALF + reach + 0.2) + f.nz * 0.3)) reach += 0.1;
    if (reach < 1.9) { if (sgn < 0) sl = -ENTRY_HALF - reach - 0.3; else sr = ENTRY_HALF + reach + 0.3; }
  }
  const front = frontStair(poly, maxH, way, flats, f, sl, sr);
  if (front) return front;
  // Else the stairs where they fit, and a hallway straight in from the door to their hall.
  const S = (x: number, z: number): [number, number] => [(x - flats.x) * f.ex + (z - flats.z) * f.ez, (x - flats.x) * f.nx + (z - flats.z) * f.nz];
  const lines = [sl + 0.4, (sl + sr) / 2, sr - 0.4];
  // Lines down the hallway: where each meets the hall (it must, for all) and the core (it must not, before).
  const span = (q: Poly, sv: number) => lineSpan(q, S, sv);
  let best: { stair: StairCore; depth: number; hall: Poly } | null = null;
  for (const c of stairSpots(poly, null, maxH)) {
    const core = coreRect(c, 0, 0.1);
    if (way && overlaps(core, way)) continue;
    const hall = stairHall(c, poly);
    let depth = 0, ok = true;
    for (const sv of lines) {
      const h = span(hall, sv), k = span(core, sv);
      if (!h || h[0] > ENTRY_MAX) { ok = false; break; }
      if (k && k[0] < h[0] + 0.4) { ok = false; break; }
      depth = Math.max(depth, h[0] + 0.4);
    }
    if (!ok || (best && depth >= best.depth)) continue;
    // The hallway stays inside the storey (an L-shaped floor) and clear of the shop's way in.
    const corridor = hallway(flats, f, sl, sr, depth);
    if (way && overlaps(corridor, way)) continue;
    let inside = true;
    for (let d = 0.3; d < depth && inside; d += 1) for (const sv of [sl + 0.2, sr - 0.2]) {
      const x = flats.x + f.ex * sv + f.nx * d, z = flats.z + f.ez * sv + f.nz * d;
      if (!pointInPoly(poly, x, z)) inside = false;
    }
    if (inside) best = { stair: c, depth, hall };
  }
  if (!best) return null;
  const entry = largest(intersection(unionPos([hallway(flats, f, sl, sr, best.depth), best.hall]).map((u) => u.outer), [poly]));
  return !entry || (way && overlaps(entry, way)) ? null : { stair: best.stair, entry };
}

/**
 * The stairs straight behind the flats' door: the core along the side wall the door is nearer,
 * its flights running in from the front, the landing at their foot just inside the door (the
 * town house's way up beside the shop).
 */
function frontStair(poly: Poly, maxH: number, way: Poly | null, flats: Door, f: DoorFrame, sl: number, sr: number): { stair: StairCore; entry: Poly } | null {
  // The corner side: where the hallway reached the side wall (else the nearer one).
  const sgn = -sl > sr ? -1 : 1, wall = sgn < 0 ? -sl - 0.1 : sr - 0.1;
  const vAlong = -f.nz * f.ex + f.nx * f.ez; // core v (perpendicular to u = n) along the facade: ±1
  for (const [w, g, near, far, rise, tread] of CORE_SIZES) {
    const run = Math.max(2.2, Math.ceil(maxH / 2 / rise) * tread);
    const len = near + run + far, band = 2 * w + g;
    // Off the side wall as little as the outline lets it (a lot's side walls are seldom square to its front).
    // Close to the side wall first: square to the front, else turned a little to follow a side wall that is not.
    for (let off = 0.15; off < 3; off += 0.1) for (const deg of [0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25]) for (const foot of [1.4, 1.1]) {
      const sc = sgn * (wall - off - band / 2);
      // (The landing at its foot opens onto the door's hallway.)
      if (Math.min(sr, sc + band / 2) - Math.max(sl, sc - band / 2) < 0.7) continue;
      const a = (deg * Math.PI) / 180, ux = f.nx * Math.cos(a) - f.nz * Math.sin(a), uz = f.nx * Math.sin(a) + f.nz * Math.cos(a);
      const cx = flats.x + f.ex * sc + f.nx * foot, cz = flats.z + f.ez * sc + f.nz * foot;
      const c: StairCore = { cx, cz, ux, uz, len, w, g, near, run, open: -sgn * vAlong };
      const r = coreRect(c, 0, 0.1);
      let ok = true;
      for (let k = 0; k < 8 && ok; k += 2) {
        const n = (k + 2) % 8;
        if (!pointInPoly(poly, r[k], r[k + 1]) || !pointInPoly(poly, (r[k] + r[n]) / 2, (r[k + 1] + r[n + 1]) / 2)) ok = false;
      }
      if (!ok || (way && overlaps(r, way))) continue;
      const entry = largest(intersection(unionPos([hallway(flats, f, sl, sr, foot + 0.2 + Math.abs(Math.tan(a)) * band), stairHall(c, poly, false)]).map((u) => u.outer), [poly]));
      if (!entry || (way && overlaps(entry, way))) continue;
      return { stair: c, entry };
    }
  }
  return null;
}

type DoorFrame = { ex: number; ez: number; nx: number; nz: number };

/** The hallway quad from just outside the door to `depth` in, between sl and sr along the facade. */
function hallway(door: Door, f: DoorFrame, sl: number, sr: number, depth: number): Poly {
  const P = (sv: number, d: number): [number, number] => [door.x + f.ex * sv + f.nx * d, door.z + f.ez * sv + f.nz * d];
  return [...P(sl, -0.3), ...P(sr, -0.3), ...P(sr, depth), ...P(sl, depth)];
}

/** Where the line s = sv (door frame) crosses a convex quad: its [near, far] depth, or null. */
function lineSpan(q: Poly, S: (x: number, z: number) => [number, number], sv: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const n = q.length >> 1;
  for (let i = 0; i < n; i++) {
    const [s0, d0] = S(q[i * 2], q[i * 2 + 1]), j = (i + 1) % n, [s1, d1] = S(q[j * 2], q[j * 2 + 1]);
    if ((s0 - sv) * (s1 - sv) > 0 || s0 === s1) continue;
    const d = d0 + ((sv - s0) / (s1 - s0)) * (d1 - d0);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return lo <= hi ? [lo, hi] : null;
}

function stairAt(poly: Poly, lift: LiftShaft | null, maxH: number, way: Poly | null): StairCore | null {
  for (const c of stairSpots(poly, lift, maxH)) if (!way || !overlaps(coreRect(c, 0, 0.1), way)) return c;
  return null;
}

/** Core sizes, best first: lane width, gap, near and far landing, rise, tread, hall in front (a comfortable core, then a compact one). */
const CORE_SIZES = [[1.1, 0.12, 1.3, 1.25, RISE, TREAD, 1.2], [0.9, 0.08, 1.0, 1.0, 0.19, 0.25, 0.9]] as const;

/** Every place the stair core fits (inside the outline, room for its hall, clear of the lift), best first. */
function* stairSpots(poly: Poly, lift: LiftShaft | null, maxH: number): Generator<StairCore> {
  const F = new Frame(poly);
  // The end away from the lift (the lift sits at the -u end when there is one).
  const liftEnd = lift ? Math.sign((lift.cx - F.cx) * F.ux + (lift.cz - F.cz) * F.uz) || -1 : 0;
  const lr = lift ? liftRect(lift, LANDING + 0.6) : null;
  for (const [w, g, near, far, rise, tread, hall] of CORE_SIZES) {
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
          if (ok) yield c;
        }
      }
    }
  }
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
