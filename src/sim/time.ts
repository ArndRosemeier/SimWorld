/**
 * Game time. `world.clock` counts game minutes since the start of day 0, which is a Monday at 00:00.
 * Live play advances one minute per real minute (D3); the time skip advances hours or days at a time.
 */
import type { DayMask } from './places';

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_YEAR = 365;

/** Game day (0 = the first Monday). */
export const dayOf = (clock: number): number => Math.floor(clock / MINUTES_PER_DAY);
/** 0 = Monday ... 6 = Sunday. */
export const weekdayOf = (clock: number): number => ((dayOf(clock) % 7) + 7) % 7;
/** Minutes since midnight. */
export const minuteOfDay = (clock: number): number => clock - dayOf(clock) * MINUTES_PER_DAY;
/** Does `mask` include the weekday of `clock`? */
export const onDay = (mask: DayMask, clock: number): boolean => ((mask >> weekdayOf(clock)) & 1) === 1;
/** Clock of `minute` (minutes from midnight, may exceed 1440) on the day of `clock`. */
export const atMinute = (clock: number, minute: number): number => dayOf(clock) * MINUTES_PER_DAY + minute;
/** Minutes from `clock` to the next `minute` of the day that is at least `least` minutes away (a skip "until the evening"). */
export function minutesUntil(clock: number, minute: number, least = 30): number {
  let t = atMinute(clock, minute);
  while (t - clock < least) t += MINUTES_PER_DAY;
  return t - clock;
}

/** The times of day a skip can run to (minutes from midnight). */
export const TIMES_OF_DAY = { morning: 7 * 60, noon: 12 * 60, evening: 18 * 60, night: 22 * 60 } as const;

/** "07:30" */
export const hhmm = (minute: number): string => {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
