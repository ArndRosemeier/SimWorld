/**
 * Episodic memory (plan §3.1): what a person remembers having happened to them, for prompts and reflection.
 * Retrieval ranks by recency × importance × relevance, Generative-Agents style; relevance is word and
 * person/place overlap for now (the MiniLM embedder from Scale can replace `relevance` later without changing callers).
 */
import type { ActorId } from './actors';
import type { Emotion } from './mind/proposal';
import type { PlaceId } from './places';
import type { World } from './world';

export interface Memory {
  /** Clock minute. */
  time: number;
  place: PlaceId;
  /** People involved. */
  who: ActorId[];
  /** One-line summary in the person's perspective ("Ruby told me James lost his job"). */
  summary: string;
  /** 0..1 */
  importance: number;
  emotion: Emotion | null;
  /** Fact it is about, -1 if none. */
  fact: number;
}

/** Memories kept per person; the least valuable (importance × recency) go first. */
export const MEMORY_CAP = 150;
/** Recency half-life in game days. */
const HALF_LIFE_DAYS = 7;

export interface Memories {
  byPerson: Memory[][];
}

export const newMemories = (): Memories => ({ byPerson: [] });

export function remember(world: World, id: ActorId, m: Omit<Memory, 'time' | 'fact' | 'emotion' | 'place'> & Partial<Memory>): Memory {
  const mem: Memory = { time: world.clock, place: world.actors.cols.place[id], fact: -1, emotion: null, ...m };
  const list = (world.memory.byPerson[id] ??= []);
  list.push(mem);
  if (list.length > MEMORY_CAP) {
    let worst = 0, ws = Infinity;
    for (let i = 0; i < list.length; i++) {
      const v = list[i].importance * recency(world, list[i]);
      if (v < ws) { ws = v; worst = i; }
    }
    list.splice(worst, 1);
  }
  return mem;
}

export function memoriesOf(world: World, id: ActorId): readonly Memory[] {
  return world.memory.byPerson[id] ?? [];
}

const recency = (world: World, m: Memory) => Math.pow(0.5, (world.clock - m.time) / 1440 / HALF_LIFE_DAYS);
/** Content words of a text (lower case, 4+ letters). */
export const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z']+/).filter((w) => w.length >= 4));

/** Share of the shorter text's content words that the other has too, 0..1. */
export function wordOverlap(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.max(1, Math.min(wa.size, wb.size));
}

export interface RecallQuery {
  /** People in the conversation or mentioned. */
  who?: readonly ActorId[];
  place?: PlaceId;
  /** Free text (the player's message). */
  text?: string;
}

/** The `k` memories that matter most for this moment (plan §3.1). */
export function recall(world: World, id: ActorId, q: RecallQuery, k = 5): Memory[] {
  const qw = q.text ? words(q.text) : null;
  const scored = memoriesOf(world, id).map((m) => {
    let rel = 0;
    if (q.who && m.who.some((w) => q.who!.includes(w))) rel += 0.6;
    if (q.place !== undefined && q.place >= 0 && m.place === q.place) rel += 0.3;
    if (qw && qw.size > 0) {
      const mw = words(m.summary);
      let hit = 0;
      for (const w of qw) if (mw.has(w)) hit++;
      rel += 0.6 * (hit / Math.max(1, Math.min(qw.size, mw.size)));
    }
    return { m, s: 0.3 * recency(world, m) + 0.35 * m.importance + 0.35 * Math.min(1, rel) };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.m);
}
