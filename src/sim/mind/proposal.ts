/**
 * What an LLM may propose for an NPC's mind after a conversation turn: the input of
 * `applyProposal(world, id, proposal)` (src/sim/mind/apply.ts), the only way LLM output changes
 * state (plan §3.2: "the LLM proposes, the game disposes").
 *
 * Produced by src/llm (the `npc.appraisal` task), which maps the model's refs back to ids and drops
 * anything malformed before this type is built. Everything here is a request: applyProposal clamps
 * the steps, gates them by personality, checks feasibility and logs what it did.
 *
 * Agreed between the LLM layer and Society simulation threads (2026-10-18). Types only.
 */

/** Actor and place ids as the society sim stores them. (Re-exported from src/sim/actors.ts / places.ts once those land.) */
export type ActorId = number;
export type PlaceId = number;

/** An ordinal nudge: -3 (a lot down) .. +3 (a lot up). applyProposal maps it to real deltas and clamps. */
export type Step = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export const EMOTIONS = ['joy', 'anger', 'fear', 'sadness', 'surprise', 'disgust', 'affection', 'shame'] as const;
export type EmotionKind = (typeof EMOTIONS)[number];

/** The closed set of things a conversation can make an NPC go and do (plan §3.2). */
export const INTENTIONS = ['go_to', 'meet', 'tell', 'avoid', 'call_police', 'ask_leave', 'quit_job', 'buy', 'give', 'change_routine'] as const;
export type IntentionKind = (typeof INTENTIONS)[number];

export interface When {
  inMinutes?: number;
  /** 'HH:MM', 24 h. */
  clock?: string;
  /** 0 today, 1 tomorrow, n days ahead. */
  day?: number;
}

export interface RelationProposal {
  toward: ActorId;
  trust?: Step;
  affection?: Step;
  respect?: Step;
  reason: string;
}

export interface BeliefProposal {
  /** The claim as the NPC understood it, one sentence. */
  claim: string;
  about: { people: ActorId[]; places: PlaceId[] };
  /** Who told them (usually the partner). */
  source: ActorId;
  stance: 'accepts' | 'doubts' | 'rejects';
}

/** A claim the NPC itself made that is not among its beliefs (the epistemic firewall). */
export interface UtteranceProposal {
  claim: string;
  about: { people: ActorId[]; places: PlaceId[] };
  kind: 'speculation' | 'lie';
}

export interface IntentionProposal {
  kind: IntentionKind;
  person?: ActorId;
  place?: PlaceId;
  /** What to tell, for `tell`; what changes, for `change_routine`. */
  topic?: string;
  /** For `buy` / `give`. */
  item?: string;
  when?: When;
  /** The words in the NPC's reply that committed to it. */
  quote: string;
}

export interface MindProposal {
  /** Whose mind changes. */
  npc: ActorId;
  /** Who they were talking to. */
  partner: ActorId;
  relations: RelationProposal[];
  emotion?: { kind: EmotionKind; intensity: 1 | 2 | 3; toward?: ActorId };
  beliefs: BeliefProposal[];
  utterances: UtteranceProposal[];
  intentions: IntentionProposal[];
  memory?: { summary: string; importance: number };
  endConversation?: { reason: string };
}
