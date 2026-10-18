/**
 * The sim's view snapshot (plan, "town realism": every visible detail that changes over time is caused by the
 * sim). The sim worker sends one with each game minute; every view on the main thread (people, traffic, lit
 * windows, gardens) reads it, and none keeps a channel of its own to the sim. Typed arrays, so the worker
 * transfers them instead of copying.
 *
 * What it holds so far: the date and the weather, where everyone is and what they do, and the journeys under
 * way; once a game day, the town's face (`TownFace`: what each place is now, its name, its looks, the council's
 * rules). A view that needs a fact it lacks adds it here (docs/ARCHITECTURE.md).
 */
import type { ActorId } from './actors';
import { agendaOn, type OccasionKind } from './agenda';
import { dateOf, type GameDate } from './calendar';
import { MINUTES_PER_DAY } from './time';
import type { Mode, Trip } from './travel';
import { townLooks, type TownLooks } from './economy';
import { rulesOf, type TownRules } from './politics';
import { weatherAt, type Weather } from './weather';
import { householdOf, type World } from './world';

/** Travel modes by their index in `TripRows.mode`. */
export const MODES: readonly Mode[] = ['foot', 'car', 'bike', 'bus', 'train'];

/** `world.trips` as columns: row i is one traveller under way (see `Trip`). */
export interface TripRows {
  who: Int32Array;
  from: Int32Array;
  to: Int32Array;
  /** Clock minutes. */
  depart: Float64Array;
  arrive: Float64Array;
  /** Index into MODES. */
  mode: Uint8Array;
  /** The traveller they go with, -1 when on their own account. */
  leader: Int32Array;
  /** The bus or train run, -1 when none. */
  run: Int32Array;
  /** The traveller's household (whose car it is), -1 for none. */
  household: Int32Array;
}

/** Something on in town today, where it is (the place's entrance). What the sound and the stalls need of the agenda. */
export interface ViewOccasion { kind: OccasionKind; start: number; end: number; x: number; z: number }

export interface SimView {
  /** Game minutes since day 0 (whole minutes: the sim's tick). */
  clock: number;
  date: GameDate;
  weather: Weather;
  /** The weather at 07:00 today: what people dressed for when they went out. */
  morning: Weather;
  /** Per actor (index = actor id): where they are (a street while travelling), -1 for nowhere yet. */
  place: Int32Array;
  /** Per actor: where they are going, -1 when not travelling. */
  dest: Int32Array;
  /** Per actor: what they are doing (index into ACTIVITIES). */
  activity: Uint8Array;
  trips: TripRows;
  /** Today's agenda at a place (bin day and trick-or-treating, which happen on every street, are left out). */
  occasions: ViewOccasion[];
  /** The town's face, in the first view of each game day (and the first view of all); null in the others. */
  town: TownFace | null;
}

/**
 * How the town looks today, per place (index = PlaceId of the planner's graph): what the sim has made of it since
 * it was planned. A shop that closed is 'vacant' with a to-let board; a new one has its own name; houses show their
 * owners' money in upkeep and wealth; the council's decisions show in the street (lamps off at midnight, 30 signs,
 * parking meters, a closed pool, building sites).
 */
export interface TownFace {
  /** Game day it was taken. */
  day: number;
  /** Per place: its kind now, an index into PLACE_KINDS. */
  kind: Uint8Array;
  /** Per place: its name now ('' for none). */
  name: string[];
  /** Per place: LOOK_* flags (to let, for sale, new, struggling), upkeep and wealth 0..1. */
  looks: TownLooks;
  rules: TownRules;
}

/** The view of `world` now, with the town's face when `face` is set (the worker sends it once a game day). */
export function viewOf(world: World, face = false): SimView {
  const a = world.actors.cols, n = world.actors.count, t = world.trips, m = t.length;
  const trips: TripRows = {
    who: new Int32Array(m), from: new Int32Array(m), to: new Int32Array(m), depart: new Float64Array(m), arrive: new Float64Array(m),
    mode: new Uint8Array(m), leader: new Int32Array(m), run: new Int32Array(m), household: new Int32Array(m),
  };
  t.forEach((r, i) => {
    trips.who[i] = r.who; trips.from[i] = r.from; trips.to[i] = r.to; trips.depart[i] = r.depart; trips.arrive[i] = r.arrive;
    trips.mode[i] = MODES.indexOf(r.mode); trips.leader[i] = r.leader; trips.run[i] = r.run; trips.household[i] = householdOf(world, r.who)?.id ?? -1;
  });
  return {
    clock: world.clock, date: dateOf(world, world.clock), weather: weatherAt(world),
    morning: weatherAt(world, Math.floor(world.clock / MINUTES_PER_DAY) * MINUTES_PER_DAY + 7 * 60),
    place: a.place.slice(0, n), dest: a.dest.slice(0, n), activity: a.activity.slice(0, n), trips,
    occasions: occasionsOf(world),
    town: face ? townFace(world) : null,
  };
}

/** The town's face now. */
export function townFace(world: World): TownFace {
  const rules = rulesOf(world);
  return {
    day: Math.floor(world.clock / MINUTES_PER_DAY), kind: world.kindOf.slice(), name: world.graph.places.map((p) => p.name),
    looks: townLooks(world), rules: { ...rules, works: rules.works.map((w) => ({ ...w })) },
  };
}

function occasionsOf(world: World): ViewOccasion[] {
  const day = Math.floor(world.clock / MINUTES_PER_DAY), places = world.graph.places;
  const out: ViewOccasion[] = [];
  // Today only: the agenda caches one day, and the schedule reads today.
  for (const { kind, start, end, place } of agendaOn(world, day)) {
    if (place >= 0 && kind !== 'binDay') out.push({ kind, start, end, x: places[place].x, z: places[place].z });
  }
  return out;
}

/** The buffers of a view, for postMessage's transfer list. */
export function viewTransfers(v: SimView): Transferable[] {
  const face = v.town ? [v.town.kind.buffer, v.town.looks.flags.buffer, v.town.looks.upkeep.buffer, v.town.looks.wealth.buffer] : [];
  return [v.place.buffer, v.dest.buffer, v.activity.buffer, ...Object.values(v.trips).map((c: Int32Array) => c.buffer), ...face];
}

/** Row i of a view's trips as a `Trip` (with its household). */
export function tripRow(rows: TripRows, i: number): Trip & { household: number } {
  return {
    who: rows.who[i] as ActorId, from: rows.from[i], to: rows.to[i], depart: rows.depart[i], arrive: rows.arrive[i],
    mode: MODES[rows.mode[i]], leader: rows.leader[i], run: rows.run[i], household: rows.household[i],
  };
}
