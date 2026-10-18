/**
 * Holiday decorations at home, as the households choose them (plan, "town realism": visible detail is caused by
 * the sim). Each day the town's face (src/sim/view.ts `townFace`) carries, per place, which decorations are up
 * and what share of its households put them up:
 * - Halloween: pumpkins and window decorations from mid-October to 1 November, far more often where there are
 *   children;
 * - Christmas: lights from the start of the Christmas market (the Friday before Advent) and a tree in the window
 *   from the second week of December, both until Epiphany;
 * - Easter: a few egg garlands in Holy Week;
 * - the summer festival: bunting in the week of the festival.
 * Who decorates: the household's own taste (fixed per household and year), children, money, mood; a household
 * that lost someone close in the last two months does not decorate. Everyone puts things up on their own day,
 * so the town fills in over a week or two.
 *
 * Pure. New in SimWorld.
 */
import { clamp, hashCombine, hashToFloat } from '@futuremagic/core';
import { MINUTES_PER_DAY } from './time';
import { christmasMarket, civilOf, daysOf, easter, festivalStart } from './calendar';
import { closeTo } from './life';
import { ageOf, householdOf, type World } from './world';

export const DECOR_HALLOWEEN = 1;
export const DECOR_XMAS_LIGHTS = 2;
export const DECOR_XMAS_TREE = 4;
export const DECOR_EASTER = 8;
export const DECOR_BUNTING = 16;

/** What each place shows: DECOR_* bits, and the share of its households that decorate (0 … 255). */
export interface HomeDecor {
  flags: Uint8Array;
  share: Uint8Array;
}

/** A holiday's decorating season: days (civil day numbers) and how keen the town is (share of keen households). */
interface DecorSeason { bit: number; from: number; to: number; spread: number; keen: number; kids: number }

/** The decorating seasons that touch civil day `days`. */
export function decorSeasons(world: World, days: number): DecorSeason[] {
  const { year } = civilOf(days);
  const out: DecorSeason[] = [];
  const add = (s: DecorSeason) => { if (days >= s.from && days <= s.to) out.push(s); };
  add({ bit: DECOR_HALLOWEEN, from: daysOf(year, 10, 17), to: daysOf(year, 11, 1), spread: 10, keen: 0.22, kids: 0.5 });
  // Christmas runs over New Year: this year's and the one that began last December.
  for (const y of [year - 1, year]) {
    const epiphany = daysOf(y + 1, 1, 6);
    add({ bit: DECOR_XMAS_LIGHTS, from: christmasMarket(y)[0], to: epiphany, spread: 16, keen: 0.42, kids: 0.2 });
    add({ bit: DECOR_XMAS_TREE, from: daysOf(y, 12, 8), to: epiphany, spread: 14, keen: 0.72, kids: 0.15 });
  }
  const e = easter(year), ed = daysOf(e.year, e.month, e.day);
  add({ bit: DECOR_EASTER, from: ed - 7, to: ed + 3, spread: 4, keen: 0.12, kids: 0.15 });
  const f = festivalStart(world, year);
  add({ bit: DECOR_BUNTING, from: f - 6, to: f + 1, spread: 5, keen: 0.18, kids: 0.05 });
  return out;
}

/** Days a household skips decorating after losing someone close. */
const GRIEF_DAYS = 60;

/** Today's decorations per place (see the header), into `out` when given. */
export function homeDecor(world: World, out?: HomeDecor): HomeDecor {
  const n = world.graph.places.length;
  const flags = out?.flags ?? new Uint8Array(n), share = out?.share ?? new Uint8Array(n);
  flags.fill(0); share.fill(0);
  const day = Math.floor(world.clock / MINUTES_PER_DAY), days = world.epoch + day;
  const seasons = decorSeasons(world, days);
  if (!seasons.length) return { flags, share };
  // Households in mourning: the dead person's home and their close family's.
  const grieving = new Set<number>();
  const events = world.life.events;
  for (let i = events.length - 1; i >= 0 && events[i].day >= day - GRIEF_DAYS; i--) {
    const ev = events[i];
    if (ev.kind !== 'death' || world.actors.cols.kind[ev.who] !== 0) continue;
    for (const hh of world.households) if (hh.home === ev.place) grieving.add(hh.id);
    for (const m of closeTo(world, ev.who)) { const h = householdOf(world, m); if (h) grieving.add(h.id); }
  }
  const ec = world.economy.hh, mood = world.actors.cols.mood;
  const decorating = new Float32Array(n), homes = new Float32Array(n);
  for (const hh of world.households) {
    if (!hh.members.length) continue;
    homes[hh.home]++;
    if (grieving.has(hh.id)) continue;
    const kids = hh.members.some((m) => world.actors.cols.kind[m] === 0 && ageOf(world, m) < 13) ? 1 : 0;
    const wealth = hh.id < ec.count ? ec.cols.wealth[hh.id] : 0.5;
    const cheer = hh.members.reduce((s, m) => s + mood[m], 0) / hh.members.length;
    let any = false;
    for (const s of seasons) {
      const year = civilOf(s.from).year;
      const h = hashCombine(hashCombine(world.seed ^ 0xdec0, hh.id), year * 32 + s.bit);
      // Keenness: the household's taste, children, a little money and a little mood.
      const keen = clamp(s.keen + kids * s.kids + (wealth - 0.5) * 0.15 + cheer * 0.08, 0, 0.97);
      if (hashToFloat(h) >= keen) continue;
      if (days < s.from + Math.floor(hashToFloat(hashCombine(h, 7)) * s.spread)) continue; // not up yet
      flags[hh.home] |= s.bit;
      any = true;
    }
    if (any) decorating[hh.home]++;
  }
  for (let p = 0; p < n; p++) if (homes[p]) share[p] = Math.round((decorating[p] / homes[p]) * 255);
  return { flags, share };
}
