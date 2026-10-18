/**
 * The shapes the physics world takes (src/physics/physics.ts), as plain data: made anywhere without loading Rapier
 * (the physics module is loaded only once the player first takes the wheel).
 */

/**
 * A static box: centre, half extents and turn about the vertical (radians; local +z turns toward +x, as three's
 * rotation.y), then tilted by `pitch` about its own x (positive lifts its +z end: a ramp).
 */
export interface SolidBox { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number; pitch?: number }
/** A floor to stand on: its level and outline (x, z pairs), with openings (a stairwell). */
export interface SolidFloor { y: number; outer: readonly number[]; holes: readonly (readonly number[])[] }
/** A static upright cylinder: base centre, radius, height. */
export interface SolidPost { x: number; y: number; z: number; r: number; h: number }

/** Wall thickness of an outline's walls (m), centred on the outline. */
const WALL = 0.4;

/** An outline (x, z pairs) as walls: a thin box along each edge, from `y0` up to `y1` (a building as the body meets it). */
export function wallBoxes(poly: readonly number[], y0: number, y1: number): SolidBox[] {
  const out: SolidBox[] = [], n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[((i + 1) % n) * 2], bz = poly[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    out.push({ x: (ax + bx) / 2, y: (y0 + y1) / 2, z: (az + bz) / 2, hx: len / 2 + WALL / 2, hy: (y1 - y0) / 2, hz: WALL / 2, yaw: Math.atan2(-(bz - az), bx - ax) });
  }
  return out;
}

/** Thickness of a ramp's board (m). */
const RAMP_T = 0.16;

/** A flight of stairs as a tilted board whose top runs from (x0, y0, z0) to (x1, y1, z1). */
export function rampBox(r: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; width: number }): SolidBox {
  const dx = r.x1 - r.x0, dy = r.y1 - r.y0, dz = r.z1 - r.z0, run = Math.hypot(dx, dz), len = Math.hypot(run, dy);
  const pitch = Math.atan2(dy, run), c = Math.cos(pitch);
  // The board's centre lies half its thickness under the middle of its top.
  return { x: (r.x0 + r.x1) / 2 + (dx / Math.max(run, 1e-6)) * Math.sin(pitch) * RAMP_T / 2, y: (r.y0 + r.y1) / 2 - c * RAMP_T / 2, z: (r.z0 + r.z1) / 2 + (dz / Math.max(run, 1e-6)) * Math.sin(pitch) * RAMP_T / 2, hx: r.width / 2, hy: RAMP_T / 2, hz: len / 2, yaw: Math.atan2(dx, dz), pitch };
}

/** A box's edges as pairs of corner numbers (bit 0: +x, bit 1: +y, bit 2: +z). */
export const EDGES: readonly (readonly [number, number])[] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
