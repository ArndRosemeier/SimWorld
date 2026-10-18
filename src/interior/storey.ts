/**
 * One storey's interior: the stair hall and lift lobby the building's cores leave, then the
 * theme's program cuts the rest into rooms (fill/split), the doors are placed, the way in from the
 * street door is kept clear, every room is furnished (fill/place) and gets its ceiling lights.
 *
 * A storey of flats is cut twice: first into its homes along the stair hall or a landing
 * corridor (one door each), then each home into its rooms behind a small entrance hall.
 *
 * Ported from Scale (src/interior/InteriorGen.ts planFloor, clipWall, openWall, lookOf,
 * furnishRooms and the ceiling lights). Gone: the church, warehouse and arcade layouts (a town's
 * halls are themes on the splitter now, fill/work); new: flats, homes by storey part, rooms
 * that know which home they belong to.
 */
import type { Rng } from '@futuremagic/core';
import { polyArea, pointInPoly, polyCentroid, polyBounds, distSqPointSeg, distPointPolyEdge, type Poly } from '../geom/geom2';
import { intersection, largest } from '../geom/clip';
import type { BuildingDesc } from '../plan/building';
import { WALLS } from './fill/palette';
import { roomArea, type Area, type EdgeKind } from './fill/area';
import { Filler, type Item } from './fill/place';
import { splitStorey, type Program, type Space, type Split } from './fill/split';
import { flatsProgram, homeProgram, homeItems, lacksOf, type HomePart, type HomeRoom } from './fill/home';
import { coreRect, coreFits, liftRect, doorWay, stairHall, stairsOf, Frame, LANDING, type Door, type LiftShaft, type StairCore } from './cores';
import type { FloorPlan, Furn, IWall, Room, RoomType } from './types';
import { connectRooms, roomsAt, walkWays, type Arrival } from './ways';

/** What a storey is for. */
export type StoreyUse =
  /** One space divided by a theme: a workplace (`unit` -1) or one home's storey (`unit` its index). */
  | { kind: 'rooms'; program: Program; items: (type: RoomType, A: Area) => Item[]; unit: number; part?: HomePart }
  /** `count` flats, numbered from `first`. */
  | { kind: 'flats'; count: number; first: number }
  /** A car park deck: columns on a grid. */
  | { kind: 'parking' };

/**
 * The building's lift and stairs (planned once, src/interior/cores.ts planCores) and, for homes
 * over a shop, the ground floor's hall from their own street door to the stairs (`entry`, the
 * home `entryUnit` or -1 for all of them): walled off from the workplace, no door into it.
 */
export interface StoreyCores { lift: LiftShaft | null; stair: StairCore | null; entry?: Poly | null; entryUnit?: number; entryDoor?: Door | null }

/** Where one arrives from the storey below: the top of its stairs (x, z), and the stairwell they come up through. */
export interface StoreyBelow { at: [number, number][]; hole: number[] | null }
const NO_BELOW: StoreyBelow = { at: [], hole: null };

/**
 * `up`: stairs from this storey to the next (the core fits both); `below`: stairs arrive from the
 * storey below; `door`: the street door (ground floor only).
 */
export function planStorey(b: BuildingDesc, poly: Poly, floor: number, y: number, height: number, use: StoreyUse, cores: StoreyCores, up: boolean, below: boolean, door: Door | null, r: Rng, from: StoreyBelow = NO_BELOW): FloorPlan {
  const F = new Frame(poly);
  const plan: FloorPlan = { floor, y, height, poly, rooms: [], walls: [], furniture: [], flights: [], landings: [], stairHole: null, lights: [], fixtures: [] };
  const clipRoom = (rect: Poly): Poly | null => {
    const q = largest(intersection([rect], [poly]));
    return q && Math.abs(polyArea(q)) > 2 ? q : null;
  };
  const ground = floor === 0;
  let closed = false;
  // The stair hall belongs to the home in a house, to everyone in a block.
  const hallUnit = use.kind === 'rooms' && use.part ? use.unit : -1;
  // --- the lift: shaft walls, and the lobby in front of its doors.
  const lift = cores.lift && liftRect(cores.lift, 0.05).every((_, k, a) => k % 2 === 1 || pointInPoly(poly, a[k], a[k + 1])) ? cores.lift : null;
  if (lift) {
    const vx = -lift.uz, vz = lift.ux;
    const L = (u: number, v: number): [number, number] => [lift.cx + lift.ux * u + vx * v, lift.cz + lift.uz * u + vz * v];
    const wall = (a: [number, number], b2: [number, number], doors: [number, number][]) => plan.walls.push({ ax: a[0], az: a[1], bx: b2[0], bz: b2[1], doors, solid: true });
    const { hu: lu, hv: lv } = lift;
    wall(L(-lu, -lv), L(lu, -lv), []);
    wall(L(-lu, lv), L(lu, lv), []);
    wall(L(-lu, -lv), L(-lu, lv), []);
    const dw = 0.5 / (2 * lv);
    wall(L(lu, -lv), L(lu, lv), [[0.5 - dw, 0.5 + dw]]);
    const lob = Math.min(F.hv, 2.8), fr = lu + LANDING;
    const lobby = clipRoom([...L(-lu - 0.6, -lob), ...L(fr, -lob), ...L(fr, lob), ...L(-lu - 0.6, lob)]);
    if (lobby) plan.rooms.push({ type: 'hall', poly: lobby, floorMat: ground ? 'marble' : 'tile', wallColor: [0.86, 0.85, 0.82], unit: -1 });
  }
  // --- the stair hall: the core and a landing strip along its open side.
  const st = cores.stair && coreFits(cores.stair, poly) ? cores.stair : null;
  if (st) {
    // (On a small floor, a narrow town house, only the landing at the foot of the flights.) The
    // flats over a shop: their hall from their own street door instead, closed to the shop.
    const entry = ground && cores.entry ? cores.entry : null;
    const hq = entry ?? clipRoom(stairHall(st, poly));
    if (hq) plan.rooms.push({ type: 'stairs', poly: hq, floorMat: ground ? 'stone' : 'tile', wallColor: [0.88, 0.87, 0.83], unit: entry ? cores.entryUnit ?? -1 : hallUnit });
    closed = !!entry && !!hq;
    stairsOf(plan, st, y, height, up, below);
  }
  // The rooms one arrives in: the stair hall and the lift lobby (on the ground floor the street door's room instead).
  const hubs = plan.rooms.length;
  // The way in behind the street door.
  const way = door && doorWay(poly, door, 2.2, 0.75);
  const keepOut = [...(way ? [way] : []), ...(st ? [coreRect(st, 0, 0.1)] : []), ...(lift ? [liftRect(lift, 0.1), landingOf(lift)] : [])];
  const facade = facadeOf(b);
  const furnish: { room: Room; items: (type: RoomType, A: Area) => Item[] }[] = [];
  const solid = () => plan.walls.filter((w) => w.solid);
  const front = frontNormal(b);

  if (use.kind === 'parking') {
    plan.rooms.push({ type: 'parking', poly, floorMat: 'concrete', wallColor: [0.75, 0.75, 0.74], unit: -1 });
    for (let u = -F.hu + 3; u < F.hu - 2; u += 8) for (let v = -F.hv + 2; v < F.hv - 1; v += 8) {
      const p = F.P(u, v);
      plan.furniture.push({ kind: 'column', x: p[0], z: p[1], yaw: 0, w: 0.5, d: 0.5, h: height, color: [0.7, 0.7, 0.7] });
    }
  } else if (use.kind === 'rooms') {
    const kept = plan.rooms;
    const fixed = kept.map((q) => ({ type: q.type, poly: q.poly, hub: true, closed: closed && q.type === 'stairs' }));
    const S = splitStorey({ poly, fixed, front, solid: solid() }, use.program, r);
    plan.rooms = [];
    // A home without a bedroom or kitchen: the bed or the kitchenette in the living room.
    const lacks = use.part ? lacksOf(S.spaces.map((q) => q.type), use.part) : {};
    for (const [k, sp] of S.spaces.entries()) {
      // The fixed spaces come first, in order (the stair hall may have taken in a scrap of floor).
      if (k < kept.length) { plan.rooms.push({ ...kept[k], poly: sp.poly }); continue; }
      const room: Room = { type: sp.type, poly: sp.poly, ...lookOf(sp.type, ground, r), unit: use.unit };
      plan.rooms.push(room);
      furnish.push({ room, items: sp.type === 'living' && (lacks.bed || lacks.cook) ? (_t, A) => homeItems('living', A, r, lacks) : use.items });
    }
    plan.walls.push(...S.walls);
  } else {
    flats(plan, b, poly, use, ground, way, front, solid(), r, furnish);
  }
  // Interior walls only inside the real outline; furniture only where it fits the storey.
  plan.walls = plan.walls.flatMap((w) => clipWall(w, poly));
  const fits = fitsStorey(poly, st, lift);
  plan.furniture = plan.furniture.filter(fits);
  // A clear way in behind the street door: room walls across it get an opening.
  if (way) {
    for (const w of plan.walls) if (!w.solid) openWall(w, way);
    plan.walls = plan.walls.filter((w) => !(w.doors.length === 1 && w.doors[0][0] <= 0 && w.doors[0][1] >= 1));
  }
  // Every room reached: from the street door on the ground floor (the homes' own hall from theirs), from the stairs above.
  const closedHall = closed ? plan.rooms.findIndex((q) => q.type === 'stairs') : -1;
  // Just inside a street door: the way in's first metre.
  const inside = (q: Poly | null): [number, number][] => (q ? [[(q[4] + q[6]) / 2 * 0.4 + (q[0] + q[2]) / 2 * 0.6, (q[5] + q[7]) / 2 * 0.4 + (q[1] + q[3]) / 2 * 0.6]] : []);
  const homesWay = ground && closedHall >= 0 && cores.entryDoor ? doorWay(poly, cores.entryDoor, 2.2, 0.75) : null;
  const inner = [...inside(way), ...inside(homesWay)];
  const arrival: Arrival = ground
    ? { rooms: inner.length ? [] : closedHall >= 0 ? [closedHall] : [], at: inner }
    : { rooms: from.at.length ? [] : Array.from({ length: hubs }, (_, k) => k), at: from.at };
  const arriveRooms = [...arrival.rooms, ...arrival.at.flatMap(([x, z]) => roomsAt(plan.rooms, x, z)), ...(closedHall >= 0 ? [closedHall] : [])];
  connectRooms(plan, [...new Set(arriveRooms)], closedHall);
  // Rooms furnished by their theme once the walls and doors are final.
  for (const { room, items } of furnish) {
    const A = roomArea(room.poly, plan.walls, poly, facade, keepOut);
    if (door && distPointPolyEdge(room.poly, door.x, door.z) < 0.5) A.entry = [door.x, door.z];
    for (const f of new Filler(A, r, undefined, fits).fill(items(room.type, A))) plan.furniture.push({ ...f, unit: room.unit });
  }
  // And where a body fits among the furniture: the doorways clear, the stairs up reached.
  const fl = plan.flights[0];
  walkWays(plan, poly, arrival, from.hole, fl ? [fl.x - fl.dx * 0.5, fl.z - fl.dz * 0.5] : null, closedHall);
  lightsOf(plan);
  return plan;
}

/**
 * A storey of flats: cut into `count` homes along the stair hall (a landing corridor where the
 * homes would otherwise open into each other); on the ground floor a hall runs in from the street
 * door. Each home is then cut into its rooms behind its own small entrance hall.
 */
function flats(plan: FloorPlan, b: BuildingDesc, poly: Poly, use: { count: number; first: number }, ground: boolean, way: Poly | null, front: [number, number] | null, solid: IWall[], r: Rng, furnish: { room: Room; items: (type: RoomType, A: Area) => Item[] }[]): void {
  const kept = plan.rooms;
  const fixed: Space[] = kept.map((q) => ({ type: q.type, poly: q.poly, hub: true }));
  if (way) {
    // The entrance hall: from the street door in to the middle of the floor.
    const hall = entranceHall(poly, way);
    if (hall) fixed.push({ type: 'hall', poly: hall, hub: true });
  }
  if (use.count === 1) {
    // One home on the storey: its rooms open straight off the stair hall.
    const S = splitStorey({ poly, fixed, front, solid }, homeProgram('flat', ground), r);
    plan.rooms = [];
    const lacks = lacksOf(S.spaces.map((q) => q.type), 'flat');
    for (const [k, sp] of S.spaces.entries()) {
      if (k < kept.length) { plan.rooms.push({ ...kept[k], poly: sp.poly }); continue; }
      const common = k < fixed.length;
      const room: Room = { type: sp.type, poly: sp.poly, ...lookOf(sp.type, ground, r), unit: common ? -1 : use.first };
      plan.rooms.push(room);
      if (!common) furnish.push({ room, items: (type, A) => homeItems(type as HomeRoom, A, r, lacks) ?? [] });
    }
    plan.walls.push(...S.walls);
    return;
  }
  let S: Split | null = null;
  for (const side of [false, true]) {
    S = splitStorey({ poly, fixed, front, solid }, flatsProgram(use.count, side), r.fork('flats', side ? 1 : 0));
    if (unitsReached(S)) break;
  }
  const split = S!;
  plan.rooms = [];
  let unit = use.first;
  for (const [k, sp] of split.spaces.entries()) {
    if (k < kept.length) { plan.rooms.push({ ...kept[k], poly: sp.poly }); continue; }
    if (sp.hub || sp.odd) {
      plan.rooms.push({ type: sp.hub ? (sp.type === 'living' ? 'corridor' : sp.type) : 'storage', poly: sp.poly, ...lookOf(sp.hub ? 'hall' : 'storage', ground, r), unit: -1 });
      continue;
    }
    // One home: its door from the common floor, then its rooms behind its entrance hall.
    const entry = split.walls.find((w) => w.doors.length && touches(w, sp.poly) && split.spaces.some((o) => o.hub && touches(w, o.poly)));
    const hall = entry && entryHall(sp.poly, entry);
    const inner = splitStorey({ poly: sp.poly, fixed: hall ? [{ type: 'hall', poly: hall, hub: true }] : [], front, solid: [...solid, ...split.walls] }, homeProgram('flat', false), r);
    const lacks = lacksOf(inner.spaces.map((q) => q.type), 'flat');
    for (const q of inner.spaces) {
      const room: Room = { type: q.type, poly: q.poly, ...lookOf(q.type, ground, r), unit };
      plan.rooms.push(room);
      furnish.push({ room, items: (type, A) => homeItems(type as HomeRoom, A, r, lacks) ?? [] });
    }
    plan.walls.push(...inner.walls);
    unit++;
  }
  plan.walls.push(...split.walls);
  void b;
}

/** Does every home (non-hub space) of a storey of flats have a door onto a hall, the stairs or the landing? */
function unitsReached(S: Split): boolean {
  return S.spaces.every((sp) => sp.hub || sp.fixed || sp.odd || S.walls.some((w) => w.doors.length && touches(w, sp.poly) && S.spaces.some((o) => o.hub && o !== sp && touches(w, o.poly))));
}

/** Does a wall lie along the polygon's outline (its middle within 10 cm of an edge, parallel to it)? */
function touches(w: IWall, p: Poly): boolean {
  const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2, L = Math.hypot(w.bx - w.ax, w.bz - w.az) || 1;
  const n = p.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1], el = Math.hypot(ex, ez) || 1;
    if (Math.abs(((w.bx - w.ax) * ez - (w.bz - w.az) * ex) / (L * el)) > 0.05) continue;
    if (distSqPointSeg(mx, mz, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]) < 0.01) return true;
  }
  return false;
}

/** A home's entrance hall: 1.4 m deep behind its door, 1.6 m wide, inside the home's outline. */
function entryHall(p: Poly, w: IWall): Poly | null {
  const [t0, t1] = w.doors[0];
  const L = Math.hypot(w.bx - w.ax, w.bz - w.az), ux = (w.bx - w.ax) / L, uz = (w.bz - w.az) / L;
  const tm = (t0 + t1) / 2, mx = w.ax + (w.bx - w.ax) * tm, mz = w.az + (w.bz - w.az) * tm;
  let nx = -uz, nz = ux;
  if (!pointInPoly(p, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
  const P = (s: number, d: number) => [mx + ux * s + nx * d, mz + uz * s + nz * d];
  const q = intersection([[...P(-0.8, -0.05), ...P(0.8, -0.05), ...P(0.8, 1.4), ...P(-0.8, 1.4)]], [p]);
  const best = largest(q);
  return best && Math.abs(polyArea(best)) > 1.2 ? best : null;
}

/** The ground floor's entrance hall of a block of flats: from the street door straight in past the middle of the floor. */
function entranceHall(poly: Poly, way: Poly): Poly | null {
  // The way quad's corners 0, 1 are just outside the door, 2, 3 its far end: extend it inwards.
  const ax = (way[0] + way[2]) / 2, az = (way[1] + way[3]) / 2, bx = (way[4] + way[6]) / 2, bz = (way[5] + way[7]) / 2;
  const L = Math.hypot(bx - ax, bz - az), nx = (bx - ax) / L, nz = (bz - az) / L, px = -nz, pz = nx;
  const [cx, cz] = polyCentroid(poly);
  const depth = Math.max(L, (cx - ax) * nx + (cz - az) * nz + 0.8);
  const P = (s: number, d: number) => [ax + px * s + nx * d, az + pz * s + nz * d];
  const q = intersection([[...P(-0.8, 0), ...P(0.8, 0), ...P(0.8, depth), ...P(-0.8, depth)]], [poly]);
  return largest(q);
}

/** Facade edges: blind where an attached building stands against the side walls, else windows. */
function facadeOf(b: BuildingDesc): (ax: number, az: number, bx: number, bz: number) => EdgeKind {
  const n = b.poly.length >> 1, fi = b.front % n, fj = (fi + 1) % n;
  const fdx = b.poly[fj * 2] - b.poly[fi * 2], fdz = b.poly[fj * 2 + 1] - b.poly[fi * 2 + 1], fl = Math.hypot(fdx, fdz) || 1;
  return (ax, az, bx, bz) => {
    if (!b.attached) return 'window';
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return Math.abs(((bx - ax) * fdx + (bz - az) * fdz) / (l * fl)) < 0.5 ? 'blind' : 'window';
  };
}

/**
 * Does a piece fit the storey: fully inside (with a margin from the walls; edge midpoints too, so
 * nothing reaches across an inner corner of an L-shaped storey) and clear of the stair core and
 * the lift with its landing?
 */
function fitsStorey(poly: Poly, st: StairCore | null, lift: LiftShaft | null): (f: Furn) => boolean {
  const core = st && coreRect(st, 0, 0.4);
  return (f) => {
    const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const w = f.w / 2 + 0.05, d = f.d / 2 + 0.05;
    for (const [lx, lz] of [[-w, -d], [w, -d], [w, d], [-w, d], [0, 0], [0, -d], [w, 0], [0, d], [-w, 0]]) {
      if (!pointInPoly(poly, f.x + lx * c + lz * sn, f.z - lx * sn + lz * c)) return false;
    }
    if (core && pointInPoly(core, f.x, f.z)) return false;
    if (lift) {
      const dx = f.x - lift.cx, dz = f.z - lift.cz;
      const u = dx * lift.ux + dz * lift.uz, v = -dx * lift.uz + dz * lift.ux;
      if (u > -lift.hu - 0.7 && u < lift.hu + LANDING + 0.4 && Math.abs(v) < lift.hv + 0.7) return false;
    }
    return true;
  };
}

/** The parts of a wall inside a polygon (shortened 5 cm at the outline), doors carried over. */
function clipWall(w: IWall, poly: Poly): IWall[] {
  const dx = w.bx - w.ax, dz = w.bz - w.az;
  const L = Math.hypot(dx, dz);
  if (L < 1e-3) return [];
  // Crossings of the wall line with the outline, as parameters along the wall.
  const ts = [0, 1];
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const px = poly[i * 2], pz = poly[i * 2 + 1], ex = poly[j * 2] - px, ez = poly[j * 2 + 1] - pz;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((px - w.ax) * ez - (pz - w.az) * ex) / den;
    const u = ((px - w.ax) * dz - (pz - w.az) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out: IWall[] = [];
  const m = 0.05 / L;
  for (let k = 0; k + 1 < ts.length; k++) {
    let t0 = ts[k], t1 = ts[k + 1];
    if (t1 - t0 < 1e-4) continue;
    const tm = (t0 + t1) / 2;
    if (!pointInPoly(poly, w.ax + dx * tm, w.az + dz * tm)) continue;
    if (t0 > 0) t0 += m;
    if (t1 < 1) t1 -= m;
    if ((t1 - t0) * L < 0.3) continue;
    const span = t1 - t0;
    const doors: [number, number][] = [];
    for (const [d0, d1] of w.doors) {
      const a = Math.max(d0, t0), b = Math.min(d1, t1);
      if (b - a > 0.6 / L) doors.push([(a - t0) / span, (b - t0) / span]);
    }
    out.push({ ax: w.ax + dx * t0, az: w.az + dz * t0, bx: w.ax + dx * t1, bz: w.az + dz * t1, doors, solid: w.solid });
  }
  return out;
}

/** A wall's opening where it crosses a convex quad (grown by a walker's width), merged with its doors. */
function openWall(w: IWall, quad: Poly): void {
  const dx = w.bx - w.ax, dz = w.bz - w.az, L = Math.hypot(dx, dz);
  if (L < 1e-3) return;
  // Cyrus–Beck: clip the wall line to the quad.
  let cx = 0, cz = 0;
  for (let i = 0; i < 8; i += 2) { cx += quad[i] / 4; cz += quad[i + 1] / 4; }
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 8 && t0 <= t1; i += 2) {
    const j = (i + 2) % 8;
    let nx = quad[j + 1] - quad[i + 1], nz = quad[i] - quad[j];
    // Outward normal of this edge.
    if ((cx - quad[i]) * nx + (cz - quad[i + 1]) * nz > 0) { nx = -nx; nz = -nz; }
    const num = (w.ax - quad[i]) * nx + (w.az - quad[i + 1]) * nz, den = dx * nx + dz * nz;
    if (Math.abs(den) < 1e-12) { if (num > 0) return; continue; }
    const t = -num / den;
    if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (t1 - t0 < 0.05 / L) return;
  // At least a doorway's width (0.9 m), and no sliver of wall left at either end.
  const need = 0.9 / L;
  if (t1 - t0 < need) { const m = (t0 + t1) / 2; t0 = Math.max(0, m - need / 2); t1 = Math.min(1, t0 + need); t0 = Math.max(0, t1 - need); }
  if (t0 < 0.3 / L) t0 = 0;
  if (t1 > 1 - 0.3 / L) t1 = 1;
  const all = [...w.doors, [t0, t1] as [number, number]].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const d of all) {
    const last = merged[merged.length - 1];
    if (last && d[0] <= last[1] + 0.3 / L) last[1] = Math.max(last[1], d[1]);
    else merged.push([d[0], d[1]]);
  }
  w.doors = merged;
}

/** Inward normal of the building's street front (its front edge), or null. */
function frontNormal(b: BuildingDesc): [number, number] | null {
  const n = b.poly.length >> 1;
  if (n < 3) return null;
  const i = b.front % n, j = (i + 1) % n;
  const ax = b.poly[i * 2], az = b.poly[i * 2 + 1], dx = b.poly[j * 2] - ax, dz = b.poly[j * 2 + 1] - az, l = Math.hypot(dx, dz);
  if (l < 1e-6) return null;
  let nx = -dz / l, nz = dx / l;
  const [cx, cz] = polyCentroid(b.poly);
  if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

/** The floor in front of the lift doors that must stay free. */
function landingOf(l: LiftShaft): Poly {
  const vx = -l.uz, vz = l.ux;
  const P = (u: number, v: number) => [l.cx + l.ux * u + vx * v, l.cz + l.uz * u + vz * v];
  return [...P(l.hu, -l.hv), ...P(l.hu + LANDING, -l.hv), ...P(l.hu + LANDING, l.hv), ...P(l.hu, l.hv)];
}

/** Floor and wall finish of a room the splitter made. */
function lookOf(type: RoomType, ground: boolean, r: Rng): Pick<Room, 'floorMat' | 'wallColor'> {
  switch (type) {
    case 'bath': case 'cell': return { floorMat: 'tile', wallColor: [0.9, 0.92, 0.93] };
    case 'kitchen': case 'bakehouse': return { floorMat: 'tile', wallColor: r.pick(WALLS) };
    case 'hall': case 'corridor': return { floorMat: 'tile', wallColor: [0.9, 0.89, 0.85] };
    case 'lobby': return { floorMat: 'marble', wallColor: [0.92, 0.9, 0.86] };
    case 'office': case 'reading': return { floorMat: 'carpet', wallColor: [0.9, 0.9, 0.88] };
    case 'meeting': return { floorMat: 'carpet', wallColor: [0.85, 0.88, 0.9] };
    case 'storage': case 'workshop': case 'garage': case 'factory': case 'parking': return { floorMat: 'concrete', wallColor: [0.8, 0.8, 0.78] };
    case 'barn': return { floorMat: 'concrete', wallColor: [0.72, 0.62, 0.48] };
    case 'shop': case 'salon': return { floorMat: 'tile', wallColor: r.pick(WALLS) };
    case 'dining': return { floorMat: 'wood', wallColor: r.pick(WALLS) };
    case 'nave': return { floorMat: 'stone', wallColor: [0.93, 0.91, 0.86] };
    case 'chamber': return { floorMat: 'wood', wallColor: [0.9, 0.86, 0.78] };
    case 'classroom': case 'playroom': return { floorMat: 'wood', wallColor: r.pick(WALLS) };
    case 'consulting': return { floorMat: 'tile', wallColor: [0.92, 0.94, 0.95] };
    case 'dayroom': return { floorMat: 'carpet', wallColor: r.pick(WALLS) };
    default: return { floorMat: ground && r.chance(0.3) ? 'tile' : r.chance(0.7) ? 'wood' : 'carpet', wallColor: r.pick(WALLS) };
  }
}

/**
 * Ceiling lights per room: one in the middle of a small room (over the table where there is
 * one), a grid in big ones; homes and places to eat get pendant lamps, workplaces panels.
 */
function lightsOf(plan: FloorPlan): void {
  for (const room of plan.rooms) {
    const fx = room.type === 'living' || room.type === 'bedroom' || room.type === 'kitchen' || room.type === 'dining' ? 1
      : room.type === 'bath' || room.type === 'corridor' || room.type === 'hall' || room.type === 'stairs' || room.type === 'storage' ? 2 : 0;
    const bb = polyBounds(room.poly);
    const cu = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
    const big = Math.max(bb[2] - bb[0], bb[3] - bb[1]) > 7;
    const pts: [number, number][] = [];
    if (!big) {
      const table = plan.furniture.find((f) => (f.kind === 'diningTable' || f.kind === 'coffeeTable') && pointInPoly(room.poly, f.x, f.z));
      pts.push(table ? [table.x, table.z] : [cu, cz]);
    } else for (let x = bb[0] + 2; x < bb[2] - 1; x += 4) for (let z = bb[1] + 2; z < bb[3] - 1; z += 4) pts.push([x, z]);
    for (const [x, z] of pts) {
      if (!pointInPoly(room.poly, x, z)) continue;
      if (plan.lights.some((_, i) => i % 2 === 0 && Math.hypot(plan.lights[i] - x, plan.lights[i + 1] - z) < 1.5)) continue;
      plan.lights.push(x, z);
      plan.fixtures.push(fx);
    }
  }
}

