/**
 * Ground levels shared by the planner, the world queries and the meshes (Scale:
 * build/ground.ts CURB_H, build/terrainMesh.ts TERRAIN_DROP).
 */

/** Height of the curb: sidewalks, squares and building floors stand this much above the road. */
export const CURB_H = 0.15;

/** The terrain mesh is drawn this much below the natural ground, so paved surfaces never fight it. */
export const TERRAIN_DROP = 0.35;

/**
 * A bridge deck's span over the water as plain data (src/build/bridges.ts `deckSpans`): a straight line from
 * (ax, az) along (dx, dz), the span s0..s1 (m along it), its height rising from h0 to h1 with an `arch` in the
 * middle, and half its width with a margin `hw`.
 */
export interface DeckSpan { ax: number; az: number; dx: number; dz: number; s0: number; s1: number; h0: number; h1: number; arch: number; hw: number }

/** The deck surface of `span` at `s` m along it (s0 <= s <= s1). */
export function deckAlong(span: DeckSpan, s: number): number {
  const t = (s - span.s0) / Math.max(1e-6, span.s1 - span.s0);
  return span.h0 + (span.h1 - span.h0) * t + span.arch * Math.sin(Math.PI * t);
}

/** The deck surface at (x, z) of the first of `spans` it lies on, or null off every deck. */
export function deckHeight(spans: readonly DeckSpan[], x: number, z: number): number | null {
  for (const p of spans) {
    const s = (x - p.ax) * p.dx + (z - p.az) * p.dz;
    if (s < p.s0 || s > p.s1) continue;
    if (Math.abs((x - p.ax) * p.dz - (z - p.az) * p.dx) < p.hw) return deckAlong(p, s);
  }
  return null;
}
