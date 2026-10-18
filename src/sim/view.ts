/**
 * The sim's view snapshot (plan, "town realism": every visible detail that changes over time is caused by the
 * sim). The sim worker sends one with each game minute; every view on the main thread (people, traffic, lit
 * windows, gardens) reads it, and none keeps a channel of its own to the sim. Typed arrays, so the worker
 * transfers them instead of copying.
 *
 * What it holds so far: the date and the weather, where everyone is and what they do, and the journeys under
 * way. A view that needs a fact it lacks adds it here (docs/ARCHITECTURE.md).
 */
import type { ActorId } from './actors';
import { agendaOn, type OccasionKind } from './agenda';
import { dateOf, type GameDate } from './calendar';
import { MINUTES_PER_DAY } from './time';
import type { Mode, Trip } from './travel';
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
}

/** The view of `world` now. */
export function viewOf(world: World): SimView {
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
  return [v.place.buffer, v.dest.buffer, v.activity.buffer, ...Object.values(v.trips).map((c: Int32Array) => c.buffer)];
}

/** Row i of a view's trips as a `Trip` (with its household). */
export function tripRow(rows: TripRows, i: number): Trip & { household: number } {
  return {
    who: rows.who[i] as ActorId, from: rows.from[i], to: rows.to[i], depart: rows.depart[i], arrive: rows.arrive[i],
    mode: MODES[rows.mode[i]], leader: rows.leader[i], run: rows.run[i], household: rows.household[i],
  };
}
