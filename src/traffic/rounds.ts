/**
 * Rounds: vehicles that come into town from the region, stop at a list of places and leave again.
 * The timetable's buses (src/traffic/buses.ts) and the service rounds here are both rounds:
 *
 * - the bin lorry on bin day (the agenda's `binDay`, one weekday per street), stopping along every
 *   street whose bins are out, early in the morning;
 * - the post van, Monday to Saturday, round a share of the streets with houses;
 * - the morning delivery lorry to the shops that sell food and drink, on the days they open;
 * - the parcel van, on weekdays, to a few homes;
 * - the emergency services, from the sim's own events: the police car from the town's police
 *   station to where a crime was reported the night before, and on its patrols; the ambulance
 *   from the hospital town, blue lights and siren, to the home of someone poorly (the sick and
 *   the old most often), now and then.
 *
 * Every other round comes from and returns to the nearby town (the depot, the sorting office, the
 * warehouse). New in SimWorld. Pure (no three.js); seeded per day.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { agendaOn } from '../sim/agenda';
import { ACTOR_PERSON } from '../sim/actors';
import { runsLike } from '../sim/calendar';
import { poisson } from '../sim/life';
import { COMPASS, regionPlaces } from '../sim/region';
import { homesRadius, streetHomes } from '../sim/places';
import { DAYS_PER_YEAR, MINUTES_PER_DAY, dayOf } from '../sim/time';
import type { Run } from '../sim/transit';
import type { World } from '../sim/world';
import { junctionBack } from './traffic';
import type { RoadNet } from './roadNet';
import type { Car, Goal } from './traffic';

/**
 * A place a round stops at: where, how long at least (s), not before `leave` (clock min), and
 * whether it pulls in to the kerb so traffic goes past (`bay`: vans and lorries at a door, buses
 * at a stop) or stands in the lane (the bin lorry, moving on every half minute).
 */
export interface RoundStop { x: number; z: number; dwell: number; leave?: number; bay?: boolean; tag: number; /** Blue lights and siren on the way there and while there. */ urgent?: boolean }

/** A vehicle's round: it comes on to the map at `spawn` (clock min) at exit `enter`, stops, and leaves by `leaveBy`. */
export interface Round {
  car: Car;
  spawn: number;
  enter: number;
  stops: RoundStop[];
  leaveBy: number;
  /** The timetable run, for a bus. */
  run?: Run;
  /** A vehicle based in town (the police car at its station): it sets off from there and parks there again (no `enter` / `leaveBy`). */
  base?: { x: number; z: number };
}

/** Keys of service vehicles start here (buses at 1 << 26, through traffic at 1 << 24). */
export const SERVICE_KEY = 1 << 27;
/** Seconds the bin lorry stands at each stop (a few bins each side), metres between its stops. */
const BIN_DWELL = 25, BIN_EVERY = 45;
/** Seconds the post van and the parcel van stand at a door; the lorry at a shop. */
const POST_DWELL = 50, PARCEL_DWELL = 90, SHOP_DWELL = 300;
/** The emergency services' vehicles: the police cars (fixed keys, based at the station), the ambulance calls. */
export const EMERGENCY_KEY = 1 << 29, POLICE_CARS = 2;
/** Ambulance calls a year per 1000 people; seconds at the door. */
const AMBULANCE_RATE = 90, AMBULANCE_DWELL = 1200;
/** Seconds the police stand where a crime was reported; at a stop on patrol. */
const REPORT_DWELL = 2100, PATROL_DWELL = 120;
/** Crimes the police come round about the next day. */
const REPORTED = new Set(['theft', 'burglary', 'vandalism', 'fight']);
/** Shops that take a morning delivery. */
const DELIVERED = new Set(['supermarket', 'grocer', 'bakery', 'butcher', 'cafe', 'pub', 'restaurant', 'newsagent', 'takeaway', 'pharmacy']);

/** The exit whose road leads towards a region town by its compass direction (the nearby town when unknown). */
export function exitTowardRegion(world: World, net: RoadNet, region: string | null): number {
  const places = regionPlaces(world);
  const place = places.find((p) => p.name === region) ?? places[1];
  return net.exitToward(place ? COMPASS.indexOf(place.dir) * 45 : 0);
}

/** The goal chain of a round: every stop (leaving at its time on the Traffic clock), then off the map. */
export function roundGoal(r: Round, trafficTimeOf: (clock: number) => number): Goal {
  let g: Goal = r.base ? { park: true, x: r.base.x, z: r.base.z } : { exit: r.leaveBy };
  for (let i = r.stops.length - 1; i >= 0; i--) {
    const h = r.stops[i];
    g = { halt: true, x: h.x, z: h.z, dwell: h.dwell, leave: h.leave === undefined ? undefined : trafficTimeOf(h.leave), bay: h.bay, then: g, tag: h.tag, urgent: h.urgent };
  }
  return g;
}

/** The town's service rounds, planned per day from the agenda, the calendar and the places. */
export class ServiceRounds {
  private readonly days = new Map<number, Round[]>();

  constructor(private readonly world: World, private readonly net: RoadNet) {}

  /** Rounds that come on to the map in the game minutes (since, clock]. */
  due(since: number, clock: number): Round[] {
    const out: Round[] = [];
    for (let day = dayOf(since); day <= dayOf(clock); day++) for (const r of this.on(day)) if (r.spawn > since && r.spawn <= clock) out.push(r);
    return out;
  }

  /** Every service round of a game day. */
  on(day: number): Round[] {
    let rs = this.days.get(day);
    if (rs) return rs;
    if (this.days.size > 3) this.days.clear();
    rs = this.plan(day);
    this.days.set(day, rs);
    return rs;
  }

  private plan(day: number): Round[] {
    const { world, net } = this;
    const d0 = day * MINUTES_PER_DAY, wd = runsLike(world, d0);
    const rng = new Rng(deriveSeed(world.seed, 'rounds', day));
    const depot = exitTowardRegion(world, net, null);
    if (depot < 0) return [];
    const places = world.graph.places;
    const out: Round[] = [];
    let n = 0;
    const round = (kind: Car['kind'], variant: number, spawn: number, stops: RoundStop[]) => {
      if (stops.length) out.push({ car: { key: SERVICE_KEY + ((day * 64 + n++) % (1 << 26)), kind, variant }, spawn, enter: depot, stops: nearestFirst(net.nodes[depot], stops), leaveBy: depot });
    };
    // ---- bin day: every street whose bins are out today, a stop every BIN_EVERY m along it
    const binStreets = new Set(agendaOn(world, day).filter((o) => o.kind === 'binDay').map((o) => places[o.place]?.name));
    const bins: RoundStop[] = [];
    net.edges.forEach((e, ei) => {
      if (e.street < 0 || e.park <= 0 || !binStreets.has(net.streets[e.street])) return;
      const back = junctionBack(e) + 6;
      for (let s = back; s <= e.len - back; s += BIN_EVERY) {
        const p = { x: 0, z: 0, dx: 0, dz: 0 };
        net.lanePoint(e, s, 0, p);
        bins.push({ x: p.x, z: p.z, dwell: BIN_DWELL, tag: ei });
      }
    });
    round('truck', 1, d0 + 6 * 60 + 30, bins);
    out.push(...this.emergencies(day, rng.fork('emergency')));
    if (wd === 6) return out;
    // ---- the post van: Monday to Saturday, a share of the streets people live on (stopping where their homes are)
    const post = streetHomes(world.graph).filter(() => rng.chance(0.6)).map((s) => ({ x: s.at.x, z: s.at.z, dwell: POST_DWELL, bay: true, tag: s.at.id }));
    round('van', 2, d0 + 9 * 60 + rng.int(0, 30), post);
    // ---- the delivery lorry to the food shops open today, early
    const open = (p: (typeof places)[number]) => p.hours.some((h) => h.days & (1 << wd));
    const shops = places.filter((p) => DELIVERED.has(p.kind) && open(p)).map((p) => ({ x: p.x, z: p.z, dwell: SHOP_DWELL, bay: true, tag: p.id }));
    round('delivery', 0, d0 + 5 * 60 + 40 + rng.int(0, 20), shops);
    if (wd === 5) return out;
    // ---- the parcel van: a few homes on a weekday
    const homes = places.filter((p) => p.homes > 0);
    const parcels = Array.from({ length: Math.min(homes.length, 3 + rng.int(0, 5)) }, () => rng.pick(homes)).map((p) => ({ x: p.x, z: p.z, dwell: PARCEL_DWELL, bay: true, tag: p.id }));
    round('delivery', 1, d0 + 10 * 60 + rng.int(0, 120), [...new Map(parcels.map((p) => [p.tag, p])).values()]);
    return out;
  }

  /** The emergency services' rounds of a day (see the header): police reports and patrols, ambulance calls. */
  private emergencies(day: number, rng: Rng): Round[] {
    const { world, net } = this;
    const d0 = day * MINUTES_PER_DAY, places = world.graph.places, out: Round[] = [];
    const station = places.find((p) => p.kind === 'police');
    const police = (k: number, spawn: number, stops: RoundStop[]) => {
      if (stops.length) out.push({ car: { key: EMERGENCY_KEY + k, kind: 'police', variant: 0 }, spawn, enter: -1, stops, leaveBy: -1, base: station });
    };
    if (station) {
      // The crimes logged at midnight: the police call round in the day, one place after another.
      const reports = world.life.events.filter((e) => e.day === day && REPORTED.has(e.kind) && e.place >= 0 && places[e.place]);
      const calls = reports.map((e) => ({ x: places[e.place].x, z: places[e.place].z, dwell: REPORT_DWELL, bay: true, tag: e.place }));
      police(1, d0 + 9 * 60 + rng.int(0, 90), nearestFirst(station, calls));
      // Patrols: late morning and afternoon, and the weekend evenings, past a few streets (where their homes are) and squares.
      const reach = homesRadius(world.graph, station.x, station.z);
      const beat = [...places.filter((p) => p.kind === 'square' || p.kind === 'park'), ...streetHomes(world.graph).map((s) => s.at)].filter((p) => Math.hypot(p.x - station.x, p.z - station.z) <= reach);
      const wd = runsLike(world, d0);
      for (const h of wd >= 4 ? [10, 15, 21] : [10, 15]) {
        const stops = Array.from({ length: Math.min(beat.length, 4) }, () => rng.pick(beat)).map((p) => ({ x: p.x, z: p.z, dwell: PATROL_DWELL, bay: true, tag: p.id }));
        police(0, d0 + h * 60 + rng.int(0, 50), nearestFirst(station, stops));
      }
    }
    // Ambulance calls: someone at home taken poorly, the frail most often; from the hospital town and back.
    const a = world.actors.cols;
    const people: number[] = [], weight: number[] = [];
    for (const hh of world.households) for (const m of hh.members) {
      if (!a.alive[m] || a.kind[m] !== ACTOR_PERSON || !places[hh.home]) continue;
      people.push(m);
      weight.push((1.05 - a.health[m]) ** 2 * (1 + Math.max(0, (day - a.birth[m]) / DAYS_PER_YEAR - 50) / 15));
    }
    const hospital = regionPlaces(world).find((p) => p.services.includes('hospital'))?.name ?? null;
    const exit = exitTowardRegion(world, net, hospital);
    const calls = poisson((people.length / 1000) * (AMBULANCE_RATE / DAYS_PER_YEAR), rng);
    for (let i = 0; i < calls && exit >= 0; i++) {
      const who = people[rng.weighted(people.map((_, j) => j), (j) => weight[j])];
      const home = places[a.home[who]];
      const spawn = d0 + rng.int(7 * 60, 23 * 60);
      out.push({ car: { key: EMERGENCY_KEY + 1024 + ((day * 8 + i) % (1 << 20)), kind: 'ambulance', variant: 0 }, spawn, enter: exit, leaveBy: exit,
        stops: [{ x: home.x, z: home.z, dwell: AMBULANCE_DWELL, urgent: true, tag: home.id }] });
    }
    return out;
  }
}

/** Stops in the order a driver takes them: always the nearest one left, starting from `from` (the exit, the station). */
function nearestFirst(from: { x: number; z: number }, stops: RoundStop[]): RoundStop[] {
  const left = stops.slice(), out: RoundStop[] = [];
  let { x, z } = from;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - x, left[i].z - z) < Math.hypot(left[bi].x - x, left[bi].z - z)) bi = i;
    const s = left.splice(bi, 1)[0];
    out.push(s);
    x = s.x; z = s.z;
  }
  return out;
}
