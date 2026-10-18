/**
 * The intention stack (plan §1.1 rule 3, §3.1): persistent overrides of the generated routine. Routines, needs,
 * events and the LLM (through `applyProposal`) write intentions, never positions. The schedule picks the most
 * urgent active intention before falling back to the routine.
 */
import type { ActorId } from './actors';
import type { PlaceId } from './places';
import type { World } from './world';
import { PROPOSABLE_INTENTIONS } from './mind/proposal';

export const INTENTION_KINDS = [...PROPOSABLE_INTENTIONS, 'eat', 'visit', 'seeDoctor', 'attend'] as const;
export type IntentionKind = (typeof INTENTION_KINDS)[number];
export type Origin = 'routine' | 'need' | 'event' | 'llm' | 'player';

export interface Intention {
  kind: IntentionKind;
  person: ActorId; // -1 = none
  place: PlaceId; // -1 = none
  /** Clock minute it becomes active. */
  at: number;
  /** Clock minute it lapses (dropped unfulfilled). */
  until: number;
  /** Higher wins; work is 50, sleep 60; 'avoid' does not compete, it filters. */
  priority: number;
  origin: Origin;
  /** Fact for 'tell', the occasion id for 'attend' (src/sim/agenda.ts), -1 otherwise. */
  fact: number;
  item: string;
  /** Why, in plain words, for the debug overlay and prompts ("promised Mara to meet at the fountain"). */
  reason: string;
}

/** Add an intention. The actor reconsiders at `at` (or now), so it can interrupt what they are doing. */
export function intend(world: World, id: ActorId, i: Partial<Intention> & { kind: IntentionKind }): Intention {
  const full: Intention = {
    person: -1, place: -1, at: world.clock, until: world.clock + 1440, priority: 55, origin: 'event', fact: -1, item: '', reason: '',
    ...i,
  };
  (world.intentions[id] ??= []).push(full);
  const until = world.actors.cols.until;
  if (full.kind !== 'avoid') until[id] = Math.min(until[id], Math.max(world.clock, full.at));
  return full;
}

export function intentionsOf(world: World, id: ActorId): readonly Intention[] {
  return world.intentions[id] ?? [];
}

/** Remove an intention (fulfilled or abandoned). */
export function dropIntention(world: World, id: ActorId, i: Intention): void {
  const s = world.intentions[id];
  if (!s) return;
  const k = s.indexOf(i);
  if (k >= 0) s.splice(k, 1);
}

/** Drop lapsed intentions; return the most urgent active non-'avoid' one (or null). */
export function activeIntention(world: World, id: ActorId): Intention | null {
  const s = world.intentions[id];
  if (!s || s.length === 0) return null;
  let best: Intention | null = null;
  for (let k = s.length - 1; k >= 0; k--) {
    const i = s[k];
    if (i.until <= world.clock) { s.splice(k, 1); continue; }
    if (i.kind === 'avoid' || i.at > world.clock) continue;
    if (!best || i.priority > best.priority) best = i;
  }
  return best;
}

/** Is `id` avoiding `person` or `place` right now? */
export function avoids(world: World, id: ActorId, person: ActorId, place: PlaceId): boolean {
  const s = world.intentions[id];
  if (!s) return false;
  for (const i of s) {
    if (i.kind !== 'avoid' || i.at > world.clock || i.until <= world.clock) continue;
    if ((person >= 0 && i.person === person) || (place >= 0 && i.place === place)) return true;
  }
  return false;
}
