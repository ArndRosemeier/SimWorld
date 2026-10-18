/**
 * Tracks (plan §1.1, L1): where an actor is on the ground over the next minutes, as a pure function of what
 * the society sim says (L0). Someone travelling on foot walks from the door they left by to the door of where
 * they are going, on the sidewalk of their actual route; someone staying at a park, square, sports ground or
 * street strolls between spots there. Indoors (at home, at work, in the shop) or in a car, there is no track.
 *
 * Nothing here is stored: the same L0 state and clock give the same track, so promotion to the visible layer
 * (L2) and back loses nothing (plan §1.1 rule 2) and the street layer needs no save.
 *
 * Time is in game minutes (the sim's clock, fractional between ticks).
 */
import { alongLine, closestOnPolyline, joinPolylines, polylineCum, polylineLength, resample, slicePolyline, type MeasuredLine } from '../geom/geom2';
import { hash2f, hashCombine } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import type { PlaceId, PlaceKind } from '../sim/places';
import { householdOf, isPerson, tripOf, type World } from '../sim/world';
import { OUTDOOR, type StreetMap } from './streetMap';
import { avoid, clearWay, crossing, detour, lineClear } from './clearance';
import type { Footprints } from '../plan/footprints';
import { SEAT_REACH, seatFront } from './seats';
import { DOOR_LEG, doorRound, eveningOf, trickOrTreater } from './trickOrTreat';
import { MINUTES_PER_DAY } from '../sim/time';

export interface Track {
  id: ActorId;
  /** Keyframes (t, x, y, z), t ascending: the actor moves in a straight line from key to key and stands after the last. */
  keys: number[];
  /** Gone indoors after this clock (the door of where they went); Infinity: stays out. */
  hideAfter: number;
  /** The track holds until this clock; the street layer makes the next one then (or earlier, when L0 changes). */
  validUntil: number;
  /** What they are doing (index into ACTIVITIES), for the pose and props. */
  activity: number;
  /** Fingerprint of the L0 state the track was made from (`signature`). */
  sig: number;
  /**
   * When they sit (t0, t1, yaw, seat height) * n: from t0 to t1 they are seated, facing `yaw`, on a seat of
   * that height behind where the track has them (src/street/seats.ts `seatFront`). Before t0 they sit down,
   * after t1 they get up, standing there.
   */
  rests: number[];
}

/** Walking speed on a stroll (m per game minute, ~3 km/h). Trips keep the sim's own travel time. */
const STROLL = 50;
/** Minutes a street stroller takes at a turn to step over to the walking line back. */
const TURN = 0.15;
/** Share of a stay's leg spent walking (the rest is a pause at the leg's spot). */
const WALKING = 0.8;
/** The slowest walk on a street stay (m/min, ~2.4 km/h: looking in the windows). */
const AMBLE = 40;
/** The furthest (m) a street stay walks along one road before turning back. */
const STREET_TURN = 150;
/** Pace (m per game minute) from door to door on Halloween. */
const HURRY = 75;
/** How far ahead a stay's track is laid out (game minutes). */
const AHEAD = 30;
/** Spacing (m) of a walk's points, so heights follow the ground. */
const STEP = 6;

/**
 * Per kind of outdoor place: minutes per stroll leg and walking speed (m/min). By place, not by activity, so a
 * walk that leaves the place can find where the stroll had got to (the activity has changed by then).
 */
const STAY: Partial<Record<PlaceKind, { leg: number; speed: number }>> = {
  park: { leg: 7, speed: STROLL },
  square: { leg: 6, speed: 40 },
  cemetery: { leg: 10, speed: 40 },
  sports: { leg: 5, speed: 90 },
  street: { leg: 3, speed: 65 },
  woods: { leg: 6, speed: STROLL },
  field: { leg: 15, speed: 30 },
  farm: { leg: 10, speed: 40 },
};
const DEFAULT_STAY = { leg: 8, speed: STROLL };
/** Share of stroll legs that end sitting on a bench, where the place has benches (people only). */
const SIT: Partial<Record<PlaceKind, number>> = { park: 0.45, square: 0.4, cemetery: 0.3, sports: 0.2 };
/** Game minutes to turn round before sitting down, and to get up before walking on (each a few seconds). */
const SETTLE = 0.03, RISE = 0.05;
/** The last stretch (m) to a seat goes straight, from this far in front of where the sitter stands. */
const APPROACH = 0.6;

/** What the track depends on in L0: where, where to, since when, doing what, with whom. */
export function signature(world: World, id: ActorId): number {
  const a = world.actors.cols, trip = a.dest[id] >= 0 ? tripOf(world, id) : undefined;
  let h = hashCombine(a.place[id] + 7, a.dest[id] + 11);
  h = hashCombine(h, trip ? trip.depart : -1);
  h = hashCombine(h, a.activity[id] * 2 + a.alive[id]);
  h = hashCombine(h, (trip ? trip.from : -1) + 13);
  return hashCombine(h, a.with[id] + 17);
}

/** Is the actor out of doors and on foot (seen on the street) at the current clock? */
export function outside(world: World, id: ActorId): boolean {
  const a = world.actors.cols;
  if (!a.alive[id]) return false;
  // On foot only: cars, bikes and buses are the traffic's (a trip the sim has no record of is walked).
  if (a.dest[id] >= 0) return (tripOf(world, id)?.mode ?? 'foot') === 'foot';
  const p = a.place[id];
  return p >= 0 && OUTDOOR.has(world.graph.places[p].kind);
}

/** The actor's track from `clock` on, or null when they are indoors or driving. */
export function trackOf(world: World, map: StreetMap, id: ActorId, clock: number): Track | null {
  if (!outside(world, id)) return null;
  // The player walking their person themselves: the game draws them where the player has them.
  const pl = world.player;
  if (pl && pl.id === id && !pl.autopilot && pl.at) return null;
  const a = world.actors.cols, sig = signature(world, id);
  const lead = a.with[id];
  // Someone going along (a toddler, the dog) keeps beside who they are with.
  if (lead >= 0 && outside(world, lead) && a.dest[lead] === a.dest[id] && a.place[lead] === a.place[id]) {
    const t = trackOf(world, map, lead, clock);
    if (t) return { ...t, id, keys: grounded(map, beside(map.fp, t.keys, besideGap(world, id, lead))), sig, rests: [] };
  }
  if (a.dest[id] >= 0) {
    const keys = tripKeys(world, map, id);
    const indoor = !OUTDOOR.has(world.graph.places[a.dest[id]].kind);
    return { id, keys, hideAfter: indoor ? a.arrive[id] : Infinity, validUntil: a.arrive[id], activity: a.planned[id], sig, rests: [] };
  }
  const place = a.place[id], act = a.activity[id];
  const until = Math.min(a.until[id], clock + AHEAD);
  const rests: number[] = [];
  return { id, keys: stayKeys(world, map, id, place, clock, until, rests), hideAfter: Infinity, validUntil: until, activity: act, sig, rests };
}

/** The sitting under way at `t` (index of its t0 in `rests`, see Track.rests), -1 if they are not sitting. */
export function restAt(rests: ArrayLike<number>, t: number): number {
  for (let i = 0; i < rests.length; i += 4) if (t >= rests[i] && t < rests[i + 1]) return i;
  return -1;
}

/** Position on a track at `t` (x, y, z); before the first key at the first, after the last at the last. */
export function sample(keys: ArrayLike<number>, t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const n = keys.length / 4;
  if (n === 0) return out;
  if (t <= keys[0] || n === 1) { out[0] = keys[1]; out[1] = keys[2]; out[2] = keys[3]; return out; }
  let lo = 0, hi = n - 1;
  if (t >= keys[hi * 4]) { out[0] = keys[hi * 4 + 1]; out[1] = keys[hi * 4 + 2]; out[2] = keys[hi * 4 + 3]; return out; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m * 4] <= t) lo = m; else hi = m; }
  const t0 = keys[lo * 4], t1 = keys[hi * 4], f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
  for (let c = 1; c < 4; c++) out[c - 1] = keys[lo * 4 + c] + (keys[hi * 4 + c] - keys[lo * 4 + c]) * f;
  return out;
}

// ---------------------------------------------------------------------------------------------- trips

/** A walk from the door (or spot) left to the door (or spot) of the destination, departure to arrival. */
function tripKeys(world: World, map: StreetMap, id: ActorId): number[] {
  const a = world.actors.cols;
  const trip = tripOf(world, id);
  const from = trip ? trip.from : a.home[id], to = a.dest[id];
  const t0 = trip ? trip.depart : a.arrive[id] - world.travel.minutes(from, to), t1 = Math.max(a.arrive[id], t0 + 0.5);
  const [ox, oz] = whereAt(world, map, id, from, t0);
  const [dx, dz] = whereAt(world, map, id, to, t1);
  const path = walkPath(world, map, id, from, to, ox, oz, dx, dz);
  return timed(map, path, t0, t1);
}

/**
 * The ground path (x, z, …) of a walk between two places: out of the door to its doorstep, along the sidewalks
 * of the route between them, across the last street (where no parked car is in the way) when the door ahead is
 * on its far side, and in at the door; bent around everything standing on the way.
 */
export function walkPath(world: World, map: StreetMap, id: ActorId, from: PlaceId, to: PlaceId, ox: number, oz: number, dx: number, dz: number): number[] {
  const places = world.graph.places;
  const outFrom = OUTDOOR.has(places[from].kind), outTo = OUTDOOR.has(places[to].kind);
  const [sx, sz] = outFrom ? [ox, oz] : map.doorStep(from);
  const [ex, ez] = outTo ? [dx, dz] : map.doorStep(to);
  const middle = avoid(map.fp, streetPath(world, map, id, from, to, sx, sz, ex, ez));
  return clearWay(map.fp, [...(outFrom ? [] : [ox, oz]), ...middle, ...(outTo ? [] : [dx, dz])]);
}

/** From (ox, oz) to (dx, dz) along the sidewalks of the route between two places. */
function streetPath(world: World, map: StreetMap, id: ActorId, from: PlaceId, to: PlaceId, ox: number, oz: number, dx: number, dz: number): number[] {
  // Out of the door onto their own street, or back in from it: straight there (not by way of the street's
  // place, which on a long road can be far away).
  const own = world.streetOf[from] === to || world.streetOf[to] === from;
  const route = own ? [] : world.travel.roadPath(from, to);
  const es: [number, number][] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const e = map.edge(route[i], route[i + 1]);
    if (e >= 0) es.push([e, route[i]]);
  }
  if (!es.length) return [ox, oz, dx, dz];
  // Keep to the side of the street the walk starts on; turn the other way at a junction and you cross.
  const sign = sideOf(map.centreline(es[0][0], es[0][1]), ox, oz);
  const lane = laneOf(world, id);
  const lines = es.map(([e, a]) => map.walkLine(e, a, sign, lane));
  const walk = joinPolylines(lines);
  const W: MeasuredLine = { pts: walk, cum: polylineCum(walk) };
  // Join the street where the door is, not back at the junction behind it; leave it opposite the door ahead.
  const here = lines[lines.length - 1];
  const first = closestOnPolyline(lines[0], ox, oz).s;
  const lastStart = polylineLength(walk) - polylineLength(here);
  const [eL, aL] = es[es.length - 1];
  const dHere = closestOnPolyline(here, dx, dz).s;
  const across = (map.graph.edges[eL].side ?? 0) >= 1 && sideOf(map.centreline(eL, aL), dx, dz) !== sign;
  if (!across) {
    const last = lastStart + dHere;
    if (last - first < 1) return [ox, oz, dx, dz];
    return [ox, oz, ...slicePolyline(W, first, last), dx, dz];
  }
  // The door ahead is across the last street: cross it a little before the door, clear of the junction behind
  // and of parked cars, lamps and trees.
  const there = map.walkLine(eL, aL, -sign, lane);
  const lenHere = polylineLength(here);
  const lo = Math.min(lenHere, es.length > 1 ? (map.graph.edges[es[es.length - 2][0]].side ?? 0) + 2 : Math.max(0, first - lastStart));
  const hi = Math.max(lo, lenHere - 2);
  const [sc, tc] = crossing(map.fp, here, there, dHere - 2, lo, hi);
  const T: MeasuredLine = { pts: there, cum: polylineCum(there) };
  const dThere = closestOnPolyline(there, dx, dz).s;
  const before = lastStart + sc - first >= 0.5 ? slicePolyline(W, first, lastStart + sc) : [...alongLine(W, lastStart + sc)];
  const after = dThere - tc >= 0.5 ? slicePolyline(T, tc, dThere) : [...alongLine(T, tc)];
  return [ox, oz, ...before, ...after, dx, dz];
}

/** Which side of a line (x, z, …) a point is: +1 left of its direction, -1 right. */
function sideOf(line: number[], x: number, z: number): number {
  const c = closestOnPolyline(line, x, z), i = Math.min(c.seg, (line.length >> 1) - 2) * 2;
  return (line[i + 2] - line[i]) * (z - line[i + 1]) - (line[i + 3] - line[i + 1]) * (x - line[i]) > 0 ? 1 : -1;
}

/** Each person walks their own line, a little in or out from the middle of the sidewalk. */
function laneOf(world: World, id: ActorId): number {
  const lead = world.actors.cols.with[id];
  return lead >= 0 ? laneOf(world, lead) + 0.7 : (hash2f(world.seed, id, 0x1a9e) - 0.5) * 1.2;
}

/** Keys for a path walked at constant speed from t0 to t1, the heights from the ground. */
function timed(map: StreetMap, path: number[], t0: number, t1: number): number[] {
  const pts = polylineLength(path) > STEP ? resampleKeepEnds(path) : path;
  const L = polylineLength(pts), keys: number[] = [];
  const key = (s: number, x: number, y: number, z: number) => keys.push(t0 + (L > 0 ? (s / L) * (t1 - t0) : 0), x, y, z);
  let s = 0, py = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const y = map.groundY(pts[i], pts[i + 1]);
    if (i > 0) {
      const d = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      onGround(map, pts[i - 2], pts[i - 1], py, pts[i], pts[i + 1], y, s, d, 0, key);
      s += d;
    }
    key(s, pts[i], y, pts[i + 1]);
    py = y;
  }
  return keys;
}

/** The same keys (moved off the path they were made for) put back on the drawn ground, keys between where it steps. */
function grounded(map: StreetMap, keys: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < keys.length; i += 4) {
    const t = keys[i], x = keys[i + 1], z = keys[i + 3], y = map.groundY(x, z);
    if (i > 0) {
      const lt = keys[i - 4], lx = keys[i - 3], lz = keys[i - 1], ly = out[out.length - 2];
      const d = Math.hypot(x - lx, z - lz);
      onGround(map, lx, lz, ly, x, z, y, 0, d, 0, (s, kx, ky, kz) => out.push(lt + (d > 0 ? s / d : 0) * (t - lt), kx, ky, kz));
    }
    out.push(t, x, y, z);
  }
  return out;
}

/** How far a straight line between two keys may stray from the ground under it (m) before a key goes in between. */
const GROUND_TOL = 0.02;
/** How far apart the ground is looked at along a straight line between keys (m): narrower than a path or a kerb's ramp. */
const GROUND_LOOK = 0.4;

/**
 * Keys between (ax, az) and (bx, bz) (heights ay, by; `s` along the path to a, `d` long) so that walking straight
 * from one to the next keeps the feet on the drawn ground: halves where the middle is off the line, down to a few
 * centimetres, which puts a key either side of a kerb.
 */
function onGround(map: StreetMap, ax: number, az: number, ay: number, bx: number, bz: number, by: number, s: number, d: number, depth: number, key: (s: number, x: number, y: number, z: number) => void): void {
  if (d < 0.06 || depth > 8) return;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = map.groundY(mx, mz);
  // (Points every GROUND_LOOK too, at least the quarters: a kerb near one end, or a narrow strip, hides from the middle.)
  let off = Math.abs(my - (ay + by) / 2);
  const n = Math.max(4, Math.ceil(d / GROUND_LOOK));
  for (let i = 1; i < n && off <= GROUND_TOL; i++) {
    const f = i / n;
    off = Math.max(off, Math.abs(map.groundY(ax + (bx - ax) * f, az + (bz - az) * f) - (ay + (by - ay) * f)));
  }
  if (off <= GROUND_TOL) return;
  onGround(map, ax, az, ay, mx, mz, my, s, d / 2, depth + 1, key);
  key(s + d / 2, mx, my, mz);
  onGround(map, mx, mz, my, bx, bz, by, s + d / 2, d / 2, depth + 1, key);
}

/** Resample each straight run to STEP spacing, keeping the corners (a plain resample would cut them). */
function resampleKeepEnds(path: number[]): number[] {
  const out: number[] = [path[0], path[1]];
  for (let i = 2; i < path.length; i += 2) {
    const seg = [path[i - 2], path[i - 1], path[i], path[i + 1]];
    const r = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) > STEP ? resample(seg, STEP) : seg;
    for (let k = 2; k < r.length; k += 2) out.push(r[k], r[k + 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- stays

/**
 * Where an actor is at a place at time t: the door of an indoor place, the spot of the stroll they are on at
 * an outdoor one (so a walk that leaves a park starts where the stroll had got to).
 */
function whereAt(world: World, map: StreetMap, id: ActorId, place: PlaceId, t: number): [number, number] {
  const pl = world.graph.places[place];
  if (!OUTDOOR.has(pl.kind)) return map.door(place);
  const keys = stayKeys(world, map, id, place, t, t);
  const p = sample(keys, t);
  return [p[0], p[2]];
}

/**
 * A stay's stroll from t0 to t1: legs of a fixed length, each a walk to the leg's spot and a pause there.
 * The spot of leg k depends only on (who, place, k), so any stretch of the stay can be laid out on its own
 * and joins up with the stretch before it.
 */
function stayKeys(world: World, map: StreetMap, id: ActorId, place: PlaceId, t0: number, t1: number, rests: number[] = []): number[] {
  const kind = world.graph.places[place].kind;
  const { leg, speed } = STAY[kind] ?? DEFAULT_STAY;
  const street = kind === 'street';
  // Halloween evening: the children go round the doors.
  const anchor = world.actors.cols.arrive[id];
  if (street && trickOrTreater(world, id, place, anchor)) return roundKeys(world, map, id, anchor, t0, t1);
  const keys: number[] = [];
  const k0 = Math.floor(t0 / leg), k1 = Math.floor(t1 / leg) + 1;
  for (let k = k0; k <= k1; k++) {
    const start = k * leg;
    if (street) {
      // Up and down the street on its sidewalk; at the turn they step over to the walking line back (from where
      // the last leg ended, round the lamp or the traffic light on the corner).
      const before = streetLeg(world, map, id, place, k - 2, k - 1);
      const path = clearWay(map.fp, [before[before.length - 2], before[before.length - 1], ...avoid(map.fp, streetLeg(world, map, id, place, k - 1, k))]);
      // At an easy pace that fills most of the leg (window shopping), never a dawdle or a run.
      const walk = Math.min(leg * 0.9 - TURN, polylineLength(path) / Math.max(AMBLE, Math.min(speed, polylineLength(path) / (leg * 0.9))));
      const ks = timed(map, path, start + TURN, start + TURN + walk);
      if (!keys.length) keys.push(start, ks[1], ks[2], ks[3]);
      for (let i = 0; i < ks.length; i += 4) keys.push(ks[i], ks[i + 1], ks[i + 2], ks[i + 3]);
      continue;
    }
    // From the last leg's spot to this leg's, by way of other spots while there is time: they keep walking for
    // most of the leg and pause at the end (a big park is crossed in a hurry rather than never).
    const [px, pz] = legEnd(world, map, id, place, k - 1), end = legEnd(world, map, id, place, k), [qx, qz] = end;
    // Animals (grazing, idling on the farm) go straight to the next spot and stay there a while.
    // (Going to sit on a bench: straight there, and sit most of the leg.)
    const path = [px, pz], reach = isPerson(world, id) && end[2] < 0 ? leg * WALKING * speed : 0;
    let len = 0, cx = px, cz = pz;
    for (let j = 1; j <= 6; j++) {
      const [sx, sz] = map.spot(place, id, -(k * 8 + j));
      const d = Math.hypot(sx - cx, sz - cz);
      if (len + d + Math.hypot(qx - sx, qz - sz) > reach) break;
      path.push(sx, sz);
      len += d; cx = sx; cz = sz;
    }
    // To a seat: up to a step in front of it round whatever stands about, then the last step to it.
    const seat = end[2] >= 0 ? map.seats[end[2]] : null;
    if (seat) path.push(...seatFront(seat, SEAT_REACH + APPROACH));
    else path.push(qx, qz);
    const way = clearWay(map.fp, avoid(map.fp, path));
    if (seat) way.push(qx, qz);
    const walk = Math.max(0.01, Math.min(leg * 0.9, polylineLength(way) / speed));
    const ks = timed(map, way, start, start + walk);
    // (The leg's first key holds them at the last leg's spot until the walk starts: a pause, not a creep.)
    for (let i = keys.length && keys[keys.length - 4] >= ks[0] ? 4 : 0; i < ks.length; i += 4) keys.push(ks[i], ks[i + 1], ks[i + 2], ks[i + 3]);
    // Turn round and sit down; get up a little before the next leg's walk.
    if (seat && start + walk + SETTLE < start + leg - RISE) rests.push(start + walk + SETTLE, start + leg - RISE, seat.yaw + Math.PI, seat.top);
  }
  return keys;
}

/**
 * A trick-or-treater's evening from t0 to t1 (src/street/trickOrTreat.ts): from home (they set out at `anchor`)
 * to each door of their round in turn on the sidewalks, a DOOR_LEG each, a walk and a wait on the doorstep;
 * then home again.
 */
function roundKeys(world: World, map: StreetMap, id: ActorId, anchor: number, t0: number, t1: number): number[] {
  const round = doorRound(world, map, id, anchor);
  const door = (r: number): PlaceId => round[r >= 0 && r + 1 < round.length ? r + 1 : 0];
  const keys: number[] = [];
  const r0 = Math.max(0, Math.floor((t0 - anchor) / DOOR_LEG)), r1 = Math.max(r0, Math.floor((t1 - anchor) / DOOR_LEG) + 1);
  for (let r = r0; r <= r1; r++) {
    const start = anchor + r * DOOR_LEG, from = door(r - 1), to = door(r);
    // Doorstep to doorstep (a door to door walk without going in at either end).
    const way = roundWay(world, map, id, anchor, r, from, to);
    const walk = Math.max(0.01, Math.min(DOOR_LEG * 0.7, polylineLength(way) / HURRY));
    const ks = timed(map, way, start, start + walk);
    for (let i = keys.length && keys[keys.length - 4] >= ks[0] ? 4 : 0; i < ks.length; i += 4) keys.push(ks[i], ks[i + 1], ks[i + 2], ks[i + 3]);
  }
  return keys;
}

/** A round's walk from door `from` to door `to` (leg r), doorstep to doorstep on the sidewalks. */
function roundWay(world: World, map: StreetMap, id: ActorId, anchor: number, r: number, from: PlaceId, to: PlaceId): number[] {
  // Laid out once: the track is remade every few minutes.
  const c = eveningOf(map, Math.floor(anchor / MINUTES_PER_DAY));
  const key = id * 128 + Math.min(r, 127);
  let way = c.ways.get(key);
  if (way) return way;
  const [sx, sz] = map.doorStep(from), [ex, ez] = map.doorStep(to);
  way = from === to ? [sx, sz, ex + 0.01, ez] : between(walkPath(world, map, id, from, to, ...map.door(from), ...map.door(to)), sx, sz, ex, ez);
  c.ways.set(key, way);
  return way;
}

/** The stretch of `path` from its point at (sx, sz) to its point at (ex, ez), each added when the path misses it. */
function between(path: number[], sx: number, sz: number, ex: number, ez: number): number[] {
  const hits = (i: number, x: number, z: number) => Math.hypot(path[i] - x, path[i + 1] - z) < 0.05;
  let i0 = 0, i1 = path.length - 2;
  while (i0 < path.length && !hits(i0, sx, sz)) i0 += 2;
  while (i1 >= 0 && !hits(i1, ex, ez)) i1 -= 2;
  if (i0 >= path.length || i1 < i0) return [sx, sz, ...path.slice(2, -2), ex, ez];
  return path.slice(i0, i1 + 2);
}

/**
 * Where a person's stroll leg k at a place ends (x, z, and the seat they sit on there, -1 for none): now and
 * then a free bench seat (sitting the rest of the leg), else the leg's spot. The same for the same leg.
 */
function legEnd(world: World, map: StreetMap, id: ActorId, place: PlaceId, k: number): [number, number, number] {
  const kind = world.graph.places[place].kind, share = SIT[kind] ?? 0;
  if (share > 0 && isPerson(world, id)) {
    const h = hashCombine(hashCombine(world.seed, id), place * 7919 + k);
    const seats = map.seatsAt(place);
    if (seats.length && hash2f(h, 1, 0x5ea7) < share) {
      const { leg } = STAY[kind] ?? DEFAULT_STAY;
      for (let j = 0; j < 4; j++) {
        const i = seats[Math.floor(hash2f(h, j + 2, 0x5ea7) * seats.length)];
        if (!map.seatBook.book(i, id, k * leg, (k + 1) * leg)) continue;
        const [x, z] = seatFront(map.seats[i]);
        return [x, z, i];
      }
    }
  }
  const [x, z] = map.spot(place, id, k);
  return [x, z, -1];
}

/**
 * Where a street stay starts from: the road node at their own front door when it is their own street (a long
 * country road's place can be kilometres from the house), else the street's own node.
 */
function streetAnchor(world: World, id: ActorId, place: PlaceId): number {
  const home = world.actors.cols.home[id];
  return home >= 0 && world.streetOf[home] === place ? world.graph.places[home].node : world.graph.places[place].node;
}

/** A street stay goes up and down the street: even legs end at their anchor node, odd ones toward a neighbour. */
function streetNode(world: World, map: StreetMap, id: ActorId, place: PlaceId, k: number): number {
  const home = streetAnchor(world, id, place);
  if (k % 2 === 0) return home;
  const next = neighbours(map, home);
  return next.length ? next[Math.floor(hash2f(hashCombine(world.seed, id), place, k) * next.length)] : home;
}

/** The walk of a street stay's leg from its node at leg ka to its node at leg kb, on the sidewalk. */
function streetLeg(world: World, map: StreetMap, id: ActorId, place: PlaceId, ka: number, kb: number): number[] {
  const a = streetNode(world, map, id, place, ka), b = streetNode(world, map, id, place, kb);
  const e = map.edge(a, b), n = map.graph.nodes[a];
  if (e < 0) return [n.x, n.z, n.x + 0.01, n.z];
  // On a long road they turn round after a while: out over its first STREET_TURN metres, back over the same.
  const line = map.walkLine(e, a, 1, laneOf(world, id)), L = polylineLength(line);
  if (L <= STREET_TURN) return line;
  const M = { pts: line, cum: polylineCum(line) };
  return ka % 2 === 0 ? slicePolyline(M, 0, STREET_TURN) : slicePolyline(M, L - STREET_TURN, L);
}

const neighbourCache = new WeakMap<StreetMap, number[][]>();
function neighbours(map: StreetMap, node: number): number[] {
  let adj = neighbourCache.get(map);
  if (!adj) {
    adj = map.graph.nodes.map(() => []);
    for (const e of map.graph.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    neighbourCache.set(map, adj);
  }
  return adj[node];
}

/** How far to the side someone going along walks: the first on the left, the next on the right a little further out (where one side is blocked, both on the other), and so on. */
function besideGap(world: World, id: ActorId, lead: ActorId): number {
  const a = world.actors.cols, hh = householdOf(world, lead);
  const along = hh ? [...hh.members, ...hh.animals].filter((f) => a.with[f] === lead).sort((x, y) => x - y) : [];
  const i = Math.max(0, along.indexOf(id));
  return (i % 2 ? -1 : 1) * 0.8 * (1 + i * 0.6);
}

/**
 * The same keys moved `d` metres to the side of the direction of movement (someone walking beside): to the
 * left, and kept on the same side where the walk turns back (they do not pass through who they are with).
 */
function beside(fp: Footprints, keys: number[], d: number): number[] {
  const out: number[] = [];
  const n = keys.length / 4;
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = keys[b * 4 + 1] - keys[a * 4 + 1], dz = keys[b * 4 + 3] - keys[a * 4 + 3];
    const l = Math.hypot(dx, dz);
    let ox: number, oz: number;
    if (l < 1e-3) { ox = px; oz = px || pz ? pz : d; } // standing still: where they were (at first: to one side)
    else { ox = (-dz / l) * d; oz = (dx / l) * d; }
    if (ox * px + oz * pz < 0) { ox = -ox; oz = -oz; }
    // A tree or a lamp on that side: the other side, else fall in behind.
    const t = keys[i * 4], x = keys[i * 4 + 1], y = keys[i * 4 + 2], z = keys[i * 4 + 3];
    const clear = (sx: number, sz: number) => lineClear(fp, x + sx, z + sz, x + sx, z + sz);
    const [sx, sz] = clear(ox, oz) ? [ox, oz] : clear(-ox, -oz) ? [-ox, -oz] : [0, 0];
    if (sx || sz) { px = sx; pz = sz; }
    // From the last key round anything between (a lamp they would pass on the other side of), timed along.
    if (i > 0) {
      const lx = out[out.length - 3], lz = out[out.length - 1], lt = out[out.length - 4], ly = out[out.length - 2];
      const way = detour(fp, lx, lz, x + sx, z + sz);
      if (way && way.length > 4) {
        const L = polylineLength(way);
        let s = 0;
        for (let j = 2; j + 2 < way.length; j += 2) {
          s += Math.hypot(way[j] - way[j - 2], way[j + 1] - way[j - 1]);
          const f = L > 0 ? s / L : 0;
          out.push(lt + (t - lt) * f, way[j], ly + (y - ly) * f, way[j + 1]);
        }
      }
    }
    out.push(t, x + sx, y, z + sz);
  }
  return out;
}
