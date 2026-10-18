/**
 * Opening hours per business (town-realism §3, track E). `defaultHours(kind)` is what a kind of place usually keeps;
 * each real business keeps its own version of it. Some shops close at one on Wednesdays, some stay open late on
 * Thursdays, small shops and cafés may shut on Mondays, the pub may open at lunchtime at the weekend, and nobody opens
 * or closes on exactly the same quarter hour as the shop next door.
 *
 * `createWorld` applies it once, seeded per place, to the world's copy of the place graph. The planner's graph keeps
 * the defaults, so signs and boards that show a shop's hours read them from the world.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { Hours, Place, PlaceGraph, PlaceKind } from './places';

const MON = 0, WED = 2, THU = 3, SAT = 5;
const bit = (d: number) => 1 << d;

/** Kinds whose hours vary like a high-street shop's. */
const SHOPS = new Set<PlaceKind>(['bakery', 'butcher', 'grocer', 'pharmacy', 'hairdresser', 'shop', 'hardware', 'clothes', 'florist', 'charity', 'estateagent', 'beauty', 'post']);
/** Small independents that may take Monday off. */
const SMALL = new Set<PlaceKind>(['hairdresser', 'beauty', 'florist', 'clothes', 'shop', 'charity', 'cafe', 'butcher']);
/** Kinds that may stay open late on Thursdays. */
const LATE = new Set<PlaceKind>(['shop', 'clothes', 'hardware', 'hairdresser', 'pharmacy']);

/** Take weekday `d` out of every window and give it `w` instead (or nothing). */
function replaceDay(hours: Hours[], d: number, w: ((h: Hours) => Hours | null)): Hours[] {
  const out: Hours[] = [];
  for (const h of hours) {
    if (!(h.days & bit(d))) { out.push(h); continue; }
    if (h.days & ~bit(d)) out.push({ ...h, days: h.days & ~bit(d) });
    const r = w({ ...h, days: bit(d) });
    if (r) out.push(r);
  }
  return out;
}

/** One business's own hours: its kind's defaults, varied. */
export function businessHours(kind: PlaceKind, hours: readonly Hours[], rng: Rng): Hours[] {
  let out = hours.map((h) => ({ ...h }));
  if (out.length === 0) return out;
  if (SHOPS.has(kind) && rng.chance(0.25)) out = replaceDay(out, WED, (h) => (h.open < 13 * 60 ? { ...h, close: Math.min(h.close, 13 * 60) } : null));
  if (LATE.has(kind) && rng.chance(0.3)) out = replaceDay(out, THU, (h) => ({ ...h, close: Math.max(h.close, 20 * 60) }));
  if (SMALL.has(kind) && rng.chance(0.2)) out = replaceDay(out, MON, () => null);
  if (kind === 'pub' && rng.chance(0.5)) out.push({ days: bit(SAT) | bit(6), open: 12 * 60, close: 15 * 60 });
  // Each opens and closes on its own quarter hour (a window never shrinks below two hours).
  const shift = rng.int(-2, 2) * 15, shut = rng.int(-2, 2) * 15;
  return out.map((h) => (h.close - h.open - shift + shut >= 120 ? { ...h, open: h.open + shift, close: h.close + shut } : h));
}

/** The graph with each business keeping its own hours (new place objects for those that change). */
export function withLocalHours(graph: PlaceGraph, seed: number): PlaceGraph {
  const places = graph.places.map((p): Place => {
    if (p.hours.length === 0 || p.kind === 'school' || p.kind === 'kindergarten' || p.kind === 'church' || p.kind === 'cemetery') return p;
    return { ...p, hours: businessHours(p.kind, p.hours, new Rng(deriveSeed(seed, 'hours', p.id))) };
  });
  return { ...graph, places };
}
