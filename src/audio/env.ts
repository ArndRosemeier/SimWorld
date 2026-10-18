/**
 * What the soundscape hears from the game: the time, the date, the sun, the weather and the town's
 * calendar, read from the sim's seams (`src/sim/calendar.ts`, `src/sim/weather.ts`) so the bells,
 * the birds and the rain agree with what everyone else in the game sees. `soundEnvOf` is pure.
 *
 * `LiveClock` is the stand-in for the running sim until the game runs one (plan step 4): the real
 * date and time (D3: game time = real time) as a minimal dated world. It is the one wall-clock read
 * of the audio layer (guarded).
 */
import { clamp, smoothstep } from '@futuremagic/core';
import { DEFAULT_LATITUDE, dateOf, daysOf, epochFor, feast, schoolDay, sunPosition, type Dated } from '../sim/calendar';
import { weatherAt } from '../sim/weather';
import { MINUTES_PER_DAY } from '../sim/time';
import type { SoundEnv } from './soundscape';

/** What `soundEnvOf` needs of a world: the calendar's and the weather's inputs. */
export interface SoundWorld extends Dated {
  readonly latitude: number;
  clock: number;
  region?: { region: { coastal?: boolean } } | null;
}

/** Overrides for listening tests (from the URL): a fixed weather. */
export interface EnvOverrides { rain?: number; wind?: number }

/** The sound environment at `clock`: sun elevation sets the night, the weather model the rain and wind. */
export function soundEnvOf(world: SoundWorld, clock = world.clock, o: EnvOverrides = {}): SoundEnv {
  const d = dateOf(world, clock);
  const sun = sunPosition(world, clock).elevation;
  const w = weatherAt(world, clock);
  return {
    clock,
    month: d.month - 1,
    // Full night once the sun is 6° below the horizon (civil dusk), full day 3° above it.
    night: 1 - smoothstep(-0.105, 0.05, sun),
    rain: o.rain ?? w.rain,
    wind: o.wind ?? w.wind,
    lightning: o.rain !== undefined ? 0 : w.lightning,
    schoolDay: schoolDay(world, clock),
    feast: feast(world, clock),
  };
}

/**
 * The real date and time as a dated world. URL overrides for listening: `?date=YYYY-MM-DD`,
 * `?time=HH:MM` (both run on from the page load), `?rain=0…1`, `?wind=0…1`.
 */
export class LiveClock implements SoundWorld {
  readonly epoch: number;
  readonly latitude = DEFAULT_LATITUDE;
  clock = 0;
  region: { region: { coastal: boolean } } = { region: { coastal: false } };
  readonly overrides: EnvOverrides = {};
  private readonly startMinute: number;
  private readonly startMs = performance.now();

  constructor(readonly seed: number, q: URLSearchParams = new URLSearchParams()) {
    const now = new Date();
    const [y, mo, da] = (q.get('date') ?? '').split('-').map(Number);
    const date = Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(da) ? { year: y, month: mo, day: da } : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    // Game day 0 is the Monday of that week; the clock counts on from there.
    this.epoch = epochFor(date, 0);
    const [hh, mm] = (q.get('time') ?? '').split(':').map(Number);
    const minute = Number.isFinite(hh) ? hh * 60 + (Number.isFinite(mm) ? mm : 0) : now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    this.startMinute = (daysOf(date.year, date.month, date.day) - this.epoch) * MINUTES_PER_DAY + minute;
    for (const k of ['rain', 'wind'] as const) if (q.has(k) && Number.isFinite(Number(q.get(k)))) this.overrides[k] = clamp(Number(q.get(k)), 0, 1);
    this.clock = this.startMinute;
  }

  /** Advance to now (one game minute per real minute) and return the sound environment. */
  now(): SoundEnv {
    this.clock = this.startMinute + (performance.now() - this.startMs) / 60000;
    return soundEnvOf(this, this.clock, this.overrides);
  }
}
