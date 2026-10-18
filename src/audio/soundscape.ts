/**
 * The town's soundscape, decided without any audio: which ambience beds play how loud where the
 * listener is, and which sounds the town's rhythms make right now (church bells on the hour and the
 * Sunday peal, the school bell and the schoolyard at break, lawnmowers on Saturday, dogs in the
 * gardens, roosters at dawn). Pure and deterministic: everything comes from the sound map, the game
 * clock (`src/sim/time.ts`, one game minute per real minute), the weather and a seed, so the same
 * minute always sounds the same and tests need no browser. `src/audio/townAudio.ts` plays it.
 */
import { Rng, clamp, deriveSeed, dist2, smoothstep } from '@futuremagic/core';
import { dayOf, minuteOfDay, weekdayOf } from '../sim/time';
import type { ViewOccasion } from '../sim/view';
import { strikesIn } from '../sim/weather';
import { groundAt, newSample, soundAt, type SoundMap, type SoundSample, type SoundSource } from './soundMap';

/** What time it is and what the weather does. */
export interface SoundEnv {
  /** Game clock (minutes since day 0, a Monday 00:00; fractions allowed). */
  clock: number;
  /** Month 0 … 11 (the calendar is not in the sim yet: the caller's date). */
  month: number;
  /** 0 day … 1 full night. */
  night: number;
  /** Rain and wind 0 … 1. */
  rain: number;
  wind: number;
  /** Is there school today? (the calendar's terms and holidays; Monday … Friday when not given) */
  schoolDay?: boolean;
  /** A feast day (Christmas, Easter …): the bells ring as on a Sunday. */
  feast?: boolean;
  /** Lightning 0 … 1 (a storm): thunder rolls in now and then. */
  lightning?: number;
  /**
   * Today's agenda (from the sim's view): services, weddings, funerals, markets, matches, the festival.
   * When given, the church bells ring for the services and ceremonies on it; without it (the start
   * screen), they ring the fixed Sunday peal.
   */
  occasions?: readonly ViewOccasion[];
}

/** Where the listener is: position and the ground height under it; `indoor` 0 … 1. */
export interface Listener { x: number; y: number; z: number; ground: number; indoor?: number }

/** A one-shot to play `delay` seconds from now. */
export interface Shot { id: string; x: number; y: number; z: number; gain: number; pitch: number; refDist: number; delay: number }

/** A positioned loop that should be playing now; `key` stays the same while it runs. */
export interface LoopCue { key: string; id: string; x: number; y: number; z: number; gain: number; rate: number; refDist: number }

/** The ambience beds' target levels and the ambience low-pass (Hz). */
export interface AmbienceMix { levels: Record<string, number>; muffle: number }

/** Hours the church strikes (inclusive): it keeps quiet at night. */
export const BELL_HOURS: readonly [number, number] = [7, 22];
/** Sunday: the peal before the 10 o'clock service (minutes of the day). */
export const SUNDAY_PEAL: readonly [number, number] = [9 * 60 + 40, 9 * 60 + 55];
/** School bells (minutes of the day) on school days. */
export const SCHOOL_BELLS: readonly number[] = [7 * 60 + 55, 8 * 60, 9 * 60 + 45, 10 * 60 + 5, 12 * 60 + 15, 13 * 60, 15 * 60 + 15];
/** When the schoolyard is full: before school, the breaks, after school (minutes of the day). */
export const SCHOOLYARD: readonly [number, number][] = [[7 * 60 + 40, 7 * 60 + 58], [9 * 60 + 45, 10 * 60 + 5], [12 * 60 + 15, 13 * 60], [15 * 60 + 15, 15 * 60 + 30]];
/** The peal before a service (minutes before its start). */
export const SERVICE_PEAL: readonly [number, number] = [20, 5];
/** The peal after a wedding, as the couple come out (minutes after its end). */
export const WEDDING_PEAL = 8;
/** The funeral knell: one slow stroke every this many seconds, for `KNELL_MINUTES` before the funeral. */
export const KNELL_GAP = 20;
export const KNELL_MINUTES = 10;
/** How far an occasion's crowd is heard at all (m). */
const HEAR_CROWD = 450;
/** Seconds between two strikes of the hour bell. */
const STRIKE_GAP = 2.6;
/** How far the listener hears each kind of source at all (m). */
const HEAR = { church: 2500, school: 400, garden: 230, farm: 1600, station: 800, sports: 600 } as const;

/** How far from an occasion's entrance its church tower may stand (m). */
const TOWER_NEAR = 90;
/** The crowd of an occasion: its loop, level and spread. */
const CROWDS: Partial<Record<ViewOccasion['kind'], { id: string; gain: number; refDist: number }>> = {
  market: { id: 'amb_crowd', gain: 0.7, refDist: 18 },
  christmasMarket: { id: 'amb_crowd', gain: 0.8, refDist: 20 },
  festival: { id: 'amb_crowd', gain: 1, refDist: 30 },
  match: { id: 'amb_crowd', gain: 0.45, refDist: 25 },
  reception: { id: 'terrace_clatter', gain: 0.6, refDist: 8 },
  newYear: { id: 'amb_crowd', gain: 0.9, refDist: 25 },
};

const SATURDAY = 5, SUNDAY = 6;

/** 1 inside [a, b), fading in over `fin` and out over `fout` (same units as `t`). */
const within = (t: number, a: number, b: number, fin: number, fout: number): number => smoothstep(a, a + fin, t) * (1 - smoothstep(b - fout, b, t));

/** The peal loop of a church tower. */
const peal = (tower: SoundSource, gain: number): LoopCue => ({ key: `peal:${tower.x | 0}:${tower.z | 0}`, id: 'bell_peal', x: tower.x, y: tower.y, z: tower.z, gain, rate: 1, refDist: 70 });

export class Soundscape {
  private last = -1;
  private readonly s = newSample();
  private readonly near: SoundSource[] = [];

  /** `weatherSeed`: the town's seed, which the weather's lightning strikes are drawn from (src/sim/weather.ts `strikesIn`), so the sky flashes with the same strikes. */
  constructor(readonly map: SoundMap, readonly seed: number, readonly weatherSeed = seed) {}

  /** Is there school on the day of `env`? */
  static schoolDay(env: SoundEnv): boolean {
    return env.schoolDay ?? weekdayOf(env.clock) < SATURDAY;
  }

  /** The beds for where the listener is, now. */
  ambience(l: Listener, env: SoundEnv): AmbienceMix {
    const s = soundAt(this.map, l.x, l.z, this.s);
    return ambienceAt(s, l, env);
  }

  /**
   * The one-shots the town makes since the last call (call every frame or every second). Each game
   * minute is decided once; a jump of more than ten minutes (a time skip, a hidden tab) is not
   * replayed, the town just carries on from now.
   */
  shots(l: Listener, env: SoundEnv): Shot[] {
    const now = Math.floor(env.clock);
    if (this.last < 0 || now < this.last || now - this.last > 10) this.last = now - 1;
    const out: Shot[] = [];
    for (let m = this.last + 1; m <= now; m++) this.minute(m, l, env, out);
    this.last = now;
    return out;
  }

  /** The loops that should be playing now (the peal, the schoolyard, lawnmowers). */
  loops(l: Listener, env: SoundEnv): LoopCue[] {
    const out: LoopCue[] = [];
    const clock = env.clock, mod = minuteOfDay(clock), wd = weekdayOf(clock), day = dayOf(clock);
    const dry = env.rain < 0.05;
    for (const src of this.sources(l)) {
      if (src.kind === 'church' && !env.occasions && (wd === SUNDAY || env.feast) && mod >= SUNDAY_PEAL[0] && mod < SUNDAY_PEAL[1]) {
        out.push(peal(src, within(mod, SUNDAY_PEAL[0], SUNDAY_PEAL[1], 0.3, 0.4)));
      }
      if (src.kind === 'school' && Soundscape.schoolDay(env) && env.rain < 0.3) {
        for (const [a, b] of SCHOOLYARD) {
          if (mod < a || mod >= b) continue;
          const fade = smoothstep(a, a + 1, mod) * (1 - smoothstep(b - 1.5, b, mod));
          out.push({ key: `yard:${src.x | 0}:${src.z | 0}`, id: 'kids_playground', x: src.x, y: src.y, z: src.z, gain: fade * 0.9, rate: 1, refDist: 25 });
        }
      }
      if (src.kind === 'garden' && dry && mowingSeason(env.month)) {
        const m = this.mowing(src, day, wd, mod);
        if (m > 0) {
          // Up and down the lawn: about 12 m strips, a slow turn at each end.
          const t = clock * 60 / 14, phase = t - Math.floor(t), lane = Math.floor(t) % 6;
          const run = (Math.floor(t) % 2 === 0 ? phase : 1 - phase) * 12 - 6;
          const [ox, oz] = gardenOffset(this.seed, src);
          out.push({ key: `mow:${src.x | 0}:${src.z | 0}`, id: 'lawnmower', x: src.x + ox + run, y: src.y, z: src.z + oz + lane * 0.8 - 2, gain: m * 0.8, rate: 0.97 + 0.06 * hash01(this.seed, 'mow-rate', src.x, src.z), refDist: 6 });
        }
      }
    }
    for (const o of env.occasions ?? []) this.occasionLoops(o, l, clock, env, out);
    // At most three mowers at once: the nearest.
    const mowers = out.filter((c) => c.id === 'lawnmower').sort((a, b) => dist2(a.x, a.z, l.x, l.z) - dist2(b.x, b.z, l.x, l.z));
    return out.filter((c) => c.id !== 'lawnmower' || mowers.indexOf(c) < 3);
  }

  /** The loops of one occasion on the agenda: the peal before a service and after a wedding, the crowd at a market. */
  private occasionLoops(o: ViewOccasion, l: Listener, clock: number, env: SoundEnv, out: LoopCue[]): void {
    const key = `${o.kind}:${o.start}:${o.x | 0}:${o.z | 0}`;
    if (o.kind === 'service' || o.kind === 'wedding') {
      const tower = this.towerOf(o, l);
      if (!tower) return;
      const [a, b] = o.kind === 'service' ? [o.start - SERVICE_PEAL[0], o.start - SERVICE_PEAL[1]] : [o.end, o.end + WEDDING_PEAL];
      if (clock >= a && clock < b) out.push(peal(tower, within(clock, a, b, 0.3, 0.4)));
      return;
    }
    const crowd = CROWDS[o.kind];
    if (!crowd || clock < o.start || clock >= o.end || dist2(o.x, o.z, l.x, l.z) > HEAR_CROWD) return;
    // Fewer people out in the rain.
    const gain = crowd.gain * within(clock, o.start, o.end, 8, 8) * (1 - 0.6 * clamp(env.rain, 0, 1));
    out.push({ key, id: crowd.id, x: o.x, y: groundAt(this.map, o.x, o.z) + 1.5, z: o.z, gain, rate: 1, refDist: crowd.refDist });
  }

  /** The church tower of an occasion's place (a church's bells), null when it is held elsewhere (the town hall, the cemetery). */
  private towerOf(o: ViewOccasion, l: Listener): SoundSource | null {
    if (dist2(o.x, o.z, l.x, l.z) > HEAR.church) return null;
    let best: SoundSource | null = null, bd = TOWER_NEAR;
    for (const s of this.map.sources) {
      if (s.kind !== 'church') continue;
      const d = dist2(s.x, s.z, o.x, o.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** The one-shots of the occasions in game minute `m`: the knell, the cheers, the referee. */
  private occasionShots(m: number, l: Listener, env: SoundEnv, out: Shot[]): void {
    for (const o of env.occasions ?? []) {
      const r = new Rng(deriveSeed(this.seed, 'occasion', m, Math.round(o.x), Math.round(o.z)));
      if (o.kind === 'funeral' && m >= o.start - KNELL_MINUTES && m < o.start) {
        const tower = this.towerOf(o, l);
        if (tower) for (let t = 0; t < 60; t += KNELL_GAP) out.push(shot('bell_toll', tower, 0.9, 0.82, 80, t));
        continue;
      }
      if (dist2(o.x, o.z, l.x, l.z) > HEAR_CROWD) continue;
      const at = { x: o.x, y: groundAt(this.map, o.x, o.z) + 1.5, z: o.z };
      if (o.kind === 'wedding' && m === o.end) out.push(shot('crowd_cheer', at, 0.8, 1.05, 14, r.float() * 20));
      if (o.kind === 'match' && m >= o.start && m <= o.end) {
        // Kick-off, half time, the second half and the final whistle; cheers and kicks in between.
        const half = Math.floor((o.end - o.start - 15) / 2);
        if ([o.start, o.start + half, o.start + half + 15, o.end].includes(m)) out.push(shot('ref_whistle', at, 1, 1, 20, r.float() * 5));
        const playing = m < o.start + half || (m >= o.start + half + 15 && m < o.end);
        if (playing) {
          for (let k = r.int(1, 4); k > 0; k--) out.push(shot('ball_kick', at, 0.7, 0.9 + r.float() * 0.2, 10, r.float() * 60));
          if (r.chance(0.12)) out.push(shot('crowd_cheer', at, 0.9, 0.95 + r.float() * 0.1, 25, r.float() * 60));
        }
      }
      if (o.kind === 'festival' && m >= o.start && m < o.end && r.chance(0.04)) out.push(shot('crowd_cheer', at, 0.6, 1, 20, r.float() * 60));
    }
  }

  /** 0 … 1: is this garden being mown now (a fade in and out at the ends)? */
  private mowing(src: SoundSource, day: number, wd: number, mod: number): number {
    // Half-hour slots; on a Saturday morning or afternoon many gardens, on a weekday evening a few.
    const slot = Math.floor(mod / 30);
    const p = wd === SATURDAY ? ((mod >= 9 * 60 && mod < 12 * 60 + 30) || (mod >= 14 * 60 && mod < 18 * 60) ? 0.09 : 0)
      : wd === SUNDAY ? 0 : mod >= 17 * 60 && mod < 19 * 60 + 30 ? 0.012 : 0;
    if (p === 0) return 0;
    if (hash01(this.seed, 'mow', day, slot, src.x, src.z) >= p) return 0;
    const start = slot * 30 + 2 + 6 * hash01(this.seed, 'mow-start', day, slot, src.x, src.z);
    const end = start + 18 + 10 * hash01(this.seed, 'mow-len', day, slot, src.x, src.z);
    return smoothstep(start, start + 0.15, mod) * (1 - smoothstep(end - 0.15, end, mod));
  }

  /** The sources within hearing of the listener (cached per call). */
  private sources(l: Listener): SoundSource[] {
    this.near.length = 0;
    for (const s of this.map.sources) {
      const r = HEAR[s.kind];
      if ((s.x - l.x) ** 2 + (s.z - l.z) ** 2 < r * r) this.near.push(s);
    }
    return this.near;
  }

  /** Everything that happens in game minute `m`. */
  private minute(m: number, l: Listener, env: SoundEnv, out: Shot[]): void {
    const mod = minuteOfDay(m), h = Math.floor(mod / 60), min = mod % 60;
    const dayTime = 1 - env.night;
    const school = Soundscape.schoolDay({ ...env, clock: m });
    for (const t of strikesIn(this.weatherSeed, m, env.lightning ?? 0)) {
      out.push({ id: t.distance < 1200 ? 'thunder_near' : 'thunder_far', x: l.x + Math.cos(t.angle) * t.distance, y: l.y + 300, z: l.z + Math.sin(t.angle) * t.distance, gain: 1, pitch: 1, refDist: t.distance < 1200 ? 300 : 900, delay: t.at });
    }
    this.occasionShots(m, l, env, out);
    for (const src of this.sources(l)) {
      const r = new Rng(deriveSeed(this.seed, 'minute', m, Math.round(src.x), Math.round(src.z)));
      switch (src.kind) {
        case 'church':
          if (min === 0 && h >= BELL_HOURS[0] && h <= BELL_HOURS[1]) {
            const count = h % 12 || 12;
            for (let k = 0; k < count; k++) out.push(shot('bell_toll', src, 1, 1, 80, k * STRIKE_GAP));
          }
          break;
        case 'school':
          if (school && SCHOOL_BELLS.includes(mod)) out.push(shot('school_bell', src, 1, 1, 18, r.float() * 2));
          break;
        case 'garden': {
          // About a third of the houses with gardens have a dog; it barks now and then by day, rarely at night.
          if (hash01(this.seed, 'dog', src.x, src.z) > 0.35) break;
          const p = 0.015 * dayTime + 0.002 * env.night;
          if (!r.chance(p)) break;
          const barks = r.int(2, 5), pitch = 0.88 + 0.24 * hash01(this.seed, 'dog-size', src.x, src.z);
          let t = r.float() * 50;
          const [ox, oz] = gardenOffset(this.seed, src);
          for (let k = 0; k < barks; k++) { out.push(shot('dog_bark', { x: src.x + ox, y: src.y, z: src.z + oz }, 0.9, pitch, 10, t)); t += r.range(0.35, 0.75); }
          break;
        }
        case 'farm': {
          // Roosters at first light, now and then later in the morning; cows by day.
          const dawn = mod >= 5 * 60 + 15 && mod < 7 * 60 + 30 ? 0.08 : mod >= 7 * 60 + 30 && mod < 11 * 60 ? 0.01 : 0;
          if (dawn > 0 && r.chance(dawn)) out.push(shot('rooster_crow', src, 1, 0.95 + r.float() * 0.1, 30, r.float() * 50));
          if (dayTime > 0.5 && r.chance(0.03)) out.push(shot('cow_moo', src, 0.9, 0.9 + r.float() * 0.2, 25, r.float() * 50));
          break;
        }
        default: break;
      }
    }
  }
}

function shot(id: string, at: { x: number; y: number; z: number }, gain: number, pitch: number, refDist: number, delay: number): Shot {
  return { id, x: at.x, y: at.y, z: at.z, gain, pitch, refDist, delay };
}

/** Lawns are mown from April to October. */
export const mowingSeason = (month: number): boolean => month >= 3 && month <= 9;

/** Where in its garden a dog or a mower is: behind the house, a seeded offset (m). */
function gardenOffset(seed: number, s: SoundSource): [number, number] {
  const a = hash01(seed, 'garden', s.x, s.z) * Math.PI * 2;
  return [Math.cos(a) * 9, Math.sin(a) * 9];
}

function hash01(seed: number, ...parts: (string | number)[]): number {
  return new Rng(deriveSeed(seed, ...parts.map((p) => (typeof p === 'number' ? Math.round(p * 10) : p)))).float();
}

/**
 * The beds at one spot. Traffic follows the day (rush hours, a quiet Sunday), the shopping street's
 * murmur the opening hours, birds the dawn chorus, crickets warm nights; from high up the ground
 * fades and goes dull, and the wind takes over; rain and wind as Scale's weather mix.
 */
export function ambienceAt(s: SoundSample, l: Listener, env: SoundEnv): AmbienceMix {
  const mod = minuteOfDay(env.clock), h = mod / 60, wd = weekdayOf(env.clock);
  const day = 1 - env.night, night = env.night;
  const alt = Math.max(0, l.y - l.ground);
  // The ground beds from high up: quieter and dull, but never gone (the town below still hums).
  const ground = 1 - 0.75 * smoothstep(30, 500, alt);
  const indoor = l.indoor ?? 0;
  const shut = 1 - 0.75 * indoor;
  const rain = env.rain, wet = 1 - 0.35 * smoothstep(0.1, 0.7, rain);
  const sunday = wd === SUNDAY ? 0.55 : wd === SATURDAY ? 0.85 : 1;
  const rush = clamp(0.45 + 0.55 * (bump(h, 8, 1.2) + bump(h, 17.3, 1.5)) + 0.25 * bump(h, 12.5, 2), 0.3, 1) * sunday;
  const shopsOpen = wd === SUNDAY ? 0.15 : smoothstep(8.5, 9.5, h) * (1 - smoothstep(18, 19.5, h)) * (wd === SATURDAY ? 1.2 : 1);
  const chorus = night > 0.5 ? 0.12 : 0.6 + 0.5 * bump(h, 6.3, 1.2) + 0.2 * bump(h, 19.5, 1);
  const warm = env.month >= 4 && env.month <= 8 ? 1 : env.month === 3 || env.month === 9 ? 0.4 : 0;
  const town = s.built;
  const levels: Record<string, number> = {
    // A small town is quieter than Scale's city: the city beds sit lower.
    amb_city_day: town * day * rush * 0.6 * wet * ground,
    amb_city_night: town * night * 0.55 * wet * ground,
    amb_crowd: s.busy * shopsOpen * day * 0.55 * (1 - 0.8 * smoothstep(0.05, 0.4, rain)) * ground,
    amb_park: Math.max(s.green, 0.3 * town) * chorus * (1 - 0.7 * smoothstep(0.05, 0.5, rain)) * ground * (1 - 0.4 * s.rural),
    amb_country_day: s.rural * day * (1 - 0.6 * smoothstep(0.05, 0.5, rain)) * ground,
    amb_country_night: Math.max(s.rural, s.green * 0.6) * night * warm * (1 - smoothstep(0.02, 0.3, rain)) * ground,
    amb_river: s.water * 0.8 * ground,
    amb_sea: s.sea * 0.85 * ground,
    amb_interior: indoor * 0.55,
    amb_rain_light: clamp(rain * 4, 0, 1) * (1 - smoothstep(0.35, 0.8, rain) * 0.6) * shut,
    amb_rain_heavy: smoothstep(0.25, 0.85, rain) * shut,
    // Gusts with the wind, and the wind of open air high above the roofs.
    amb_wind_gust: Math.max(smoothstep(0.3, 0.9, env.wind) * 0.8 * shut, smoothstep(60, 450, alt) * 0.45),
  };
  // Every bed is muffled from high up; indoors, the outdoor beds go dull too.
  const muffle = Math.min(20000 - 18500 * smoothstep(40, 500, alt), 20000 - 18000 * indoor);
  return { levels, muffle };
}

/** A smooth bump around `c` (width `w` hours). */
const bump = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

/** The ids the soundscape may ask for (the manifest must have each one). */
export const SOUNDSCAPE_IDS = [
  'amb_city_day', 'amb_city_night', 'amb_crowd', 'amb_park', 'amb_country_day', 'amb_country_night', 'amb_river', 'amb_sea',
  'amb_interior', 'amb_rain_light', 'amb_rain_heavy', 'amb_wind_gust',
  'bell_toll', 'bell_peal', 'school_bell', 'kids_playground', 'lawnmower', 'dog_bark', 'rooster_crow', 'cow_moo',
] as const;
