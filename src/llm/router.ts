/**
 * Task routing: which roster models may run a task, best first (plan R6).
 *
 * A model qualifies when it is enabled and has every capability the task `needs`. Qualified models
 * are ordered by how many of the task's `prefers` they have, then by the task's `rank` (quality: the
 * quality score; cost: the blended list price), then by id so the order is stable. A per-task
 * override from the settings puts the player's picks first, in their order, if they qualify.
 */
import type { Capability, ModelEntry, Roster } from './roster';

export interface Routing {
  needs: Capability[];
  prefers?: Capability[];
  rank: 'quality' | 'cost';
}

/** Blended list price per million tokens, weighted like a chat turn (mostly input). */
export const blendedPrice = (m: ModelEntry): number => m.price.prompt * 0.8 + m.price.completion * 0.2;

export function qualifies(m: ModelEntry, r: Routing): boolean {
  return m.enabled && r.needs.every((c) => m.tags.includes(c));
}

/** The models to try for a task, in order. `override` lists model ids the player pinned for it. */
export function route(roster: Roster, r: Routing, override: string[] = [], maxTries = 3): ModelEntry[] {
  const ok = roster.models.filter((m) => qualifies(m, r));
  const pref = (m: ModelEntry) => (r.prefers ?? []).filter((c) => m.tags.includes(c)).length;
  const rank = (m: ModelEntry) => (r.rank === 'quality' ? -(m.quality ?? 0) : blendedPrice(m));
  ok.sort((a, b) => pref(b) - pref(a) || rank(a) - rank(b) || (r.rank === 'cost' ? (b.quality ?? 0) - (a.quality ?? 0) : 0) || (a.id < b.id ? -1 : 1));
  const pinned = override.map((id) => ok.find((m) => m.id === id)).filter((m): m is ModelEntry => !!m);
  const rest = ok.filter((m) => !pinned.includes(m));
  return [...pinned, ...rest].slice(0, Math.max(maxTries, pinned.length));
}
