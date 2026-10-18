/**
 * Ways through a storey (Arnd: "I started in a house that I can not leave"): every room is reached from where
 * one comes in (the street door on the ground floor, the stairs above) and the stairs up are reached too. The
 * splitter (fill/split) cuts a storey into rooms and puts in doors between them, but a cut can leave a room, a
 * whole home or the stair hall with no way in, and furniture can stand in a doorway. So once the rooms are cut
 * (`connectRooms`, on the plan: rooms meet without a wall or through a doorway) and again once they are furnished
 * (`walkWays`, where a body fits: src/interior/reach.ts FloorGrid), a room cut off gets a doorway in a wall it
 * shares with a room one gets to, and a doorway something stands in is cleared.
 *
 * One walks through the common rooms (stair hall, landing corridor, a workplace) and the home one comes in by,
 * never through someone else's home: no doorway is put between two homes, or into the homes' own hall over a shop.
 *
 * New in SimWorld.
 */
import { distPointPolyEdge, distSqPointSeg, pointInPoly, polyArea, polyBounds, type Poly } from '../geom/geom2';
import { FLAT, innerBoxes } from './indoors';
import { FloorGrid, ROOM_CELLS, SPOT_REACH } from './reach';
import { spotsOfPiece } from './spots';
import { footprint, overlap } from './fill/place';
import type { FloorPlan, Furn, IWall, Room, RoomType, Spot } from './types';

/** A doorway's width (narrower where the wall is short, down to NARROW); how far from a wall's end one is put; how deep a room must be either side of it (m). */
const DOOR_W = 0.9, NARROW = 0.75, CORNER = 0.2, DEEP = 0.8;
/** Rooms one passes through: a doorway out of a room cut off goes into one of these first. */
const PASSAGE = new Set<RoomType>(['hall', 'corridor', 'stairs', 'lobby']);
/** Rounds of doorways per storey at most. */
const ROUNDS = 12;
/** Doorways tried per round. */
const TRIES = 6;
/** Pieces taken away per storey at most to free the beds, seats and desks walled in. */
const POCKETS = 16;

/** Rooms (and the stairs up) a storey's ways could not reach, by plan (none: all reached): a floor plan to cut again. */
export const stillCut = new WeakMap<FloorPlan, number>();

/** The rooms (indices) containing (x, z). */
export function roomsAt(rooms: readonly Room[], x: number, z: number): number[] {
  return rooms.flatMap((q, k) => (pointInPoly(q.poly, x, z) ? [k] : []));
}

/** Where one comes in to a storey: rooms (`rooms`, plan.rooms indices) and points (x, z). */
export interface Arrival { rooms: number[]; at: [number, number][] }

/**
 * A door between rooms `a` and `b` would not cross a home one does not live in: never between two homes, never
 * into the homes' hall over a shop (`closed`).
 */
function allowed(rooms: readonly Room[], a: number, b: number, closed: number): boolean {
  if (a === closed || b === closed) return false;
  const ua = rooms[a].unit, ub = rooms[b].unit;
  return ua < 0 || ub < 0 || ua === ub;
}

/**
 * The best new doorway: a stretch of an inner wall with a room one gets to on one side (`side` 1) and one cut
 * off on the other (0), the same rooms all along it and deep enough for a body both sides (`side` -1: not here).
 * Into a hall or the stairs first, then into a common room, then the longest stretch.
 */
function doorways(plan: FloorPlan, side: (x: number, z: number) => [room: number, state: number], ok: (reached: number, cut: number) => boolean, gain: (x: number, z: number) => number = () => 1, deep = DEEP, roomHere = (x: number, z: number) => roomsAt(plan.rooms, x, z)[0] ?? -1): Doorway[] {
  const rooms = plan.rooms, out: (Doorway & { score: number })[] = [];
  for (const w of plan.walls) {
    if (w.solid) continue;
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (L < NARROW + CORNER) continue;
    const ux = (w.bx - w.ax) / L, uz = (w.bz - w.az) / L;
    let run: { a: number; sa: number; b: number; sb: number; a0: number; b0: number; s0: number } | null = null;
    const close = (s1: number) => {
      if (!run) return;
      const { a, sa, b, sb, a0, b0, s0 } = run;
      run = null;
      if (a < 0 || b < 0 || sa < 0 || sb < 0 || sa === sb) return;
      const [r, c] = sa ? [a, b] : [b, a];
      if (!ok(r, c)) return;
      // (Closer to the ends on a short stretch, down to half the corner.)
      const len = s1 - s0 - 2 * Math.max(CORNER / 2, Math.min(CORNER, (s1 - s0 - NARROW) / 2));
      if (len < NARROW) return;
      const dw = Math.min(DOOR_W, len), mid = (s0 + s1) / 2, t0 = (mid - dw / 2) / L, t1 = (mid + dw / 2) / L;
      if (w.doors.some(([p, q]) => q > t0 - 0.3 / L && p < t1 + 0.3 / L)) return;
      // Right by the wall another room than a body's depth into it: a strip too narrow to stand in, walled off
      // from the room behind; the doorway goes through that wall too, or not at all.
      const also: Also[] = [];
      for (const [near, far, k] of [[a0, a, 1], [b0, b, -1]] as const) {
        if (near === far) continue;
        if (near >= 0 && (!ok(r, near) || !ok(near, c))) return;
        const behind = wallBehind(plan, w, mid, dw, deep * k);
        if (!behind) return;
        also.push(behind);
      }
      // What a doorway here gets one to (on the side cut off).
      const k = sa ? 1 : -1, g = gain(w.ax + ux * mid + uz * deep * k, w.az + uz * mid - ux * deep * k);
      if (g <= 0) return;
      const score = g + (PASSAGE.has(rooms[r].type) ? 100 : 0) + (rooms[c].unit < 0 ? 50 : 0) + len - also.length * 20;
      out.push({ w, t0, t1, a: r, b: c, also, score });
    };
    for (let s = 0.05; s < L; s += 0.1) {
      const x = w.ax + ux * s, z = w.az + uz * s;
      const [a, sa] = side(x - uz * deep, z + ux * deep), [b, sb] = side(x + uz * deep, z - ux * deep);
      // The room right by the wall, and a body's depth into it.
      const a0 = roomHere(x - uz * 0.15, z + ux * 0.15), b0 = roomHere(x + uz * 0.15, z - ux * 0.15);
      if (!run || run.a !== a || run.b !== b || run.sa !== sa || run.sb !== sb || run.a0 !== a0 || run.b0 !== b0) { close(s); run = { a, sa, b, sb, a0, b0, s0: s }; }
    }
    close(L);
  }
  return out.sort((p, q) => q.score - p.score);
}

/** Has room `k` an inner wall to another room that could take a doorway? */
function doorable(plan: FloorPlan, k: number): boolean {
  return plan.walls.some((w) => {
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (w.solid || L < NARROW + CORNER) return false;
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2, nx = -(w.bz - w.az) / L, nz = (w.bx - w.ax) / L;
    const a = roomsAt(plan.rooms, mx + nx * 0.15, mz + nz * 0.15)[0] ?? -1, b = roomsAt(plan.rooms, mx - nx * 0.15, mz - nz * 0.15)[0] ?? -1;
    return a >= 0 && b >= 0 && a !== b && (a === k || b === k);
  });
}

/** A doorway to put in: wall w from t0 to t1, between room `a` (one gets to) and `b` (cut off), and the same opening in the walls `also` just behind it. */
interface Doorway { w: IWall; t0: number; t1: number; a: number; b: number; also: Also[] }
/** The opening [t0, t1] of a wall a doorway passes through as well. */
interface Also { w: IWall; t0: number; t1: number }

/** Put doorway d in (its walls' doorways as they were, to put back). */
function addDoor(d: Doorway): [IWall, [number, number][]][] {
  const was: [IWall, [number, number][]][] = [];
  for (const { w, t0, t1 } of [d, ...d.also]) {
    was.push([w, w.doors]);
    w.doors = [...w.doors, [t0, t1] as [number, number]].sort((p, q) => p[0] - q[0]);
  }
  return was;
}

/**
 * The inner wall parallel to w, `off` from it (signed: + to w's left), behind a doorway of width dw at `mid`
 * along it: and where on that wall the doorway falls. Null if none, or if the opening would not fit on it.
 */
function wallBehind(plan: FloorPlan, w: IWall, mid: number, dw: number, off: number): Also | null {
  const L = Math.hypot(w.bx - w.ax, w.bz - w.az), ux = (w.bx - w.ax) / L, uz = (w.bz - w.az) / L;
  const mx = w.ax + ux * mid, mz = w.az + uz * mid, nx = -uz * Math.sign(off), nz = ux * Math.sign(off);
  let best: Also | null = null, bd = Infinity;
  for (const q of plan.walls) {
    if (q === w) continue;
    const QL = Math.hypot(q.bx - q.ax, q.bz - q.az);
    if (QL < 0.3) continue;
    const qx = (q.bx - q.ax) / QL, qz = (q.bz - q.az) / QL;
    if (Math.abs(qx * ux + qz * uz) < 0.97) continue;
    // How far behind (along the normal), and where the doorway's ends fall on it.
    const d = (q.ax - mx) * nx + (q.az - mz) * nz + ((mx - q.ax) * qx + (mz - q.az) * qz) * (qx * nx + qz * nz);
    if (d < 0.05 || d > Math.abs(off) || d >= bd) continue;
    const s = (x: number, z: number) => (x - q.ax) * qx + (z - q.az) * qz;
    const e0 = s(mx - ux * dw / 2, mz - uz * dw / 2), e1 = s(mx + ux * dw / 2, mz + uz * dw / 2), s0 = Math.min(e0, e1), s1 = Math.max(e0, e1);
    if (s0 < 0.05 || s1 > QL - 0.05) continue;
    if (q.solid) return null;
    if (q.doors.some(([p, r]) => r * QL > s0 - 0.3 && p * QL < s1 + 0.3)) continue;
    best = { w: q, t0: s0 / QL, t1: s1 / QL }; bd = d;
  }
  return best;
}

/**
 * Doors until every room of `plan` is reached from where one comes in (`from`), on the plan: rooms join where
 * they meet without a wall, or through a doorway. One walks on through the common rooms and the home one comes
 * in by; someone else's home is entered, not crossed. `closed`: the homes' hall over a shop (-1 none).
 */
export function connectRooms(plan: FloorPlan, from: readonly number[], closed: number): void {
  const rooms = plan.rooms, n = rooms.length;
  if (!from.length || n < 2) return;
  const inRoom = (x: number, z: number, not: number) => rooms.findIndex((q, k) => k !== not && pointInPoly(q.poly, x, z));
  // (The rooms stay as they are: where each point is, kept to the centimetre, as each round asks the same again.)
  const where = new Map<number, number>();
  const roomHere = (x: number, z: number) => {
    const key = Math.round(x * 100) * 1e7 + Math.round(z * 100);
    let k = where.get(key);
    if (k === undefined) where.set(key, (k = inRoom(x, z, -1)));
    return k;
  };
  // Is (x, z) on a wall, outside its doorways?
  const walled = (x: number, z: number) => plan.walls.some((w) => {
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (L < 1e-3 || distSqPointSeg(x, z, w.ax, w.az, w.bx, w.bz) > 0.12 * 0.12) return false;
    const t = ((x - w.ax) * (w.bx - w.ax) + (z - w.az) * (w.bz - w.az)) / (L * L);
    return !w.doors.some(([a, b]) => t > a && t < b);
  });
  // Walk each room's outline: where the room beside it is open to it, the two are linked.
  const open = new Set<number>();
  const link = (i: number, j: number) => open.add(Math.min(i, j) * n + Math.max(i, j));
  const linked = (i: number, j: number) => open.has(Math.min(i, j) * n + Math.max(i, j));
  rooms.forEach((q, i) => {
    const P = q.poly, m = P.length >> 1, sg = polyArea(P) > 0 ? 1 : -1;
    for (let e = 0; e < m; e++) {
      const ax = P[e * 2], az = P[e * 2 + 1], bx = P[((e + 1) % m) * 2], bz = P[((e + 1) % m) * 2 + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const ox = ((bz - az) / L) * sg, oz = (-(bx - ax) / L) * sg;
      for (let s = 0.15; s < L - 0.1; s += 0.25) {
        const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L;
        const j = [inRoom(x + ox * 0.15, z + oz * 0.15, i), inRoom(x - ox * 0.15, z - oz * 0.15, i)].find((k) => k >= 0) ?? -1;
        if (j >= 0 && !walled(x, z)) link(i, j);
      }
    }
  });
  // Through the common rooms and the home one comes in by; into other homes but not on out of them.
  const entered = new Set(from.map((k) => rooms[k].unit).filter((u) => u >= 0));
  const passes = (k: number) => rooms[k].unit < 0 || entered.has(rooms[k].unit);
  const spread = (): boolean[] => {
    const got = rooms.map((_, k) => from.includes(k)), todo = [...from];
    while (todo.length) {
      const k = todo.pop()!;
      for (let j = 0; j < n; j++) {
        if (got[j] || !linked(j, k) || !allowed(rooms, j, k, -1)) continue;
        if (!passes(k) && rooms[j].unit !== rooms[k].unit) continue;
        got[j] = true;
        todo.push(j);
      }
    }
    return got;
  };
  for (let round = 0; round < n; round++) {
    const got = spread();
    if (got.every(Boolean)) return;
    const side = (x: number, z: number): [number, number] => { const k = roomHere(x, z); return [k, k < 0 ? -1 : got[k] ? 1 : 0]; };
    const d = doorways(plan, side, (r, c) => allowed(rooms, r, c, closed) && (passes(r) || rooms[r].unit === rooms[c].unit), undefined, DEEP, roomHere)[0];
    if (!d) return;
    addDoor(d);
    link(d.a, d.b);
  }
}

/**
 * Once the storey is furnished: where a body fits from where one comes in (`from`: its rooms and points; `hole`
 * the stairwell of the flights from below, `up` the foot of the stairs up), doorways cleared of what stands in
 * them and put in where a room or the stairs up are still cut off. `poly` the storey outline; `closed` as above.
 */
export function walkWays(plan: FloorPlan, poly: Poly, from: Arrival, hole: Poly | null, up: [number, number] | null, closed: number): void {
  stillCut.delete(plan);
  const rooms = plan.rooms;
  // What does not change here: the floor within the outer walls (their inside face on the outline) less the
  // flights up, which stand on it (one walks onto them at their foot only); which room each cell is in.
  const base = new FloorGrid(plan.y, poly, hole ? [hole] : []);
  for (let i = 0, n = poly.length >> 1; i < n; i++) {
    const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[((i + 1) % n) * 2], bz = poly[((i + 1) % n) * 2 + 1];
    base.block({ x: (ax + bx) / 2, y: plan.y + 1, z: (az + bz) / 2, hx: 0.01, hy: 1, hz: Math.hypot(bx - ax, bz - az) / 2, yaw: Math.atan2(bx - ax, bz - az) });
  }
  for (const fl of plan.flights) base.block({ x: fl.x + fl.dx * fl.run / 2, y: plan.y + 1, z: fl.z + fl.dz * fl.run / 2, hx: fl.width / 2, hy: 1, hz: fl.run / 2, yaw: Math.atan2(fl.dx, fl.dz) });
  const roomOf = new Int16Array(base.free.length).fill(-1);
  rooms.forEach((q, k) => {
    // (Each room over its own bounds only.)
    const [x0, z0, x1, z1] = polyBounds(q.poly), i0 = base.cell(x0, z0), i1 = base.cell(x1, z1);
    const a = Math.max(0, i0 < 0 ? 0 : i0 % base.nx), b = i1 < 0 ? base.nx - 1 : i1 % base.nx, c0 = i0 < 0 ? 0 : (i0 / base.nx) | 0, c1 = i1 < 0 ? base.nz - 1 : (i1 / base.nx) | 0;
    for (let kz = c0; kz <= c1; kz++) for (let ix = a; ix <= b; ix++) { const c = kz * base.nx + ix; if (roomOf[c] < 0 && pointInPoly(q.poly, base.cx(ix), base.cz(kz))) roomOf[c] = k; }
  });
  const roomHere = (x: number, z: number) => { const c = base.cell(x, z); return c < 0 ? -1 : roomOf[c]; };
  const fromRooms = new Set(from.rooms);
  // Where a body fits now and where one gets to (bare: the walls only, as if the furniture were not there).
  // (The last one again while nothing changed: the walls, their doorways and the furniture are the same.)
  let last: { furniture: Furn[]; walls: IWall[]; doors: unknown[]; g: FloorGrid; got: Uint8Array } | null = null;
  const grid = (bare = false) => {
    if (!bare && last && last.furniture === plan.furniture && last.walls === plan.walls && last.doors.every((d, i) => d === plan.walls[i].doors)) return last;
    const g = base.copy();
    for (const b of innerBoxes(bare ? { ...plan, furniture: [] } : plan, 0)) g.block(b);
    const seeds = from.at.map(([x, z]) => g.near(x, z, 0.6));
    if (fromRooms.size) for (let c = 0; c < g.free.length; c++) if (g.free[c] && fromRooms.has(roomOf[c])) seeds.push(c);
    const got = g.flood(seeds);
    if (!bare) last = { furniture: plan.furniture, walls: plan.walls, doors: plan.walls.map((w) => w.doors), g, got };
    return { g, got };
  };
  for (let round = 0; round < ROUNDS; round++) {
    const { g, got } = grid();
    if (!got.some(Boolean)) return;
    // Rooms with room for a body but none of it reached; the foot of the stairs up.
    const fits = new Array<number>(rooms.length).fill(0), reached = new Array<boolean>(rooms.length).fill(false);
    for (let c = 0; c < g.free.length; c++) {
      const k = roomOf[c];
      if (!g.free[c] || k < 0) continue;
      fits[k]++;
      if (got[c]) reached[k] = true;
    }
    const cut = rooms.map((_, k) => fits[k] >= ROOM_CELLS && !reached[k]);
    const foot = up ? g.near(up[0], up[1], 0.5) : -1;
    const upCut = foot >= 0 && !got[foot];
    // A scrap walled in by the stairs or the lift, with no wall a doorway could go in, is sealed: no way in.
    cut.forEach((c, k) => { if (c && !doorable(plan, k)) { rooms[k].sealed = true; cut[k] = false; } });
    const left = cut.filter(Boolean).length + (upCut ? 1 : 0);
    if (!left) break;
    stillCut.set(plan, left);
    // Each side of a wall: its room, and whether one gets there. What getting through gains: the stairs up, a room cut off.
    // (Reached: somewhere reached close by; the spot itself may be under a table.)
    const stateIn = (G: FloorGrid, ok: Uint8Array) => (x: number, z: number): [number, number] => {
      const k = roomHere(x, z);
      return [k, k < 0 ? -1 : G.nearWhere(x, z, 0.6, (c) => ok[c] === 1) >= 0 ? 1 : 0];
    };
    const state = stateIn(g, got);
    // What getting through gains: places from which one gets to a room cut off or to the stairs up (a room
    // counts as one place where its own floor is blocked: what stands in a doorway may be what splits it).
    const targets: number[] = upCut ? [foot] : [];
    for (let c = 0; c < g.free.length; c++) if (g.free[c] && !got[c] && roomOf[c] >= 0 && cut[roomOf[c]]) targets.push(c);
    const toCut = g.flood(targets), byCut = rooms.map(() => false);
    for (let c = 0; c < g.free.length; c++) if (toCut[c] && roomOf[c] >= 0) byCut[roomOf[c]] = true;
    const gain = (x: number, z: number) => {
      const c = g.near(x, z, 0.5), k = roomHere(x, z);
      return c >= 0 && toCut[c] ? 300 : k >= 0 && byCut[k] ? 200 : 0;
    };
    if (clearDoorway(plan, state, gain, closed)) { stillCut.delete(plan); continue; }
    // A doorway that gets one somewhere new (tried in turn, the best first; a shallower room next to the wall next).
    const gains = (t: { got: Uint8Array }) => { for (let c = 0; c < t.got.length; c++) if (t.got[c] && toCut[c]) return true; return false; };
    let opened = false;
    // Last, where one would get to but for the furniture (what stands in front of the new doorway goes with it).
    const bare = grid(true);
    for (const [st, deep] of [[state, DEEP], [state, DEEP / 2], [stateIn(bare.g, bare.got), DEEP]] as const) {
      for (const d of doorways(plan, st, (r, c) => allowed(rooms, r, c, closed), gain, deep, roomHere).slice(0, TRIES)) {
        const furniture = plan.furniture, was = addDoor(d);
        for (const q of [d, ...d.also]) clearAround(plan, q.w, q.t0, q.t1);
        if (gains(grid())) { opened = true; break; }
        for (const [q, doors] of was) q.doors = doors;
        plan.furniture = furniture;
      }
      if (opened) break;
    }
    if (opened) { stillCut.delete(plan); continue; }
    // No doorway fits (a scrap of floor behind the stairs): a wall of a room cut off comes down, if that opens it.
    const walls = plan.walls;
    for (const w of walls) {
      if (w.solid) continue;
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az), mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2, nx = -(w.bz - w.az) / L, nz = (w.bx - w.ax) / L;
      const a = roomsAt(rooms, mx + nx * 0.15, mz + nz * 0.15)[0] ?? -1, b = roomsAt(rooms, mx - nx * 0.15, mz - nz * 0.15)[0] ?? -1;
      if (a < 0 || b < 0 || a === b || !(cut[a] || cut[b]) || !allowed(rooms, a, b, closed)) continue;
      plan.walls = walls.filter((q) => q !== w);
      if (gains(grid())) { opened = true; break; }
      plan.walls = walls;
    }
    if (opened) { stillCut.delete(plan); continue; }
    // No doorway does it: what stands in the way inside a room goes (a bed across a box room on the way to its
    // bathroom), the smallest piece near what is cut off that opens a way.
    const byWhatIsCut = (f: Furn) => rooms.some((q, k) => byCut[k] && (pointInPoly(q.poly, f.x, f.z) || distPointPolyEdge(q.poly, f.x, f.z) < 3));
    const all = plan.furniture, by = all.filter((f) => f.h >= 0.05 && !FLAT.has(f.kind) && (upCut || byWhatIsCut(f))).sort((p, q) => p.w * p.d - q.w * q.d);
    let freed = false;
    for (const f of by) {
      plan.furniture = all.filter((q) => q !== f);
      if (gains(grid())) { freed = true; break; }
    }
    if (freed) stillCut.delete(plan);
    if (!freed) { plan.furniture = all; break; }
  }
  // Every bed, seat and desk with somewhere one gets to beside it, to get up from it and go: a piece walling one
  // in (an armchair across the end of a sofa) goes; if none does it, the piece itself.
  for (let round = 0; round < POCKETS; round++) {
    const { g, got } = grid();
    if (!got.some(Boolean)) return;
    const getsUp = (gg: FloorGrid, ok: Uint8Array, s: Spot) => gg.nearWhere(s.x, s.z, SPOT_REACH, (c) => ok[c] === 1) >= 0;
    let stuck: { f: Furn; s: Spot } | null = null;
    for (const f of plan.furniture) {
      const sp: Spot[] = [];
      spotsOfPiece(f, plan.floor, sp);
      const s = sp.find((q) => !getsUp(g, got, q));
      if (s) { stuck = { f, s }; break; }
    }
    if (!stuck) return;
    const { f, s } = stuck, all = plan.furniture;
    const by = all.filter((o) => o !== f && o.h >= 0.05 && !FLAT.has(o.kind) && Math.hypot(o.x - s.x, o.z - s.z) < 2.5).sort((p, q) => p.w * p.d - q.w * q.d);
    let freed = false;
    for (const o of by) {
      plan.furniture = all.filter((q) => q !== o);
      const t = grid();
      if (getsUp(t.g, t.got, s)) { freed = true; break; }
    }
    if (!freed) plan.furniture = all.filter((q) => q !== f);
  }
}

/** An existing doorway one gets to from one side with something to gain on the other, cleared of what stands in it. Whether anything went. */
function clearDoorway(plan: FloorPlan, state: (x: number, z: number) => [number, number], gain: (x: number, z: number) => number, closed: number): boolean {
  for (const w of plan.walls) {
    if (w.solid) continue;
    const L = Math.hypot(w.bx - w.ax, w.bz - w.az);
    if (L < 0.3) continue;
    const ux = (w.bx - w.ax) / L, uz = (w.bz - w.az) / L;
    for (const [t0, t1] of w.doors) {
      const s = ((t0 + t1) / 2) * L, x = w.ax + ux * s, z = w.az + uz * s;
      const pa: [number, number] = [x - uz * 0.5, z + ux * 0.5], pb: [number, number] = [x + uz * 0.5, z - ux * 0.5];
      const [a, sa] = state(...pa), [b, sb] = state(...pb);
      if (a < 0 || b < 0 || sa === sb || !allowed(plan.rooms, a, b, closed)) continue;
      if (gain(...(sa ? pb : pa)) > 0 && clearAround(plan, w, t0, t1)) return true;
    }
  }
  return false;
}

/** Take away the furniture standing in doorway [t0, t1] of wall w or just in front of it either side. Whether any went. */
function clearAround(plan: FloorPlan, w: IWall, t0: number, t1: number): boolean {
  const L = Math.hypot(w.bx - w.ax, w.bz - w.az), ux = (w.bx - w.ax) / L, uz = (w.bz - w.az) / L;
  const s0 = t0 * L - 0.15, s1 = t1 * L + 0.15, before = plan.furniture.length;
  // The doorway's box: along the wall over the opening (and a little), 1 m deep each side.
  const box = footprint(w.ax + ux * (s0 + s1) / 2, w.az + uz * (s0 + s1) / 2, Math.atan2(-uz, ux), s1 - s0, -1, 1);
  plan.furniture = plan.furniture.filter((f) => f.h < 0.05 || FLAT.has(f.kind) || !overlap(box, footprint(f.x, f.z, f.yaw, f.w, -f.d / 2, f.d / 2)));
  return plan.furniture.length < before;
}
