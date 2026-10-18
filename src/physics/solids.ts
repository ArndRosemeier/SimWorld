/**
 * The shapes the physics world takes (src/physics/physics.ts), as plain data: made anywhere without loading Rapier
 * (the physics module is loaded only once the player first takes the wheel).
 */
import type { HeightGrid } from '../workers/simProtocol';
import { CURB_H, deckAlong, deckHeight } from '../world/ground';

/**
 * Where a body stands at (x, z), exactly as the physics world has it: on a bridge deck, its surface plus the curb;
 * else the ground grid, its cells cut into two triangles along the diagonal from (i+1, j) to (i, j+1) as Rapier's
 * heightfield does (a smooth blend of the four corners is up to metres off it where the ground steps: a body put
 * there starts under it). Outside the grid: its nearest edge.
 */
export function heightOnGrid(g: HeightGrid, x: number, z: number): number {
  const deck = g.decks ? deckHeight(g.decks, x, z) : null;
  if (deck !== null) return deck + CURB_H;
  const fx = Math.min(g.n - 1.000001, Math.max(0, (x - g.x0) / g.step)), fz = Math.min(g.n - 1.000001, Math.max(0, (z - g.z0) / g.step));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = g.h, n = g.n;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

/** Thickness of a deck's slab in the physics world, the length of its pieces, and the height of its parapets (m). */
const DECK_T = 0.4, DECK_PIECE = 2, PARAPET_H = 1.1;

/**
 * The bridge decks of `g` as boxes: the deck in pieces of about DECK_PIECE m whose tops follow its surface (plus the
 * curb), with a parapet along each side so nobody walks off into the water.
 */
export function deckBoxes(g: HeightGrid): SolidBox[] {
  const out: SolidBox[] = [];
  for (const p of g.decks ?? []) {
    const n = Math.max(1, Math.ceil((p.s1 - p.s0) / DECK_PIECE)), len = (p.s1 - p.s0) / n, yaw = Math.atan2(p.dx, p.dz);
    for (let k = 0; k < n; k++) {
      const sa = p.s0 + k * len, sb = sa + len, ya = deckAlong(p, sa) + CURB_H, yb = deckAlong(p, sb) + CURB_H;
      const pitch = Math.atan2(yb - ya, len), c = Math.cos(pitch), sm = (sa + sb) / 2, ym = (ya + yb) / 2;
      const hz = (len / c) / 2 + 0.05;
      // The slab: its top through the middle of the piece.
      const mx = p.ax + p.dx * sm, mz = p.az + p.dz * sm;
      out.push({ x: mx, y: ym - (c * DECK_T) / 2, z: mz, hx: p.hw, hy: DECK_T / 2, hz, yaw, pitch });
      // The parapets, standing on its edges.
      for (const side of [-1, 1]) {
        const ox = p.dz * side * (p.hw + 0.15), oz = -p.dx * side * (p.hw + 0.15);
        out.push({ x: mx + ox, y: ym + PARAPET_H / 2, z: mz + oz, hx: 0.15, hy: PARAPET_H / 2 + DECK_T / 2, hz, yaw, pitch });
      }
    }
  }
  return out;
}

/** Is (x, z) on the grid, at least `margin` metres inside its edge (beyond it there is no ground to stand on)? */
export function onGrid(g: HeightGrid, x: number, z: number, margin = 0): boolean {
  const size = (g.n - 1) * g.step;
  return x >= g.x0 + margin && x <= g.x0 + size - margin && z >= g.z0 + margin && z <= g.z0 + size - margin;
}

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
