/**
 * Can you get out? Where a person fits on a floor of a building (a grid of places clear of the walls and the
 * furniture by a body's radius), and which parts of a walk-in building (src/interior/indoors.ts) cannot be
 * reached from the street: a street door blocked inside, a bed, seat or desk walled in, a room with no way in.
 * The stairs join the floors. Pure; the floor plans use the grid to put in the doorways a room lacks
 * (src/interior/ways.ts), the tests check every building of a town with `cutOff`.
 *
 * New in SimWorld.
 */
import { pointInPoly, polyBounds, type Poly } from '../geom/geom2';
import type { Box, Indoors } from './indoors';
import type { Interior } from './building';

/** Grid step (m); a body's radius (src/game/avatar.ts) and the heights it meets things at above its floor. */
const STEP = 0.15, BODY_R = 0.28, KNEE = 0.33, HEAD = 1.76;
/** The ground around a building counted as the street (m). */
const MARGIN = 1.5;
/** Fewer free cells than this: not a room anyone stands in (a sliver of floor). */
export const ROOM_CELLS = 4;
/** A bed, seat or desk is reached when somewhere one gets to is this close to it (m): as far as one gets up from it (src/game/playing.ts standUp). */
export const SPOT_REACH = 1.8;

/** One floor as a grid: which cells a body fits in (standing on the floor at height `y`). */
export class FloorGrid {
  readonly x0: number; readonly z0: number; readonly nx: number; readonly nz: number;
  readonly free: Uint8Array;

  /** Over `poly` grown by `margin`: cells in `poly` are floor unless in `holes`; outside it only if `outside`. */
  constructor(readonly y: number, poly: Poly, holes: readonly Poly[] = [], margin = 0, outside = false) {
    const [bx0, bz0, bx1, bz1] = polyBounds(poly);
    this.x0 = bx0 - margin; this.z0 = bz0 - margin;
    this.nx = Math.max(1, Math.ceil((bx1 - bx0 + 2 * margin) / STEP)); this.nz = Math.max(1, Math.ceil((bz1 - bz0 + 2 * margin) / STEP));
    this.free = new Uint8Array(this.nx * this.nz);
    for (let k = 0; k < this.nz; k++) for (let i = 0; i < this.nx; i++) {
      const x = this.cx(i), z = this.cz(k);
      this.free[k * this.nx + i] = (pointInPoly(poly, x, z) ? !holes.some((h) => pointInPoly(h, x, z)) : outside) ? 1 : 0;
    }
  }

  /** The same grid, to block more in. */
  copy(): FloorGrid {
    const g: FloorGrid = Object.create(FloorGrid.prototype);
    Object.assign(g, { y: this.y, x0: this.x0, z0: this.z0, nx: this.nx, nz: this.nz, free: this.free.slice() });
    return g;
  }

  cx(i: number): number { return this.x0 + (i + 0.5) * STEP; }
  cz(k: number): number { return this.z0 + (k + 0.5) * STEP; }

  /** The cell at (x, z), -1 off the grid. */
  cell(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / STEP), k = Math.floor((z - this.z0) / STEP);
    return i < 0 || k < 0 || i >= this.nx || k >= this.nz ? -1 : k * this.nx + i;
  }

  /** Is (x, z) a place a body fits? */
  fits(x: number, z: number): boolean {
    const c = this.cell(x, z);
    return c >= 0 && this.free[c] === 1;
  }

  /** Box `b` (src/interior/indoors.ts: z along (sin yaw, cos yaw)) takes the cells a body cannot stand in, if it is at body height. */
  block(b: Box): void {
    if (b.y + b.hy < this.y + KNEE || b.y - b.hy > this.y + HEAD) return;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), ex = Math.abs(c) * b.hx + Math.abs(s) * b.hz + BODY_R, ez = Math.abs(s) * b.hx + Math.abs(c) * b.hz + BODY_R;
    const i0 = Math.max(0, Math.floor((b.x - ex - this.x0) / STEP)), i1 = Math.min(this.nx - 1, Math.ceil((b.x + ex - this.x0) / STEP));
    const k0 = Math.max(0, Math.floor((b.z - ez - this.z0) / STEP)), k1 = Math.min(this.nz - 1, Math.ceil((b.z + ez - this.z0) / STEP));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const dx = this.cx(i) - b.x, dz = this.cz(k) - b.z;
      const ox = Math.max(0, Math.abs(dx * c - dz * s) - b.hx), oz = Math.max(0, Math.abs(dx * s + dz * c) - b.hz);
      if (ox * ox + oz * oz < BODY_R * BODY_R) this.free[k * this.nx + i] = 0;
    }
  }

  /** The nearest free cell to (x, z) within `r`, -1 if none. */
  near(x: number, z: number, r: number): number {
    return this.nearWhere(x, z, r, () => true);
  }

  /** The nearest free cell to (x, z) within `r` that `ok` accepts, -1 if none. */
  nearWhere(x: number, z: number, r: number, ok: (c: number) => boolean): number {
    let best = -1, bd = Infinity;
    const n = Math.ceil(r / STEP), i0 = Math.floor((x - this.x0) / STEP), k0 = Math.floor((z - this.z0) / STEP);
    for (let k = k0 - n; k <= k0 + n; k++) for (let i = i0 - n; i <= i0 + n; i++) {
      const c = k * this.nx + i;
      if (i < 0 || k < 0 || i >= this.nx || k >= this.nz || !this.free[c] || !ok(c)) continue;
      const d = Math.hypot(this.cx(i) - x, this.cz(k) - z);
      if (d <= r && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Every free cell one walks to from cells `from` (1: reached). */
  flood(from: readonly number[]): Uint8Array {
    const got = new Uint8Array(this.free.length), todo: number[] = [];
    for (const c of from) if (c >= 0 && this.free[c] && !got[c]) { got[c] = 1; todo.push(c); }
    while (todo.length) {
      const c = todo.pop()!, i = c % this.nx;
      for (const d of [i > 0 ? c - 1 : -1, i + 1 < this.nx ? c + 1 : -1, c - this.nx, c + this.nx]) {
        if (d >= 0 && d < this.free.length && this.free[d] && !got[d]) { got[d] = 1; todo.push(d); }
      }
    }
    return got;
  }
}

/** What cannot be reached from the street: street doors (index in `Indoors.doors`), spots (in `Indoors.spots`), rooms ([floor, index]). */
export interface CutOff { doors: number[]; spots: number[]; rooms: [number, number][] }

/** The floors of a walk-in building as grids, and whether a place on one is joined to the street. */
export interface Reach {
  grids: FloorGrid[];
  /** Is (x, z) on floor `floor` a free place joined to the street? */
  out(floor: number, x: number, z: number): boolean;
}

/** The grids of `ind`, joined by its stairs, and which of their places join the street. */
export function reachOf(ind: Indoors): Reach {
  const outline = ind.slabs.find((s) => s.floor === 0)?.outer ?? [];
  const grids = ind.storeys.map((st, f) => {
    const slab = ind.slabs.find((s) => s.floor === f);
    // The ground floor and the street round the building; above, the floor slab without its stairwell.
    const g = new FloorGrid(st.y, outline, f === 0 ? [] : slab?.holes ?? [], MARGIN, f === 0);
    if (f > 0 && slab) for (let c = 0; c < g.free.length; c++) if (g.free[c] && !pointInPoly(slab.outer, g.cx(c % g.nx), g.cz((c / g.nx) | 0))) g.free[c] = 0;
    for (const b of ind.colliders) g.block(b);
    return g;
  });
  const per = grids[0]?.free.length ?? 0;
  // Union-find over every cell of every floor (the grids are the same size), the street, and the stair landings.
  const parent: number[] = Array.from({ length: per * grids.length }, (_, k) => k);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  grids.forEach((g, f) => {
    for (let c = 0; c < per; c++) {
      if (!g.free[c]) continue;
      if ((c % g.nx) + 1 < g.nx && g.free[c + 1]) join(f * per + c, f * per + c + 1);
      if (c + g.nx < per && g.free[c + g.nx]) join(f * per + c, f * per + c + g.nx);
    }
  });
  const STREET = parent.length;
  parent.push(STREET);
  const g0 = grids[0];
  if (g0) for (let c = 0; c < per; c++) if (g0.free[c] && !pointInPoly(outline, g0.cx(c % g0.nx), g0.cz((c / g0.nx) | 0))) join(c, STREET);
  // Each flight joins the place below its foot to the place past its top, on a floor or on a landing (flight ends
  // at the same height close together).
  const ends: { x: number; y: number; z: number; node: number }[] = [];
  const endNode = (x: number, y: number, z: number): number => {
    const f = ind.storeys.findIndex((s) => Math.abs(s.y - y) < 0.12);
    if (f >= 0) { const c = grids[f].near(x, z, 0.6); return c < 0 ? -1 : f * per + c; }
    const e = ends.find((q) => Math.abs(q.y - y) < 0.12 && Math.hypot(q.x - x, q.z - z) < 3.5);
    if (e) return e.node;
    const node = parent.length;
    parent.push(node);
    ends.push({ x, y, z, node });
    return node;
  };
  for (const r of ind.ramps) {
    const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0) || 1, ux = (r.x1 - r.x0) / L, uz = (r.z1 - r.z0) / L;
    const a = endNode(r.x0 - ux * 0.5, r.y0, r.z0 - uz * 0.5), b = endNode(r.x1 + ux * 0.5, r.y1, r.z1 + uz * 0.5);
    if (a >= 0 && b >= 0) join(a, b);
  }
  return {
    grids,
    out: (floor, x, z) => {
      const g = grids[floor], c = g ? g.cell(x, z) : -1;
      return c >= 0 && g.free[c] === 1 && find(floor * per + c) === find(STREET);
    },
  };
}

/** What in `ind` (interior `I`'s walk-in building) cannot be reached from the street. */
export function cutOff(ind: Indoors, I: Interior): CutOff {
  const R = reachOf(ind), out: CutOff = { doors: [], spots: [], rooms: [] };
  // Somewhere free and joined to the street within r of (x, z) on floor f.
  const reached = (f: number, x: number, z: number, r: number) => {
    const g = R.grids[f];
    return !!g && g.nearWhere(x, z, r, (c) => R.out(f, g.cx(c % g.nx), g.cz((c / g.nx) | 0))) >= 0;
  };
  ind.doors.forEach((d, i) => { if (!reached(0, d.x - d.nx * 0.6, d.z - d.nz * 0.6, 0.45)) out.doors.push(i); });
  // A spot: from where the person gets up (src/game/playing.ts standUp).
  ind.spots.forEach((s, i) => { if (!reached(s.floor, s.x, s.z, SPOT_REACH)) out.spots.push(i); });
  I.storeys.forEach((s, f) => s.rooms.forEach((room, j) => {
    if (room.sealed) return;
    const [x0, z0, x1, z1] = polyBounds(room.poly);
    // (A sliver of floor nobody fits in is not a room to get to.)
    let fits = 0;
    for (let z = z0 + STEP / 2; z < z1; z += STEP) for (let x = x0 + STEP / 2; x < x1; x += STEP) {
      if (!pointInPoly(room.poly, x, z)) continue;
      if (R.out(f, x, z)) return;
      if (R.grids[f].fits(x, z)) fits++;
    }
    if (fits >= ROOM_CELLS) out.rooms.push([f, j]);
  }));
  return out;
}
