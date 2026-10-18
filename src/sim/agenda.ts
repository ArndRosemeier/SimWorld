/**
 * The town's agenda (town-realism §3, plan track E): everything that is on in town on a given day. It covers the weekly
 * market, Sunday services, bin day per street, the summer festival, the Christmas market, Halloween, New Year's Eve,
 * and weddings and funerals. Clubs, congregations and the council (track F) add their meetings here with
 * `addRecurring`; there is no second calendar.
 *
 * An occasion draws people in their free time by its `pull` (only its `guests`, when it has a list). Guests of a
 * ceremony get an intention to attend (src/sim/life.ts), which beats work. Views read the agenda too (bins out on bin
 * day, stalls on market day). Plain data, so it saves and crosses to the worker as is.
 */
import { hashCombine } from '@futuremagic/core';
import { A, type ActorId } from './actors';
import { holidayOn, runsLike, dateOf, daysOf, weekdayOfDays } from './calendar';
import type { DayMask, PlaceId } from './places';
import { MINUTES_PER_DAY } from './time';
import { placesOf, type World } from './world';

export type OccasionKind =
  | 'market' | 'service' | 'binDay' | 'festival' | 'christmasMarket' | 'halloween' | 'newYear'
  | 'wedding' | 'reception' | 'funeral' | 'meeting' | 'match' | 'club';

/** Who an open occasion appeals to, on top of its pull. */
export type Appeal = 'all' | 'faith' | 'children' | 'adults';

export interface Occasion {
  /** Stable id of a one-off occasion; -1 for one that recurs. */
  id: number;
  kind: OccasionKind;
  /** "the Saturday market", "Mara and Tom's wedding". */
  name: string;
  /** Where it happens; -1 = on each person's own street (Halloween). */
  place: PlaceId;
  /** Clock minutes. */
  start: number;
  end: number;
  /** Free-time draw (0 draws nobody, like bin day; 1 is a strong habit). */
  pull: number;
  appeal: Appeal;
  /** Only these people come (members, wedding guests); null = anyone. */
  guests: ActorId[] | null;
  /** What being there means (an `A` activity). */
  activity: number;
  /** Who it is about: the couple, the dead, the host. */
  about: ActorId[];
}

/** An occasion that repeats on some weekdays (read through `runsLike`, so a public holiday runs like a Sunday). */
export interface Recurring {
  kind: OccasionKind;
  name: string;
  place: PlaceId;
  /** Minutes from midnight. */
  start: number;
  end: number;
  days: DayMask;
  /** Only the n-th such weekday of the month (1-4, or -1 for the last): the monthly council meeting. */
  nth?: number;
  /** Months it runs in (bit `month - 1`); default all year. */
  months?: number;
  pull: number;
  appeal: Appeal;
  guests: ActorId[] | null;
  activity: number;
}

export interface Agenda {
  recurring: Recurring[];
  /** One-off occasions still to come or under way. */
  once: Occasion[];
  nextId: number;
  /** Bumped on every change; the per-day cache follows it. */
  version: number;
}

export const newAgenda = (): Agenda => ({ recurring: [], once: [], nextId: 0, version: 0 });

export function addRecurring(world: World, r: Recurring): void {
  world.agenda.recurring.push(r);
  world.agenda.version++;
}

export function addOccasion(world: World, o: Omit<Occasion, 'id'>): Occasion {
  const full = { ...o, id: world.agenda.nextId++ };
  world.agenda.once.push(full);
  world.agenda.version++;
  return full;
}

export function cancelOccasion(world: World, id: number): void {
  const once = world.agenda.once;
  const k = once.findIndex((o) => o.id === id);
  if (k >= 0) { once.splice(k, 1); world.agenda.version++; }
}

/** Drop one-off occasions that ended before `clock`. */
export function pruneAgenda(world: World, clock: number): void {
  const once = world.agenda.once;
  const n = once.length;
  for (let k = n - 1; k >= 0; k--) if (once[k].end < clock) once.splice(k, 1);
  if (once.length !== n) world.agenda.version++;
}

// ---- what is on today ------------------------------------------------------------------------------------

interface DayCache { version: number; day: number; all: Occasion[]; drawing: Occasion[] }
const cache = new WeakMap<World, DayCache>();

/** Everything on in town on game day `day`, in start order. */
export function agendaOn(world: World, day: number): readonly Occasion[] {
  return cached(world, day).all;
}

/** The occasions on `day` that draw anyone (pull > 0): what the schedule offers. */
export function drawingOn(world: World, day: number): readonly Occasion[] {
  return cached(world, day).drawing;
}

function cached(world: World, day: number): DayCache {
  let c = cache.get(world);
  if (c && c.day === day && c.version === world.agenda.version) return c;
  const all = occasionsOn(world, day);
  c = { version: world.agenda.version, day, all, drawing: all.filter((o) => o.pull > 0) };
  cache.set(world, c);
  return c;
}

function occasionsOn(world: World, day: number): Occasion[] {
  const out: Occasion[] = [];
  const at = day * MINUTES_PER_DAY;
  const date = dateOf(world, at);
  const wd = runsLike(world, at);
  for (const r of world.agenda.recurring) {
    if (((r.days >> wd) & 1) === 0) continue;
    if (r.months !== undefined && ((r.months >> (date.month - 1)) & 1) === 0) continue;
    if (r.nth !== undefined && !nthOfMonth(date.days, date.year, date.month, r.nth)) continue;
    out.push({ id: -1, kind: r.kind, name: r.name, place: r.place, start: at + r.start, end: at + r.end, pull: r.pull, appeal: r.appeal, guests: r.guests, activity: r.activity, about: [] });
  }
  seasonal(world, day, out);
  for (const o of world.agenda.once) if (o.start < at + MINUTES_PER_DAY && o.end > at) out.push(o);
  return out.sort((x, y) => x.start - y.start);
}

/** Is `days` the n-th (or, n = -1, the last) of its weekday in its month? */
function nthOfMonth(days: number, year: number, month: number, n: number): boolean {
  if (n < 0) return days + 7 >= daysOf(year, month + 1, 1);
  return Math.floor((days - daysOf(year, month, 1)) / 7) === n - 1;
}

const SUNDAYS: DayMask = 0b1000000;

/**
 * The occasions the calendar brings: the festival, the Christmas market, the Christmas Eve service, Halloween, New
 * Year's Eve. (Public holidays run like Sundays, so they have the Sunday service anyway.)
 */
function seasonal(world: World, day: number, out: Occasion[]): void {
  const at = day * MINUTES_PER_DAY;
  const h = holidayOn(world, at);
  if (!h) return;
  const seasonOccasion = (kind: OccasionKind, name: string, place: PlaceId, from: number, to: number, pull: number, appeal: Appeal, activity: number) => {
    if (place === -2) return;
    out.push({ id: -1, kind, name, place, start: at + from * 60, end: at + to * 60, pull, appeal, guests: null, activity, about: [] });
  };
  const square = centre(world), church = placeOfKind(world, 'church');
  const weekend = weekdayOfDays(world.epoch + day) >= 5;
  switch (h.kind) {
    case 'summerFestival': seasonOccasion('festival', 'the summer festival', square, 11, 23.5, 1.4, 'all', A.socialize); break;
    case 'christmasMarket': seasonOccasion('christmasMarket', 'the Christmas market', square, weekend ? 11 : 16, 21, 0.6, 'all', A.socialize); break;
    case 'halloween': seasonOccasion('halloween', 'trick-or-treating', -1, 17, 19.5, 2, 'children', A.leisure); break;
    case 'newYearsEve': seasonOccasion('newYear', 'the New Year fireworks', square, 23.5, 24.5, 0.9, 'adults', A.socialize); break;
    case 'christmasEve': seasonOccasion('service', 'the Christmas Eve service', church, 17, 18.25, 1.6, 'faith', A.worship); break;
    default: break;
  }
}

/** The square (or a park) where the town gathers; -2 if the town has neither. */
function centre(world: World): PlaceId {
  const s = placeOfKind(world, 'square');
  return s !== -2 ? s : placeOfKind(world, 'park');
}

function placeOfKind(world: World, kind: 'square' | 'park' | 'church'): PlaceId {
  const l = placesOf(world, [kind]);
  return l.length ? l[0] : -2;
}

// ---- the town's own week ---------------------------------------------------------------------------------

/**
 * The recurring life of a town (`createWorld` calls it once): the weekly market on the square, the Sunday service
 * in each church, and bin day for each street (one weekday per street, collected early in the morning).
 */
export function townAgenda(world: World): void {
  const square = centre(world);
  if (square >= 0) {
    const sat = hashCombine(world.seed, 0x3a7) % 2 === 0;
    addRecurring(world, { kind: 'market', name: `the ${sat ? 'Saturday' : 'Thursday'} market`, place: square, start: 450, end: 780, days: sat ? 0b0100000 : 0b0001000, pull: 0.7, appeal: 'adults', guests: null, activity: A.shop });
  }
  for (const church of placesOf(world, ['church'])) {
    addRecurring(world, { kind: 'service', name: 'the Sunday service', place: church, start: 600, end: 660, days: SUNDAYS, pull: 1, appeal: 'faith', guests: null, activity: A.worship });
  }
  for (const street of placesOf(world, ['street'])) {
    const wd = hashCombine(world.seed, street) % 5;
    addRecurring(world, { kind: 'binDay', name: 'bin day', place: street, start: 390, end: 600, days: 1 << wd, pull: 0, appeal: 'all', guests: null, activity: A.idle });
  }
}
