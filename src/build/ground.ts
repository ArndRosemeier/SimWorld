/**
 * Urban ground surfaces of a cell: carriageway, sidewalks with curbs, plazas,
 * yards and parks, quay promenades, road markings. Surfaces are triangulated
 * (earcut), tessellated so they follow the terrain, and draped on it.
 *
 * Ported from Scale (src/build/ground.ts); CURB_H now lives in src/world/ground.ts.
 * Every ground mesh (the town's, the country roads', the railway's, the water's) uses
 * `groundSpecs()` and the `GroundLayer` numbers, so they share the ground material.
 */
import earcut from 'earcut';
import { difference, shapesToPolys, type Shape } from '../geom/clip';
import type { Terrain } from '../world/terrain';
import type { CellPlan } from '../plan/cell';
import { RoadClass } from '../plan/types';
import { CURB_H } from '../world/ground';
import { MeshBuilder, type AttrSpec } from './meshBuilder';
import { resample, polylineLength } from '../geom/geom2';
import { crossingsOf, markedEnds } from '../plan/crossings';

export const enum GroundLayer {
  Asphalt = 0,
  Paving = 1,
  Curb = 2,
  Grass = 3,
  PlazaStone = 4,
  Cobble = 5,
  Gravel = 6,
  Promenade = 7,
  AsphaltLight = 8,
  PaintWhite = 9,
  PaintYellow = 10,
  Dirt = 11,
  QuayWall = 12,
}
export const GROUND_LAYER_COUNT = 13;

const MAX_EDGE = 5;
/** Draped ground follows the terrain to within DRAPE_TOL, never splitting edges below DRAPE_MIN. */
const DRAPE_MIN = 1.2, DRAPE_TOL = 0.02;

/** The ground attributes: uv = world x/z (m), aLayer = a GroundLayer. */
export function groundSpecs(): AttrSpec[] {
  return [
    { name: 'uv', size: 2 },
    { name: 'aLayer', size: 1 },
  ];
}

/** Triangulate a shape with holes, tessellate, drape at terrain height + dy. */
export function drapeShape(mb: MeshBuilder, sh: Shape, terrain: Terrain, dy: number, layer: number, heightFn?: (x: number, z: number) => number, maxEdge = MAX_EDGE): void {
  const flat: number[] = [];
  const holes: number[] = [];
  for (let i = 0; i < sh.outer.length; i++) flat.push(sh.outer[i]);
  for (const h of sh.holes) {
    holes.push(flat.length / 2);
    for (let i = 0; i < h.length; i++) flat.push(h[i]);
  }
  const tris = earcut(flat, holes.length ? holes : undefined, 2);
  if (!tris.length) return;
  // Tessellate: split edges longer than MAX_EDGE with a shared midpoint cache.
  const pts: number[] = flat.slice();
  // Edge key → midpoint vertex; edge key → terrain height at the midpoint (each edge is tested
  // from both of its triangles, and a split midpoint becomes a vertex: measure it once).
  const cache = new Map<number, number>();
  const midH = new Map<number, number>();
  const edge = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
  // Adaptive: an edge is split only where the terrain bends under it (or when very long),
  // decided per edge so neighbouring triangles agree (no cracks).
  const hFn = heightFn ?? ((x: number, z: number) => terrain.height(x, z));
  const hs: number[] = [];
  const hAt = (i: number) => {
    let h = hs[i];
    if (h === undefined) { h = hFn(pts[i * 2], pts[i * 2 + 1]); hs[i] = h; }
    return h;
  };
  const mid = (a: number, b: number): number => {
    const k = edge(a, b);
    let m = cache.get(k);
    if (m === undefined) {
      m = pts.length / 2;
      pts.push((pts[a * 2] + pts[b * 2]) / 2, (pts[a * 2 + 1] + pts[b * 2 + 1]) / 2);
      cache.set(k, m);
      const h = midH.get(k);
      if (h !== undefined) hs[m] = h;
    }
    return m;
  };
  const hardMax = maxEdge * 5;
  const needs = (a: number, b: number, L: number): boolean => {
    if (L <= DRAPE_MIN) return false;
    if (L > hardMax) return true;
    const k = edge(a, b);
    let h = midH.get(k);
    if (h === undefined) {
      h = hFn((pts[a * 2] + pts[b * 2]) / 2, (pts[a * 2 + 1] + pts[b * 2 + 1]) / 2);
      midH.set(k, h);
    }
    return Math.abs(h - (hAt(a) + hAt(b)) / 2) > DRAPE_TOL;
  };
  const out: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < tris.length; i += 3) stack.push(tris[i], tris[i + 1], tris[i + 2]);
  let guard = 0;
  while (stack.length && guard++ < 400000) {
    const c = stack.pop()!, b = stack.pop()!, a = stack.pop()!;
    const lab = Math.hypot(pts[a * 2] - pts[b * 2], pts[a * 2 + 1] - pts[b * 2 + 1]);
    const lbc = Math.hypot(pts[b * 2] - pts[c * 2], pts[b * 2 + 1] - pts[c * 2 + 1]);
    const lca = Math.hypot(pts[c * 2] - pts[a * 2], pts[c * 2 + 1] - pts[a * 2 + 1]);
    // Degenerate (collinear) triangles cover nothing; splitting them only makes more of them -
    // endlessly, as they keep producing coincident midpoints (it ran into the guard with
    // hundreds of thousands of useless vertices per shape).
    const cr = (pts[b * 2] - pts[a * 2]) * (pts[c * 2 + 1] - pts[a * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[c * 2] - pts[a * 2]);
    if (Math.abs(cr) < 1e-4 * Math.max(lab, lbc, lca) ** 2) continue;
    const nab = needs(a, b, lab) ? lab : -1, nbc = needs(b, c, lbc) ? lbc : -1, nca = needs(c, a, lca) ? lca : -1;
    const m = Math.max(nab, nbc, nca);
    if (m < 0) { out.push(a, b, c); continue; }
    if (m === nab) { const d = mid(a, b); stack.push(a, d, c, d, b, c); }
    else if (m === nbc) { const d = mid(b, c); stack.push(a, b, d, a, d, c); }
    else { const d = mid(c, a); stack.push(a, b, d, d, b, c); }
  }
  mb.set('aLayer', layer);
  const base = mb.vcount;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    mb.v(x, hAt(i) + dy, z, 0, 1, 0, x, z);
  }
  // Orient every triangle to face +y (clockwise in the x/z plane).
  for (let i = 0; i < out.length; i += 3) {
    const a = out[i], b = out[i + 1], c = out[i + 2];
    const cr = (pts[b * 2] - pts[a * 2]) * (pts[c * 2 + 1] - pts[a * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[c * 2] - pts[a * 2]);
    if (cr > 0) mb.tri(base + a, base + c, base + b);
    else mb.tri(base + a, base + b, base + c);
  }
}

/** Vertical skirt along a ring (curbs, quay walls). Faces outward of a CCW ring when outward=true. */
export function ringWall(mb: MeshBuilder, ring: number[], terrain: Terrain, yTop: number, yBottom: number, layer: number, outward: boolean, step = MAX_EDGE): void {
  mb.set('aLayer', layer);
  const n = ring.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const segs = Math.max(1, Math.ceil(L / step));
    let nx = (bz - az) / L, nz = -(bx - ax) / L; // right normal (outward for CCW)
    if (!outward) { nx = -nx; nz = -nz; }
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const h0 = terrain.height(x0, z0), h1 = terrain.height(x1, z1);
      const u0 = (L * t0), u1 = (L * t1);
      const i0 = mb.v(x0, h0 + yBottom, z0, nx, 0, nz, u0, h0 + yBottom);
      mb.v(x1, h1 + yBottom, z1, nx, 0, nz, u1, h1 + yBottom);
      mb.v(x1, h1 + yTop, z1, nx, 0, nz, u1, h1 + yTop);
      mb.v(x0, h0 + yTop, z0, nx, 0, nz, u0, h0 + yTop);
      if (outward) mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      else mb.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    }
  }
}

/** One kind of draped surface of a cell: its shapes, height above the ground, layer. */
export interface GroundSurface { shapes: Shape[]; dy: number; layer: GroundLayer }

/**
 * The draped surfaces of a cell. They never overlap: two drapes a centimetre apart cross
 * wherever their triangles follow the terrain differently (DRAPE_TOL), and fight in the depth
 * buffer further off, so a block's ground has holes where anything else lies on it.
 */
export function groundSurfaces(plan: CellPlan): GroundSurface[] {
  const oldTown = plan.district === 'oldtown';
  // Blocks: lots and yards. Lot surfaces of dense districts are paved, gardens are grass.
  const dense = plan.district === 'downtown' || plan.district === 'commercial' || plan.district === 'oldtown';
  const industrial = plan.district === 'industrial' || plan.district === 'port';
  // Highest first: each lies where none above it does.
  const S: GroundSurface[] = [
    { shapes: plan.cemPaths, dy: CURB_H + 0.01, layer: GroundLayer.Gravel },
    { shapes: plan.yards, dy: CURB_H + 0.01, layer: industrial ? GroundLayer.Gravel : GroundLayer.Grass },
    { shapes: plan.sidewalks, dy: CURB_H, layer: oldTown ? GroundLayer.PlazaStone : GroundLayer.Paving },
    { shapes: plan.promenade, dy: CURB_H, layer: GroundLayer.Promenade },
    { shapes: plan.plazas, dy: CURB_H, layer: GroundLayer.PlazaStone },
    { shapes: plan.paved, dy: CURB_H, layer: GroundLayer.AsphaltLight },
    { shapes: plan.parks, dy: CURB_H, layer: GroundLayer.Grass },
    { shapes: plan.cemeteries, dy: CURB_H, layer: GroundLayer.Grass },
    { shapes: plan.blocks, dy: CURB_H - 0.01, layer: industrial ? GroundLayer.AsphaltLight : dense ? GroundLayer.Paving : GroundLayer.Grass },
  ];
  const above: Shape[] = [];
  for (const g of S) {
    const own = g.shapes;
    g.shapes = uncovered(own, above);
    above.push(...own);
  }
  return [{ shapes: plan.carriageway, dy: 0, layer: oldTown ? GroundLayer.Cobble : GroundLayer.Asphalt }, ...S];
}

export function buildGround(plan: CellPlan, terrain: Terrain, origin: [number, number, number]): MeshBuilder {
  const mb = new MeshBuilder(groundSpecs());
  mb.setOrigin(...origin);
  for (const g of groundSurfaces(plan)) for (const s of g.shapes) drapeShape(mb, s, terrain, g.dy, g.layer);
  // Curbs: carriageway outline walls facing the road.
  for (const s of plan.carriageway) {
    ringWall(mb, s.outer, terrain, CURB_H, -0.05, GroundLayer.Curb, false);
    for (const h of s.holes) ringWall(mb, h, terrain, CURB_H, -0.05, GroundLayer.Curb, false);
  }
  // Quay walls along the water side of promenades.
  for (const s of plan.promenade) {
    const n = s.outer.length >> 1;
    // Only edges actually at the water get a deep wall.
    const ring = s.outer;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (ring[i * 2] + ring[j * 2]) / 2, mz = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2;
      const wl = terrain.waterLevel(mx + (ring[j * 2 + 1] - ring[i * 2 + 1]) * 0.2, mz - (ring[j * 2] - ring[i * 2]) * 0.2);
      if (wl === -Infinity) continue;
      ringWall(mb, [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]], terrain, CURB_H, -6, GroundLayer.QuayWall, true);
    }
  }
  buildMarkings(mb, plan, terrain);
  return mb;
}

/** The parts of `shapes` that none of `over` covers. */
function uncovered(shapes: Shape[], over: Shape[]): Shape[] {
  return shapes.length && over.length ? difference(shapesToPolys(shapes), shapesToPolys(over)) : shapes;
}

/** Lane markings, crosswalks and stop lines as thin draped quads. */
function buildMarkings(mb: MeshBuilder, plan: CellPlan, terrain: Terrain): void {
  // Above the carriageway by more than its drape tolerance (DRAPE_TOL) plus depth precision far off.
  const lift = 0.04;
  const strip = (pts: number[], off: number, halfW: number, dash: number, gap: number, layer: number, trim0: number, trim1: number) => {
    const L = polylineLength(pts);
    if (L < trim0 + trim1 + 1) return;
    const rs = resample(pts, 1);
    const n = rs.length >> 1;
    const step = L / (n - 1);
    mb.set('aLayer', layer);
    let s = 0;
    for (let i = 0; i < n - 1; i++, s += step) {
      if (s < trim0 || s > L - trim1) continue;
      if (dash > 0 && (s % (dash + gap)) > dash) continue;
      const x0 = rs[i * 2], z0 = rs[i * 2 + 1], x1 = rs[i * 2 + 2], z1 = rs[i * 2 + 3];
      const dx = x1 - x0, dz = z1 - z0;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const ax = x0 + nx * off, az = z0 + nz * off, bx = x1 + nx * off, bz = z1 + nz * off;
      const p = [
        ax - nx * halfW, az - nz * halfW, ax + nx * halfW, az + nz * halfW,
        bx + nx * halfW, bz + nz * halfW, bx - nx * halfW, bz - nz * halfW,
      ];
      const base = mb.vcount;
      for (let k = 0; k < 4; k++) mb.v(p[k * 2], terrain.height(p[k * 2], p[k * 2 + 1]) + lift, p[k * 2 + 1], 0, 1, 0, p[k * 2], p[k * 2 + 1]);
      upQuad(mb, base, p);
    }
  };
  for (const st of plan.streets) {
    const ends = markedEnds(plan, st);
    if (!ends) continue;
    const [j0, j1] = ends;
    const trim0 = j0 ? st.width * 0.75 + 2.5 : 1, trim1 = j1 ? st.width * 0.75 + 2.5 : 1;
    if (st.cls <= RoadClass.Avenue) {
      // Double yellow centre (or median edge), dashed lane dividers, edge lines.
      if (st.cls === RoadClass.Boulevard) {
        strip(st.pts, 1.0, 0.08, 0, 0, GroundLayer.PaintYellow, trim0, trim1);
        strip(st.pts, -1.0, 0.08, 0, 0, GroundLayer.PaintYellow, trim0, trim1);
      } else {
        strip(st.pts, 0.12, 0.06, 0, 0, GroundLayer.PaintYellow, trim0, trim1);
        strip(st.pts, -0.12, 0.06, 0, 0, GroundLayer.PaintYellow, trim0, trim1);
      }
      const laneW = (st.width / 2 - (st.cls === RoadClass.Boulevard ? 1 : 0)) / st.lanes;
      for (let k = 1; k < st.lanes; k++) {
        const off = (st.cls === RoadClass.Boulevard ? 1 : 0) + laneW * k;
        strip(st.pts, off, 0.07, 3, 6, GroundLayer.PaintWhite, trim0, trim1);
        strip(st.pts, -off, 0.07, 3, 6, GroundLayer.PaintWhite, trim0, trim1);
      }
    } else if (st.cls === RoadClass.Street) {
      strip(st.pts, 0, 0.07, 3, 5, GroundLayer.PaintWhite, trim0, trim1);
    }
  }
  // Crosswalks (zebra) near junction ends (src/plan/crossings.ts), with a stop line on the
  // approach side (right-hand traffic: the lane arriving at the junction).
  for (const c of crossingsOf(plan)) {
    const px = c.x, pz = c.z, dxv = Math.sin(c.heading), dzv = Math.cos(c.heading);
    const nx = -dzv, nz = dxv;
    const half = c.width / 2 - 0.3;
    mb.set('aLayer', GroundLayer.PaintWhite);
    for (let o = -half + 0.25; o < half - 0.2; o += 1.0) {
      const cx = px + nx * o, cz = pz + nz * o;
      const p = [
        cx - nx * 0.25 - dxv * 1.5, cz - nz * 0.25 - dzv * 1.5,
        cx + nx * 0.25 - dxv * 1.5, cz + nz * 0.25 - dzv * 1.5,
        cx + nx * 0.25 + dxv * 1.5, cz + nz * 0.25 + dzv * 1.5,
        cx - nx * 0.25 + dxv * 1.5, cz - nz * 0.25 + dzv * 1.5,
      ];
      const base = mb.vcount;
      for (let k = 0; k < 4; k++) mb.v(p[k * 2], terrain.height(p[k * 2], p[k * 2 + 1]) + lift, p[k * 2 + 1], 0, 1, 0, p[k * 2], p[k * 2 + 1]);
      upQuad(mb, base, p);
    }
    const sx = px + dxv * 2.2, sz = pz + dzv * 2.2;
    strip([sx - nx * 0.05, sz - nz * 0.05, sx + nx * half, sz + nz * half], 0, 0.2, 0, 0, GroundLayer.PaintWhite, 0, 0);
  }
}

/** Emit a quad (4 verts already added at `base`, xz corners in p) facing +y. */
function upQuad(mb: MeshBuilder, base: number, p: number[]): void {
  const cr = (p[2] - p[0]) * (p[5] - p[1]) - (p[3] - p[1]) * (p[4] - p[0]);
  if (cr > 0) { mb.tri(base, base + 2, base + 1); mb.tri(base, base + 3, base + 2); }
  else { mb.tri(base, base + 1, base + 2); mb.tri(base, base + 2, base + 3); }
}
