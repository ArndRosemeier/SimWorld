/**
 * Public transport: the town's bus line out to the nearby town, the school bus that takes the
 * secondary pupils there on school days, and the trains at the station. Lines, stops and the
 * timetable, as pure data the society simulation and the views share: people in the sim ride
 * them (`nextRide`), the station board and the bus stop show them (`departures`), the traffic and
 * the rail view move the vehicles where the timetable says they are (`runsAt`).
 *
 * New in SimWorld. A function of the place graph, the region and the calendar (no state of its
 * own): the same for the live tick, the time skip and the screen.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { runsLike, schoolDay } from './calendar';
import type { PlaceId } from './places';
import { dayOf, MINUTES_PER_DAY, minuteOfDay } from './time';
import { WALK_M_PER_MIN } from './travel';
import type { World } from './world';

export type TransitMode = 'bus' | 'train';

/** A place where a bus or train stops: a place in town, or a town of the region (off the map). */
export interface Stop {
  id: number;
  name: string;
  /** The place in town, or -1 for a region stop. */
  place: PlaceId;
  /** The region place's name for a stop out of town, else null. */
  region: string | null;
}

export interface Line {
  id: number;
  /** "1", "S", "Rail". */
  code: string;
  /** "Bus 1 to Marwick", "School bus", "Trains to Carlston". */
  name: string;
  mode: TransitMode;
}

/** Which days a run runs on. */
export type RunDays = 'weekday' | 'saturday' | 'sunday' | 'school';

/** One journey of a line: the stops in order and the minute of day at each (may pass 1440). */
export interface Run {
  id: number;
  line: number;
  days: RunDays;
  stops: number[];
  times: number[];
}

export interface Transit {
  stops: Stop[];
  lines: Line[];
  runs: Run[];
}

/** Minutes a bus or train stands at a stop. */
export const DWELL = 1;
/** Average bus speed out of town (km/h) and the time it loses getting in and out of the towns (min). */
const BUS_KMH = 55, BUS_TOWN_MIN = 6;
/** How far people walk to a stop (m). */
export const STOP_WALK = 1200;

const cache = new WeakMap<World, Transit>();

/** The transit of a world (built once from its place graph and region). */
export function transitOf(world: World): Transit {
  let t = cache.get(world);
  if (!t) cache.set(world, (t = buildTransit(world)));
  return t;
}

function buildTransit(world: World): Transit {
  const { graph } = world;
  const rng = new Rng(deriveSeed(world.seed, 'transit'));
  const stops: Stop[] = [], lines: Line[] = [], runs: Run[] = [];
  /** The stop at a town place (`place` ≥ 0) or a region town (`region`), made on first use. */
  const stop = (place: PlaceId, name: string, region: string | null = null): number => {
    const old = stops.find((s) => (region ? s.region === region : s.place === place));
    if (old) return old.id;
    return stops.push({ id: stops.length, name, place, region }) - 1;
  };
  const stopAt = (place: PlaceId, name: string) => stop(place, name);
  const regionStop = (name: string) => stop(-1, name, name);
  const places = graph.places;
  const station = places.find((p) => p.kind === 'station');
  const centre = places.find((p) => p.kind === 'square') ?? places.find((p) => p.kind === 'townhall');
  const regionPlaces = world.region?.region.places ?? [];
  // places[0] is the big city, places[1] the larger town nearby (hospital, secondary school).
  const city = regionPlaces[0], near = regionPlaces[1];
  const nearName = near?.name ?? 'the nearby town', nearKm = near?.km ?? 15;
  const cityName = city?.name ?? 'the city', cityKm = city?.km ?? 60;

  // Minutes between two town stops by bus: the car's time plus a minute for the stop.
  const hop = (a: number, b: number) => world.travel.minutes(stops[a].place, stops[b].place, true) + DWELL;
  /** A line's runs at the given departure minutes from its first stop, both directions. */
  const timetable = (line: number, there: number[], legs: number[], days: RunDays, starts: number[], backStarts: number[]) => {
    for (const [seq, times0, dir] of [[there, starts, 0], [[...there].reverse(), backStarts, 1]] as const) {
      const l = dir === 0 ? legs : [...legs].reverse();
      for (const t0 of times0) {
        const times = [t0];
        for (const m of l) times.push(times[times.length - 1] + m);
        runs.push({ id: runs.length, line, days, stops: [...seq], times });
      }
    }
  };
  const every = (from: number, to: number, step: number) => { const out: number[] = []; for (let t = from; t <= to; t += step) out.push(t); return out; };

  // ---- bus 1: the station, the centre, out to the nearby town
  const town = [station, centre].filter((p): p is NonNullable<typeof p> => !!p);
  if (town.length) {
    const seq = town.map((p) => stopAt(p.id, p.kind === 'station' ? `${p.name}` : p.name));
    seq.push(regionStop(nearName));
    const legs: number[] = [];
    for (let i = 0; i + 1 < seq.length; i++) legs.push(stops[seq[i + 1]].region ? Math.round((nearKm / BUS_KMH) * 60 + BUS_TOWN_MIN) : hop(seq[i], seq[i + 1]));
    const line = lines.push({ id: lines.length, code: '1', name: `Bus 1 to ${nearName}`, mode: 'bus' }) - 1;
    const off = rng.int(0, 9);
    timetable(line, seq, legs, 'weekday', every(6 * 60 + off, 19 * 60 + off, 60), every(6 * 60 + 30 + off, 19 * 60 + 30 + off, 60));
    timetable(line, seq, legs, 'saturday', every(8 * 60 + off, 18 * 60 + off, 120), every(9 * 60 + off, 19 * 60 + off, 120));
  }

  // ---- the school bus: three pick-ups spread over the town, then the centre, to the secondary school in the nearby town
  // Streets people live on (a stop on a farm road 5 km out would take the bus half the morning).
  const homesOn = new Map<string, number>();
  for (const p of places) if (p.homes > 0) homesOn.set(p.street, (homesOn.get(p.street) ?? 0) + p.homes);
  const streets = places.filter((p) => p.kind === 'street' && (homesOn.get(p.name) ?? 0) >= 6);
  if (streets.length && centre) {
    const picks: typeof streets = [];
    // Farthest-point picks: the first farthest from the centre, then each farthest from those chosen.
    for (let k = 0; k < Math.min(3, streets.length); k++) {
      let best = streets[0], bd = -1;
      for (const s of streets) {
        const d = Math.min(...[centre, ...picks].map((q) => Math.hypot(q.x - s.x, q.z - s.z)));
        if (d > bd) { bd = d; best = s; }
      }
      picks.push(best);
    }
    // In order round the town (by angle about the centre), ending at the centre.
    picks.sort((a, b) => Math.atan2(a.z - centre.z, a.x - centre.x) - Math.atan2(b.z - centre.z, b.x - centre.x));
    const seq = [...picks.map((p) => stopAt(p.id, p.name)), stopAt(centre.id, centre.name), regionStop(nearName)];
    const legs: number[] = [];
    for (let i = 0; i + 1 < seq.length; i++) legs.push(stops[seq[i + 1]].region ? Math.round((nearKm / BUS_KMH) * 60 + BUS_TOWN_MIN) : hop(seq[i], seq[i + 1]));
    const line = lines.push({ id: lines.length, code: 'S', name: 'School bus', mode: 'bus' }) - 1;
    const ride = legs.reduce((a, b) => a + b, 0);
    // At school by 07:55; back from school at 15:35.
    timetable(line, seq, legs, 'school', [7 * 60 + 55 - ride], [15 * 60 + 35]);
  }

  // ---- trains: to the city, and out into the country the other way unless the town is at the end of a branch line
  // (A region planned before it knew the railway, or none at all: trust the station.)
  const rail = world.region?.region.rail === undefined ? 'through' : world.region.region.rail;
  if (station && rail) {
    const st = stopAt(station.id, station.name);
    const far = regionPlaces.slice(2).sort((a, b) => b.km - a.km)[0];
    // As the region lore tells it: about km / 80 h plus ten minutes, twenty more with a change on a branch line.
    const lines2: [string, number, boolean][] = [[cityName, Math.round((cityKm / 80) * 60 + (rail === 'terminus' ? 30 : 10)), true]];
    if (rail === 'through' && far) lines2.push([far.name, Math.max(8, Math.round((far.km / 80) * 60 + 5)), false]);
    for (const [dest, ride, peak] of lines2) {
      const to = regionStop(dest);
      const line = lines.push({ id: lines.length, code: 'Rail', name: `Trains to ${dest}`, mode: 'train' }) - 1;
      const off = rng.int(0, 59);
      // Trains back leave there so they pass ours half an hour apart: back at the station at :off+30.
      const back = (ts: number[]) => ts.map((t) => t + 30 - ride);
      const base = every(5 * 60 + off, 22 * 60 + off, 60);
      // Into the city twice an hour in the morning rush, home twice an hour in the evening one.
      const outPeak = peak ? every(6 * 60 + 30 + off, 8 * 60 + 30 + off, 60) : [];
      const backPeak = peak ? every(17 * 60 + off, 18 * 60 + off, 60) : [];
      const sorted = (ts: number[]) => ts.sort((a, b) => a - b);
      timetable(line, [st, to], [ride], 'weekday', sorted([...base, ...outPeak]), back(sorted([...base, ...backPeak])));
      timetable(line, [st, to], [ride], 'saturday', every(7 * 60 + off, 22 * 60 + off, 60), back(every(7 * 60 + off, 22 * 60 + off, 60)));
      timetable(line, [st, to], [ride], 'sunday', every(8 * 60 + off, 21 * 60 + off, 120), back(every(8 * 60 + off, 21 * 60 + off, 120)));
    }
  }
  return { stops, lines, runs };
}

/** Does a run run on the day of `clock` (public holidays run like Sundays; the school bus on school days)? */
export function runsOnDay(world: World, run: Run, clock: number): boolean {
  if (run.days === 'school') return schoolDay(world, clock);
  const wd = runsLike(world, clock);
  return run.days === 'weekday' ? wd < 5 : run.days === 'saturday' ? wd === 5 : wd === 6;
}

/** A run on a particular day: its run and the clock of its first stop. */
export interface Departure { run: Run; /** Index of the stop in `run.stops`. */ at: number; /** Clock minute it leaves that stop. */ clock: number }

/** The next `n` departures from a stop at or after `clock` (today and tomorrow), soonest first. */
export function departures(world: World, stop: number, clock: number, n = 6): Departure[] {
  const out: Departure[] = [];
  const day0 = dayOf(clock) * MINUTES_PER_DAY;
  for (const day of [day0 - MINUTES_PER_DAY, day0, day0 + MINUTES_PER_DAY]) {
    for (const run of transitOf(world).runs) {
      const at = run.stops.indexOf(stop);
      // (Not from its last stop: nothing leaves there.)
      if (at < 0 || at === run.stops.length - 1) continue;
      const t = day + run.times[at];
      if (t >= clock && runsOnDay(world, run, day)) out.push({ run, at, clock: t });
    }
  }
  return out.sort((a, b) => a.clock - b.clock).slice(0, n);
}

/** A ride: walk to `board`, ride from `depart` to `arrive`, get off at `alight`. */
export interface Ride { run: Run; board: number; alight: number; depart: number; arrive: number; walk: number }

/**
 * The ride that gets someone from a place (or a region town) to another soonest, leaving at or
 * after `clock`; null when no line serves the pair today or tomorrow, or the stops are too far.
 */
export function nextRide(world: World, from: PlaceId | string, to: PlaceId | string, clock: number): Ride | null {
  const T = transitOf(world);
  const near = (p: PlaceId | string): { stop: number; walk: number }[] => {
    if (typeof p === 'string') return T.stops.filter((s) => s.region === p).map((s) => ({ stop: s.id, walk: 0 }));
    return T.stops.filter((s) => s.place >= 0).map((s) => ({ stop: s.id, walk: world.travel.metres(p, s.place) / WALK_M_PER_MIN })).filter((x) => x.walk * WALK_M_PER_MIN <= STOP_WALK);
  };
  const A = near(from), B = near(to);
  let best: Ride | null = null;
  for (const a of A) for (const d of departures(world, a.stop, clock + Math.ceil(a.walk), 24)) {
    for (const b of B) {
      const k = d.run.stops.indexOf(b.stop, d.at + 1);
      if (k < 0) continue;
      const arrive = d.clock - d.run.times[d.at] + d.run.times[k];
      if (!best || arrive + b.walk < best.arrive + best.walk) best = { run: d.run, board: a.stop, alight: b.stop, depart: d.clock, arrive, walk: Math.ceil(a.walk + b.walk) };
    }
  }
  return best;
}

/** A bus or train under way: between stop `at` and `at + 1` (`t` 0..1), or standing at `at` (`t` 0, `standing`). */
export interface Underway { run: Run; at: number; t: number; standing: boolean }

/** Every bus and train under way at `clock`. */
export function runsAt(world: World, clock: number): Underway[] {
  const out: Underway[] = [];
  const day0 = dayOf(clock) * MINUTES_PER_DAY, m = minuteOfDay(clock);
  for (const run of transitOf(world).runs) {
    // Today's runs, and yesterday's that run past midnight.
    for (const [day, mm] of [[day0, m], [day0 - MINUTES_PER_DAY, m + MINUTES_PER_DAY]] as const) {
      const ts = run.times;
      if (mm < ts[0] || mm >= ts[ts.length - 1] + DWELL || !runsOnDay(world, run, day)) continue;
      let i = 0;
      while (i + 1 < ts.length && ts[i + 1] <= mm) i++;
      if (i === ts.length - 1) { out.push({ run, at: i, t: 0, standing: true }); continue; }
      const leave = ts[i] + (i === 0 ? 0 : DWELL);
      if (mm < leave) out.push({ run, at: i, t: 0, standing: true });
      else out.push({ run, at: i, t: Math.min(1, (mm - leave) / Math.max(1, ts[i + 1] - leave)), standing: false });
    }
  }
  return out;
}
