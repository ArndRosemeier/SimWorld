/**
 * A building to walk around in: its interior (src/interior/building.ts) as the solid things a
 * person bumps into and stands on, in world coordinates. The outer walls with the street doors
 * cut in, the inner walls with their doorways, the furniture you would walk into, the floors with
 * the stairwells open, each flight of stairs as a ramp and its landing. The game turns these into
 * physics bodies (boxes, ramps, floor polygons); the interior meshes (src/build/interior.ts
 * `buildIndoors`) draw the same outer walls.
 *
 * New in SimWorld (Scale built one storey's walls as colliders when the player walked in,
 * src/interior/Interiors.ts). Pure: a function of the interior and where the building stands.
 */
import { polyArea, type Poly } from '../geom/geom2';
import type { WallWindows } from '../build/massing';
import type { Interior, StreetDoor } from './building';
import type { FloorPlan, FurnKind, FurnUse } from './types';
import { doorLeavesOf, type DoorLeaf } from './doors';

/** A box: centre, half sizes along its own x (across), y and z (along), turned `yaw` about y (x = sin, z = cos). */
export interface Box { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }

/** A flight of stairs as a ramp: bottom and top of its centre line, its width. */
export interface Ramp { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; width: number }

/** A floor to stand on: its level, outline and openings (the stairwell from below). */
export interface Slab { floor: number; y: number; outer: Poly; holes: Poly[] }

/**
 * An outer wall piece along the storey's outline, from a to b, between y0 and y1 (world); (nx, nz) points out of the
 * building; `windows` its openings `[s0, s1, y0, y1]` (s along it from a, world y) where the facade has its windows.
 */
export interface OuterWall { floor: number; ax: number; az: number; bx: number; bz: number; y0: number; y1: number; nx: number; nz: number; windows: [number, number, number, number][] }

/** Somewhere to put a person (src/interior/types.ts Spot: what x, z, yaw and seat mean) with its floor's world height `y`. */
export interface IndoorSpot { use: FurnUse; floor: number; x: number; y: number; z: number; yaw: number; seat: number; unit: number }

export interface Indoors {
  /** World y of the ground floor. */
  base: number;
  /** Each storey's floor level (world y) and height. */
  storeys: { y: number; height: number }[];
  /** The street doors (world, y the ground floor). */
  doors: (StreetDoor & { y: number })[];
  /** Walls and furniture. */
  colliders: Box[];
  ramps: Ramp[];
  slabs: Slab[];
  outer: OuterWall[];
  spots: IndoorSpot[];
  /** A door leaf in every doorway, room doors and street doors (src/interior/doors.ts); the walls leave the doorways open. */
  leaves: DoorLeaf[];
}

/** Thickness of the outer wall inside the facade (the 20 cm between facade and storey outline) and of inner walls. */
const OUTER_T = 0.2, INNER_T = 0.12;
/** Height of a street door's opening. */
export const STREET_DOOR_H = 2.15;
/** Pieces nobody walks into: on the floor flat, or on a wall. */
export const FLAT = new Set<FurnKind>(['rug', 'painting', 'mirror', 'screen']);

/**
 * The walk-in building for interior `I` whose ground floor stands at world y `base`; `windows` (src/build/massing.ts
 * `windowOpenings` of its building) opens its outer walls where the facade has windows. The colliders stay whole:
 * the glass is there.
 */
export function indoorsOf(I: Interior, base: number, windows: readonly WallWindows[] = []): Indoors {
  const colliders: Box[] = [], ramps: Ramp[] = [], slabs: Slab[] = [], outer: OuterWall[] = [];
  const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, t: number, out = 0) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.02 || y1 - y0 < 0.02) return;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    colliders.push({ x: (ax + bx) / 2 + dz * out, y: (y0 + y1) / 2, z: (az + bz) / 2 - dx * out, hx: t / 2, hy: (y1 - y0) / 2, hz: L / 2, yaw: Math.atan2(dx, dz) });
  };
  I.storeys.forEach((s, f) => {
    const y = base + s.y, top = y + s.height;
    // Outer walls along the storey's outline, pushed out to the facade, the street doors cut in on the ground floor.
    const P = s.poly, n = P.length >> 1;
    const sign = polyArea(P) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = P[i * 2], az = P[i * 2 + 1], bx = P[j * 2], bz = P[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.02) continue;
      const gaps: [number, number][] = [];
      if (f === 0) for (const d of I.doors) {
        const t = ((d.x - ax) * (bx - ax) + (d.z - az) * (bz - az)) / (L * L);
        const off = Math.abs(((d.x - ax) * (bz - az) - (d.z - az) * (bx - ax)) / L);
        if (t > 0 && t < 1 && off < 0.4) gaps.push([Math.max(0, t * L - d.w / 2), Math.min(L, t * L + d.w / 2)]);
      }
      gaps.sort((p, q) => p[0] - q[0]);
      const dx = (bx - ax) / L, dz = (bz - az) / L, along = (s0: number) => [ax + dx * s0, az + dz * s0];
      let s0 = 0;
      for (const [g0, g1] of [...gaps, [L, L] as [number, number]]) {
        if (g0 > s0) {
          const [x0, z0] = along(s0), [x1, z1] = along(g0);
          outer.push({ floor: f, ax: x0, az: z0, bx: x1, bz: z1, y0: y, y1: top, nx: dz * sign, nz: -dx * sign, windows: openingsOn(windows, x0, z0, x1, z1, dz * sign, -dx * sign, y, top, base) });
          wall(x0, z0, x1, z1, y, top, OUTER_T, (OUTER_T / 2) * sign);
        }
        if (g1 > g0 && g1 < L + 1e-6 && g0 < L) {
          // The lintel over a street door.
          const [x0, z0] = along(g0), [x1, z1] = along(g1);
          outer.push({ floor: f, ax: x0, az: z0, bx: x1, bz: z1, y0: y + STREET_DOOR_H, y1: top, nx: dz * sign, nz: -dx * sign, windows: [] });
          wall(x0, z0, x1, z1, y + STREET_DOOR_H, top, OUTER_T, (OUTER_T / 2) * sign);
        }
        s0 = Math.max(s0, g1);
      }
    }
    colliders.push(...innerBoxes(s, base));
    for (const fl of s.flights) ramps.push({ x0: fl.x, y0: base + fl.y0, z0: fl.z, x1: fl.x + fl.dx * fl.run, y1: base + fl.y1, z1: fl.z + fl.dz * fl.run, width: fl.width });
    const below = f > 0 ? I.storeys[f - 1].stairHole : null;
    slabs.push({ floor: f, y, outer: P, holes: below ? [below] : [] });
  });
  // The roof over the top storey.
  const last = I.storeys[I.storeys.length - 1];
  slabs.push({ floor: I.storeys.length, y: base + last.y + last.height, outer: last.poly, holes: [] });
  return {
    base,
    storeys: I.storeys.map((s) => ({ y: base + s.y, height: s.height })),
    doors: I.doors.map((d) => ({ ...d, y: base })),
    colliders, ramps, slabs, outer,
    spots: I.spots.map((p) => ({ use: p.use, floor: p.floor, x: p.x, y: base + I.storeys[p.floor].y, z: p.z, yaw: p.yaw, seat: p.seat, unit: p.unit })),
    leaves: doorLeavesOf(I, base),
  };
}

/**
 * A storey's inner solids, with its ground floor at world y `base`: the inner walls between their doorways, the
 * furniture one walks into, the stair landings. (The outer walls and the stairs are indoorsOf's.)
 */
export function innerBoxes(s: FloorPlan, base: number): Box[] {
  const out: Box[] = [], y = base + s.y, top = y + s.height;
  for (const w of s.walls) {
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (L < 0.2) continue;
    const dx = (w.bx - w.ax) / L, dz = (w.bz - w.az) / L;
    let s0 = 0;
    for (const [d0, d1] of [...w.doors.map(([a, b]) => [a * L, b * L]).sort((p, q) => p[0] - q[0]), [L, L]]) {
      if (d0 - s0 > 0.02) out.push({ x: w.ax + dx * (s0 + d0) / 2, y: (y + top) / 2, z: w.az + dz * (s0 + d0) / 2, hx: INNER_T / 2, hy: (top - y) / 2, hz: (d0 - s0) / 2, yaw: Math.atan2(dx, dz) });
      s0 = Math.max(s0, d1);
    }
  }
  for (const it of s.furniture) {
    if (FLAT.has(it.kind) || it.h < 0.05) continue;
    out.push({ x: it.x, y: y + it.h / 2, z: it.z, hx: it.w / 2, hy: it.h / 2, hz: it.d / 2, yaw: it.yaw });
  }
  for (const l of s.landings) out.push(landingBox(l, base));
  return out;
}

/** The facade's window openings that fall on the wall piece a → b (outward n, y0 to y1), in the piece's terms. */
function openingsOn(windows: readonly WallWindows[], ax: number, az: number, bx: number, bz: number, nx: number, nz: number, y0: number, y1: number, base: number): OuterWall['windows'] {
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, out: OuterWall['windows'] = [];
  for (const w of windows) {
    // The facade edge this piece lies behind: the same way out, about the outer wall's thickness outside it.
    if (w.nx * nx + w.nz * nz < 0.99) continue;
    const gap = (w.ax - ax) * nx + (w.az - az) * nz;
    if (gap < 0.05 || gap > 0.45) continue;
    const ex = w.bx - w.ax, ez = w.bz - w.az, EL = Math.hypot(ex, ez);
    for (const [u0, u1, v0, v1] of w.open) {
      const alongOf = (u: number) => (w.ax + (ex / EL) * u - ax) * dx + (w.az + (ez / EL) * u - az) * dz;
      const s0 = Math.max(0.05, Math.min(alongOf(u0), alongOf(u1))), s1 = Math.min(L - 0.05, Math.max(alongOf(u0), alongOf(u1)));
      const h0 = Math.max(y0 + 0.05, base + v0), h1 = Math.min(y1 - 0.05, base + v1);
      if (s1 - s0 > 0.3 && h1 - h0 > 0.3) out.push([s0, s1, h0, h1]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** A stair landing (a quad `poly` with its top at `y` above the ground floor) as a 22 cm thick box: its z along the first edge. */
export function landingBox(l: { poly: number[]; y: number }, base: number): Box {
  const L = l.poly;
  let cx = 0, cz = 0;
  for (let i = 0; i < 8; i += 2) { cx += L[i] / 4; cz += L[i + 1] / 4; }
  const ex = L[2] - L[0], ez = L[3] - L[1];
  return { x: cx, y: base + l.y - 0.11, z: cz, hx: Math.hypot(L[6] - L[0], L[7] - L[1]) / 2, hy: 0.11, hz: Math.hypot(ex, ez) / 2, yaw: Math.atan2(ex, ez) };
}
