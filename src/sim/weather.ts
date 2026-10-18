/**
 * The weather: a pure function of (seed, epoch, game minute), so NPCs react to it, the time skip and saves need no
 * state, and the renderer, the audio and the sim all see the same sky. Ported from Scale (src/world/weather.ts: the
 * Markov chain of states, the blends, showers and gusts, wet ground) and extended for SimWorld: a temperate climate
 * with seasons (Arnd, 2026-10-18, Q2), a temperature, snow instead of rain when it is cold, snow lying on the ground
 * and ice on wet streets.
 *
 * How it stays a pure function: the chain of states restarts every game week (it starts half a day before the
 * Monday so it has a history, and the old week's chain hands over to the new one over the first two hours of
 * Monday, in the night). Within a week, each state lasts tens of minutes to hours and blends into the next. A slow
 * "regime" (settled or unsettled spells over days) and the season weight the transitions; a smooth anomaly over
 * days makes warm and cold spells. Lying snow and wet ground are integrated over a fixed window before the minute
 * asked for, aligned to weeks, so the answer never depends on what was asked before.
 *
 * Cheap to call from hot sim loops: one week's chain and one snow trajectory are cached per model, and the last
 * minutes asked for are cached per world.
 */
import { Rng, clamp, deriveSeed, hash32, hashToFloat, lerp, smoothstep } from '@futuremagic/core';
import { yearPhase } from './calendar';

export type WeatherKind = 'clear' | 'fair' | 'cloudy' | 'overcast' | 'drizzle' | 'rain' | 'storm' | 'fog';
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'fair', 'cloudy', 'overcast', 'drizzle', 'rain', 'storm', 'fog'];

/** The continuous sky parameters of a state (all 0 … 1). */
interface SkyParams {
  /** Cloud coverage of the sky. */
  cover: number;
  /** Cloud opacity. */
  density: number;
  /** How dark and grey the clouds and the sky are. */
  dark: number;
  /** Precipitation intensity (0 none, ~0.2 drizzle, ~0.6 rain, 1 downpour), rain or snow by the temperature. */
  precip: number;
  /** Ground fog, mist, haze. */
  fog: number;
  /** Wind strength. */
  wind: number;
  /** Direct sunlight left (1 clear sky, ~0.1 under rain clouds). */
  sun: number;
  /** Lightning rate (storms). */
  lightning: number;
}

const STATES: Record<WeatherKind, SkyParams> = {
  clear: { cover: 0.06, density: 0.3, dark: 0, precip: 0, fog: 0, wind: 0.12, sun: 1, lightning: 0 },
  fair: { cover: 0.36, density: 0.45, dark: 0, precip: 0, fog: 0, wind: 0.22, sun: 1, lightning: 0 },
  cloudy: { cover: 0.62, density: 0.62, dark: 0.18, precip: 0, fog: 0.05, wind: 0.35, sun: 0.7, lightning: 0 },
  overcast: { cover: 0.97, density: 0.9, dark: 0.45, precip: 0, fog: 0.18, wind: 0.3, sun: 0.22, lightning: 0 },
  drizzle: { cover: 1, density: 0.92, dark: 0.55, precip: 0.22, fog: 0.3, wind: 0.3, sun: 0.16, lightning: 0 },
  rain: { cover: 1, density: 0.95, dark: 0.68, precip: 0.62, fog: 0.38, wind: 0.5, sun: 0.1, lightning: 0.04 },
  storm: { cover: 1, density: 1, dark: 0.88, precip: 1, fog: 0.45, wind: 0.95, sun: 0.05, lightning: 1 },
  fog: { cover: 0.25, density: 0.4, dark: 0.1, precip: 0, fog: 1, wind: 0.04, sun: 0.45, lightning: 0 },
};

/** The weather at one game minute: what the sky does, how warm it is, what lies on the ground. */
export interface Weather extends SkyParams {
  /** The state that dominates now. */
  kind: WeatherKind;
  /** Air temperature, °C. */
  tempC: number;
  /** Falling rain, 0 … 1 (`precip` that is not snow). */
  rain: number;
  /** Falling snow, 0 … 1. */
  snow: number;
  /** Wet ground and walls 0 … 1 (soaks in minutes, dries over hours). */
  wet: number;
  /** Lying snow, cm. */
  snowCm: number;
  /** Black ice: wet ground below freezing. */
  ice: boolean;
  /** Frost on lawns and windscreens (a clear night or morning below freezing). */
  frost: boolean;
}

/** The climate: the town's is temperate with snowy winters; the coast brings fog, drizzle and milder winters. */
export interface Climate {
  /** Mean daily temperature over the year, °C. */
  meanC: number;
  /** Half the difference between the warmest and the coldest month's mean, °C. */
  swingC: number;
  /** By the sea. */
  coastal: boolean;
}

export const TEMPERATE: Climate = { meanC: 9.5, swingC: 11, coastal: false };

/** Typical durations (h): [min, max]. */
const DUR: Record<WeatherKind, [number, number]> = {
  clear: [1.5, 6], fair: [2, 8], cloudy: [1, 4.5], overcast: [1.5, 5], drizzle: [0.6, 2.5], rain: [0.5, 2.5], storm: [0.35, 1.2], fog: [1, 3.5],
};

const WEEK_H = 168;
/** Each week's chain starts this long before its Monday. */
const LEAD_H = 12;
/** The old week's chain hands over to the new one over this long. */
const HANDOVER_H = 2;
/** Lying snow is integrated over this many hours before the week it is asked for (and that week), in steps. */
const SNOW_WINDOW_H = 6 * WEEK_H;
const SNOW_STEP_H = 2;
/** Wet ground is integrated over this many hours before the minute asked for, in steps. */
const WET_WINDOW_H = 8;
const WET_STEP_H = 1 / 6;

const hourOf = (h: number) => ((h % 24) + 24) % 24;

interface Segment { kind: WeatherKind; start: number; end: number; blend: number }

/** Smooth 1D value noise over time (`period` in the same unit as `t`), 0 … 1. */
function vnoise(seed: number, t: number, period: number): number {
  const x = t / period, i = Math.floor(x), f = x - i;
  const a = hashToFloat(hash32(seed ^ Math.imul(i, 0x27d4eb2d))), b = hashToFloat(hash32(seed ^ Math.imul(i + 1, 0x27d4eb2d)));
  return lerp(a, b, f * f * (3 - 2 * f));
}

/** How warm the season is, 0 (midwinter) … 1 (midsummer), from the year phase (warmest around 20 July). */
const warmthOf = (phase: number): number => 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - 0.55));

export class WeatherModel {
  private readonly nSeed: number;
  private weeks = new Map<number, Segment[]>();
  private snowRuns = new Map<number, Float32Array>();

  constructor(readonly seed: number, readonly epoch: number, readonly climate: Climate = TEMPERATE) {
    this.nSeed = deriveSeed(seed, 'weather-noise');
  }

  /** The season's warmth 0 … 1 at absolute game hour h. */
  warmth(h: number): number { return warmthOf(yearPhase(this, h * 60)); }

  /** Unsettled spells 0 (high pressure, settled) … 1 (fronts coming through), over days. */
  unsettled(h: number): number {
    return clamp(0.65 * vnoise(this.nSeed ^ 0x1234, h, 4.5 * 24) + 0.35 * vnoise(this.nSeed ^ 0x9876, h, 1.7 * 24), 0, 1);
  }

  /** Next state after `from`, for a change at hour h: Scale's weights, modulated by the hour, the season, the spell. */
  private nextKind(from: WeatherKind, h: number, r: Rng): WeatherKind {
    const hr = hourOf(h);
    const morning = hr >= 2.5 && hr < 8.5;
    const afternoon = hr >= 12 && hr < 19.5;
    const sea = this.climate.coastal ? 1 : 0;
    const warm = this.warmth(h);
    const u = this.unsettled(h);
    // Autumn and winter mornings are the foggy ones; thunderstorms are a summer afternoon thing.
    const fogW = morning ? (sea ? 2.6 : 1.4) * (0.6 + 1.8 * (1 - warm)) * (1.2 - 0.6 * u) : 0;
    const stormW = (afternoon ? 0.6 + 1.4 * warm : 0.06) * (sea ? 0.8 : 1.15) * smoothstep(0.2, 0.65, warm) * (0.4 + 1.2 * u);
    const wet = (1 + 0.35 * sea - 0.3 * warm + 0.2 * (1 - warm)) * (0.45 + 1.3 * u);
    const sunny = (1 + 0.4 * warm) * (1.5 - u);
    const w: Partial<Record<WeatherKind, number>> =
      from === 'clear' ? { fair: 6 * sunny, cloudy: 1.2, fog: fogW, storm: stormW * 0.3 }
      : from === 'fair' ? { clear: 2.4 * sunny, cloudy: 3.6, rain: 0.35 * wet, fog: fogW * 0.8, storm: stormW }
      : from === 'cloudy' ? { fair: 4.5 * sunny, clear: 0.6, overcast: 2.4 * wet, drizzle: 0.8 * wet, rain: 1.0 * wet, storm: stormW * 0.9, fog: fogW * 0.6 }
      : from === 'overcast' ? { cloudy: 3.2, fair: 0.8 * sunny, drizzle: 2.2 * wet, rain: 2.0 * wet, fog: fogW * 0.5 }
      : from === 'drizzle' ? { overcast: 2.6, cloudy: 2.6, rain: 1.4 * wet, fair: 0.6 }
      : from === 'rain' ? { overcast: 2.4, cloudy: 2.8, drizzle: 1.6, fair: 0.8, storm: stormW * 0.6 }
      : from === 'storm' ? { rain: 3.5, cloudy: 2.5, overcast: 1.2, fair: 0.8 }
      : /* fog */ { fair: 4.5 * sunny, cloudy: 2.6, clear: 1.6, overcast: 1.0 * wet };
    let sum = 0;
    for (const k of WEATHER_KINDS) sum += w[k] ?? 0;
    let x = r.float() * sum;
    for (const k of WEATHER_KINDS) { x -= w[k] ?? 0; if (x < 0) return k; }
    return 'fair';
  }

  /** The chain of week `wk` (week 0 starts at game hour 0), covering [start - LEAD_H, end + HANDOVER_H]. */
  private week(wk: number): Segment[] {
    let segs = this.weeks.get(wk);
    if (segs) return segs;
    const t0 = wk * WEEK_H - LEAD_H, t1 = (wk + 1) * WEEK_H + HANDOVER_H;
    const r0 = new Rng(deriveSeed(this.seed, 'weather', wk, 0));
    const u = this.unsettled(t0);
    const kind: WeatherKind = r0.chance(0.25 + 0.5 * u) ? (r0.chance(0.5) ? 'overcast' : 'cloudy') : r0.chance(0.6) ? 'fair' : 'clear';
    segs = [{ kind, start: t0, end: t0 + r0.range(...DUR[kind]), blend: 0 }];
    while (segs[segs.length - 1].end <= t1) {
      const prev = segs[segs.length - 1];
      const r = new Rng(deriveSeed(this.seed, 'weather', wk, segs.length));
      const next = this.nextKind(prev.kind, prev.end, r);
      let dur = r.range(...DUR[next]);
      if (next === 'fog') dur = Math.max(0.8, Math.min(dur, 11 - hourOf(prev.end))); // fog burns off by late morning
      segs.push({ kind: next, start: prev.end, end: prev.end + dur, blend: Math.min(blendTime(prev.kind, next), dur * 0.4) });
    }
    if (this.weeks.size > 12) this.weeks.delete(this.weeks.keys().next().value!);
    this.weeks.set(wk, segs);
    return segs;
  }

  /** The sky parameters and the dominating state of one week's chain at hour h. */
  private chainAt(wk: number, h: number, out: SkyParams): WeatherKind {
    const segs = this.week(wk);
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (segs[m].start <= h) lo = m; else hi = m - 1;
    }
    const s = segs[lo], cur = STATES[s.kind], prev = lo > 0 ? STATES[segs[lo - 1].kind] : cur;
    blendParams(prev, cur, s.blend > 0 ? smoothstep(0, s.blend, h - s.start) : 1, out);
    return lo > 0 && h - s.start < s.blend * 0.5 ? segs[lo - 1].kind : s.kind;
  }

  private readonly tmp: SkyParams = { ...STATES.fair };

  /** The sky at absolute game hour h (no ground state): the chains, the handover, showers and gusts. */
  sky(h: number, out: SkyParams = { ...STATES.fair }): WeatherKind {
    const wk = Math.floor(h / WEEK_H);
    let kind = this.chainAt(wk, h, out);
    const into = h - wk * WEEK_H;
    if (into < HANDOVER_H) {
      const prevKind = this.chainAt(wk - 1, h, this.tmp);
      const f = smoothstep(0, HANDOVER_H, into);
      blendParams(this.tmp, out, f, out);
      if (f < 0.5) kind = prevKind;
    }
    vary(out, h, this.nSeed);
    return kind;
  }

  /** Air temperature at hour h for a sky: the season, warm and cold spells, the day's swing (less under clouds), rain. */
  temperature(h: number, p: SkyParams): number {
    const c = this.climate;
    const phase = yearPhase(this, h * 60);
    const mean = c.meanC + c.swingC * Math.cos(2 * Math.PI * (phase - 0.55));
    const spell = (vnoise(this.nSeed ^ 0x7e3f, h, 5 * 24) - 0.5) * 10 + (vnoise(this.nSeed ^ 0x3c1d, h, 17 * 24) - 0.5) * 5;
    const daySwing = (3 + 2 * warmthOf(phase)) * (1 - 0.65 * p.cover);
    return mean + spell + daySwing * Math.cos((2 * Math.PI * (hourOf(h) - 15)) / 24) - 1.5 * p.precip;
  }

  /** Lying snow (cm) at hour h: snowfall minus melt, integrated over the window before h's week. */
  snowCm(h: number): number {
    const wk = Math.floor(h / WEEK_H);
    let run = this.snowRuns.get(wk);
    if (!run) {
      const t0 = wk * WEEK_H - SNOW_WINDOW_H, n = (SNOW_WINDOW_H + WEEK_H) / SNOW_STEP_H + 1;
      run = new Float32Array(n);
      const p: SkyParams = { ...STATES.fair };
      let cm = 0;
      for (let i = 1; i < n; i++) {
        const t = t0 + (i - 0.5) * SNOW_STEP_H;
        this.sky(t, p);
        const temp = this.temperature(t, p);
        const sf = snowFraction(temp);
        // ~1.5 cm an hour in heavy snow; melting by degree-hours, faster in rain and sunshine.
        cm += SNOW_STEP_H * (1.5 * p.precip * sf - Math.max(0, temp) * (0.05 + 0.12 * p.precip * (1 - sf)) - 0.03 * p.sun * Math.max(0, temp + 4));
        cm = Math.max(0, cm);
        run[i] = cm;
      }
      if (this.snowRuns.size > 4) this.snowRuns.delete(this.snowRuns.keys().next().value!);
      this.snowRuns.set(wk, run);
    }
    const x = (h - (wk * WEEK_H - SNOW_WINDOW_H)) / SNOW_STEP_H, i = Math.floor(x);
    return lerp(run[i], run[Math.min(run.length - 1, i + 1)], x - i);
  }

  /** The full weather at a game minute. */
  weather(clock: number): Weather {
    const h = clock / 60;
    const p: SkyParams = { ...STATES.fair };
    const kind = this.sky(h, p);
    const tempC = this.temperature(h, p);
    const sf = snowFraction(tempC);
    // Wet ground from the last hours (from dry; it dries within hours).
    let wet = 0;
    const q: SkyParams = { ...STATES.fair };
    for (let t = h - WET_WINDOW_H; t < h; t += WET_STEP_H) {
      this.sky(t, q);
      wet = stepWet(wet, q.precip * (1 - snowFraction(this.temperature(t, q))), q.sun, WET_STEP_H);
    }
    const snowCm = this.snowCm(h);
    const hr = hourOf(h);
    return {
      ...p, kind, tempC,
      rain: p.precip * (1 - sf), snow: p.precip * sf,
      wet, snowCm,
      ice: tempC < 0 && wet > 0.15,
      frost: tempC < 0.5 && p.cover < 0.6 && (hr < 10 || hr > 18) && snowCm < 0.5,
    };
  }
}

/** How much of the precipitation falls as snow at a temperature (sleet in between). */
export const snowFraction = (tempC: number): number => smoothstep(2, -0.5, tempC);

/** Blend time (h) from one state to the next: fronts take a while, storms roll in faster. */
function blendTime(a: WeatherKind, b: WeatherKind): number {
  if (a === 'storm' || b === 'storm') return 0.15;
  if (a === 'fog' || b === 'fog') return 0.45;
  if (b === 'rain' || b === 'drizzle' || a === 'rain' || a === 'drizzle') return 0.25;
  return 0.3;
}

/**
 * Blend two states (f 0 → a, 1 → b): clouds first, then the precipitation (it sets in late in the blend and stops
 * early), so a shower never falls from a blue sky.
 */
function blendParams(a: SkyParams, b: SkyParams, f: number, out: SkyParams): SkyParams {
  const fr = b.precip >= a.precip ? smoothstep(0.45, 1, f) : smoothstep(0, 0.55, f);
  out.cover = lerp(a.cover, b.cover, f);
  out.density = lerp(a.density, b.density, f);
  out.dark = lerp(a.dark, b.dark, f);
  out.sun = lerp(a.sun, b.sun, f);
  out.fog = lerp(a.fog, b.fog, f);
  out.wind = lerp(a.wind, b.wind, f);
  out.precip = lerp(a.precip, b.precip, fr);
  out.lightning = lerp(a.lightning, b.lightning, fr);
  return out;
}

/** Variation inside a state: showers, drifting cloud amount, gusts; morning fog lifts as the day warms up. */
function vary(p: SkyParams, h: number, seed: number): void {
  const n1 = vnoise(seed, h, 0.17), n2 = vnoise(seed ^ 0x51ed, h, 0.6), n3 = vnoise(seed ^ 0x9e37, h, 0.05);
  p.precip *= 0.7 + 0.3 * n1;
  p.cover = clamp(p.cover + (n2 - 0.5) * 0.12 * (1 - p.cover) * 2, 0, 1);
  p.wind = clamp(p.wind * (0.7 + 0.6 * n3), 0, 1);
  const hr = hourOf(h);
  const lift = smoothstep(9, 12.5, hr) * (1 - smoothstep(19, 22, hr));
  p.fog = Math.max(p.fog * (1 - 0.75 * lift), Math.min(p.fog, p.precip * 0.45));
}

/** Wet ground 0 … 1 after dtH hours: soaks within minutes in rain, dries over an hour or two (faster in sunshine). */
export function stepWet(wet: number, rain: number, sun: number, dtH: number): number {
  if (rain > 0.03) {
    const target = clamp(0.35 + rain * 1.2, 0, 1);
    if (wet < target) return Math.min(target, wet + dtH * (1.5 + rain * 10));
    return wet;
  }
  return Math.max(0, wet - dtH * (0.25 + 0.75 * sun));
}

// ---- the world's weather, and what people make of it ----------------------------------------------------------

interface WeatherWorld { seed: number; epoch: number; clock: number; region?: { coastal?: boolean } | null }

const models = new WeakMap<object, { model: WeatherModel; last: Map<number, Weather> }>();

/** The weather model of a world (one per world; the climate is temperate, milder and foggier on the coast). */
export function weatherModel(world: WeatherWorld): WeatherModel {
  return entry(world).model;
}

function entry(world: WeatherWorld) {
  let e = models.get(world);
  if (!e || e.model.epoch !== world.epoch) {
    const coastal = !!world.region?.coastal;
    e = { model: new WeatherModel(world.seed, world.epoch, coastal ? { ...TEMPERATE, meanC: 9.5, swingC: 9.5, coastal } : TEMPERATE), last: new Map() };
    models.set(world, e);
  }
  return e;
}

/** The weather in town at a game minute (now by default). Cached: hot loops may call it per person. */
export function weatherAt(world: WeatherWorld, clock = world.clock): Weather {
  const e = entry(world);
  const m = Math.floor(clock);
  let w = e.last.get(m);
  if (!w) {
    w = e.model.weather(m);
    if (e.last.size > 32) e.last.delete(e.last.keys().next().value!);
    e.last.set(m, w);
  }
  return w;
}

/** Rain or snow falling (people put up hoods and umbrellas, stay in, leave the terrace). */
export const isWetOut = (w: Weather): boolean => w.precip > 0.08;
/** Cold enough for a winter coat. */
export const isCold = (w: Weather): boolean => w.tempC < 6;
/** Hot (shade, ice cream, the lake). */
export const isHot = (w: Weather): boolean => w.tempC >= 26;
/** Nice out: dry, mild or warm, not grey (terraces, gardens, walks, the park). */
export const isNiceOut = (w: Weather): boolean => w.precip < 0.02 && w.tempC >= 14 && w.cover < 0.75 && w.wind < 0.6;
/** Bad enough that people who can stay in do (storm, heavy rain or snow, blizzard). */
export const isFoul = (w: Weather): boolean => w.lightning > 0.5 || w.precip > 0.75 || w.wind > 0.85;

/** The weather as people say it: "light snow, -2°C", "sunny and warm, 24°C", "foggy, 6°C". */
export function describeWeather(w: Weather): string {
  const t = `${Math.round(w.tempC)}°C`;
  const snowy = w.snow > w.rain;
  const sleet = w.snow > 0.05 && w.rain > 0.05 && Math.abs(w.snow - w.rain) < 0.4 * w.precip;
  let s: string;
  if (w.precip > 0.08) {
    if (sleet) s = 'sleet';
    else if (w.lightning > 0.5) s = snowy ? 'a blizzard' : 'a thunderstorm';
    else if (snowy) s = w.precip > 0.5 ? 'snowing hard' : w.precip > 0.25 ? 'snowing' : 'light snow';
    else s = w.precip > 0.7 ? 'pouring with rain' : w.precip > 0.3 ? 'raining' : 'drizzle';
  } else if (w.fog > 0.55) s = 'foggy';
  else if (w.cover > 0.85) s = 'grey and overcast';
  else if (w.cover > 0.5) s = 'cloudy';
  else s = w.tempC >= 22 ? 'sunny and warm' : w.tempC < 3 ? 'clear and cold' : w.cover > 0.2 ? 'bright with some cloud' : 'clear';
  const extras: string[] = [];
  if (w.wind > 0.7 && w.lightning < 0.5) extras.push('windy');
  if (w.snowCm >= 1 && !snowy) extras.push(w.snowCm > 10 ? 'deep snow on the ground' : 'snow on the ground');
  else if (w.ice) extras.push('icy underfoot');
  else if (w.frost) extras.push('frosty');
  return `${s}${extras.length ? `, ${extras.join(', ')}` : ''}, ${t}`;
}

/** `w` with the sky of state `kind` instead (a chosen weather for looking at the town; the ground state stays). */
export function forceWeather(w: Weather, kind: WeatherKind): Weather {
  const p = STATES[kind], sf = snowFraction(w.tempC);
  return { ...w, ...p, kind, rain: p.precip * (1 - sf), snow: p.precip * sf, wet: p.precip > 0 ? Math.max(w.wet, 0.35 + p.precip * 0.6) : w.wet };
}
