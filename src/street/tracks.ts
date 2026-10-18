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
import { closestOnPolyline, polylineLength, resample, slicePolyline } from '../geom/geom2';
import { hash2f, hashCombine } from '@futuremagic/core';
import type { ActorId } from '../sim/actors';
import type { PlaceId, PlaceKind } from '../sim/places';
import type { World } from '../sim/world';
import { OUTDOOR, type StreetMap } from './streetMap';

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
}

/** Walking speed on a stroll (m per game minute, ~3 km/h). Trips keep the sim's own travel time. */
const STROLL = 50;
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
  square: { leg: 12, speed: STROLL },
  cemetery: { leg: 10, speed: 40 },
  sports: { leg: 5, speed: 90 },
  street: { leg: 4, speed: 65 },
  woods: { leg: 6, speed: STROLL },
  field: { leg: 15, speed: 30 },
  farm: { leg: 10, speed: 40 },
};
const DEFAULT_STAY = { leg: 8, speed: STROLL };

/** What the track depends on in L0: where, where to, since when, doing what, with whom. */
export function signature(world: World, id: ActorId): number {
  const a = world.actors.cols;
  let h = hashCombine(a.place[id] + 7, a.dest[id] + 11);
  h = hashCombine(h, a.depart[id]);
  h = hashCombine(h, a.activity[id] * 4 + a.byCar[id] * 2 + a.alive[id]);
  h = hashCombine(h, a.from[id] + 13);
  return hashCombine(h, a.with[id] + 17);
}

/** Is the actor out of doors and on foot (seen on the street) at the current clock? */
export function outside(world: World, id: ActorId): boolean {
  const a = world.actors.cols;
  if (!a.alive[id]) return false;
  if (a.dest[id] >= 0) return !a.byCar[id];
  const p = a.place[id];
  return p >= 0 && OUTDOOR.has(world.graph.places[p].kind);
}

/** The actor's track from `clock` on, or null when they are indoors or driving. */
export function trackOf(world: World, map: StreetMap, id: ActorId, clock: number): Track | null {
  if (!outside(world, id)) return null;
  const a = world.actors.cols, sig = signature(world, id);
  const lead = a.with[id];
  // Someone going along (a toddler, the dog) keeps beside who they are with.
  if (lead >= 0 && outside(world, lead) && a.dest[lead] === a.dest[id] && a.place[lead] === a.place[id]) {
    const t = trackOf(world, map, lead, clock);
    if (t) return { ...t, id, keys: beside(t.keys, 0.8), sig };
  }
  if (a.dest[id] >= 0) {
    const keys = tripKeys(world, map, id);
    const indoor = !OUTDOOR.has(world.graph.places[a.dest[id]].kind);
    return { id, keys, hideAfter: indoor ? a.arrive[id] : Infinity, validUntil: a.arrive[id], activity: a.planned[id], sig };
  }
  const place = a.place[id], act = a.activity[id];
  const until = Math.min(a.until[id], clock + AHEAD);
  return { id, keys: stayKeys(world, map, id, place, clock, until), hideAfter: Infinity, validUntil: until, activity: act, sig };
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
  const from = a.from[id] >= 0 ? a.from[id] : a.home[id], to = a.dest[id];
  const t0 = a.depart[id], t1 = Math.max(a.arrive[id], t0 + 0.5);
  const [ox, oz] = whereAt(world, map, id, from, t0);
  const [dx, dz] = whereAt(world, map, id, to, t1);
  const path = walkPath(world, map, id, from, to, ox, oz, dx, dz);
  return timed(map, path, t0, t1);
}

/** The ground path (x, z, …) of a walk between two places, along the sidewalks of the route between them. */
export function walkPath(world: World, map: StreetMap, id: ActorId, from: PlaceId, to: PlaceId, ox: number, oz: number, dx: number, dz: number): number[] {
  const route = world.travel.roadPath(from, to);
  if (route.length < 2) return [ox, oz, dx, dz];
  // Keep to the side of the street the walk starts on; turn the other way at a junction and you cross.
  const c0 = map.centreline(map.edge(route[0], route[1]), route[0]);
  const sign = (c0[2] - c0[0]) * (oz - c0[1]) - (c0[3] - c0[1]) * (ox - c0[0]) > 0 ? 1 : -1;
  const lane = laneOf(world, id);
  const lines: number[][] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const e = map.edge(route[i], route[i + 1]);
    if (e >= 0) lines.push(map.walkLine(e, route[i], sign, lane));
  }
  if (!lines.length) return [ox, oz, dx, dz];
  const walk = lines.flat();
  // Join the street where the door is, not back at the junction behind it; leave it opposite the door ahead.
  const first = closestOnPolyline(lines[0], ox, oz).s;
  const lastStart = polylineLength(walk) - polylineLength(lines[lines.length - 1]);
  const last = lastStart + closestOnPolyline(lines[lines.length - 1], dx, dz).s;
  if (last - first < 1) return [ox, oz, dx, dz];
  return [ox, oz, ...slicePolyline(walk, first, last), dx, dz];
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
  let s = 0;
  for (let i = 0; i < pts.length; i += 2) {
    if (i > 0) s += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    keys.push(t0 + (L > 0 ? (s / L) * (t1 - t0) : 0), pts[i], map.groundY(pts[i], pts[i + 1]), pts[i + 1]);
  }
  return keys;
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
  if (!OUTDOOR.has(pl.kind)) return [pl.x, pl.z];
  const keys = stayKeys(world, map, id, place, t, t);
  const p = sample(keys, t);
  return [p[0], p[2]];
}

/**
 * A stay's stroll from t0 to t1: legs of a fixed length, each a walk to the leg's spot and a pause there.
 * The spot of leg k depends only on (who, place, k), so any stretch of the stay can be laid out on its own
 * and joins up with the stretch before it.
 */
function stayKeys(world: World, map: StreetMap, id: ActorId, place: PlaceId, t0: number, t1: number): number[] {
  const kind = world.graph.places[place].kind;
  const { leg, speed } = STAY[kind] ?? DEFAULT_STAY;
  const street = kind === 'street';
  const keys: number[] = [];
  const k0 = Math.floor(t0 / leg), k1 = Math.floor(t1 / leg) + 1;
  for (let k = k0; k <= k1; k++) {
    const start = k * leg;
    if (street) {
      // Up and down the street on its sidewalk; at the turn they step over to the walking line back.
      const path = streetLeg(world, map, id, place, k - 1, k);
      const walk = Math.min(leg * 0.8, polylineLength(path) / speed);
      const cross = keys.length ? 0.15 : 0;
      const ks = timed(map, path, start + cross, start + cross + walk);
      for (let i = 0; i < ks.length; i += 4) keys.push(ks[i], ks[i + 1], ks[i + 2], ks[i + 3]);
      continue;
    }
    const [px, pz] = map.spot(place, id, k - 1), [qx, qz] = map.spot(place, id, k);
    // A leg's walk takes at most most of the leg (they hurry across a big park rather than never arrive).
    const walk = Math.min(leg * 0.8, Math.hypot(qx - px, qz - pz) / speed);
    if (keys.length === 0) keys.push(start, px, map.groundY(px, pz), pz);
    keys.push(start + Math.max(walk, 0.01), qx, map.groundY(qx, qz), qz);
  }
  return keys;
}

/** A street stay goes up and down the street: even legs end at the street's own node, odd ones at a neighbour. */
function streetNode(world: World, map: StreetMap, id: ActorId, place: PlaceId, k: number): number {
  const home = world.graph.places[place].node;
  if (k % 2 === 0) return home;
  const next = neighbours(map, home);
  return next.length ? next[Math.floor(hash2f(hashCombine(world.seed, id), place, k) * next.length)] : home;
}

/** The walk of a street stay's leg from its node at leg ka to its node at leg kb, on the sidewalk. */
function streetLeg(world: World, map: StreetMap, id: ActorId, place: PlaceId, ka: number, kb: number): number[] {
  const a = streetNode(world, map, id, place, ka), b = streetNode(world, map, id, place, kb);
  const e = map.edge(a, b), n = map.graph.nodes[a];
  if (e < 0) return [n.x, n.z, n.x + 0.01, n.z];
  return map.walkLine(e, a, 1, laneOf(world, id));
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

/**
 * The same keys moved `d` metres to the side of the direction of movement (someone walking beside): to the
 * left, and kept on the same side where the walk turns back (they do not pass through who they are with).
 */
function beside(keys: number[], d: number): number[] {
  const out = keys.slice();
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
    out[i * 4 + 1] += ox;
    out[i * 4 + 3] += oz;
    px = ox; pz = oz;
  }
  return out;
}
