/**
 * A conversation between the player's inhabitant and someone they stopped on the street (plan §3.2, §5), as the
 * society sees it. The LLM never writes here: what an NPC thinks of the conversation enters through `applyProposal`;
 * this file only does what the conversation itself does to the world, whoever voices the NPC (the LLM or the
 * procedural engine):
 *
 *  - `stopToTalk`: the NPC stops where they are (a walk is broken off) and stays to talk;
 *  - `shareInChat`: news the NPC passes on in a reply reaches the partner's belief store (`tell`), so what you hear
 *    in a chat is in your notebook and you can pass it on, distorted or not;
 *  - `endChat`: both remember the conversation, it counts as time spent together (`meet`), and the NPC goes back to
 *    their day.
 */
import type { ActorId } from '../actors';
import { A } from '../actors';
import { beliefAbout, tell } from '../knowledge';
import { remember, wordOverlap } from '../memory';
import { meet } from '../relations';
import { go } from '../schedule';
import { firstName, isPerson, type World } from '../world';

/** Activities a person keeps doing while they talk (a sales assistant serves you; nobody breaks off a lesson). */
const KEEPS = new Set<number>([A.work, A.school]);
/** How much of a reply must echo a belief for it to count as passed on (share of the shorter text's words). */
export const SHARED_OVERLAP = 0.6;

/**
 * `npc` stops to talk for (at least) `minutes`: a walk is broken off where they are (they stay on that street),
 * free time turns into socialising, work and school go on. Called again each turn to keep them.
 */
export function stopToTalk(world: World, npc: ActorId, minutes: number): void {
  if (!isPerson(world, npc)) return;
  const a = world.actors.cols;
  const until = world.clock + Math.max(1, minutes);
  if (a.dest[npc] >= 0) {
    // On the way somewhere: they stop on the street they were walking (the trip is dropped by the next `arrive`).
    a.dest[npc] = -1;
    go(world, npc, a.place[npc], A.socialize, until);
    return;
  }
  if (KEEPS.has(a.activity[npc])) { a.until[npc] = Math.max(a.until[npc], until); return; }
  go(world, npc, a.place[npc], A.socialize, Math.max(a.until[npc], until));
}

/**
 * The NPC's reply passed on news: every belief from `offered` (the facts the NPC's prompt held) whose wording the
 * reply echoes is told to `partner`, through the knowledge network's own `tell` (trust, distortion, secrets); the
 * facts in `voiced` were told for sure (the procedural engine put them into words itself). Returns the facts the
 * partner now holds a version of.
 */
export function shareInChat(world: World, npc: ActorId, partner: ActorId, reply: string, offered: readonly number[], voiced: readonly number[] = []): number[] {
  const told: number[] = [];
  if (!isPerson(world, partner)) return told;
  const facts = world.knowledge.facts;
  for (const f of offered) {
    if (f < 0 || f >= facts.length || beliefAbout(world, npc, f) < 0) continue;
    const text = facts[f].text.replace(/\{\w+\}/g, '');
    if (!voiced.includes(f) && wordOverlap(reply, text) < SHARED_OVERLAP && !mentionsAll(world, reply, facts[f].subject, facts[f].object, text)) continue;
    const t = tell(world, npc, partner, f);
    if (t >= 0) told.push(t);
  }
  return told;
}

/** The reply names the story's people and echoes some of its words: "James lost his job" for "{subject} lost their job at {place}". */
function mentionsAll(world: World, reply: string, subject: ActorId, object: ActorId, text: string): boolean {
  if (subject < 0) return false;
  const low = reply.toLowerCase();
  for (const who of [subject, object]) if (who >= 0 && !low.includes(firstName(world, who).toLowerCase())) return false;
  return wordOverlap(reply, text) >= SHARED_OVERLAP / 2;
}

export interface ChatSummary {
  /** One sentence from the NPC's side ("Tom told me the mill is closing"). Stored through `applyProposal` by the caller. */
  npc?: string;
  /** One sentence from the partner's side ("Ruth said her sister is moving"). */
  partner: string;
  /** 0..1 */
  importance: number;
  /** -1..1: how the talk went (an argument, a pleasant chat). */
  warmth: number;
}

/**
 * The conversation is over: it counts as `minutes` spent together, the partner remembers it, and the NPC returns
 * to their day (they decide what to do next on the coming tick).
 */
export function endChat(world: World, npc: ActorId, partner: ActorId, minutes: number, summary: ChatSummary): void {
  if (!isPerson(world, npc)) return;
  if (isPerson(world, partner)) {
    meet(world.relations, npc, partner, world.clock, Math.max(1, minutes), summary.warmth);
    remember(world, partner, { who: [npc], summary: summary.partner.slice(0, 240), importance: Math.max(0, Math.min(1, summary.importance)) });
  }
  const a = world.actors.cols;
  if (a.dest[npc] < 0 && a.activity[npc] === A.socialize) a.until[npc] = world.clock;
}
