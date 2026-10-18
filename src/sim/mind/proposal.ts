/**
 * What an LLM may propose for an NPC after a conversation turn (plan §3.2, "the LLM proposes, the game disposes").
 *
 * Contract between the LLM layer (src/llm builds it from the appraisal call) and the sim (`applyProposal` in
 * src/sim/mind/apply.ts validates, clamps, gates by personality and logs it). Every reference to a person or place is
 * already resolved to an id by the LLM layer (it built the prompt, so it knows which ids it showed the model);
 * anything it could not resolve is dropped there, not guessed here.
 */
import type { ActorId } from '../actors';
import type { PlaceId } from '../places';

export const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Intentions an LLM may create, from commitments the NPC actually made in its speech. */
export const PROPOSABLE_INTENTIONS = [
  'go',        // go to `place` (at `at`)
  'meet',      // meet `person` (at `place`, at `at`)
  'tell',      // tell `person` about `fact`
  'avoid',     // avoid `person` or `place` until `until`
  'callPolice',
  'takeLeave', // ask for leave / skip work
  'quitJob',
  'give',      // give `item` to `person`
  'buy',       // buy `item` (at `place`)
] as const;
export type ProposableIntention = (typeof PROPOSABLE_INTENTIONS)[number];

/** A claim the NPC heard in the conversation (usually from the player). Becomes a fact + belief if accepted. */
export interface Claim {
  /** One-line paraphrase in plain English: "Jonas lost his job at the garage". Used by talk and prompts. */
  text: string;
  /** Who the claim is about, when it names a known person. */
  about?: ActorId;
  /** Where it happened, when it names a known place. */
  place?: PlaceId;
  /** Topic from the closed fact vocabulary (src/sim/knowledge.ts `FACT_TOPICS`); 'other' when none fits. */
  topic: string;
  /** Is this a secret ("don't tell anyone")? */
  secret: boolean;
}

export type ProposalChange =
  /** Feelings toward a person (usually the player's character). Deltas in [-1, 1] before clamping. */
  | { kind: 'relation'; toward: ActorId; trust?: number; affection?: number; respect?: number; reason: string }
  | { kind: 'emotion'; emotion: Emotion; delta: number; reason: string }
  /** The NPC's plausibility judgement in [0, 1]; the sim combines it with trust in the source. */
  | { kind: 'belief'; claim: Claim; plausibility: number }
  | {
      kind: 'intention';
      intention: ProposableIntention;
      person?: ActorId;
      place?: PlaceId;
      /** Game minute (absolute, `world.clock` units) it should happen at; omitted = soon. */
      at?: number;
      until?: number;
      item?: string;
      /** For 'tell': the claim to pass on (must be a belief the NPC holds or one accepted in this proposal). */
      claimText?: string;
      reason: string;
    }
  | { kind: 'memory'; summary: string; importance: number; emotion?: Emotion }
  | { kind: 'endConversation'; reason: string };

export interface Proposal {
  /** The NPC whose state changes. */
  npc: ActorId;
  /** Who they were talking to (the player's character, or another NPC in a group chat). */
  partner: ActorId;
  /** Conversation id from the LLM layer, so per-conversation clamps can add up turns. */
  conversation: string;
  changes: ProposalChange[];
}

/** What `applyProposal` did with each change, for the dev overlay and the usage/debug log. */
export interface AppliedChange {
  change: ProposalChange;
  outcome: 'applied' | 'softened' | 'rejected';
  /** Why it was softened or rejected ("clamped trust +0.6 to +0.15 per turn", "loyalty gate: family"). */
  note: string;
}
