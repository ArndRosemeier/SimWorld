/**
 * The town calendar (town-realism Track E, Q2): game days are real dates in a temperate climate with snowy winters.
 * `world.epoch` maps game day 0 (always a Monday) to a real date, so the season, the length of the day, the holidays
 * and the school terms follow the real calendar. Pure integer date arithmetic (no `Date`), so it runs the same
 * in the worker and in tests.
 *
 * The one way to ask what day it is: `dateOf`. Weather (src/sim/weather.ts) and the renderer's sun read the season and
 * `sunAt` from here.
 */
import { hashCombine } from '@futuremagic/core';
import { dayOf, MINUTES_PER_DAY } from './time';

/** A real date. `month` 1-12, `day` 1-31. */
export interface CivilDate { year: number; month: number; day: number }

export interface GameDate extends CivilDate {
  /** Days since 1970-01-01. */
  days: number;
  /** 0 = 1 January. */
  dayOfYear: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
}

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** What the calendar needs from a world. */
export interface Dated { readonly seed: number; readonly epoch: number }

// ---- dates -----------------------------------------------------------------------------------------------

/** Days since 1970-01-01 of a real date (proleptic Gregorian; H. Hinnant's days_from_civil). */
export function daysOf(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The real date of a day count since 1970-01-01. */
export function civilOf(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** 0 = Monday ... 6 = Sunday, of a day count since 1970-01-01 (a Thursday). */
export const weekdayOfDays = (days: number): number => (((days + 3) % 7) + 7) % 7;

/** The epoch that puts game day `gameDay` on (the Monday of the week of) real date `date`, keeping day 0 a Monday. */
export function epochFor(date: CivilDate, gameDay: number): number {
  const e = daysOf(date.year, date.month, date.day) - gameDay;
  return e - weekdayOfDays(e);
}

/** The real date of a game clock. */
export function dateOf(world: Dated, clock: number): GameDate {
  const days = world.epoch + dayOf(clock);
  const c = civilOf(days);
  return { ...c, days, dayOfYear: days - daysOf(c.year, 1, 1), weekday: weekdayOfDays(days) };
}

/** Game day of a real date. */
/** A running month number (year × 12 + month − 1), for processes that close their books by calendar month. */
export const monthKey = (world: Dated, clock: number): number => { const d = dateOf(world, clock); return d.year * 12 + d.month - 1; };

export const gameDayOf = (world: Dated, y: number, m: number, d: number): number => daysOf(y, m, d) - world.epoch;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Monday 19 October 2026" */
export const formatDate = (d: GameDate): string => `${WEEKDAYS[d.weekday]} ${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
/** "Monday" */
export const weekdayName = (weekday: number): string => WEEKDAYS[weekday];

// ---- seasons and the sun ---------------------------------------------------------------------------------

/** Meteorological seasons (winter is December to February). */
export function seasonOf(d: CivilDate): Season {
  const m = d.month;
  return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
}

/**
 * How summery the day is, -1 in midwinter to 1 in midsummer, lagging the sun by about a month as temperatures do
 * (coldest around 20 January, warmest around 20 July).
 */
export const warmth = (d: GameDate): number => -Math.cos((2 * Math.PI * (d.dayOfYear - 20)) / 365.25);

/** Is clock time daylight saving (summer) time? EU rule: last Sunday of March to last Sunday of October. */
export function summerTime(d: GameDate): boolean {
  const lastSunday = (m: number) => { const e = daysOf(d.year, m + 1, 1) - 1; return e - ((weekdayOfDays(e) + 1) % 7); };
  return d.days >= lastSunday(3) && d.days < lastSunday(10);
}

/**
 * Sunrise and sunset in clock minutes from midnight (summer time applied), for a latitude in degrees. The sun is due
 * south at 12:00 standard time; refraction and the sun's disc add the usual 0.83°.
 */
export function sunTimes(d: GameDate, latitude: number): { rise: number; set: number } {
  const decl = (-23.44 * Math.PI / 180) * Math.cos((2 * Math.PI * (d.dayOfYear + 10)) / 365.25);
  const phi = (latitude * Math.PI) / 180;
  const h0 = (-0.83 * Math.PI) / 180;
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  const half = cosH <= -1 ? 720 : cosH >= 1 ? 0 : (Math.acos(cosH) * 180 / Math.PI) * 4;
  const noon = 720 + (summerTime(d) ? 60 : 0);
  return { rise: Math.round(noon - half), set: Math.round(noon + half) };
}

/** Sunrise and sunset on the day of `clock` in the town (minutes from midnight, clock time). */
export const sunAt = (world: Dated & { readonly latitude: number }, clock: number): { rise: number; set: number } =>
  sunTimes(dateOf(world, clock), world.latitude);

/** Default latitude of the town (a temperate, snowy-wintered western place). */
export const DEFAULT_LATITUDE = 51;

// ---- holidays --------------------------------------------------------------------------------------------

export type HolidayKind =
  | 'newYear' | 'goodFriday' | 'easter' | 'easterMonday' | 'halloween' | 'christmasEve' | 'christmas' | 'boxingDay'
  | 'newYearsEve' | 'summerFestival' | 'christmasMarket';

export interface Holiday {
  kind: HolidayKind;
  name: string;
  /** Most people are off work and the shops are shut (the day runs like a Sunday). */
  dayOff: boolean;
}

/** Easter Sunday of a year (anonymous Gregorian computus). */
export function easter(year: number): CivilDate {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return { year, month, day: ((h + l - 7 * m + 114) % 31) + 1 };
}

const holiday = (kind: HolidayKind, name: string, dayOff: boolean): Holiday => ({ kind, name, dayOff });
const FIXED: Record<string, Holiday> = {
  '1-1': holiday('newYear', "New Year's Day", true),
  '10-31': holiday('halloween', 'Halloween', false),
  '12-24': holiday('christmasEve', 'Christmas Eve', false),
  '12-25': holiday('christmas', 'Christmas Day', true),
  '12-26': holiday('boxingDay', 'Boxing Day', true),
  '12-31': holiday('newYearsEve', "New Year's Eve", false),
};
const GOOD_FRIDAY = holiday('goodFriday', 'Good Friday', true);
const EASTER = holiday('easter', 'Easter Sunday', true);
const EASTER_MONDAY = holiday('easterMonday', 'Easter Monday', true);
const FESTIVAL = holiday('summerFestival', 'the summer festival', false);
const MARKET = holiday('christmasMarket', 'the Christmas market', false);

/** First day of the town's summer festival (a Saturday in July, fixed per town by its seed). */
export function festivalStart(world: Dated, year: number): number {
  const jul1 = daysOf(year, 7, 1);
  const firstSat = jul1 + ((5 - weekdayOfDays(jul1) + 7) % 7);
  return firstSat + 7 * (1 + (hashCombine(world.seed, 0xfe57) % 3));
}

/** The Christmas market runs from the Friday before the first Sunday of Advent until 23 December. */
export function christmasMarket(year: number): [number, number] {
  const xmas = daysOf(year, 12, 25);
  const advent4 = xmas - ((weekdayOfDays(xmas) + 1) % 7 || 7);
  return [advent4 - 21 - 2, daysOf(year, 12, 23)];
}

/** The holiday or town-wide occasion on the day of `clock`, or null (they never overlap). */
export function holidayOn(world: Dated, clock: number): Holiday | null {
  const d = dateOf(world, clock);
  const fixed = FIXED[`${d.month}-${d.day}`];
  if (fixed) return fixed;
  if (d.month === 3 || d.month === 4) {
    const e = easter(d.year), ed = daysOf(e.year, e.month, e.day);
    if (d.days === ed - 2) return GOOD_FRIDAY;
    if (d.days === ed) return EASTER;
    if (d.days === ed + 1) return EASTER_MONDAY;
  }
  if (d.month === 7 || d.month === 8) {
    const f = festivalStart(world, d.year);
    if (d.days === f || d.days === f + 1) return FESTIVAL;
  }
  if (d.month >= 11) {
    const [a, b] = christmasMarket(d.year);
    if (d.days >= a && d.days <= b) return MARKET;
  }
  return null;
}

/** Is the day of `clock` a public holiday (runs like a Sunday)? */
export const dayOff = (world: Dated, clock: number): boolean => holidayOn(world, clock)?.dayOff ?? false;

/** What the schedules ask about a day, worked out once per day (they ask thousands of times a minute). */
interface DayFacts { runsLike: number; feast: boolean; eve: boolean; school: boolean }
const facts = new WeakMap<Dated, Map<number, DayFacts>>();

function factsOf(world: Dated, clock: number): DayFacts {
  const g = dayOf(clock);
  let m = facts.get(world);
  if (!m) facts.set(world, (m = new Map()));
  let f = m.get(g);
  if (f) return f;
  const d = civilOf(world.epoch + g);
  const off = dayOff(world, clock);
  f = {
    runsLike: off ? 6 : weekdayOfDays(world.epoch + g),
    feast: (d.month === 12 && d.day === 25) || (d.month === 1 && d.day === 1),
    eve: d.month === 12 && (d.day === 24 || d.day === 31),
    school: !off && weekdayOfDays(world.epoch + g) < 5 && termOn(world, clock).inTerm,
  };
  if (m.size > 16) m.clear();
  m.set(g, f);
  return f;
}

/**
 * The weekday a day runs like: public holidays run like Sundays. Opening hours, shifts, school and church read the
 * week through this, not through the bare weekday.
 */
export const runsLike = (world: Dated, clock: number): number => factsOf(world, clock).runsLike;

/** The two days nearly everything is shut, whatever its Sunday hours: Christmas Day and New Year's Day. */
export const feast = (world: Dated, clock: number): boolean => factsOf(world, clock).feast;

/** Christmas Eve and New Year's Eve: shops close at 14:00. */
export const eve = (world: Dated, clock: number): boolean => factsOf(world, clock).eve;

// ---- school terms ----------------------------------------------------------------------------------------

/** Monday on or before a day count. */
const mondayOf = (days: number) => days - weekdayOfDays(days);
/** The `n`-th Monday (1-based) of a month; n = -1 for the last. */
function nthMonday(year: number, month: number, n: number): number {
  if (n < 0) { const end = daysOf(year, month + 1, 1) - 1; return mondayOf(end); }
  const first = daysOf(year, month, 1);
  return first + ((7 - weekdayOfDays(first)) % 7) + 7 * (n - 1);
}

/**
 * The school holidays of the year starting in `year` (a typical western pattern): a week in February, two weeks
 * around Easter, a week at the end of May, six weeks in summer, a week at the end of October and two at Christmas.
 * Each is [first day, last day] in days since 1970.
 */
export function schoolHolidays(year: number): [string, number, number][] {
  const e = easter(year), ed = daysOf(e.year, e.month, e.day);
  const summer = mondayOf(daysOf(year, 7, 24));
  const xmas = mondayOf(daysOf(year, 12, 22));
  return [
    ['the winter half-term', nthMonday(year, 2, 3) - 2, nthMonday(year, 2, 3) + 6],
    ['the Easter holidays', ed - 8, ed + 7],
    ['the May half-term', nthMonday(year, 5, -1) - 2, nthMonday(year, 5, -1) + 6],
    ['the summer holidays', summer - 2, summer + 6 * 7 - 1],
    ['the autumn half-term', nthMonday(year, 10, -1) - 2, nthMonday(year, 10, -1) + 6],
    ['the Christmas holidays', xmas - 2, mondayOf(daysOf(year + 1, 1, 7)) - 1],
  ];
}

/** School term on the day of `clock`: in term (weekends included), or the name of the holiday it falls in. */
export function termOn(world: Dated, clock: number): { inTerm: boolean; holiday: string | null } {
  const days = world.epoch + dayOf(clock);
  const { year } = civilOf(days);
  for (const y of [year - 1, year]) for (const [name, a, b] of schoolHolidays(y)) if (days >= a && days <= b) return { inTerm: false, holiday: name };
  return { inTerm: true, holiday: null };
}

/** Is the day of `clock` a school day (term, a weekday, not a public holiday)? */
export const schoolDay = (world: Dated, clock: number): boolean => factsOf(world, clock).school;

/** Clock at midnight starting a given count of days since 1970. */
export const clockOfDays = (world: Dated, days: number): number => (days - world.epoch) * MINUTES_PER_DAY;

// ---- where the sun and the moon stand (the sky view; track B) ------------------------------------------------

/** Where in the year the day of `clock` is: 0 on 1 January … 1, continuous through the day. */
export function yearPhase(world: { readonly epoch: number }, clock: number): number {
  const days = world.epoch + clock / MINUTES_PER_DAY;
  const { year } = civilOf(Math.floor(days));
  const y0 = daysOf(year, 1, 1);
  return (days - y0) / (daysOf(year + 1, 1, 1) - y0);
}

export interface SkyBody {
  /** Height above the horizon, radians (negative below it). */
  elevation: number;
  /** Compass direction, radians from north towards east. */
  azimuth: number;
  /** Unit vector towards it in world axes (east +x, up +y, north -z). */
  dir: [number, number, number];
}

/** The sun's declination (radians) on a day of the year, the same as `sunTimes`'. */
const declination = (dayOfYear: number): number => (-23.44 * Math.PI / 180) * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365.25);

function skyBody(latitude: number, decl: number, hourAngle: number): SkyBody {
  const phi = (latitude * Math.PI) / 180;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  const c = Math.cos(elevation);
  return { elevation, azimuth, dir: [c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth)] };
}

/** The sun's hour angle (radians) at `clock`: due south at 12:00 standard time, as `sunTimes` has it. */
function hourAngle(d: GameDate, clock: number): number {
  const minute = clock - Math.floor(clock / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  return ((minute - 720 - (summerTime(d) ? 60 : 0)) / 4) * (Math.PI / 180);
}

/** Where the sun stands at `clock` (fractional minutes are fine): rises and sets at `sunAt`'s times. */
export function sunPosition(world: Dated & { readonly latitude: number }, clock: number): SkyBody {
  const d = dateOf(world, clock);
  return skyBody(world.latitude, declination(d.dayOfYear), hourAngle(d, clock));
}

/** Days from a new moon to the next, and a new moon: 2000-01-06 18:14 UTC. */
const SYNODIC = 29.530589;
const NEW_MOON = daysOf(2000, 1, 6) + (18 * 60 + 14) / MINUTES_PER_DAY;

/** The moon's real phase at `clock`: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(world: { readonly epoch: number }, clock: number): number {
  const p = ((world.epoch + clock / MINUTES_PER_DAY - NEW_MOON) / SYNODIC) % 1;
  return p < 0 ? p + 1 : p;
}

/** Lit fraction of the moon's disc, 0 (new) … 1 (full). */
export const moonLit = (phase: number): number => (1 - Math.cos(phase * 2 * Math.PI)) / 2;

/**
 * Where the moon stands at `clock`: an approximation good for the sky. It follows the sun's path lagging by its
 * phase, with the declination the sun has that far round the year, so a winter full moon rides high.
 */
export function moonPosition(world: Dated & { readonly latitude: number }, clock: number): SkyBody {
  const d = dateOf(world, clock), phase = moonPhase(world, clock);
  return skyBody(world.latitude, declination(d.dayOfYear + phase * 365.25), hourAngle(d, clock) - phase * 2 * Math.PI);
}
