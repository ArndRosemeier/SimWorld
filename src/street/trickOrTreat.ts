/**
 * Trick-or-treating (Halloween evening, src/sim/agenda.ts): the children of a street go from door to door,
 * the small ones with a grown-up, ringing at the homes that put up Halloween decorations (src/sim/decor.ts).
 * The round is the decorated homes near their own, each next one the nearest not yet rung at, and back home.
 *
 * Pure (sim worker, headless tests). New in SimWorld.
 */
import { A, type ActorId } from '../sim/actors';
import { trickOrTreating } from '../sim/agenda';
import { DECOR_HALLOWEEN, homeDecor } from '../sim/decor';
import type { PlaceId } from '../sim/places';
import { MINUTES_PER_DAY } from '../sim/time';
import { activityOf, ageOf, householdOf, type World } from '../sim/world';
import type { StreetMap } from './streetMap';

/** Game minutes per door: the walk there, ringing, the treats, a word at the door. */
export const DOOR_LEG = 1.6;
/** How far (m, as the crow flies from home) a round goes, and how many doors it has at most. */
const REACH = 160;
const MOST = 30;
/** A home on another street counts this much further away (they do their own street first). */
const OTHER_STREET = 40;

const decorCache = new WeakMap<World, { day: number; flags: Uint8Array }>();
/** The evening's rounds (by who) and their walks (by who and door, laid out by src/street/tracks.ts), per street map. */
export interface Evening { day: number; rounds: Map<number, PlaceId[]>; ways: Map<number, number[]> }
const evenings = new WeakMap<StreetMap, Evening>();

/** The rounds and walks of game day `day` (a new evening each day). */
export function eveningOf(map: StreetMap, day: number): Evening {
  let e = evenings.get(map);
  if (!e || e.day !== day) evenings.set(map, (e = { day, rounds: new Map(), ways: new Map() }));
  return e;
}

/** Is `id` out trick-or-treating at street `place` (a child, or a grown-up with one along) on this stay? */
export function trickOrTreater(world: World, id: ActorId, place: PlaceId, anchor: number): boolean {
  const a = world.actors.cols;
  if (activityOf(world, id) !== A.leisure) return false;
  if (world.graph.places[place].kind !== 'street') return false;
  const o = trickOrTreating(world, Math.floor(anchor / MINUTES_PER_DAY));
  if (!o || anchor < o.start - 60 || anchor >= o.end) return false;
  if (ageOf(world, id) < 13) return true;
  const hh = householdOf(world, id);
  return !!hh?.members.some((m) => a.with[m] === id && ageOf(world, m) < 13);
}

/**
 * `id`'s round: their own home first, then the homes they ring at in order: decorated homes (not their own)
 * within REACH of home, their own street first, each next the nearest one left. The same all evening.
 */
export function doorRound(world: World, map: StreetMap, id: ActorId, clock: number): PlaceId[] {
  const c = eveningOf(map, Math.floor(clock / MINUTES_PER_DAY));
  let round = c.rounds.get(id);
  if (round) return round;
  const home = world.actors.cols.home[id], street = world.streetOf[home];
  const flags = decorOn(world, c.day);
  const [hx, hz] = map.doorStep(home);
  const left: { p: PlaceId; x: number; z: number; far: number }[] = [];
  world.graph.places.forEach((pl, p) => {
    if (p === home || pl.homes <= 0 || !(flags[p] & DECOR_HALLOWEEN)) return;
    const [x, z] = map.doorStep(p);
    if (Math.hypot(x - hx, z - hz) > REACH) return;
    left.push({ p, x, z, far: world.streetOf[p] === street ? 0 : OTHER_STREET });
  });
  round = [home];
  let cx = hx, cz = hz;
  while (left.length && round.length <= MOST) {
    let best = 0, bd = Infinity;
    left.forEach((d, i) => { const v = Math.hypot(d.x - cx, d.z - cz) + d.far; if (v < bd) { bd = v; best = i; } });
    const [d] = left.splice(best, 1);
    round.push(d.p);
    cx = d.x; cz = d.z;
  }
  c.rounds.set(id, round);
  return round;
}

/** Halloween decorations per place on game day `day` (computed once a day). */
function decorOn(world: World, day: number): Uint8Array {
  let c = decorCache.get(world);
  if (!c || c.day !== day) decorCache.set(world, (c = { day, flags: homeDecor(world).flags }));
  return c.flags;
}
