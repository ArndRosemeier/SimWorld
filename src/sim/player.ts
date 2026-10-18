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
import { hasCar, isPerson, jobOf, nameOf, placesWith, type World } from './world';

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
 * The player walks their person themselves, out of doors at (x, z): the sim has them on the nearest street, not
 * heading anywhere, until the player walks into somewhere or hands them back to their routine.
 */
export function steerPlayer(world: World, x: number, z: number): void {
  const p = world.player;
  if (!p || !isPerson(world, p.id)) return;
  p.autopilot = false;
  p.at = { x, z };
  const a = world.actors.cols, id = p.id, street = streetPlaceNear(world, x, z);
  if (street < 0 || (a.place[id] === street && a.dest[id] < 0)) return;
  a.dest[id] = -1;
  a.place[id] = street;
  go(world, id, street, A.leisure, world.clock + MINUTES_PER_DAY);
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
  const act = ACTIVITIES[a.dest[id] >= 0 ? a.planned[id] : a.activity[id]];
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
  /** Walked by the player out of doors (`steerPlayer`): (x, z) is where the player last said they are. */
  steered: boolean;
  /** Indoors: the doorstep of the place and the way out (yaw, 0 facing −z), where they step out when taken over. */
  exit: { x: number; z: number; yaw: number } | null;
  /** Needs 0..1 (food, rest, social, hygiene, fun: NEEDS order), and mood -1..1. */
  needs: number[];
  mood: number;
}

/** The player's person now, null while nobody is picked. */
export function playerStatus(world: World): PlayerStatus | null {
  const p = world.player;
  if (!p) return null;
  const id = p.id, a = world.actors.cols, alive = isPerson(world, id);
  const place = a.dest[id] >= 0 ? a.dest[id] : placeNow(world, id);
  const pl = world.graph.places[Math.max(0, place)], at = !p.autopilot ? p.at : null;
  return {
    id, name: nameOf(world, id), alive, autopilot: p.autopilot, doing: alive ? (at ? 'out and about' : doingOf(world, id)) : 'gone',
    place, placeName: pl.name, building: pl.building, x: at ? at.x : pl.x, z: at ? at.z : pl.z, travelling: a.dest[id] >= 0, outdoors: !!at, steered: !!at, exit: null,
    needs: Array.from(a.needs.subarray(id * NEED_COUNT, id * NEED_COUNT + NEED_COUNT)), mood: a.mood[id],
  };
}
