/**
 * The real calendar on top of game time (src/sim/time.ts): which date a game minute falls on, the season, daylight
 * saving, where the sun and the moon stand, sunrise and sunset. Arnd (2026-10-18, town-realism Q2): the game date
 * follows the real calendar, in a temperate climate with real winters.
 *
 * A world's `epoch` is the civil day number (days since 1970-01-01) of game day 0, which is always a Monday, so
 * `weekdayOf(clock)` and the date agree. `epochFor(today, days)` picks the epoch that puts game day `days` on a
 * real date (the history runs before it, play starts on it).
 *
 * The town is placeless (D10), so the place is a fixed, typical one: 50° N, a few degrees west of its time zone's
 * meridian, daylight saving from the last Sunday of March to the last Sunday of October. Game minutes are local
 * clock time (with daylight saving, as the player's own clock). World axes: east = +x, north = -z, up = +y.
 * Pure: no DOM, no three; the renderer reads the sun and moon from here.
 */
import { MINUTES_PER_DAY, dayOf, minuteOfDay } from './time';

export interface CalDate {
  year: number;
  /** 1 … 12 */
  month: number;
  /** 1 … 31 */
  day: number;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** 0 = 1 January. */
  dayOfYear: number;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** Latitude of the town in degrees (temperate, snowy winters). */
export const LATITUDE = 50;
/** Minutes the local sun runs behind the time zone's clock (the town lies 3° west of the zone's meridian). */
const LONGITUDE_MINUTES = 12;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

// ---- civil days ---------------------------------------------------------------------------------------------

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's days_from_civil). */
export function civilDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date of a civil day number. */
export function dateOfCivil(n: number): CalDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day, weekday: ((n % 7) + 10) % 7, dayOfYear: n - civilDay(year, 1, 1) };
}

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Is civil day `n` a Monday? (1970-01-01 was a Thursday.) */
export const isMonday = (n: number): boolean => ((n % 7) + 10) % 7 === 0;

/** The epoch of worlds made without one: Monday 28 September 2026 (autumn, like the day SimWorld started). */
export const DEFAULT_EPOCH = civilDay(2026, 9, 28);

/**
 * The epoch (a Monday) that puts game day `day` on `date`, or as near before it as a Monday allows: the history
 * runs `day` days before play, play starts on the real date. The game day of `date` is then
 * `civilDay(date) - epoch` (between `day` and `day + 6`).
 */
export function epochFor(date: { year: number; month: number; day: number }, day = 0): number {
  const n = civilDay(date.year, date.month, date.day) - day;
  return n - (((n % 7) + 10) % 7);
}

/** The game clock of `minute` (local time) on a date, for a world with `epoch`. */
export function clockAt(epoch: number, date: { year: number; month: number; day: number }, minute = 0): number {
  return (civilDay(date.year, date.month, date.day) - epoch) * MINUTES_PER_DAY + minute;
}

/** The date of a game minute. */
export const dateAt = (epoch: number, clock: number): CalDate => dateOfCivil(epoch + dayOf(clock));

/** The date of a world's game minute (now by default). */
export const dateOf = (world: { epoch: number; clock: number }, clock = world.clock): CalDate => dateAt(world.epoch, clock);

/** Meteorological seasons: spring is March to May, and so on. */
export function seasonOf(d: { month: number }): Season {
  const m = d.month;
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

/** Where in the year a game minute is, 0 (1 January 00:00) … 1, continuous (for foliage, crops, the climate). */
export function yearPhase(epoch: number, clock: number): number {
  const d = dateAt(epoch, clock);
  return (d.dayOfYear + minuteOfDay(clock) / MINUTES_PER_DAY) / (isLeapYear(d.year) ? 366 : 365);
}

/** "Saturday 17 October 2026" */
export const longDate = (d: CalDate): string => `${WEEKDAY_NAMES[d.weekday]} ${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}`;

/** The last Sunday of a month (day of month). */
function lastSunday(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const n = civilDay(year, month, lastDay);
  return lastDay - ((((n % 7) + 10) % 7) + 1) % 7;
}

/** Daylight saving time on this date (from the last Sunday of March to the last Sunday of October)? */
export function isDst(d: { year: number; month: number; day: number }): boolean {
  if (d.month < 3 || d.month > 10) return false;
  if (d.month > 3 && d.month < 10) return true;
  const ls = lastSunday(d.year, d.month);
  return d.month === 3 ? d.day >= ls : d.day < ls;
}

// ---- holidays (dates only; what the town does on them belongs to the rhythms) --------------------------------

/** Easter Sunday of a year (the Gregorian computus). */
export function easterOf(year: number): { month: number; day: number } {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return { month, day: ((h + l - 7 * m + 114) % 31) + 1 };
}

/** The holidays the town keeps (Arnd, 2026-10-18, Q5): no national days, which would place the town. */
export type Holiday = 'newYearsDay' | 'goodFriday' | 'easterSunday' | 'easterMonday' | 'halloween' | 'christmasEve' | 'christmasDay' | 'boxingDay' | 'newYearsEve';

export const HOLIDAY_LABEL: Record<Holiday, string> = {
  newYearsDay: "New Year's Day", goodFriday: 'Good Friday', easterSunday: 'Easter Sunday', easterMonday: 'Easter Monday', halloween: 'Halloween',
  christmasEve: 'Christmas Eve', christmasDay: 'Christmas Day', boxingDay: 'Boxing Day', newYearsEve: "New Year's Eve",
};

/** The holiday on a date, or null. The town's own summer festival and Christmas market are town events, not dates. */
export function holidayOn(d: { year: number; month: number; day: number }): Holiday | null {
  const { month: m, day } = d;
  if (m === 1 && day === 1) return 'newYearsDay';
  if (m === 10 && day === 31) return 'halloween';
  if (m === 12) {
    if (day === 24) return 'christmasEve';
    if (day === 25) return 'christmasDay';
    if (day === 26) return 'boxingDay';
    if (day === 31) return 'newYearsEve';
  }
  if (m === 3 || m === 4) {
    const e = easterOf(d.year);
    const off = civilDay(d.year, m, day) - civilDay(d.year, e.month, e.day);
    if (off === -2) return 'goodFriday';
    if (off === 0) return 'easterSunday';
    if (off === 1) return 'easterMonday';
  }
  return null;
}

// ---- the sun and the moon -----------------------------------------------------------------------------------

const RAD = Math.PI / 180;
const PHI = LATITUDE * RAD;

/** The sun's declination (radians) on a day of the year (0 = 1 January). */
const declination = (doy: number): number => 23.44 * RAD * Math.sin((2 * Math.PI * (284 + doy + 1)) / 365);

/** The equation of time in minutes (sundial minus clock) on a day of the year. */
function equationOfTime(doy: number): number {
  const b = (2 * Math.PI * (doy + 1 - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/** Local solar time (minutes from solar midnight) at clock minute `minute` of a date. */
function solarMinute(d: CalDate, minute: number): number {
  return minute - (isDst(d) ? 60 : 0) + equationOfTime(d.dayOfYear) - LONGITUDE_MINUTES;
}

export interface SkyBody {
  /** Height above the horizon, radians (negative below it). */
  elevation: number;
  /** Compass direction, radians from north towards east. */
  azimuth: number;
  /** Unit vector towards it in world axes (east +x, up +y, north -z). */
  dir: [number, number, number];
}

function body(decl: number, hourAngle: number): SkyBody {
  const sinEl = Math.sin(PHI) * Math.sin(decl) + Math.cos(PHI) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(PHI) - Math.tan(decl) * Math.cos(PHI)) + Math.PI;
  const c = Math.cos(elevation);
  return { elevation, azimuth, dir: [c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth)] };
}

/** Where the sun stands at a game minute. */
export function sunAt(epoch: number, clock: number): SkyBody {
  const d = dateAt(epoch, clock);
  const h = ((solarMinute(d, minuteOfDay(clock)) - 720) / 4) * RAD;
  return body(declination(d.dayOfYear), h);
}

/** Days from a new moon to the next. */
const SYNODIC = 29.530589;
/** A new moon: 2000-01-06 18:14 UTC, as a civil day with its fraction. */
const NEW_MOON = civilDay(2000, 1, 6) + (18 * 60 + 14) / MINUTES_PER_DAY;

/** The moon's phase at a game minute: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(epoch: number, clock: number): number {
  const days = epoch + clock / MINUTES_PER_DAY - NEW_MOON;
  const p = (days / SYNODIC) % 1;
  return p < 0 ? p + 1 : p;
}

/** Lit fraction of the moon's disc, 0 (new) … 1 (full). */
export const moonLit = (phase: number): number => (1 - Math.cos(phase * 2 * Math.PI)) / 2;

/**
 * Where the moon stands at a game minute (an approximation good for the sky: it follows the sun's path lagging by
 * its phase, with the declination the sun has that far round the year, so a winter full moon rides high).
 */
export function moonAt(epoch: number, clock: number): SkyBody {
  const d = dateAt(epoch, clock);
  const phase = moonPhase(epoch, clock);
  const h = ((solarMinute(d, minuteOfDay(clock)) - 720) / 4 - phase * 360) * RAD;
  return body(declination((d.dayOfYear + phase * 365.25) % 365.25), h);
}

export interface SunTimes {
  /** Clock minutes of the day (local time); NaN in polar day or night (never at 50° N). */
  sunrise: number;
  sunset: number;
  /** Solar noon. */
  noon: number;
  /** Civil dusk and dawn (the sun 6° below the horizon): street lamps, "getting dark". */
  dawn: number;
  dusk: number;
  /** Minutes of daylight. */
  daylight: number;
}

/** Sunrise, sunset, dawn and dusk on the day of a game minute. */
export function sunTimes(epoch: number, clock: number): SunTimes {
  const d = dateAt(epoch, clock);
  const decl = declination(d.dayOfYear);
  const noon = 720 + (isDst(d) ? 60 : 0) - equationOfTime(d.dayOfYear) + LONGITUDE_MINUTES;
  const half = (altDeg: number) => {
    const c = (Math.sin(altDeg * RAD) - Math.sin(PHI) * Math.sin(decl)) / (Math.cos(PHI) * Math.cos(decl));
    return c < -1 || c > 1 ? NaN : (Math.acos(c) / RAD) * 4;
  };
  const h0 = half(-0.833), h6 = half(-6);
  return { sunrise: noon - h0, sunset: noon + h0, noon, dawn: noon - h6, dusk: noon + h6, daylight: 2 * h0 };
}
