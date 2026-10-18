/**
 * What the soundscape hears from the game: the time, the date, the sun, the weather and the town's
 * calendar, read from the sim's seams (`src/sim/calendar.ts`, `src/sim/weather.ts`) so the bells,
 * the birds and the rain agree with what everyone else in the game sees. `soundEnvOf` is pure.
 *
 * Until the game runs the sim (plan step 4) the world is the game clock (src/game/clock.ts `GameClock`: the
 * real date and time, D3), the same one the sky reads; `soundOverrides` reads the listening overrides.
 */
import { clamp, smoothstep } from '@futuremagic/core';
import { dateOf, feast, schoolDay, sunPosition, type Dated } from '../sim/calendar';
import { weatherAt } from '../sim/weather';
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

/** The listening overrides from the URL: `?rain=0…1`, `?wind=0…1`. */
export function soundOverrides(q: URLSearchParams): EnvOverrides {
  const o: EnvOverrides = {};
  for (const k of ['rain', 'wind'] as const) if (q.has(k) && Number.isFinite(Number(q.get(k)))) o[k] = clamp(Number(q.get(k)), 0, 1);
  return o;
}
