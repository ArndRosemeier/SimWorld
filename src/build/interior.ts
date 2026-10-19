/**
 * Mesh data for a building's interior (src/interior): per storey the floor finishes, the slab and
 * ceiling with the stairwell cut out, the inner walls painted per room on each side (baseboards,
 * door frames, tiles in bathrooms), the switchback stairs with landings and handrails, every piece
 * of furniture, and the ceiling fixtures. One material kind (`INTERIOR`): every surface a layer of
 * the interior texture family (wood boards, tiles, carpet, paint, wallpaper, fabric, wood; uv in
 * metres) times its colour, the lamps glowing. Deterministic: the furniture's small details come
 * from the piece's position.
 *
 * `buildCutaway` is the dollhouse view of one storey: the storeys below as a shell, this storey
 * without its ceiling and with its outer walls cut at sill height.
 *
 * Ported from Scale (src/interior/InteriorBuilder.ts: buildFloorMeshes, wallSegments, stairs,
 * fixture, buildFurniture) onto the MeshBuilder; Scale's canvas textures and its ten materials
 * became texture layers and tints. New: the trades' pieces (ovens, work tables, salon chairs, car lifts,
 * machines, bunks, a safe) and the outer walls of the cutaway.
 */
import earcut from 'earcut';
import { differencePos } from '../geom/clip';
import { ensureCCW, minAreaRect, pointInPoly, polyArea, type Poly } from '../geom/geom2';
import { INTERIOR_LAYER_COUNT } from './texgen';
import { InteriorMat } from './texgen/interior';
import type { AttrSpec, MeshBuilder } from './meshBuilder';
import type { Interior } from '../interior/building';
import { landingBox, type Indoors } from '../interior/indoors';
import { LEAF_T, type DoorLeaf } from '../interior/doors';
import type { FloorMat, FloorPlan, Furn, IWall, Room } from '../interior/types';

/** The attributes of the `INTERIOR` material kind (src/render/materials.ts): uv in metres, texture layer, tint. */
export const INTERIOR_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'aLayer', size: 1 }, { name: 'aTint', size: 3, type: 'u8n' }];

/** The `aLayer` of lamps (shades, ceiling panels): past the texture layers, drawn glowing. */
export const LAMP = INTERIOR_LAYER_COUNT;

type C3 = readonly [number, number, number];

const WALL_T = 0.12;
const DOOR_H = 2.15;
/** Outer walls of the cut storey stop here (m above its floor), its inner walls a little higher. */
const SILL = 1.0, CUT = 1.3;
const BASE: C3 = [0.93, 0.92, 0.89];
const FRAME: C3 = [0.95, 0.94, 0.91];
/** A public building's plinth, where the ground falls away under it (`buildIndoors`). */
const PLINTH: C3 = [0.62, 0.6, 0.57];
const FLOOR_LAYER: Record<FloorMat, number> = {
  wood: InteriorMat.WoodFloor, tile: InteriorMat.FloorTile, carpet: InteriorMat.Carpet, concrete: InteriorMat.Concrete, stone: InteriorMat.StoneFloor, marble: InteriorMat.Marble,
};
const FLOOR: Record<FloorMat, C3> = {
  wood: [0.58, 0.42, 0.28], tile: [0.86, 0.86, 0.83], carpet: [0.42, 0.44, 0.5], concrete: [0.62, 0.62, 0.6], stone: [0.74, 0.7, 0.64], marble: [0.91, 0.9, 0.87],
};
const BOOKS: C3[] = [[0.55, 0.12, 0.1], [0.12, 0.25, 0.45], [0.15, 0.38, 0.22], [0.75, 0.6, 0.25], [0.85, 0.82, 0.75], [0.25, 0.22, 0.2], [0.45, 0.2, 0.42], [0.8, 0.4, 0.15]];

/**
 * The MeshBuilder with a colour per call (Scale's Geo) and the texture layer it goes on: `layer`
 * for coloured parts (wood or fabric on a piece of furniture), paint for near-grey ones (steel,
 * white, black), unless `fixed`.
 */
class Geo {
  layer: number = InteriorMat.Paint;
  fixed = false;
  constructor(readonly mb: MeshBuilder) {}
  col(c: C3, layer?: number): this {
    const plain = !this.fixed && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 0.08;
    this.mb.set('aTint', c[0], c[1], c[2]).set('aLayer', layer ?? (plain ? InteriorMat.Paint : this.layer));
    return this;
  }
  /** Draw with `layer` for everything (until `free`). */
  on(layer: number): this { this.layer = layer; this.fixed = true; return this; }
  free(layer: number = InteriorMat.Paint): this { this.layer = layer; this.fixed = false; return this; }
  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, c: C3): void {
    if (hx <= 0 || hy <= 0 || hz <= 0) return;
    this.col(c).mb.box(x, y, z, hx, hy, hz, yaw);
  }
  /** Vertical cylinder (or cone: r1 at the top) from y0 to y1, closed on top. */
  cyl(x: number, y0: number, z: number, y1: number, r0: number, r1: number, seg: number, c: C3, cap = true): void {
    const mb = this.col(c).mb;
    const sl = (r0 - r1) / Math.max(0.01, y1 - y0), nl = Math.hypot(1, sl);
    const base = mb.vcount;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const u = (i / seg) * Math.PI * 2 * Math.max(r0, r1);
      mb.v(x + ca * r0, y0, z + sa * r0, ca / nl, sl / nl, sa / nl, u, y0);
      mb.v(x + ca * r1, y1, z + sa * r1, ca / nl, sl / nl, sa / nl, u, y1);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; mb.quad(a, a + 1, a + 3, a + 2); }
    if (cap && r1 > 0.001) {
      const ct = mb.v(x, y1, z, 0, 1, 0, x, z), r0i = mb.vcount;
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, px = x + Math.cos(a) * r1, pz = z + Math.sin(a) * r1; mb.v(px, y1, pz, 0, 1, 0, px, pz); }
      for (let i = 0; i < seg; i++) mb.tri(ct, r0i + i + 1, r0i + i);
    }
  }
  /** A flat quad; corners counter-clockwise seen from the normal. */
  quad4(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], n: readonly number[], col: C3): void {
    const mb = this.col(col).mb;
    // uv in metres: x, z on a level face, along the face and up on an upright one.
    const level = Math.abs(n[1]) > 0.7, uv = (p: readonly number[]) => (level ? [p[0], p[2]] : [p[0] * -n[2] + p[2] * n[0], p[1]]);
    const i = mb.v(a[0], a[1], a[2], n[0], n[1], n[2], ...uv(a));
    mb.v(b[0], b[1], b[2], n[0], n[1], n[2], ...uv(b));
    mb.v(c[0], c[1], c[2], n[0], n[1], n[2], ...uv(c));
    mb.v(d[0], d[1], d[2], n[0], n[1], n[2], ...uv(d));
    mb.quad(i, i + 1, i + 2, i + 3);
  }
}

/** Flat polygon (with holes) facing up or down at height y; uv in metres along `axis` (radians: the boards' direction) and across. */
function flat(g: Geo, poly: Poly, holes: Poly[], y: number, up: boolean, c: C3, layer: number = InteriorMat.Paint, axis = 0): void {
  const pts = poly.slice();
  const hi: number[] = [];
  for (const h of holes) { hi.push(pts.length / 2); pts.push(...h); }
  const tris = earcut(pts, hi.length ? hi : undefined, 2);
  const mb = g.col(c, layer).mb, base = mb.vcount, ca = Math.cos(axis), sa = Math.sin(axis);
  for (let i = 0; i < pts.length; i += 2) mb.v(pts[i], y, pts[i + 1], 0, up ? 1 : -1, 0, pts[i] * sa + pts[i + 1] * ca, pts[i] * ca - pts[i + 1] * sa);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], d = tris[i + 2];
    const cr = (pts[b * 2] - pts[a * 2]) * (pts[d * 2 + 1] - pts[a * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[d * 2] - pts[a * 2]);
    if ((cr < 0) === up) mb.tri(base + a, base + b, base + d);
    else mb.tri(base + a, base + d, base + b);
  }
}

/** A polygon less some openings (stairwells). */
function minus(poly: Poly, holes: Poly[]): { outer: Poly; holes: Poly[] }[] {
  if (!holes.length) return [{ outer: poly, holes: [] }];
  return differencePos([ensureCCW(poly.slice())], holes.map((h) => ensureCCW(h.slice())));
}

/** A small deterministic random stream from a position (furniture details). */
function seeded(x: number, z: number, k = 0): () => number {
  let s = (Math.floor(x * 97.13) * 73856093) ^ (Math.floor(z * 89.71) * 19349663) ^ (k * 83492791);
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export interface StoreyOpts {
  /** World y of the building's ground-floor level (`buildingBase(b, terrain).base`). */
  base: number;
  /** Openings in this storey's slab (the stairs arriving from below). */
  floorHoles?: Poly[];
  /** Draw the ceiling and its lights (false: a cutaway, open to the sky). */
  ceiling?: boolean;
  /** Outer walls between the storey's outline and this facade outline, up to `outerH` (m) above the floor. */
  facade?: Poly;
  outerH?: number;
  /** Cut every inner wall at this height (m above the floor) and leave out what hangs on walls above it: a cutaway. */
  cut?: number;
}

/** One storey's meshes. */
export function buildStorey(mb: MeshBuilder, plan: FloorPlan, o: StoreyOpts): void {
  const g = new Geo(mb);
  const y = o.base + plan.y, holes = o.floorHoles ?? [];
  // Floor finishes per room (boards along the building's long axis), the structural slab under them.
  const box = minAreaRect(plan.poly), axis = Math.atan2(box.hu >= box.hv ? box.ux : -box.uz, box.hu >= box.hv ? box.uz : box.ux);
  for (const room of plan.rooms) for (const p of minus(room.poly, holes)) flat(g, p.outer, p.holes, y + 0.035, true, FLOOR[room.floorMat], FLOOR_LAYER[room.floorMat], axis);
  for (const p of minus(o.facade ?? plan.poly, holes)) flat(g, p.outer, p.holes, y + 0.02, true, [0.6, 0.6, 0.58], InteriorMat.Concrete);
  if (o.ceiling !== false) {
    for (const p of minus(plan.poly, plan.stairHole ? [plan.stairHole] : [])) flat(g, p.outer, p.holes, y + plan.height - 0.03, false, [0.95, 0.95, 0.93]);
    for (let i = 0, k = 0; i < plan.lights.length; i += 2, k++) fixture(g, plan.lights[i], plan.lights[i + 1], y + plan.height, plan.fixtures[k] ?? 0);
  }
  for (const w of plan.walls) wallSegments(g, plan, w, y, o.cut ?? plan.height);
  outlineTrim(g, plan.poly, y);
  if (o.facade) outerWalls(g, o.facade, plan.poly, y, y + (o.outerH ?? plan.height));
  stairs(g, plan, o.base);
  for (const f of plan.furniture) {
    if (o.cut && HUNG.has(f.kind)) continue;
    g.free(SOFT.has(f.kind) ? InteriorMat.Fabric : InteriorMat.Wood);
    buildFurniture(g, f, y + 0.035, !!o.cut);
  }
  g.free();
}

/** Upholstered and soft pieces (their coloured parts are fabric; other pieces' are wood). */
const SOFT = new Set(['bed', 'bedDouble', 'bunk', 'sofa', 'armchair', 'rug', 'officeChair', 'salonChair', 'clothesStack', 'clothesRail', 'mannequin']);

/** Pieces on the wall above sill height (left out of a cutaway). */
const HUNG = new Set(['painting', 'mirror', 'screen']);

/**
 * The dollhouse view of storey `floor`: the storeys below as a plain shell (slab and outer walls),
 * this one furnished, open above, its outer walls cut at sill height.
 */
export function buildCutaway(mb: MeshBuilder, I: Interior, floor: number, base: number, facades: readonly Poly[]): void {
  const f = Math.max(0, Math.min(I.storeys.length - 1, floor));
  const g = new Geo(mb);
  for (let k = 0; k < f; k++) {
    const s = I.storeys[k];
    outerWalls(g, facades[k], s.poly, base + s.y, base + s.y + s.height);
  }
  const s = I.storeys[f];
  const below = f > 0 ? I.storeys[f - 1].stairHole : null;
  buildStorey(mb, s, { base, floorHoles: below ? [below] : [], ceiling: false, facade: facades[f], outerH: SILL, cut: CUT });
}

/**
 * The whole building to walk around in: every storey furnished, with its ceiling and lamps, the
 * stairwells open, and the outer walls of `ind` (street doors cut in) on the inside of the facade.
 * `foot`: a plinth under the outer walls down to there, for a public building shown without its
 * shell (whose plinth meets the ground where it falls away), so it does not float.
 */
export function buildIndoors(mb: MeshBuilder, I: Interior, ind: Indoors, foot?: number): void {
  const g = new Geo(mb);
  if (foot !== undefined && foot < ind.base - 0.02 && I.storeys.length) {
    const P = I.storeys[0].poly, n = P.length >> 1, sg = polyArea(P) > 0 ? 1 : -1, h = (ind.base - foot) / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = P[i * 2], az = P[i * 2 + 1], bx = P[j * 2], bz = P[j * 2 + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.02) continue;
      // Under the outer wall (pushed out from the outline, as src/interior/indoors.ts lays it), a little longer to close the corners.
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz * sg, nz = -dx * sg;
      g.col(PLINTH, InteriorMat.Concrete).mb.box((ax + bx) / 2 + nx * 0.1, foot + h, (az + bz) / 2 + nz * 0.1, 0.1, h, L / 2 + 0.2, Math.atan2(dx, dz));
    }
  }
  I.storeys.forEach((s, f) => {
    const below = f > 0 ? I.storeys[f - 1].stairHole : null;
    buildStorey(mb, s, { base: ind.base, floorHoles: below ? [below] : [], ceiling: true });
    for (const w of ind.outer) {
      if (w.floor !== f) continue;
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az), dx = (w.bx - w.ax) / L, dz = (w.bz - w.az) / L, yaw = Math.atan2(dx, dz);
      // The wall from s0 to s1 along it, h0 to h1 high, in the room's paint.
      const wallPart = (s0: number, s1: number, h0: number, h1: number) => {
        if (s1 - s0 < 0.01 || h1 - h0 < 0.01) return;
        const sm = (s0 + s1) / 2, x = w.ax + dx * sm, z = w.az + dz * sm, room = roomAt(s, x - w.nx * 0.3, z - w.nz * 0.3);
        g.col(room?.wallColor ?? [0.9, 0.89, 0.86], wallLayer(room)).mb.box(x + w.nx * 0.1, (h0 + h1) / 2, z + w.nz * 0.1, 0.1, (h1 - h0) / 2, (s1 - s0) / 2, yaw);
      };
      // Solid between the windows; under each its sill, over it its head.
      let at = 0;
      for (const [s0, s1, h0, h1] of w.windows) {
        wallPart(at, s0, w.y0, w.y1);
        wallPart(s0, s1, w.y0, h0);
        wallPart(s0, s1, h1, w.y1);
        at = s1;
      }
      wallPart(at, L, w.y0, w.y1);
    }
  });
  g.free();
}

/** The ring between the facade and the storey's inside outline, y0 to y1: inner and outer faces and its top. */
function outerWalls(g: Geo, facade: Poly, inner: Poly, y0: number, y1: number): void {
  const side = (p: Poly, out: boolean, c: C3) => {
    const q = ensureCCW(p.slice()), n = q.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = q[i * 2], az = q[i * 2 + 1], bx = q[j * 2], bz = q[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      // Counter-clockwise ring (x right, z down the screen): (dz, -dx) points out.
      const nx = ((bz - az) / L) * (out ? 1 : -1), nz = (-(bx - ax) / L) * (out ? 1 : -1);
      if (out) g.quad4([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], [nx, 0, nz], c);
      else g.quad4([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], c);
    }
  };
  side(facade, true, [0.78, 0.74, 0.68]);
  side(inner, false, [0.9, 0.89, 0.86]);
  flat(g, facade, [inner], y1, true, [0.7, 0.67, 0.62]);
}

/** The room a point lies in (walls are coloured by the room on each side). */
function roomAt(plan: FloorPlan, x: number, z: number): Room | null {
  for (const r of plan.rooms) if (pointInPoly(r.poly, x, z)) return r;
  return null;
}

/**
 * A wall with its doorways: per piece two painted faces (each the colour of the room it faces),
 * its top and ends; baseboards on both faces; frames round every doorway; tiles up to 1.35 m on a
 * bathroom's side.
 */
function wallSegments(g: Geo, plan: FloorPlan, w: IWall, y: number, h: number): void {
  const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
  if (L < 0.2) return;
  const dx = (w.bx - w.ax) / L, dz = (w.bz - w.az) / L;
  const nx = -dz, nz = dx, t = WALL_T / 2;
  const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
  const rA = roomAt(plan, mx + nx * 0.3, mz + nz * 0.3), rB = roomAt(plan, mx - nx * 0.3, mz - nz * 0.3);
  const cA: C3 = rA?.wallColor ?? [0.9, 0.89, 0.86], cB: C3 = rB?.wallColor ?? [0.9, 0.89, 0.86];
  const yaw = Math.atan2(dx, dz);
  const doors = w.doors.slice().sort((a, b) => a[0] - b[0]).map(([a, b]) => [a * L, b * L] as [number, number]);
  // The solid stretches and the lintels over the doors as boxes, each face the colour of its room.
  const piece = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
    const sm = (s0 + s1) / 2, cx = w.ax + dx * sm, cz = w.az + dz * sm, hy = (y1 - y0) / 2, hl = (s1 - s0) / 2;
    // The box's local z runs along the wall, its -x face looks into room A, +x into room B; ends and top plain.
    g.col(BASE).mb.box(cx, y0 + hy, cz, t, hy, hl, yaw, 0x3c);
    g.col(cB, wallLayer(rB)).mb.box(cx, y0 + hy, cz, t, hy, hl, yaw, 0x1);
    g.col(cA, wallLayer(rA)).mb.box(cx, y0 + hy, cz, t, hy, hl, yaw, 0x2);
  };
  let s = 0;
  const solid: [number, number][] = [];
  for (const [d0, d1] of doors) {
    piece(s, d0, y, y + h);
    if (d0 - s > 0.01) solid.push([s, d0]);
    if (h > DOOR_H) piece(d0, d1, y + DOOR_H, y + h);
    s = d1;
  }
  piece(s, L, y, y + h);
  if (L - s > 0.01) solid.push([s, L]);
  for (const side of [1, -1]) {
    const off = t + 0.012;
    for (const [s0, s1] of solid) {
      const sm = (s0 + s1) / 2;
      g.box(w.ax + dx * sm + nx * side * off, y + 0.075, w.az + dz * sm + nz * side * off, 0.012, 0.045, (s1 - s0) / 2, yaw, BASE);
    }
    for (const [d0, d1] of doors) {
      const fh = Math.min(DOOR_H, h);
      for (const sd of [d0 - 0.04, d1 + 0.04]) g.box(w.ax + dx * sd + nx * side * off, y + 0.04 + fh / 2, w.az + dz * sd + nz * side * off, 0.012, fh / 2, 0.04, yaw, FRAME);
      const sm = (d0 + d1) / 2;
      if (h > DOOR_H) g.box(w.ax + dx * sm + nx * side * off, y + DOOR_H + 0.04, w.az + dz * sm + nz * side * off, 0.012, 0.04, (d1 - d0) / 2 + 0.08, yaw, FRAME);
    }
    // Wall tiles on a bathroom's side.
    if ((side > 0 ? rA : rB)?.type === 'bath') {
      for (const [s0, s1] of solid) {
        const sm = (s0 + s1) / 2;
        const th = Math.min(1.2, h - 0.15) / 2;
        g.col([0.92, 0.95, 0.97], InteriorMat.WallTile).mb.box(w.ax + dx * sm + nx * side * (t + 0.006), y + 0.12 + th, w.az + dz * sm + nz * side * (t + 0.006), 0.006, th, (s1 - s0) / 2, yaw);
      }
    }
  }
}

/** A room's wall finish: wallpaper in some living rooms and bedrooms, else paint. */
function wallLayer(r: Room | null): number {
  if (!r || (r.type !== 'living' && r.type !== 'bedroom')) return InteriorMat.Paint;
  // (A stable choice per room, from its colour.)
  return Math.round((r.wallColor[0] * 7 + r.wallColor[1] * 13 + r.wallColor[2] * 5) * 100) % 3 === 0 ? InteriorMat.Wallpaper : InteriorMat.Paint;
}

/** Baseboards round the storey's outline (the inside of the outer walls). */
function outlineTrim(g: Geo, poly: Poly, y: number): void {
  const n = poly.length / 2, sg = polyArea(poly) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.4) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz * sg, nz = dx * sg;
    g.box((ax + bx) / 2 + nx * 0.015, y + 0.075, (az + bz) / 2 + nz * 0.015, 0.012, 0.045, L / 2, Math.atan2(dx, dz), BASE);
  }
}

/** Switchback flights: steps (with a soffit under them), nosings, landings, handrails. */
function stairs(g: Geo, plan: FloorPlan, base: number): void {
  const stepC: C3 = [0.72, 0.7, 0.66], nose: C3 = [0.5, 0.48, 0.45], rail: C3 = [0.18, 0.18, 0.19];
  for (const fl of plan.flights) {
    const y0 = base + fl.y0, y1 = base + fl.y1, rise = y1 - y0;
    const n = Math.max(4, Math.round(rise / 0.175)), r = rise / n, tread = fl.run / n;
    const yaw = Math.atan2(fl.dx, fl.dz);
    for (let k = 0; k < n; k++) {
      const s = tread * (k + 0.5), top = y0 + r * (k + 1), bottom = y0 + r * k - 0.25;
      const cx = fl.x + fl.dx * s, cz = fl.z + fl.dz * s;
      g.col(stepC, InteriorMat.StoneFloor).mb.box(cx, (top + bottom) / 2, cz, fl.width / 2, (top - bottom) / 2, tread / 2, yaw);
      g.box(cx + fl.dx * (tread / 2 - 0.02), top - 0.012, cz + fl.dz * (tread / 2 - 0.02), fl.width / 2 - 0.02, 0.014, 0.025, yaw, nose);
    }
    // Handrails on both sides, 90 cm over the pitch line.
    const px = -fl.dz, pz = fl.dx;
    for (const side of [1, -1]) {
      const ox = px * side * (fl.width / 2 - 0.05), oz = pz * side * (fl.width / 2 - 0.05);
      g.col(rail).mb.beam(fl.x + ox, y0 + 0.9, fl.z + oz, fl.x + fl.dx * fl.run + ox, y1 + 0.9, fl.z + fl.dz * fl.run + oz, 0.02, 0.02);
    }
  }
  for (const l of plan.landings) {
    const b = landingBox(l, base);
    g.col(stepC, InteriorMat.StoneFloor).mb.box(b.x, b.y, b.z, b.hx, b.hy, b.hz, b.yaw);
  }
}

/** A ceiling fixture: 0 a flat panel, 1 a pendant lamp (cord and shade), 2 a round lamp. */
function fixture(g: Geo, x: number, z: number, ceil: number, kind: number): void {
  if (kind === 1) {
    g.cyl(x, ceil - 0.75, z, ceil, 0.006, 0.006, 4, [0.1, 0.1, 0.1], false);
    g.on(LAMP).cyl(x, ceil - 0.95, z, ceil - 0.72, 0.24, 0.07, 14, [1, 0.9, 0.75], false);
    g.box(x, ceil - 0.9, z, 0.05, 0.04, 0.05, 0, [1, 1, 1]);
  } else if (kind === 2) g.on(LAMP).cyl(x, ceil - 0.08, z, ceil - 0.02, 0.2, 0.2, 16, [1, 1, 1]);
  else g.on(LAMP).box(x, ceil - 0.06, z, 0.3, 0.02, 0.3, 0, [1, 1, 1]);
  g.free();
}

/** `cut`: a cutaway (no wall cabinets over a kitchen row). */
function buildFurniture(g: Geo, f: Furn, y: number, cut = false): void {
  const c = f.color as C3, yaw = f.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const W = (lx: number, lz: number): [number, number] => [f.x + lx * cs + lz * sn, f.z - lx * sn + lz * cs];
  const B = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, col: C3 = c) => { const [x, z] = W(lx, lz); g.box(x, y + ly, z, hx, hy, hz, yaw, col); };
  const Cy = (lx: number, ly0: number, lz: number, ly1: number, r0: number, r1: number, col: C3, seg = 10) => { const [x, z] = W(lx, lz); g.cyl(x, y + ly0, z, y + ly1, r0, r1, seg, col); };
  const rnd = seeded(f.x, f.z, f.kind.length);
  const w = f.w / 2, d = f.d / 2, h = f.h;
  const sc = (k: number): C3 => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
  const dark = sc(0.6), steel: C3 = [0.7, 0.71, 0.73], black: C3 = [0.08, 0.08, 0.09];
  const legs4 = (top: number, inset: number, r: number, col: C3) => { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B(a * (w - inset), top / 2, b * (d - inset), r, top / 2, r, col); };
  switch (f.kind) {
    case 'bed': case 'bedDouble': case 'bunk': {
      const frame: C3 = [0.35, 0.25, 0.18];
      const deck = (y0: number) => {
        B(0, y0 + 0.15, 0, w, 0.15, d, frame);
        B(0, y0 + 0.36, 0.03, w - 0.03, 0.08, d - 0.06, [0.94, 0.94, 0.93]);
        B(0, y0 + 0.46, 0.18, w - 0.02, 0.04, d * 0.78, c);
        B(0, y0 + 0.5, -d * 0.33, w - 0.02, 0.025, 0.1, sc(1.12));
      };
      deck(0);
      for (const a of [-1, 1]) for (const b of [-1, 1]) B(a * (w - 0.04), 0.06, b * (d - 0.04), 0.035, 0.06, 0.035, sc(0.5));
      const np = f.kind === 'bedDouble' ? 2 : 1;
      for (let i = 0; i < np; i++) B(np === 2 ? (i ? 1 : -1) * w * 0.48 : 0, 0.5, -d + 0.28, np === 2 ? w * 0.42 : w * 0.7, 0.07, 0.17, [0.97, 0.97, 0.96]);
      if (f.kind === 'bunk') { deck(1.0); for (const a of [-1, 1]) for (const b of [-1, 1]) B(a * (w - 0.03), 0.8, b * (d - 0.03), 0.03, 0.8, 0.03, frame); }
      else B(0, 0.62, -d + 0.03, w + 0.02, 0.62, 0.04, frame);
      break;
    }
    case 'sofa': case 'armchair': {
      for (const a of [-1, 1]) for (const b of [-1, 1]) B(a * (w - 0.08), 0.04, b * (d - 0.08), 0.025, 0.04, 0.025, [0.2, 0.15, 0.1]);
      B(0, 0.2, 0, w, 0.12, d, c);
      const arm = 0.12, seats = f.kind === 'sofa' ? Math.max(2, Math.round((w * 2 - 2 * arm) / 0.65)) : 1, sw = (w * 2 - 2 * arm) / seats;
      for (let i = 0; i < seats; i++) {
        const lx = -w + arm + sw * (i + 0.5);
        B(lx, 0.39, 0.06, sw / 2 - 0.015, 0.08, d - 0.18, sc(1.08));
        B(lx, 0.66, -d + 0.2, sw / 2 - 0.02, 0.2, 0.09, sc(1.05));
      }
      B(0, 0.55, -d + 0.08, w, 0.32, 0.08, c);
      B(-w + arm / 2, 0.42, 0, arm / 2, 0.18, d, c); B(w - arm / 2, 0.42, 0, arm / 2, 0.18, d, c);
      if (f.kind === 'sofa' && rnd() < 0.6) B(-w + arm + 0.22, 0.56, -d + 0.36, 0.17, 0.15, 0.05, sc(0.6));
      break;
    }
    case 'chair': {
      B(0, 0.45, 0, w, 0.025, d);
      for (let i = -1; i <= 1; i++) B(i * (w - 0.08) * 0.7, 0.72, -d + 0.03, 0.025, 0.24, 0.015);
      B(0, 0.95, -d + 0.03, w, 0.03, 0.02);
      legs4(0.44, 0.03, 0.018, dark);
      break;
    }
    case 'officeChair': case 'salonChair': {
      const metal: C3 = [0.2, 0.2, 0.2];
      B(0, 0.48, 0, w * 0.8, 0.05, d * 0.8); B(0, 0.82, -d * 0.62, w * 0.75, 0.28, 0.05); B(0, 0.25, 0, 0.03, 0.22, 0.03, [0.3, 0.3, 0.3]);
      if (f.kind === 'salonChair') { Cy(0, 0, 0, 0.04, w * 0.7, w * 0.7, steel, 14); B(0, 1.15, -d * 0.62, w * 0.35, 0.08, 0.06, sc(1.1)); }
      else for (const a of [0, 1.256, 2.513, 3.77, 5.026]) { const lx = Math.cos(a) * w * 0.4, lz = Math.sin(a) * w * 0.4; B(lx / 2, 0.04, lz / 2, Math.abs(lx) / 2 + 0.02, 0.015, Math.abs(lz) / 2 + 0.02, metal); }
      for (const a of [-1, 1]) B(a * w * 0.78, 0.62, 0, 0.025, 0.02, d * 0.45, metal);
      break;
    }
    case 'diningTable': case 'coffeeTable': case 'desk': case 'meetingTable': case 'workTable': {
      B(0, h - 0.025, 0, w, 0.025, d);
      legs4(h - 0.05, 0.05, 0.025, dark);
      if (f.kind === 'desk') {
        B(0.3, h + 0.012, 0.12, 0.22, 0.01, 0.07, [0.12, 0.12, 0.13]);
        if (rnd() < 0.6) Cy(-w + 0.2, h, 0.15, h + 0.1, 0.04, 0.04, [0.9, 0.9, 0.88], 8);
        if (rnd() < 0.5) B(-w + 0.35, h + 0.02, -0.05, 0.12, 0.02, 0.15, [0.95, 0.95, 0.93]);
      } else if (f.kind === 'workTable') {
        // Flour, dough, a tray of rolls.
        B(0, 0.12, 0, w - 0.06, 0.012, d - 0.06, sc(0.8));
        for (let k = 0; k < 3; k++) Cy((rnd() - 0.5) * w, h, (rnd() - 0.5) * d, h + 0.06, 0.1, 0.08, [0.93, 0.86, 0.7], 10);
      } else if (f.kind === 'diningTable' || f.kind === 'coffeeTable') {
        const r = rnd();
        if (r < 0.4) { Cy(0, h, 0, h + 0.22, 0.05, 0.035, [0.75, 0.82, 0.86]); for (let k = 0; k < 3; k++) Cy((rnd() - 0.5) * 0.06, h + 0.22, (rnd() - 0.5) * 0.06, h + 0.3, 0.03, 0.03, [0.85, 0.3 + rnd() * 0.5, 0.35], 6); }
        else if (r < 0.75) Cy(0, h, 0, h + 0.07, 0.12, 0.16, [0.88, 0.86, 0.8], 14);
        else for (let k = 0; k < 3; k++) B((rnd() - 0.5) * w, h + 0.015, (rnd() - 0.5) * d, 0.12, 0.012, 0.16, BOOKS[Math.floor(rnd() * BOOKS.length)]);
      }
      break;
    }
    case 'workbench': {
      B(0, h - 0.03, 0, w, 0.03, d, [0.55, 0.4, 0.25]);
      legs4(h - 0.06, 0.05, 0.03, [0.3, 0.32, 0.36]);
      B(0, 0.15, 0, w - 0.05, 0.015, d - 0.05, [0.3, 0.32, 0.36]);
      // A pegboard with tools over its back edge, a vice at one end.
      B(0, h + 0.45, -d + 0.02, w, 0.4, 0.01, [0.75, 0.62, 0.42]);
      for (let k = 0; k < 6; k++) B(-w + 0.15 + k * (w * 2 - 0.3) / 5, h + 0.45 + (rnd() - 0.5) * 0.3, -d + 0.04, 0.015, 0.1 + rnd() * 0.08, 0.01, [0.2 + rnd() * 0.5, 0.2, 0.2]);
      B(w - 0.15, h + 0.07, d - 0.1, 0.08, 0.06, 0.07, [0.25, 0.35, 0.55]);
      break;
    }
    case 'cafeTable':
      Cy(0, h - 0.03, 0, h, w, w, c, 16);
      Cy(0, 0, 0, h - 0.03, 0.03, 0.03, [0.15, 0.15, 0.15], 8);
      Cy(0, 0, 0, 0.02, 0.22, 0.22, [0.15, 0.15, 0.15], 12);
      if (rnd() < 0.5) Cy(0.12, h, 0.05, h + 0.09, 0.04, 0.045, [0.95, 0.95, 0.93], 8);
      break;
    case 'wardrobe':
      B(0, h / 2, 0, w, h / 2, d, c);
      B(0, h / 2, d + 0.004, 0.006, h / 2 - 0.04, 0.004, dark);
      for (const a of [-1, 1]) B(a * 0.05, h * 0.52, d + 0.02, 0.01, 0.12, 0.015, [0.75, 0.72, 0.6]);
      B(0, h - 0.02, 0, w + 0.02, 0.02, d + 0.02, sc(0.85));
      break;
    case 'bookshelf': case 'shelf': case 'shopShelf': case 'clothesShelf': {
      B(-w + 0.02, h / 2, 0, 0.02, h / 2, d, c); B(w - 0.02, h / 2, 0, 0.02, h / 2, d, c);
      B(0, h - 0.02, 0, w, 0.02, d, c); B(0, 0.04, 0, w, 0.04, d, c);
      B(0, h / 2, -d + 0.01, w, h / 2, 0.01, sc(0.75));
      const levels = f.kind === 'shelf' ? 3 : f.kind === 'clothesShelf' ? 4 : 5;
      for (let k = 1; k < levels; k++) B(0, (h * k) / levels, 0, w - 0.03, 0.012, d - 0.01, sc(0.85));
      if (f.kind === 'shelf') { for (let k = 0; k < levels; k++) B(0, (h * (k + 0.5)) / levels, d + 0.004, w - 0.04, h / levels / 2 - 0.02, 0.005, sc(0.92)); break; }
      if (f.kind === 'clothesShelf') {
        for (let k = 0; k < levels; k++) {
          const yy = (h * k) / levels + 0.02;
          for (let x = -w + 0.06; x + 0.3 < w - 0.04; x += 0.36) {
            if (rnd() < 0.1) continue;
            const bh = 0.08 + rnd() * 0.16;
            B(x + 0.15, yy + bh / 2, 0.02, 0.15, bh / 2, d * 0.75, [0.2 + rnd() * 0.7, 0.2 + rnd() * 0.6, 0.2 + rnd() * 0.65]);
          }
        }
        break;
      }
      for (let k = 0; k < levels; k++) {
        const yy = (h * k) / levels + 0.02, room = h / levels - 0.06;
        for (let x = -w + 0.05; x < w - 0.08;) {
          const bw = f.kind === 'shopShelf' ? 0.08 + rnd() * 0.12 : 0.025 + rnd() * 0.035;
          if (rnd() < (f.kind === 'shopShelf' ? 0.08 : 0.12)) { x += bw + 0.05; continue; }
          const bh = room * (f.kind === 'shopShelf' ? 0.45 + rnd() * 0.4 : 0.65 + rnd() * 0.3);
          const col: C3 = f.kind === 'shopShelf' ? [0.3 + rnd() * 0.65, 0.25 + rnd() * 0.6, 0.2 + rnd() * 0.6] : BOOKS[Math.floor(rnd() * BOOKS.length)];
          B(Math.min(w - 0.05, x + bw / 2), yy + bh / 2, 0.02, bw / 2 - 0.003, bh / 2, d * (f.kind === 'shopShelf' ? 0.8 : 0.7), col);
          x += bw + 0.004;
        }
      }
      break;
    }
    case 'kitchenRow': {
      B(0, 0.05, 0.02, w, 0.05, d - 0.04, [0.2, 0.2, 0.2]);
      B(0, (h - 0.1) / 2 + 0.1, 0, w, (h - 0.1) / 2, d, c);
      const n = Math.max(1, Math.round((w * 2) / 0.6));
      for (let i = 0; i < n; i++) {
        const lx = -w + (i + 0.5) * ((w * 2) / n);
        B(lx, h * 0.55, d + 0.005, w / n - 0.01, h * 0.4, 0.005, sc(0.96));
        B(lx, h * 0.82, d + 0.02, 0.07, 0.008, 0.012, [0.7, 0.7, 0.72]);
      }
      B(0, h + 0.02, 0, w + 0.01, 0.02, d + 0.02, [0.22, 0.2, 0.2]);
      const hx = -w * 0.35, sx = w * 0.35;
      B(hx, h + 0.042, 0, 0.3, 0.003, 0.26, [0.04, 0.04, 0.05]);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) Cy(hx + a * 0.14, h + 0.044, b * 0.12, h + 0.046, 0.08, 0.08, [0.25, 0.08, 0.06], 12);
      B(sx, h + 0.041, 0, 0.24, 0.004, 0.2, [0.72, 0.74, 0.76]);
      B(sx, h + 0.035, 0, 0.2, 0.012, 0.16, [0.45, 0.47, 0.49]);
      Cy(sx, h + 0.04, -d + 0.08, h + 0.3, 0.012, 0.012, [0.75, 0.76, 0.78], 6);
      B(sx, h + 0.3, -d + 0.15, 0.012, 0.012, 0.07, [0.75, 0.76, 0.78]);
      B(0, h + 0.33, -d + 0.008, w, 0.3, 0.008, [0.93, 0.93, 0.9]);
      if (cut) break;
      B(0, 1.95, -d + 0.18, w, 0.33, 0.17, c);
      for (let i = 0; i < n; i++) { const lx = -w + (i + 0.5) * ((w * 2) / n); B(lx, 1.95, -d + 0.355, w / n - 0.01, 0.31, 0.005, sc(0.96)); }
      B(hx, h + 0.75, -d + 0.22, 0.32, 0.05, 0.22, [0.6, 0.62, 0.64]);
      break;
    }
    case 'fridge':
      B(0, h / 2, 0, w, h / 2, d, c);
      B(0, h * 0.62, d + 0.004, w - 0.01, 0.004, 0.004, sc(0.7));
      for (const yy of [h * 0.8, h * 0.45]) B(w - 0.08, yy, d + 0.025, 0.012, 0.12, 0.012, [0.7, 0.7, 0.72]);
      break;
    case 'oven': {
      // A bakery's deck oven: steel body, three glass doors with handles, a hood.
      B(0, h / 2, 0, w, h / 2, d, steel);
      for (let k = 0; k < 3; k++) {
        const yy = 0.45 + k * (h - 0.6) / 3;
        B(0, yy, d + 0.005, w - 0.08, (h - 0.7) / 7, 0.005, [0.15, 0.1, 0.08]);
        B(0, yy + (h - 0.6) / 7, d + 0.03, w * 0.6, 0.012, 0.012, [0.85, 0.85, 0.86]);
      }
      B(0, h + 0.1, 0, w + 0.05, 0.1, d + 0.05, [0.55, 0.56, 0.58]);
      break;
    }
    case 'machine': {
      // A machine tool: base, body, a control box, a guard.
      B(0, 0.08, 0, w, 0.08, d, [0.25, 0.27, 0.3]);
      B(0, h * 0.45, 0, w * 0.85, h * 0.35, d * 0.8, c);
      B(w * 0.6, h * 0.6, d * 0.7, w * 0.25, h * 0.2, 0.08, [0.85, 0.75, 0.2]);
      B(-w * 0.2, h * 0.85, 0, w * 0.5, h * 0.15, d * 0.5, sc(0.8));
      break;
    }
    case 'carLift': {
      // Two posts and the arms; a yellow-black base plate.
      for (const a of [-1, 1]) { B(a * (w - 0.12), h / 2, 0, 0.12, h / 2, 0.15, [0.2, 0.35, 0.65]); B(a * (w - 0.6), 0.5, 0, 0.5, 0.04, 0.06, [0.6, 0.6, 0.62]); }
      B(0, 0.01, 0, w, 0.01, d * 0.3, [0.85, 0.75, 0.15]);
      break;
    }
    case 'stall': {
      // A pen open to the front: plank sides and back on posts, straw on the floor, a trough along the back.
      const plank: C3 = c, post = sc(0.7), straw: C3 = [0.78, 0.68, 0.38];
      B(0, 0.01, 0, w - 0.05, 0.01, d - 0.05, straw);
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) B(a * (w - 0.05), 0.65, b * (d - 0.05), 0.05, 0.65, 0.05, post);
        for (let k = 0; k < 3; k++) B(a * (w - 0.05), 0.3 + k * 0.4, 0, 0.025, 0.08, d - 0.05, plank);
      }
      for (let k = 0; k < 3; k++) B(0, 0.3 + k * 0.4, -d + 0.05, w - 0.05, 0.08, 0.025, plank);
      B(0, 0.25, -d + 0.35, w - 0.2, 0.25, 0.25, [0.45, 0.46, 0.48]);
      break;
    }
    case 'hayBale': {
      B(0, h / 2, 0, w, h / 2, d, c);
      for (const a of [-0.5, 0.5]) B(a * w, h / 2, 0, 0.012, h / 2 + 0.005, d + 0.005, sc(0.6));
      break;
    }
    case 'tractor': {
      // A small tractor: the bonnet in front (+z), the cab over the big back wheels, small front wheels.
      B(0, 0.75, d * 0.35, w * 0.45, 0.35, d * 0.55, c);
      B(0, 0.55, -d * 0.35, w * 0.55, 0.2, d * 0.4, c);
      B(0, 1.45, -d * 0.4, w * 0.5, 0.55, d * 0.35, [0.25, 0.3, 0.35]);
      B(0, 2.02, -d * 0.4, w * 0.55, 0.03, d * 0.4, c);
      for (const a of [-1, 1]) {
        B(a * (w - 0.2), 0.75, -d * 0.45, 0.2, 0.75, 0.75, black);
        B(a * (w * 0.6), 0.4, d * 0.7, 0.12, 0.4, 0.4, black);
      }
      break;
    }
    case 'car': {
      // A car on the lift or the garage floor: body, cabin with glass, wheels.
      const body = c, glass: C3 = [0.25, 0.3, 0.35];
      B(0, 0.45, 0, w, 0.22, d, body);
      B(0, 0.82, -d * 0.1, w - 0.08, 0.17, d * 0.5, glass);
      B(0, 1.0, -d * 0.1, w - 0.1, 0.02, d * 0.48, body);
      for (const a of [-1, 1]) for (const b of [-1, 1]) Cy(a * (w - 0.05), 0, b * (d - 0.65), 0.6, 0.3, 0.3, black, 12);
      break;
    }
    case 'safe':
      B(0, h / 2, 0, w, h / 2, d, [0.35, 0.37, 0.4]);
      Cy(0.1, h * 0.55, d + 0.01, h * 0.55 + 0.02, 0.12, 0.12, [0.75, 0.75, 0.7], 12);
      break;
    case 'washBasin':
      B(0, 0.4, 0, w, 0.4, d, [0.3, 0.3, 0.32]);
      B(0, 0.85, 0.02, w, 0.06, d, [0.15, 0.15, 0.16]);
      B(0, 0.9, 0.05, w - 0.1, 0.01, d - 0.15, [0.85, 0.85, 0.85]);
      Cy(0, 0.9, -d + 0.08, 1.15, 0.012, 0.012, steel, 6);
      break;
    case 'tvStand': case 'nightstand': case 'crate': case 'altar':
      B(0, h / 2, 0, w, h / 2, d, c);
      if (f.kind === 'nightstand') {
        B(0, h * 0.6, d + 0.004, w - 0.03, h * 0.18, 0.004, sc(0.9));
        Cy(0.08, h, -0.02, h + 0.22, 0.015, 0.015, [0.8, 0.75, 0.6], 6);
        Cy(0.08, h + 0.18, -0.02, h + 0.34, 0.11, 0.07, [1, 0.9, 0.75], 12);
      }
      if (f.kind === 'tvStand') for (const a of [-1, 1]) B(a * w * 0.5, h / 2, d + 0.004, w * 0.48, h / 2 - 0.03, 0.004, sc(0.85));
      break;
    case 'counter': case 'reception': case 'barCounter': case 'displayCounter': {
      B(0, h / 2, 0, w, h / 2, d, c);
      B(0, h / 2, d + 0.005, w - 0.03, h / 2 - 0.05, 0.005, sc(0.8));
      if (f.kind === 'displayCounter') {
        // A glass case on top with the goods in it.
        B(0, h + 0.2, 0, w - 0.02, 0.2, d - 0.02, [0.75, 0.85, 0.9]);
        for (let x = -w + 0.15; x < w - 0.1; x += 0.22) B(x, h + 0.05, 0.05, 0.08, 0.04, 0.12, [0.75 + rnd() * 0.2, 0.5 + rnd() * 0.3, 0.3 + rnd() * 0.2]);
      } else B(0, h + 0.02, 0, w + 0.03, 0.02, d + 0.05, [0.15, 0.15, 0.16]);
      if (f.kind === 'barCounter') {
        for (let x = -w + 0.4; x < w - 0.2; x += 0.65) { Cy(x, 0, d + 0.45, 0.75, 0.025, 0.025, [0.2, 0.2, 0.2], 6); Cy(x, 0.72, d + 0.45, 0.78, 0.18, 0.18, c, 12); }
        for (let x = -w + 0.2; x < w - 0.1; x += 0.25) Cy(x, h + 0.04, -d + 0.15, h + 0.3, 0.035, 0.03, [0.2 + rnd() * 0.5, 0.3 + rnd() * 0.3, 0.2], 6);
      }
      if (f.kind === 'reception') B(0, h + 0.25, -0.1, 0.25, 0.17, 0.02, [0.06, 0.06, 0.07]);
      break;
    }
    case 'tv':
      B(0, 0.5 + h / 2, 0, w, h / 2, d, [0.04, 0.04, 0.05]);
      B(0, 0.5 + h / 2, d + 0.002, w - 0.03, h / 2 - 0.03, 0.002, [0.1, 0.12, 0.16]);
      break;
    case 'monitor':
      B(0, 0.74 + 0.25, 0, 0.28, 0.17, 0.02, [0.06, 0.06, 0.07]);
      B(0, 0.74 + 0.25, 0.022, 0.26, 0.15, 0.002, [0.12, 0.16, 0.22]);
      B(0, 0.74 + 0.04, 0, 0.1, 0.04, 0.06, [0.2, 0.2, 0.2]);
      break;
    case 'screen':
      B(0, 1.5, 0, w, h / 2, d, [0.05, 0.05, 0.06]);
      B(0, 1.5, d + 0.002, w - 0.04, h / 2 - 0.04, 0.002, [0.14, 0.2, 0.3]);
      break;
    case 'rug': {
      const [ax, az] = W(-w, -d), [bx, bz] = W(w, -d), [cx, cz] = W(w, d), [dx, dz] = W(-w, d), yy = y + 0.008;
      g.quad4([ax, yy, az], [dx, yy, dz], [cx, yy, cz], [bx, yy, bz], [0, 1, 0], sc(1.3));
      // A border.
      for (const s of [-1, 1]) { B(0, 0.009, s * (d - 0.08), w - 0.08, 0.001, 0.04, sc(0.6)); B(s * (w - 0.08), 0.009, 0, 0.04, 0.001, d - 0.08, sc(0.6)); }
      break;
    }
    case 'plant': {
      Cy(0, 0, 0, 0.32, 0.15, 0.19, [0.62, 0.38, 0.26], 10);
      Cy(0, 0.3, 0, 0.31, 0.17, 0.17, [0.25, 0.18, 0.12], 10);
      const n = 9 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, r = 0.05 + rnd() * 0.18, hh = 0.45 + rnd() * Math.max(0, h - 0.5);
        const [x, z] = W(Math.cos(a) * r, Math.sin(a) * r);
        g.box(x, y + hh, z, 0.11 + rnd() * 0.08, 0.012, 0.045, a + rnd(), [0.12 + rnd() * 0.1, 0.36 + rnd() * 0.2, 0.12 + rnd() * 0.06]);
        g.box(x, y + hh * 0.6, z, 0.008, hh * 0.4, 0.008, 0, [0.2, 0.35, 0.15]);
      }
      break;
    }
    case 'floorLamp':
      Cy(0, 0, 0, 0.03, 0.15, 0.15, [0.15, 0.15, 0.15], 12);
      Cy(0, 0.03, 0, 1.45, 0.012, 0.012, [0.2, 0.2, 0.2], 6);
      g.on(LAMP);
      Cy(0, 1.35, 0, 1.65, 0.22, 0.14, [1, 0.9, 0.75], 14);
      g.free();
      break;
    case 'painting': {
      B(0, 1.5, 0, w, h / 2, d, [0.22, 0.16, 0.1]);
      const pal: C3[] = [[0.85, 0.75, 0.55], [0.2, 0.35, 0.55], [0.75, 0.3, 0.2], [0.3, 0.5, 0.35], [0.9, 0.88, 0.82], [0.15, 0.15, 0.2]];
      B(0, 1.5, d + 0.004, w - 0.05, h / 2 - 0.05, 0.003, c);
      if (rnd() < 0.5) { B(0, 1.5 - h * 0.15, d + 0.008, w - 0.05, h * 0.12, 0.003, pal[3]); B(w * 0.3, 1.5 + h * 0.15, d + 0.008, 0.06, 0.06, 0.003, pal[0]); }
      else for (let k = 0; k < 3; k++) B((rnd() - 0.5) * w, 1.5 + (rnd() - 0.5) * h * 0.5, d + 0.008, 0.05 + rnd() * w * 0.4, 0.04 + rnd() * h * 0.25, 0.003, pal[Math.floor(rnd() * pal.length)]);
      break;
    }
    case 'mirror':
      B(0, 1.45, 0, w + 0.02, h / 2 + 0.02, d, [0.85, 0.85, 0.82]);
      B(0, 1.45, d + 0.003, w, h / 2, 0.003, [0.78, 0.86, 0.9]);
      break;
    case 'tallMirror':
      B(0, h / 2 + 0.06, 0, w + 0.04, h / 2 + 0.04, d * 0.5, c);
      B(0, h / 2 + 0.06, d * 0.5 + 0.004, w, h / 2, 0.004, [0.8, 0.87, 0.92]);
      for (const s of [-1, 1]) B(s * (w - 0.04), 0.03, 0.1, 0.035, 0.03, 0.12, dark);
      break;
    case 'toilet':
      Cy(0, 0, 0.08, 0.38, 0.16, 0.19, c, 14);
      Cy(0, 0.38, 0.08, 0.41, 0.2, 0.2, [0.97, 0.97, 0.97], 14);
      B(0, 0.6, -0.24, 0.19, 0.22, 0.08, c);
      break;
    case 'bathtub':
      B(0, h / 2, 0, w, h / 2, d, c);
      B(0, h - 0.015, 0, w - 0.07, 0.016, d - 0.07, [0.68, 0.8, 0.86]);
      Cy(-w + 0.12, h, 0, h + 0.18, 0.012, 0.012, [0.75, 0.76, 0.78], 6);
      break;
    case 'shower':
      B(0, 0.04, 0, w, 0.04, d, c);
      B(w - 0.01, h / 2, 0, 0.01, h / 2, d, [0.8, 0.88, 0.92]);
      B(0, h / 2, d - 0.01, w, h / 2, 0.01, [0.8, 0.88, 0.92]);
      Cy(-w + 0.15, 0.08, -d + 0.15, 2.0, 0.012, 0.012, steel, 6);
      break;
    case 'sink':
      B(0, 0.38, 0, w, 0.38, d, [0.82, 0.8, 0.76]);
      B(0, 0.8, 0.02, w + 0.02, 0.05, d + 0.02, c);
      B(0, 0.84, 0.04, w - 0.08, 0.01, d - 0.12, [0.7, 0.78, 0.84]);
      Cy(0, 0.85, -d + 0.08, 1.0, 0.012, 0.012, [0.75, 0.76, 0.78], 6);
      break;
    case 'pew':
      B(0, 0.45, 0, w, 0.03, d * 0.6); B(0, 0.7, -d * 0.5, w, 0.25, 0.03); B(-w, 0.45, 0, 0.03, 0.45, d * 0.6); B(w, 0.45, 0, 0.03, 0.45, d * 0.6);
      break;
    case 'palletRack':
      for (let k = 0; k < 3; k++) B(0, 0.1 + k * (h / 3), 0, w, 0.05, d, [0.8, 0.45, 0.1]);
      for (const a of [-1, 1]) for (const b of [-1, 1]) B(a * w, h / 2, b * d, 0.04, h / 2, 0.04, [0.2, 0.3, 0.6]);
      for (let k = 0; k < 3; k++) if (rnd() < 0.85) B((rnd() - 0.5) * 0.2, 0.4 + k * (h / 3), 0, w * (0.6 + rnd() * 0.3), 0.3, d * 0.85, [0.6 + rnd() * 0.1, 0.5 + rnd() * 0.08, 0.35 + rnd() * 0.08]);
      break;
    case 'clothesRail': {
      const chrome: C3 = [0.78, 0.79, 0.82], top = Math.min(h, 1.5);
      for (const s of [-1, 1]) { Cy(s * (w - 0.03), 0, 0, top, 0.015, 0.015, chrome, 6); B(s * (w - 0.03), 0.015, 0, 0.03, 0.015, d - 0.02, chrome); }
      B(0, top - 0.015, 0, w - 0.03, 0.012, 0.012, chrome);
      const n = Math.max(4, Math.floor((w * 2 - 0.2) / 0.075));
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.12) continue;
        const x = -w + 0.12 + ((w * 2 - 0.24) * (k + 0.5)) / n, len = 0.55 + rnd() * 0.55, t = 0.65 + rnd() * 0.5;
        const col: C3 = rnd() < 0.45 ? [0.15 + rnd() * 0.75, 0.12 + rnd() * 0.6, 0.12 + rnd() * 0.65] : sc(t);
        B(x, top - 0.05 - len / 2, 0, 0.018, len / 2, Math.min(d - 0.04, 0.24), col);
      }
      break;
    }
    case 'mannequin': {
      const skin: C3 = [0.88, 0.86, 0.83];
      Cy(0, 0, 0, 0.03, 0.2, 0.2, [0.2, 0.2, 0.22], 12);
      Cy(0, 0.03, 0, 0.75, 0.015, 0.015, [0.6, 0.6, 0.62], 6);
      Cy(0, 0.75, 0, 1.05, 0.15, 0.17, c, 12);
      Cy(0, 1.05, 0, 1.45, 0.17, 0.2, c, 12);
      Cy(0, 1.45, 0, 1.52, 0.2, 0.06, c, 12);
      Cy(0, 1.52, 0, 1.6, 0.05, 0.05, skin, 8);
      Cy(0, 1.6, 0, 1.82, 0.09, 0.08, skin, 10);
      for (const s of [-1, 1]) Cy(s * 0.22, 0.9, 0, 1.45, 0.045, 0.055, c, 8);
      break;
    }
    case 'clothesStack':
      B(0, h / 2, 0, w, h / 2, d, sc(0.7));
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j += 2) {
        const n = 2 + Math.floor(rnd() * 3);
        for (let q = 0; q < n; q++) B(i * w * 0.6, h + 0.025 + q * 0.05, j * d * 0.45, 0.16, 0.022, 0.12, sc(0.75 + 0.25 * rnd()));
      }
      break;
    case 'cooler':
      B(0, 0.5, 0, w, 0.5, d, c);
      Cy(0, 1.0, 0, 1.38, 0.13, 0.13, [0.55, 0.75, 0.95], 12);
      break;
    case 'coatRack':
      Cy(0, 0, 0, 0.03, 0.18, 0.18, c, 10);
      Cy(0, 0.03, 0, h, 0.02, 0.02, c, 6);
      for (let k = 0; k < 4; k++) { const a = k * 1.57; B(Math.cos(a) * 0.08, h - 0.1, Math.sin(a) * 0.08, 0.06, 0.01, 0.01, c); }
      if (rnd() < 0.7) B(0.1, h - 0.5, 0, 0.12, 0.38, 0.1, [0.25 + rnd() * 0.4, 0.2 + rnd() * 0.3, 0.2 + rnd() * 0.3]);
      break;
    case 'column':
      B(0, h / 2, 0, w / 2, h / 2, d / 2, c);
      break;
    default:
      B(0, h / 2, 0, w, h / 2, d, c);
  }
}

/** Street doors' paint, and the room doors' (white paint, or oiled wood). */
const STREET_DOOR: C3[] = [[0.42, 0.12, 0.1], [0.12, 0.22, 0.32], [0.16, 0.3, 0.2], [0.85, 0.83, 0.78], [0.3, 0.2, 0.13], [0.1, 0.1, 0.1]];
const ROOM_DOOR: C3[] = [[0.94, 0.93, 0.9], [0.94, 0.93, 0.9], [0.62, 0.45, 0.3]];

/**
 * A door leaf (src/interior/doors.ts) in its hinge's frame: the hinge at the origin, the leaf along +x, its faces
 * across z, with a panel moulding and a handle on each side. The game turns it about the hinge to open it.
 */
export function buildDoorLeaf(mb: MeshBuilder, l: DoorLeaf): void {
  const g = new Geo(mb), r = seeded(l.x, l.z, l.street + 2);
  const c = l.street >= 0 ? STREET_DOOR[Math.floor(r() * STREET_DOOR.length)] : ROOM_DOOR[Math.floor(r() * ROOM_DOOR.length)];
  const w = l.w - 0.02, h = l.h, wood = c[0] - c[2] > 0.15;
  g.on(wood ? InteriorMat.Wood : InteriorMat.Paint);
  g.box(0.01 + w / 2, h / 2, 0, LEAF_T, h / 2, w / 2, Math.PI / 2, c);
  // Two raised panels a side, the handles at the free edge.
  const pc: C3 = [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92];
  for (const sz of [1, -1]) {
    for (const [y0, y1] of [[0.18, 0.92], [1.08, h - 0.18]]) g.box(0.01 + w / 2, (y0 + y1) / 2, sz * (LEAF_T + 0.006), 0.006, (y1 - y0) / 2, w / 2 - 0.12, Math.PI / 2, pc);
    g.free().box(w - 0.08, 1.0, sz * (LEAF_T + 0.045), 0.012, 0.012, 0.065, Math.PI / 2, [0.75, 0.72, 0.62]);
    g.box(w - 0.08, 1.0, sz * (LEAF_T + 0.02), 0.025, 0.04, 0.025, 0, [0.75, 0.72, 0.62]);
    g.on(wood ? InteriorMat.Wood : InteriorMat.Paint);
  }
  g.free();
}
