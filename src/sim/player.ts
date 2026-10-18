/**
 * The player is an inhabitant (D4, plan R5): who they are (`world.player`), whether their routine runs them
 * (autopilot) or the player does, and what the player can tell them to do next. With autopilot off the sim makes no
 * decisions for them (`decideAll` skips `playerDrives`); every move the player picks goes through `go`, the one way
 * an actor's place and activity change, so the street, traffic, encounters and gossip see the player like anyone.
 *
 * Pure: the sim worker answers the game's `play` and `act` messages with these.
 */
import { A, ACTIVITIES, type ActorId } from './actors';
import { NEED_COUNT } from './species';
import { isHome, KINDS, type Service } from './placeKinds';
import type { PlaceId } from './places';
import { bondBit, FAMILY_MASK } from './relations';
import { capitalize } from './profile';
import { go, isOpen, placeNow } from './schedule';
import { MINUTES_PER_DAY } from './time';
import { activityOf, hasCar, isPerson, jobOf, nameOf, placesWith, tripOf, type World } from './world';

/** Make `id` the player (autopilot on: they carry on with their day until the player takes over). */
export function becomePlayer(world: World, id: ActorId, autopilot = true): void {
  if (!isPerson(world, id)) throw new Error(`becomePlayer: ${id} is not a living person`);
  const was = world.player;
  world.player = { id, autopilot, at: null };
  const a = world.actors.cols;
  // The one left behind carries on with their own day from here.
  if (was && was.id !== id && !was.autopilot) a.until[was.id] = world.clock;
  // Taken over in bed or in an armchair: they get up, ready for whatever the player does.
  if (!autopilot && a.dest[id] < 0 && a.place[id] >= 0 && a.activity[id] !== A.work) go(world, id, a.place[id], A.idle, world.clock + MINUTES_PER_DAY);
}

/**
 * The player walks their person themselves, at (x, z): out of doors (`building` -1) the sim has them on the nearest
 * street; inside building `building` (a `Place.building` code) at the place there that is theirs (their home), else
 * the one whose door is nearest. Not heading anywhere: the routine waits until the player hands them back.
 */
export function steerPlayer(world: World, x: number, z: number, building = -1): void {
  const p = world.player;
  if (!p || !isPerson(world, p.id)) return;
  p.autopilot = false;
  p.at = { x, z };
  const a = world.actors.cols, id = p.id;
  const place = building >= 0 ? placeIn(world, id, building, x, z) : streetPlaceNear(world, x, z);
  if (place < 0 || (a.place[id] === place && a.dest[id] < 0)) return;
  a.dest[id] = -1;
  a.place[id] = place;
  go(world, id, place, building >= 0 ? A.idle : A.leisure, world.clock + MINUTES_PER_DAY);
}

/** The place in building `building` that `id` walks into at (x, z): their home there, else the one with the nearest door. */
function placeIn(world: World, id: ActorId, building: number, x: number, z: number): PlaceId {
  const places = world.graph.places, home = world.actors.cols.home[id];
  if (home >= 0 && places[home].building === building) return home;
  let best = -1, bd = Infinity;
  for (let i = 0; i < places.length; i++) {
    if (places[i].building !== building) continue;
    const d = Math.hypot(places[i].x - x, places[i].z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** The street place nearest (x, z) (-1 when the town has none). */
function streetPlaceNear(world: World, x: number, z: number): PlaceId {
  let best = -1, bd = Infinity;
  const places = world.graph.places;
  for (let i = 0; i < places.length; i++) {
    if (places[i].kind !== 'street') continue;
    const d = Math.hypot(places[i].x - x, places[i].z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Hand the person back to their routine (true) or take the wheel (false). */
export function setAutopilot(world: World, on: boolean): void {
  const p = world.player;
  if (!p) return;
  p.autopilot = on;
  if (on) p.at = null;
  // Back on autopilot: they decide again at once rather than finishing whatever the player last picked.
  if (on && world.actors.cols.dest[p.id] < 0) world.actors.cols.until[p.id] = world.clock;
}

/** Something the player can tell their person to do. */
export interface PlayerAction {
  /** "Sleep", "The Crown (pub)", "Visit your sister Anna". */
  label: string;
  /** Section in the menu: 'Here', 'Home', 'Work', 'Visit', 'Eat', 'Shop', … */
  group: string;
  place: PlaceId;
  activity: number;
  /** Minutes to get there (0 when here). */
  minutes: number;
  /** Open now (homes always are). */
  open: boolean;
}

/** The menu sections for services, and the activity each starts. */
const SERVICE_ACTIONS: { service: Service; group: string; activity: number }[] = [
  { service: 'eat', group: 'Eat out', activity: A.eat },
  { service: 'socialize', group: 'Meet people', activity: A.socialize },
  { service: 'shop', group: 'Shop', activity: A.shop },
  { service: 'errand', group: 'Errands', activity: A.errand },
  { service: 'leisure', group: 'Leisure', activity: A.leisure },
  { service: 'exercise', group: 'Exercise', activity: A.exercise },
  { service: 'worship', group: 'Worship', activity: A.worship },
  { service: 'doctor', group: 'Doctor', activity: A.doctor },
];

/** Things to do at home. */
const AT_HOME: [string, number][] = [['Sleep', A.sleep], ['Eat', A.eat], ['Wash', A.wash], ['Relax', A.leisure]];

/** Places per service offered (the nearest first). */
const PER_SERVICE = 4;
/** Friends and family offered to visit. */
const VISITS = 6;

/** What the player's person can do now: here, at home, at work, visiting the people closest to them, and the town's services nearby. */
export function playerActions(world: World): PlayerAction[] {
  const p = world.player;
  if (!p || !isPerson(world, p.id)) return [];
  const id = p.id, a = world.actors.cols, places = world.graph.places;
  const here = a.dest[id] >= 0 ? a.dest[id] : placeNow(world, id);
  const home = a.home[id];
  const car = hasCar(world, id);
  const minutes = (to: PlaceId): number => (to === here ? 0 : Math.round(world.travel.minutes(here, to, car)));
  const out: PlayerAction[] = [];
  const offer = (label: string, group: string, place: PlaceId, activity: number): void => {
    out.push({ label, group, place, activity, minutes: minutes(place), open: isHome(places[place].kind) || places[place].hours.length === 0 || isOpen(world, place, world.clock + minutes(place)) });
  };
  // Here: what this place offers.
  if (here === home) for (const [label, act] of AT_HOME) offer(label, 'Here', home, act);
  else {
    for (const s of SERVICE_ACTIONS) if (KINDS[places[here].kind]?.services.includes(s.service)) offer(ACTIVITIES[s.activity] === 'eat' ? 'Eat here' : capitalize(s.group), 'Here', here, s.activity);
    offer('Wait here', 'Here', here, A.idle);
    if (home >= 0) for (const [label, act] of AT_HOME) offer(label, 'Home', home, act);
  }
  // Work or school.
  const job = jobOf(world, id);
  if (job) offer(`${capitalize(job.role)} at ${places[job.place].name}`, 'Work', job.place, A.work);
  const school = world.people.cols.school[a.row[id]];
  if (school >= 0) offer(places[school].name, 'Work', school, A.school);
  // The people closest to them, at home.
  const rel = world.relations, c = rel.t.cols;
  const ties = rel.known(id)
    .filter((r) => a.alive[c.to[r]] && isPerson(world, c.to[r]) && a.home[c.to[r]] >= 0 && a.home[c.to[r]] !== home)
    .map((r) => ({ r, close: c.familiarity[r] * 0.5 + c.affection[r] + ((c.bonds[r] & FAMILY_MASK) ? 0.3 : 0) + ((c.bonds[r] & bondBit('friend')) ? 0.3 : 0) }))
    .sort((x, y) => y.close - x.close)
    .slice(0, VISITS);
  for (const { r } of ties) offer(`Visit ${nameOf(world, c.to[r])}`, 'Visit', a.home[c.to[r]], A.visit);
  // The town's services, the nearest few of each.
  for (const s of SERVICE_ACTIONS) {
    const near = placesWith(world, s.service).filter((pl) => pl !== here && places[pl].kind !== 'away')
      .map((pl) => ({ pl, m: minutes(pl) })).sort((x, y) => x.m - y.m).slice(0, PER_SERVICE);
    for (const { pl } of near) offer(places[pl].name, s.group, pl, s.activity);
  }
  return out;
}

/**
 * The player sends their person to do `activity` at `place` (travelling there first). With autopilot on this is a
 * nudge: they do it, then their routine picks up again (`hours` from now at the latest). With it off they stay at
 * it until the player picks something else.
 */
export function playerGo(world: World, place: PlaceId, activity: number, hours = 2): void {
  const p = world.player;
  if (!p || !isPerson(world, p.id)) return;
  // Sent somewhere: the sim walks them there (the player can take over again on the way).
  p.at = null;
  go(world, p.id, place, activity, p.autopilot ? world.clock + hours * 60 : world.clock + MINUTES_PER_DAY);
}

/** What someone is up to, in words ("walking to Elm Street Bakery (shop)", "work at the town hall"). */
export function doingOf(world: World, id: ActorId): string {
  const a = world.actors.cols, places = world.graph.places;
  const act = ACTIVITIES[activityOf(world, id)];
  if (a.dest[id] >= 0) return `walking to ${places[a.dest[id]].name} (${act})`;
  return a.place[id] >= 0 ? `${act} at ${places[a.place[id]].name}` : act;
}

/** The player's person as the play panel shows them. */
export interface PlayerStatus {
  id: ActorId;
  name: string;
  /** False once they have died or moved away (the game then asks the player to pick someone else). */
  alive: boolean;
  autopilot: boolean;
  doing: string;
  /** Where they are, or where they are heading while on the way. */
  place: PlaceId;
  placeName: string;
  /** That place's building (`Place.building`: decode with src/plan/placeGraph.ts `buildingRef`; -1 none): the interior to show while they are inside (src/render/interiorView.ts). */
  building: number;
  /** That place's entrance (the camera looks there while they are indoors). */
  x: number;
  z: number;
  travelling: boolean;
  /** Out of doors: (x, z) is then where they are on the street (the sim worker fills this in from their track). */
  outdoors: boolean;
  /** Walked by the player (`steerPlayer`), out of doors or in: (x, z) is where the player last said they are. */
  steered: boolean;
  /** Where the player takes over (the sim worker fills it in: src/street/takeover.ts), null before. */
  take: Takeover | null;
  /** Needs 0..1 (food, rest, social, hygiene, fun: NEEDS order), and mood -1..1. */
  needs: number[];
  mood: number;
  /** Their home: its building (`Place.building` code, -1 none) and entrance; null when they have none. */
  home: { building: number; x: number; z: number } | null;
  /** The people they know by name, alive and in town (the minimap marks those out near you): family, then the others, closest first. */
  kin: ActorId[];
  known: ActorId[];
}

/** How well someone without a bond (friend, colleague, neighbour, …) must be known to count as known by name (`Relations` familiarity). */
const KNOWN_BY_NAME = 0.1;
/** At most this many non-family people are listed (closest first). */
const KNOWN_MAX = 80;

/** The people `id` knows by name: family, and the others they have a bond with or know at least `KNOWN_BY_NAME` well (closest first). */
export function tiesOf(world: World, id: ActorId): { kin: ActorId[]; known: ActorId[] } {
  const rel = world.relations, c = rel.t.cols, a = world.actors.cols;
  const kin: ActorId[] = [], known: number[] = [];
  for (const r of rel.known(id)) {
    const o = c.to[r];
    if (!a.alive[o] || !isPerson(world, o)) continue;
    if (c.bonds[r] & FAMILY_MASK) kin.push(o);
    else if (c.bonds[r] || c.familiarity[r] >= KNOWN_BY_NAME) known.push(r);
  }
  known.sort((x, y) => c.familiarity[y] - c.familiarity[x]);
  return { kin, known: known.slice(0, KNOWN_MAX).map((r) => c.to[r]) };
}

/** The player's person now, null while nobody is picked. */
export function playerStatus(world: World): PlayerStatus | null {
  const p = world.player;
  if (!p) return null;
  const id = p.id, a = world.actors.cols, alive = isPerson(world, id);
  const place = a.dest[id] >= 0 ? a.dest[id] : placeNow(world, id);
  const pl = world.graph.places[Math.max(0, place)], at = !p.autopilot ? p.at : null;
  const home = a.home[id] >= 0 ? world.graph.places[a.home[id]] : null;
  return {
    id, name: nameOf(world, id), alive, autopilot: p.autopilot, doing: alive ? (at ? 'out and about' : doingOf(world, id)) : 'gone',
    place, placeName: pl.name, building: pl.building, x: at ? at.x : pl.x, z: at ? at.z : pl.z, travelling: a.dest[id] >= 0, outdoors: !!at && a.place[id] >= 0 && KINDS[world.graph.places[a.place[id]].kind].category === 'outdoor', steered: !!at, take: null,
    needs: Array.from(a.needs.subarray(id * NEED_COUNT, id * NEED_COUNT + NEED_COUNT)), mood: a.mood[id],
    home: home ? { building: home.building, x: home.x, z: home.z } : null,
    ...tiesOf(world, id),
  };
}

/**
 * Where the player takes someone over, as the sim has them: inside their building (by the spot they were given),
 * on the street (on their walk, or at the doorstep of a place with no inside to show), or not yet: in a car, on a
 * bus or a bike, or out of town, the player starts when they are on foot in town again (`back`: about when, or null).
 */
export type Takeover =
  /** In `building`; (x, z, yaw): its doorstep, facing out, for a building with no inside to show. */
  | { kind: 'inside'; building: number; x: number; z: number; yaw: number }
  | { kind: 'street'; x: number; z: number; yaw: number }
  | { kind: 'wait'; why: string; back: number | null };

/** The vehicle words for a trip under way ("driving to the town hall"). */
const RIDING: Record<string, string> = { car: 'driving', bus: 'on the bus', train: 'on the train', bike: 'cycling' };

/**
 * Can `id` not be taken over now, and why: on their way somewhere by car, bus, train or bike (until they get there),
 * or out of town (at work in the city, at school in the next town, or on the way: until they are back). Null when
 * they can be (at home, at a place in town, walking).
 */
export function waitOf(world: World, id: ActorId): Extract<Takeover, { kind: 'wait' }> | null {
  const a = world.actors.cols, places = world.graph.places;
  const isAway = (p: PlaceId) => p >= 0 && places[p].kind === 'away';
  if (a.dest[id] >= 0) {
    const mode = tripOf(world, id)?.mode ?? 'foot', to = places[a.dest[id]];
    if (isAway(a.dest[id])) return { kind: 'wait', why: `on the way to ${to.name}`, back: null };
    if (mode !== 'foot') return { kind: 'wait', why: `${RIDING[mode] ?? 'travelling'} to ${to.name}`, back: a.arrive[id] };
    if (isAway(a.place[id])) return { kind: 'wait', why: `coming back from ${places[a.place[id]].name}`, back: a.arrive[id] };
    return null;
  }
  const here = a.place[id];
  if (!isAway(here)) return null;
  const home = a.home[id] >= 0 ? a.home[id] : here;
  return { kind: 'wait', why: doingOf(world, id), back: a.until[id] + world.travel.minutes(here, home, hasCar(world, id)) };
}
