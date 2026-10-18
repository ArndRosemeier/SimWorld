/**
 * The game clock on screen until the sim worker drives it: game time = real time (D3), on today's real date and
 * time of day, so the town shows the season and the light outside the player's window. `?date=2026-12-24`,
 * `?time=18:30` and `?speed=60` (game minutes per real minute) pick another moment, for looking and screenshots.
 * It is the world the calendar, the weather and the sound read (src/sim/calendar.ts, src/sim/weather.ts,
 * src/audio/env.ts): seed, epoch, latitude, clock, region.
 */
import { DEFAULT_LATITUDE, daysOf, epochFor } from '../sim/calendar';
import { MINUTES_PER_DAY } from '../sim/time';

export class GameClock {
  /** The civil day of game day 0 (a Monday). */
  readonly epoch: number;
  readonly latitude = DEFAULT_LATITUDE;
  /** Game minutes since day 0, fractional. */
  clock: number;
  /** Game minutes per real minute. */
  speed: number;
  /** The region as the weather reads it (coastal: milder and foggier), once the town workers know it. */
  region: { region: { coastal?: boolean } } | null = null;

  constructor(readonly seed: number, q: URLSearchParams = new URLSearchParams(), now: Date = new Date()) {
    const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q.get('date') ?? '');
    const date = dm ? { year: +dm[1], month: +dm[2], day: +dm[3] } : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    const tm = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') ?? '');
    const minute = tm ? +tm[1] * 60 + +tm[2] : now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    this.epoch = epochFor(date, 0);
    this.clock = (daysOf(date.year, date.month, date.day) - this.epoch) * MINUTES_PER_DAY + minute;
    const s = Number(q.get('speed'));
    this.speed = q.has('speed') && Number.isFinite(s) && s >= 0 ? s : 1;
  }

  /** Advance by `dtReal` real seconds. */
  advance(dtReal: number): void {
    this.clock += (dtReal / 60) * this.speed;
  }
}
