/**
 * The shapes the physics world takes (src/physics/physics.ts), as plain data: made anywhere without loading Rapier
 * (the physics module is loaded only once the player first takes the wheel).
 */

/** A static box: centre, half extents and turn about the vertical (radians; local +x turns toward −z). */
export interface SolidBox { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }
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
