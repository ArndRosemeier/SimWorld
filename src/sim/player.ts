/**
 * The player is an inhabitant (D4, plan R5): who they are (`world.player`), whether their routine runs them
 * (autopilot) or the player does, and what the player can tell them to do next. With autopilot off the sim makes no
 * decisions for them (`decideAll` skips `playerDrives`); every move the player picks goes through `go`, the one way
 * an actor's place and activity change, so the street, traffic, encounters and gossip see the player like anyone.
 *
 * Pure: the sim worker answers the game's `play` and `act` messages with these.
 */
import { A, ACTIVITIES, type ActorId } from './actors';
import { isHome, KINDS, type Service } from './placeKinds';
import type { PlaceId } from './places';
import { bondBit, FAMILY_MASK } from './relations';
import { go, isOpen } from './schedule';
import { MINUTES_PER_DAY } from './time';
import { hasCar, isPerson, jobOf, nameOf, placesWith, type World } from './world';

/** Make `id` the player (autopilot on: they carry on with their day until the player takes over). */
export function becomePlayer(world: World, id: ActorId, autopilot = true): void {
  if (!isPerson(world, id)) throw new Error(`becomePlayer: ${id} is not a living person`);
  const was = world.player;
  world.player = { id, autopilot };
  // The one left behind carries on with their own day from here.
  if (was && was.id !== id && !was.autopilot) world.actors.cols.until[was.id] = world.clock;
}

/** Hand the person back to their routine (true) or take the wheel (false). */
export function setAutopilot(world: World, on: boolean): void {
  const p = world.player;
  if (!p) return;
  p.autopilot = on;
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
  const here = a.dest[id] >= 0 ? a.dest[id] : a.place[id] >= 0 ? a.place[id] : a.home[id];
  const home = a.home[id];
  const car = hasCar(world, id);
  const minutes = (to: PlaceId): number => (to === here ? 0 : Math.round(world.travel.minutes(here, to, car)));
  const out: PlayerAction[] = [];
  const add = (label: string, group: string, place: PlaceId, activity: number): void => {
    out.push({ label, group, place, activity, minutes: minutes(place), open: isHome(places[place].kind) || places[place].hours.length === 0 || isOpen(world, place, world.clock + minutes(place)) });
  };
  // Here: what this place offers.
  if (here === home) for (const [label, act] of AT_HOME) add(label, 'Here', home, act);
  else {
    for (const s of SERVICE_ACTIONS) if (KINDS[places[here].kind]?.services.includes(s.service)) add(ACTIVITIES[s.activity] === 'eat' ? 'Eat here' : capital(s.group), 'Here', here, s.activity);
    add('Wait here', 'Here', here, A.idle);
    if (home >= 0) for (const [label, act] of AT_HOME) add(label, 'Home', home, act);
  }
  // Work or school.
  const job = jobOf(world, id);
  if (job) add(`${capital(job.role)} at ${places[job.place].name}`, 'Work', job.place, A.work);
  const school = world.people.cols.school[a.row[id]];
  if (school >= 0) add(places[school].name, 'Work', school, A.school);
  // The people closest to them, at home.
  const rel = world.relations, c = rel.t.cols;
  const ties = rel.known(id)
    .filter((r) => a.alive[c.to[r]] && isPerson(world, c.to[r]) && a.home[c.to[r]] >= 0 && a.home[c.to[r]] !== home)
    .map((r) => ({ r, close: c.familiarity[r] * 0.5 + c.affection[r] + ((c.bonds[r] & FAMILY_MASK) ? 0.3 : 0) + ((c.bonds[r] & bondBit('friend')) ? 0.3 : 0) }))
    .sort((x, y) => y.close - x.close)
    .slice(0, VISITS);
  for (const { r } of ties) add(`Visit ${nameOf(world, c.to[r])}`, 'Visit', a.home[c.to[r]], A.visit);
  // The town's services, the nearest few of each.
  for (const s of SERVICE_ACTIONS) {
    const near = placesWith(world, s.service).filter((pl) => pl !== here && places[pl].kind !== 'away')
      .map((pl) => ({ pl, m: minutes(pl) })).sort((x, y) => x.m - y.m).slice(0, PER_SERVICE);
    for (const { pl } of near) add(places[pl].name, s.group, pl, s.activity);
  }
  return out;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The player sends their person to do `activity` at `place` (travelling there first). With autopilot on this is a
 * nudge: they do it, then their routine picks up again (`hours` from now at the latest). With it off they stay at
 * it until the player picks something else.
 */
export function playerGo(world: World, place: PlaceId, activity: number, hours = 2): void {
  const p = world.player;
  if (!p || !isPerson(world, p.id)) return;
  go(world, p.id, place, activity, p.autopilot ? world.clock + hours * 60 : world.clock + MINUTES_PER_DAY);
}
