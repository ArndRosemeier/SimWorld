/**
 * Ground geometry of the countryside (worker side), in the ground attribute format
 * (`groundSpecs`, `GroundLayer`) so it shares the town's ground material: the country roads
 * draped on the terrain (asphalt main roads with a dashed centre line, lighter lanes, dirt
 * tracks), the farmyards, the railway (ballast bed, sleeper bands, two tracks of raised rails),
 * the level crossings, and plain bridge decks with low parapets where a road or the railway
 * crosses a river.
 *
 * Ported from Scale (src/build/rural.ts: the road ribbons, the dashes, the yard lip). Left
 * behind: Scale's villages and their buildings, the collision boxes and the surface outlines.
 * New in SimWorld: the railway, the level crossings and the bridge decks (a much reduced
 * stand-in for Scale's src/build/bridges.ts).
 */
import { smoothstep } from '@futuremagic/core';
import type { Terrain } from '../world/terrain';
import { RoadKind, type RuralPlan, type RuralRoad } from '../world/rural';
import type { Railway } from '../plan/types';
import { RAIL_HW } from '../plan/rail';
import { TERRAIN_DROP } from '../world/ground';
import { closestOnPolyline, pointInPoly, polyBounds, resample } from '../geom/geom2';
import { MeshBuilder } from './meshBuilder';
import { drapeShape, groundSpecs, GroundLayer } from './ground';
import { terrainMeshHeight } from './terrainMesh';

/** A square of the world (corner and edge length, m). */
export interface TileBox { x0: number; z0: number; size: number }

/**
 * Height of the road surfaces (Main, Lane, Dirt) and the farmyards above the ground they stand
 * on (`standOn`). Where two of them overlap (a junction, a track running into a yard) they are
 * at least 4 cm apart: more than both their chords stray from the terrain (COURSE_TOL) plus the
 * depth precision some hundred metres off, so the upper one always wins.
 */
const DY = [0.12, 0.08, 0.04], YARD_DY = 0.16;
/** A course follows the terrain under its centreline to within COURSE_TOL (no closer than COURSE_MIN m). */
const COURSE_TOL = 0.01, COURSE_MIN = 2;
/** Length (m) over which a road leaving the town rises to its DY. */
const RAMP = 8;
/** Radius (m) within which the terrain tiles are all the finest (terrainTiles). */
const FINE_R = 1000;
const DASH_ON = 3, DASH_OFF = 6;
/** Draped edges slope this far out and this far down, under the terrain mesh (no raised slab from the side). */
const LIP_W = 0.6, LIP_DOWN = TERRAIN_DROP + 0.12;
/** A farmyard's lip reaches this far out (m) and this far down under the ground (`lip`). */
const YARD_LIP = 1.6, LIP_UNDER = TERRAIN_DROP + 0.12;
/** Railway: ballast top, sleeper band top, rail top (above the natural ground), gauge, track centres. */
const BALLAST = 0.3, SLEEPER = 0.33, RAIL_TOP = 0.5, RAIL_HALF = 0.04, GAUGE = 1.435, TRACK = 1.9;
/** Bridges: deck slab depth, parapet height and width, clearance over the water (road, rail). */
const DECK = 1.2, PARAPET = 0.9, PARAPET_W = 0.3, CLEAR_ROAD = 3.5, CLEAR_RAIL = 5;

/**
 * Every country road, farmyard, the railway, its level crossings and the bridges whose geometry
 * lies in `tile` (a segment belongs to the tile its midpoint is in, a farmyard to the tile of
 * its farm; the whole world when no tile is given). Origin: the tile centre (world 0 without a
 * tile). Null when the tile holds nothing.
 */
export function buildCountryRoads(rural: RuralPlan, rail: Railway | null, terrain: Terrain, tile?: TileBox): MeshBuilder | null {
  const mb = new MeshBuilder(groundSpecs());
  const inTile = tile ? (x: number, z: number) => x >= tile.x0 && x < tile.x0 + tile.size && z >= tile.z0 && z < tile.z0 + tile.size : () => true;
  if (tile) mb.setOrigin(tile.x0 + tile.size / 2, 0, tile.z0 + tile.size / 2);
  const ctx: Sweep = { mb, T: terrain, inTile };

  for (const R of rural.roads) {
    if (tile && !nearTile(R.pts, tile, 80)) continue;
    const { full, surface } = roadSwept(R, terrain);
    if (surface.C.n < 2) continue;
    const dy = DY[R.kind], hw = R.hw;
    sweep(ctx, surface.C, surface.prof);
    if (R.kind === RoadKind.Main) {
      // Dashed centre line, from 20 m beyond the town's ground.
      const P = DASH_ON + DASH_OFF;
      for (let d = Math.ceil((R.trim + 20) / P) * P; d + DASH_ON < full.length; d += P) {
        sweep(ctx, slice(full, d, d + DASH_ON), [-0.08, dy + 0.03, GroundLayer.PaintWhite, 0.08, dy + 0.03, GroundLayer.PaintWhite]);
      }
    }
    for (const sp of full.spans) bridge(ctx, slice(full, Math.max(sp.s0, R.trim), sp.s1), hw + LIP_W + 0.1, dy);
  }

  for (const f of rural.farms) {
    if (!inTile(f.x, f.z)) continue;
    for (const p of rural.layout(f.id).paved) {
      drapeShape(mb, { outer: p.poly, holes: [] }, terrain, YARD_DY, p.layer, standOn(terrain), 6);
      lip(mb, terrain, p.poly, YARD_DY, p.layer);
    }
  }

  if (rail && (!tile || nearTile(rail.pts, tile, 40))) railway(ctx, rail, rural);
  return mb.empty ? null : mb;
}

/** Does any point of the polyline come within `pad` of the tile? */
function nearTile(P: number[], t: TileBox, pad: number): boolean {
  const cx = t.x0 + t.size / 2, cz = t.z0 + t.size / 2, r = t.size / 2 + pad;
  for (let i = 0; i < P.length; i += 2) if (Math.abs(P[i] - cx) < r && Math.abs(P[i + 1] - cz) < r) return true;
  return false;
}

// ------------------------------------------------------------------ railway

/** A surface swept along a course: the cross section `prof` (offset, height, layer per point), level within `level` of the line. */
interface Swept { C: Course; prof: number[]; level: number }

/** A country road's surface (from where it leaves the town's ground), and its whole course. */
function roadSwept(R: RuralRoad, terrain: Terrain): { full: Course; surface: Swept } {
  const full = courseOf(terrain, R.pts, R.bridges, CLEAR_ROAD);
  full.rise = riseOf(R);
  const dy = DY[R.kind], hw = R.hw;
  const layer = R.kind === RoadKind.Main ? GroundLayer.Asphalt : R.kind === RoadKind.Lane ? GroundLayer.AsphaltLight : GroundLayer.Dirt;
  return { full, surface: { C: slice(full, R.trim, full.length), prof: [-hw - LIP_W, -LIP_DOWN, layer, -hw, dy, layer, 0, dy, layer, hw, dy, layer, hw + LIP_W, -LIP_DOWN, layer], level: -1 } };
}

/**
 * The railway's surfaces: its ballast bed, and each level crossing's slab (level with the rail heads, ramped down to
 * the road each side) with the arc length range it covers; and the whole course.
 */
function railSwept(rail: Railway, rural: RuralPlan, terrain: Terrain): { full: Course; bed: Swept; crossings: { swept: Swept; s: number; h: number; layer: number }[] } {
  const pts = resample(rail.pts, 5);
  const full = courseOf(terrain, pts, rail.bridges, CLEAR_RAIL);
  const W = RAIL_HW + 1, y = RAIL_TOP + 0.005;
  // Level crossings: arc-length ranges along the line (wider where the road crosses obliquely).
  const crossings: { swept: Swept; s: number; h: number; layer: number }[] = [];
  for (const X of rural.crossings) {
    const R = rural.roads[X.road];
    const q = closestOnPolyline(pts, X.x, X.z), i = segAt(full, q.s)[0];
    const r = closestOnPolyline(R.pts, X.x, X.z), k = r.seg * 2;
    const dx = R.pts[k + 2] - R.pts[k], dz = R.pts[k + 3] - R.pts[k + 1], l = Math.hypot(dx, dz) || 1;
    const sin = Math.abs((full.lx[i] * dx + full.lz[i] * dz) / l);
    const h = Math.min(3 * R.hw, (R.hw + 1) / Math.max(0.3, sin)), layer = R.kind === RoadKind.Track ? GroundLayer.Dirt : GroundLayer.Asphalt;
    crossings.push({ s: q.s, h, layer, swept: { C: slice(full, q.s - h, q.s + h), prof: [-W - 3, DY[0], layer, -W, y, layer, W, y, layer, W + 3, DY[0], layer], level: RAIL_HW } });
  }
  crossings.sort((a, b) => a.s - b.s);
  const bed = { C: full, prof: [-W, -LIP_DOWN, GroundLayer.Gravel, -RAIL_HW + 0.6, BALLAST, GroundLayer.Gravel, RAIL_HW - 0.6, BALLAST, GroundLayer.Gravel, W, -LIP_DOWN, GroundLayer.Gravel], level: RAIL_HW };
  return { full, bed, crossings };
}

function railway(ctx: Sweep, rail: Railway, rural: RuralPlan): void {
  const { full, bed, crossings } = railSwept(rail, rural, ctx.T);
  const W = RAIL_HW + 1;
  sweep(ctx, bed.C, bed.prof, bed.level);
  // Sleeper bands and rails run between the crossings.
  let s = 0;
  const runs: [number, number][] = [];
  for (const g of crossings) { if (g.s - g.h > s) runs.push([s, g.s - g.h]); s = Math.max(s, g.s + g.h); }
  if (s < full.length) runs.push([s, full.length]);
  for (const [a, b] of runs) {
    const C = slice(full, a, b);
    for (const t of [-TRACK, TRACK]) {
      sweep(ctx, C, [t - 1.3, SLEEPER, GroundLayer.Dirt, t + 1.3, SLEEPER, GroundLayer.Dirt], RAIL_HW);
      for (const o of [t - GAUGE / 2, t + GAUGE / 2]) {
        sweep(ctx, C, [o - RAIL_HALF, SLEEPER, GroundLayer.Curb, o - RAIL_HALF, RAIL_TOP, GroundLayer.Curb, o + RAIL_HALF, RAIL_TOP, GroundLayer.Curb, o + RAIL_HALF, SLEEPER, GroundLayer.Curb], RAIL_HW);
      }
    }
  }
  // The crossings: the slab, flush rails in it.
  for (const g of crossings) {
    const C = g.swept.C, y = RAIL_TOP + 0.005;
    sweep(ctx, C, g.swept.prof, g.swept.level);
    for (const t of [-TRACK, TRACK]) for (const o of [t - GAUGE / 2, t + GAUGE / 2]) sweep(ctx, C, [o - RAIL_HALF, y + 0.005, GroundLayer.Curb, o + RAIL_HALF, y + 0.005, GroundLayer.Curb], RAIL_HW);
  }
  for (const sp of full.spans) bridge(ctx, slice(full, sp.s0, sp.s1), W + PARAPET_W, BALLAST);
}

/** Deck slab sides and low parapets of a bridge span (the surface itself is the road's or the track bed's). */
function bridge(ctx: Sweep, C: Course, W: number, dy: number): void {
  if (C.n < 2) return;
  const top = dy + PARAPET, P = PARAPET_W, S = GroundLayer.QuayWall, K = GroundLayer.Curb;
  // Cross sections run clockwise round the solid (o to the right, y up), so every face looks out.
  sweep(ctx, C, [-W, -DECK, S, -W, top, K, -W + P, top, K, -W + P, dy, K]);
  sweep(ctx, C, [W - P, dy, K, W - P, top, K, W, top, S, W, -DECK, S, -W, -DECK, S]);
}

// ------------------------------------------------------------------ courses and sweeps

/** A bridge span on a course: the deck runs from height ya to yb, lifted by k in the middle. */
interface Span { s0: number; s1: number; ya: number; yb: number; k: number }

/** A polyline prepared for sweeping: points, unit left normals, arc length, bridge spans. */
interface Course {
  n: number;
  x: Float64Array;
  z: Float64Array;
  lx: Float64Array;
  lz: Float64Array;
  s: Float64Array;
  length: number;
  spans: Span[];
  /** Terrain height at each point (NaN until measured: centreHeight). */
  yc: Float64Array;
  /** How much of the profile's height above the ground stands at arc length s (0…1; 1 without). */
  rise?: (s: number) => number;
}

const stands = new WeakMap<Terrain, (x: number, z: number) => number>();
/**
 * The height country surfaces are draped at: the natural ground, or a little higher where the
 * coarse terrain mesh far out (`terrainMeshHeight`) would poke through it.
 */
function standOn(T: Terrain): (x: number, z: number) => number {
  let f = stands.get(T);
  // (Within FINE_R of the centre the grid is 8 m: it never comes near the surfaces there.)
  const grid = new Map<number, number>();
  if (!f) { f = (x, z) => x * x + z * z < FINE_R * FINE_R ? T.height(x, z) : Math.max(T.height(x, z), terrainMeshHeight(T, x, z, grid) + TERRAIN_DROP); stands.set(T, f); }
  return f;
}

/** Points added along a polyline where the ground under it bends (to COURSE_TOL), so its sweep follows the terrain. */
function followGround(T: Terrain, pts: number[]): number[] {
  const H = standOn(T), out: number[] = [pts[0], pts[1]];
  const halve = (ax: number, az: number, ha: number, bx: number, bz: number, hb: number, depth: number) => {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (depth < 8 && Math.hypot(bx - ax, bz - az) > COURSE_MIN) {
      const hm = H(mx, mz);
      if (Math.abs(hm - (ha + hb) / 2) > COURSE_TOL) {
        halve(ax, az, ha, mx, mz, hm, depth + 1);
        halve(mx, mz, hm, bx, bz, hb, depth + 1);
        return;
      }
    }
    out.push(bx, bz);
  };
  let hp = H(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    const h = H(pts[i], pts[i + 1]);
    halve(pts[i - 2], pts[i - 1], hp, pts[i], pts[i + 1], h, 0);
    hp = h;
  }
  return out;
}

function centreHeight(C: Course, T: Terrain, i: number): number {
  let y = C.yc[i];
  if (y !== y) y = C.yc[i] = standOn(T)(C.x[i], C.z[i]);
  return y;
}

function courseOf(T: Terrain, line: number[], bridges: readonly [number, number][], clear: number): Course {
  const pts = followGround(T, line);
  const n = pts.length >> 1;
  const C: Course = { n, x: new Float64Array(n), z: new Float64Array(n), lx: new Float64Array(n), lz: new Float64Array(n), s: new Float64Array(n), length: 0, spans: [], yc: new Float64Array(n).fill(NaN) };
  for (let i = 0; i < n; i++) {
    C.x[i] = pts[i * 2]; C.z[i] = pts[i * 2 + 1];
    if (i) C.s[i] = C.s[i - 1] + Math.hypot(C.x[i] - C.x[i - 1], C.z[i] - C.z[i - 1]);
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
    C.lx[i] = -dz / l; C.lz[i] = dx / l;
  }
  C.length = n ? C.s[n - 1] : 0;
  for (const [a, b] of bridges) {
    const s0 = Math.max(0, a), s1 = Math.min(C.length, b);
    if (s1 - s0 < 2) continue;
    const ya = standOn(T)(...pointAt(C, s0)), yb = standOn(T)(...pointAt(C, s1));
    const [mx, mz] = pointAt(C, (s0 + s1) / 2);
    let wl = T.waterLevel(mx, mz);
    if (wl === -Infinity) wl = T.water(mx, mz).level;
    C.spans.push({ s0, s1, ya, yb, k: Math.max(0, wl + clear - (ya + yb) / 2) });
  }
  return C;
}

/** Index of the segment holding arc length s, and the fraction along it. */
function segAt(C: Course, s: number): [number, number] {
  let lo = 0, hi = C.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C.s[m] <= s) lo = m; else hi = m; }
  const L = C.s[hi] - C.s[lo];
  return [lo, L > 0 ? Math.min(1, Math.max(0, (s - C.s[lo]) / L)) : 0];
}

function pointAt(C: Course, s: number): [number, number] {
  const [i, t] = segAt(C, s);
  const j = Math.min(C.n - 1, i + 1);
  return [C.x[i] + (C.x[j] - C.x[i]) * t, C.z[i] + (C.z[j] - C.z[i]) * t];
}

/** Deck height at arc length s (NaN off the bridges): never below the ground under it. */
function deckAt(C: Course, T: Terrain, s: number, x: number, z: number): number {
  for (const b of C.spans) {
    if (s < b.s0 || s > b.s1) continue;
    const t = (s - b.s0) / (b.s1 - b.s0);
    return Math.max(standOn(T)(x, z), b.ya + (b.yb - b.ya) * t + b.k * Math.min(1, 2.5 * Math.sin(Math.PI * t)));
  }
  return NaN;
}

/**
 * Height of the rail heads at arc length s along the railway (along `rail.pts`), bridge decks
 * included: where the trains run (src/traffic/trains.ts). `RAIL_TRACK`: each track's centre
 * from the line's.
 */
export function railSurface(rail: Railway, terrain: Terrain): (s: number) => number {
  const C = courseOf(terrain, resample(rail.pts, 5), rail.bridges, CLEAR_RAIL);
  return (s) => {
    const [x, z] = pointAt(C, s);
    const deck = deckAt(C, terrain, s, x, z);
    return (deck === deck ? deck : standOn(terrain)(x, z)) + RAIL_TOP;
  };
}
export const RAIL_TRACK = TRACK;

/** A road leaving the town rises from the town's carriageway to its own height over its first RAMP m. */
function riseOf(R: RuralRoad): ((s: number) => number) | undefined {
  return R.trim > 0 ? (s) => smoothstep(R.trim, R.trim + RAMP, s) : undefined;
}

/** The part of a course between arc lengths a and b (end points interpolated). */
function slice(C: Course, a: number, b: number): Course {
  a = Math.max(0, a); b = Math.min(C.length, b);
  const out: Course = { n: 0, x: new Float64Array(0), z: new Float64Array(0), lx: new Float64Array(0), lz: new Float64Array(0), s: new Float64Array(0), length: Math.max(0, b - a), spans: C.spans, yc: new Float64Array(0), rise: C.rise };
  if (C.n < 2 || b - a < 0.05) return out;
  const [i0, t0] = segAt(C, a), [i1, t1] = segAt(C, b);
  const X: number[] = [], Z: number[] = [], LX: number[] = [], LZ: number[] = [], S: number[] = [];
  const pushAt = (i: number, t: number) => {
    const j = Math.min(C.n - 1, i + 1);
    const lx = C.lx[i] + (C.lx[j] - C.lx[i]) * t, lz = C.lz[i] + (C.lz[j] - C.lz[i]) * t, l = Math.hypot(lx, lz) || 1;
    X.push(C.x[i] + (C.x[j] - C.x[i]) * t); Z.push(C.z[i] + (C.z[j] - C.z[i]) * t);
    LX.push(lx / l); LZ.push(lz / l); S.push(C.s[i] + (C.s[j] - C.s[i]) * t);
  };
  pushAt(i0, t0);
  for (let i = i0 + 1; i <= i1; i++) if (C.s[i] > S[S.length - 1] + 0.01 && C.s[i] < b - 0.01) pushAt(i, 0);
  pushAt(i1, t1);
  out.n = X.length;
  out.x = Float64Array.from(X); out.z = Float64Array.from(Z); out.lx = Float64Array.from(LX); out.lz = Float64Array.from(LZ); out.s = Float64Array.from(S);
  out.yc = new Float64Array(out.n).fill(NaN);
  return out;
}

interface Sweep { mb: MeshBuilder; T: Terrain; inTile: (x: number, z: number) => boolean }

/**
 * Sweep a cross section along a course. `prof` holds (offset to the left, height above the
 * ground or the deck, layer) per point; each section segment is its own flat-shaded strip whose
 * face looks to the left of the segment's direction in the (offset, height) plane. Off the
 * bridges every vertex sits on the terrain under it, except those within `level` of the
 * centreline, which sit level with the ground at the centreline (a track bed does not tilt
 * with the cross slope); on a deck the whole section is level.
 * Segments whose midpoint lies outside the tile are skipped.
 */
function sweep(ctx: Sweep, C: Course, prof: number[], level = -1): void {
  const { mb, T } = ctx;
  const segs = prof.length / 3 - 1;
  if (C.n < 2 || segs < 1) return;
  const no: number[] = [], ny: number[] = [], ys: number[] = [];
  for (let k = 0; k < segs; k++) {
    const dO = prof[k * 3 + 3] - prof[k * 3], dY = prof[k * 3 + 4] - prof[k * 3 + 1], l = Math.hypot(dO, dY) || 1;
    no.push(-dY / l); ny.push(dO / l);
  }
  const row = (i: number): number => {
    const base = mb.vcount;
    const cx = C.x[i], cz = C.z[i], lx = C.lx[i], lz = C.lz[i];
    rowHeights(C, T, i, prof, level, ys);
    for (let k = 0; k < segs; k++) {
      mb.set('aLayer', prof[k * 3 + 2]);
      const wall = Math.abs(ny[k]) < 0.5;
      for (let e = k; e <= k + 1; e++) {
        const o = prof[e * 3], x = cx + lx * o, z = cz + lz * o, y = ys[e];
        mb.v(x, y, z, lx * no[k], ny[k], lz * no[k], wall ? C.s[i] : x, wall ? y : z);
      }
    }
    return base;
  };
  let prev = -1;
  for (let i = 0; i + 1 < C.n; i++) {
    if (!ctx.inTile((C.x[i] + C.x[i + 1]) / 2, (C.z[i] + C.z[i + 1]) / 2)) { prev = -1; continue; }
    const a = prev >= 0 ? prev : row(i), b = row(i + 1);
    for (let k = 0; k < segs; k++) {
      const ak = a + k * 2, bk = b + k * 2;
      mb.tri(ak, ak + 1, bk);
      mb.tri(ak + 1, bk + 1, bk);
    }
    prev = b;
  }
}

/** The heights of a cross section's points at row i of a course (into ys): what `sweep` draws, and `sweptGround` reads. */
function rowHeights(C: Course, T: Terrain, i: number, prof: readonly number[], level: number, ys: number[] | Float64Array, at = 0): void {
  const cx = C.x[i], cz = C.z[i], lx = C.lx[i], lz = C.lz[i];
  const deck = deckAt(C, T, C.s[i], cx, cz);
  const yc = deck === deck ? deck : level >= 0 ? centreHeight(C, T, i) : 0;
  const k = C.rise ? C.rise(C.s[i]) : 1;
  for (let e = 0; e < prof.length / 3; e++) {
    const o = prof[e * 3], dy = prof[e * 3 + 1];
    ys[at + e] = (deck === deck || Math.abs(o) <= level ? yc : standOn(T)(cx + lx * o, cz + lz * o)) + (dy > 0 ? dy * k : dy);
  }
}

/**
 * Read a swept surface's height (as `sweep` draws it): `(i, x, z)` gives the height at (x, z) on the strip between
 * rows i and i + 1, NaN off it. The strip is the quad between the two rows' cross sections (each across by its own
 * normal: a bend's strip is a trapezoid), so the point is found in it by its fraction t along and offset o across
 * (a few rounds of solving one for the other). The rows' heights are measured when first needed.
 */
function sweptGround(sw: Swept, T: Terrain): (i: number, x: number, z: number) => number {
  const { C, prof, level } = sw, np = prof.length / 3;
  const ys = new Float64Array(C.n * np).fill(NaN), o0 = prof[0], o1 = prof[prof.length - 3];
  const row = (r: number, o: number): number => {
    if (ys[r * np] !== ys[r * np]) rowHeights(C, T, r, prof, level, ys, r * np);
    let e = 0;
    while (e < np - 2 && prof[(e + 1) * 3] < o) e++;
    const a = prof[e * 3], b = prof[(e + 1) * 3], f = b > a ? Math.max(0, Math.min(1, (o - a) / (b - a))) : 0;
    return ys[r * np + e] + (ys[r * np + e + 1] - ys[r * np + e]) * f;
  };
  return (i, x, z) => {
    const j = Math.min(C.n - 1, i + 1);
    const ax = C.x[i], az = C.z[i], bx = C.x[j], bz = C.z[j], alx = C.lx[i], alz = C.lz[i], blx = C.lx[j], blz = C.lz[j];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0, o = 0;
    for (let k = 0; k < 4; k++) {
      // Across, at t: from the centre there along the normal there.
      const cx = ax + dx * t, cz = az + dz * t, lx = alx + (blx - alx) * t, lz = alz + (blz - alz) * t;
      o = ((x - cx) * lx + (z - cz) * lz) / (lx * lx + lz * lz || 1);
      // Along, at o: between the two rows' points at offset o.
      const px = ax + alx * o, pz = az + alz * o, qx = bx + blx * o - px, qz = bz + blz * o - pz, q2 = qx * qx + qz * qz;
      t = q2 > 0 ? ((x - px) * qx + (z - pz) * qz) / q2 : 0;
    }
    if (t < -1e-4 || t > 1 + 1e-4 || o < o0 - 1e-4 || o > o1 + 1e-4) return NaN;
    t = Math.max(0, Math.min(1, t));
    return row(i, o) * (1 - t) + row(j, o) * t;
  };
}

/** One segment of a swept surface, for finding the surfaces under a point. */
interface SweptSeg { at: (i: number, x: number, z: number) => number; i: number; sx: number; sz: number; ux: number; uz: number; l2: number; pad: number }

/**
 * The drawn countryside under points: the country roads (with their lips), the railway's bed and its level crossings,
 * the farmyards. `at(x, z)` is the height of the highest of them there (the one that shows), NaN off all of them;
 * a road in the town (up to its `trim`) is the town's to draw. What wheels and feet stand on out of town
 * (src/build/drawnGround.ts).
 */
export function countryGround(rural: RuralPlan, rail: Railway | null, terrain: Terrain): (x: number, z: number) => number {
  const swepts: Swept[] = rural.roads.map((R) => roadSwept(R, terrain).surface);
  if (rail) {
    const r = railSwept(rail, rural, terrain);
    swepts.push(r.bed, ...r.crossings.map((c) => c.swept));
  }
  const G = 16, grid = new Map<number, SweptSeg[]>();
  for (const sw of swepts) {
    const at = sweptGround(sw, terrain), C = sw.C, pad = Math.max(Math.abs(sw.prof[0]), Math.abs(sw.prof[sw.prof.length - 3])) + 0.5;
    for (let i = 0; i + 1 < C.n; i++) {
      const x0 = Math.min(C.x[i], C.x[i + 1]) - pad, x1 = Math.max(C.x[i], C.x[i + 1]) + pad;
      const z0 = Math.min(C.z[i], C.z[i + 1]) - pad, z1 = Math.max(C.z[i], C.z[i + 1]) + pad;
      for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
        const k = gx * 65536 + gz;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push({ at, i, sx: C.x[i], sz: C.z[i], ux: C.x[i + 1] - C.x[i], uz: C.z[i + 1] - C.z[i], l2: (C.x[i + 1] - C.x[i]) ** 2 + (C.z[i + 1] - C.z[i]) ** 2, pad });
      }
    }
  }
  // The farmyards with their lips (`lip`: from the yard's edge down under the terrain mesh LIP_OUT m out), by bounds.
  const yards = rural.farms.flatMap((f) => rural.layout(f.id).paved.map((p) => {
    const b = polyBounds(p.poly);
    return { poly: p.poly, ring: [...p.poly, p.poly[0], p.poly[1]], box: [b[0] - YARD_LIP, b[1] - YARD_LIP, b[2] + YARD_LIP, b[3] + YARD_LIP] };
  }));
  const H = standOn(terrain);
  return (x, z) => {
    let y = NaN;
    for (const g of grid.get(Math.floor(x / G) * 65536 + Math.floor(z / G)) ?? []) {
      // (Nowhere near the segment: not on its strip.)
      const t = g.l2 > 0 ? Math.max(0, Math.min(1, ((x - g.sx) * g.ux + (z - g.sz) * g.uz) / g.l2)) : 0;
      const ex = x - g.sx - g.ux * t, ez = z - g.sz - g.uz * t;
      if (ex * ex + ez * ez > g.pad * g.pad) continue;
      const h = g.at(g.i, x, z);
      if (h === h && !(h <= y)) y = h;
    }
    for (const { poly, ring, box } of yards) {
      if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) continue;
      const f = pointInPoly(poly, x, z) ? 0 : closestOnPolyline(ring, x, z).d / YARD_LIP;
      if (f > 1) continue;
      const h = H(x, z) + YARD_DY + (-LIP_UNDER - YARD_DY) * f;
      if (!(h <= y)) y = h;
    }
    return y;
  };
}

/**
 * A lip round a draped area (counter-clockwise outline): slopes from its surface down under the
 * terrain mesh a little way out, so the edge does not show as a raised slab from the side.
 * (Scale's `skirt` in src/build/rural.ts.)
 */
function lip(mb: MeshBuilder, T: Terrain, poly: number[], dy: number, layer: number): void {
  const W = YARD_LIP, DOWN = LIP_UNDER;
  const n = poly.length >> 1;
  mb.set('aLayer', layer);
  // Outward normals at the corners (averaged with the neighbouring edges: no gaps at the corners).
  const nrm = (k: number): [number, number] => {
    const p = (k + n - 1) % n, q = (k + 1) % n;
    let ux = poly[k * 2] - poly[p * 2], uz = poly[k * 2 + 1] - poly[p * 2 + 1], vx = poly[q * 2] - poly[k * 2], vz = poly[q * 2 + 1] - poly[k * 2 + 1];
    const lu = Math.hypot(ux, uz) || 1, lv = Math.hypot(vx, vz) || 1;
    ux /= lu; uz /= lu; vx /= lv; vz /= lv;
    const ox = uz + vz, oz = -ux - vx, l = Math.hypot(ox, oz) || 1;
    return [ox / l, oz / l];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
    const [anx, anz] = nrm(i), [bnx, bnz] = nrm(j);
    const base = mb.vcount;
    const pts = [[ax, az, dy], [bx, bz, dy], [bx + bnx * W, bz + bnz * W, -DOWN], [ax + anx * W, az + anz * W, -DOWN]];
    for (const [x, z, d] of pts) mb.v(x, standOn(T)(x, z) + d, z, 0, 1, 0, x, z);
    // Faces up: clockwise in x/z as in drapeShape (the outline runs counter-clockwise, the lip outside it).
    mb.tri(base, base + 1, base + 2);
    mb.tri(base, base + 2, base + 3);
  }
}
