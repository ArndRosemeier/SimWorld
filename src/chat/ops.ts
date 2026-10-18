/**
 * The conversation layer's requests, answered inside the sim worker against the live world (src/workers/sim.worker.ts
 * routes `{ type: 'chat', req }` here; src/game/chat.ts asks). The language model runs on the main thread between
 * them: the worker builds what the NPC knows (`turn`), the main thread streams the reply and the appraisal, and the
 * worker applies what came of it (`said`, `apply`, `end`). Every state change goes through the sim's own seams:
 * `applyProposal` for what the NPC thinks, `shareInChat` / `endChat` for what the conversation itself did.
 */
import type { NpcPromptInput, Turn } from '../llm/prompt';
import type { ActorId } from '../sim/actors';
import { FEMALE } from '../sim/actors';
import { factText } from '../sim/knowledge';
import { applyProposal } from '../sim/mind/apply';
import { endChat, shareInChat, stopToTalk } from '../sim/mind/chat';
import type { AppliedChange, Proposal } from '../sim/mind/proposal';
import { relation } from '../sim/relations';
import { ageOf, isPerson, nameOf, type World } from '../sim/world';
import { proceduralReply } from '../talk/answer';
import { moodOf, occupationText } from './card';
import { chatContext } from './context';
import { clamp } from '@futuremagic/core';

/** Game minutes the NPC is held per turn (renewed each turn; the chat panel's close releases them). */
export const HOLD_MINUTES = 10;
/** Below this age nobody holds a conversation (a toddler babbles; the language model would role-play a fluent one). */
export const TALK_MIN_AGE = 4;

/** The chat panel's header: who you are talking to, as your inhabitant knows them. */
export interface ChatHeader {
  npc: ActorId;
  name: string;
  age: number;
  /** "baker at Keller's Bakery", '' if none. */
  occupation: string;
  /** How your inhabitant knows them: "your sister; you know her well", "a stranger". */
  knows: string;
  /** What you can see of their mood: "seems tired, a bit down". */
  looks: string;
  she: boolean;
  /** Your inhabitant. */
  player: ActorId;
  playerName: string;
}

export type ChatRequest =
  /** Stop `npc` to talk with `player`'s inhabitant; the header. */
  | { op: 'start'; npc: ActorId; player: ActorId }
  /** The prompt input for the NPC's next reply (`turns` ends with the player's line). */
  | { op: 'turn'; npc: ActorId; player: ActorId; conversation: string; turns: Turn[] }
  /** No language model: the procedural engine answers from the same input. */
  | { op: 'procedural'; npc: ActorId; player: ActorId; conversation: string; turns: Turn[] }
  /** The NPC said `reply` (to the facts `offered` in its prompt): news in it reaches the player's inhabitant. */
  | { op: 'said'; npc: ActorId; player: ActorId; reply: string; offered: number[]; voiced?: number[] }
  /** What the appraisal proposed for the NPC. */
  | { op: 'apply'; npc: ActorId; proposal: Proposal }
  /** The conversation is over (`npcMemory`: the NPC's own summary, from `memory.summary`, if any). */
  | { op: 'end'; npc: ActorId; player: ActorId; conversation: string; minutes: number; told: string[]; npcMemory?: { summary: string; importance: number } };

export type ChatResponse =
  | { op: 'start'; header: ChatHeader | null }
  | { op: 'turn'; input: NpcPromptInput; offered: number[] }
  | { op: 'procedural'; reply: string; input: NpcPromptInput; offered: number[]; voiced: number[] }
  | { op: 'said'; told: string[] }
  | { op: 'apply'; applied: AppliedChange[]; end: boolean }
  | { op: 'end' };

/** How `player` knows `npc`, in words. */
function knows(world: World, player: ActorId, npc: ActorId, she: boolean): string {
  const r = relation(world, player, npc);
  const them = she ? 'her' : 'him';
  if (!r || r.familiarity < 0.04) return 'a stranger to you';
  const how = r.familiarity > 0.7 ? `you know ${them} well` : r.familiarity > 0.3 ? `you know ${them}` : `you have seen ${them} around`;
  const bond = r.bonds.filter((b) => b !== 'housemate')[0];
  const like = r.affection > 0.5 ? `, you are fond of ${them}` : r.affection < -0.4 ? `, you don't get on` : '';
  return `${bond ? `your ${bond}; ` : ''}${how}${like}`;
}

/**
 * Who you are when nobody has been picked yet (before anyone is picked: `world.player` unset): the first grown-up of
 * the town who is not the person you talk to. Stable per world.
 */
export function standIn(world: World, not: ActorId): ActorId {
  for (let id = 0; id < world.actors.count; id++) {
    if (id !== not && isPerson(world, id) && ageOf(world, id) >= 25 && ageOf(world, id) < 65) return id;
  }
  return -1;
}

/** Answer one request against the live world. */
export function chatOp(world: World, req: ChatRequest): ChatResponse {
  switch (req.op) {
    case 'start': {
      const player = isPerson(world, req.player) ? req.player : isPerson(world, world.player?.id ?? -1) ? world.player!.id : standIn(world, req.npc);
      req = { ...req, player };
      if (!isPerson(world, req.npc) || player < 0 || req.npc === player || ageOf(world, req.npc) < TALK_MIN_AGE) return { op: 'start', header: null };
      stopToTalk(world, req.npc, HOLD_MINUTES);
      const she = world.actors.cols.sex[req.npc] === FEMALE;
      const m = moodOf(world, req.npc);
      return {
        op: 'start',
        header: {
          npc: req.npc, name: nameOf(world, req.npc), age: ageOf(world, req.npc), occupation: occupationText(world, req.npc), knows: knows(world, req.player, req.npc, she),
          looks: `seems ${[m.mood, m.needs].filter(Boolean).join(', ')}`, she, player: req.player, playerName: nameOf(world, req.player),
        },
      };
    }
    case 'turn': {
      stopToTalk(world, req.npc, HOLD_MINUTES);
      const c = chatContext(world, req.npc, req.player, req.conversation, req.turns);
      return { op: 'turn', input: c.input, offered: c.offered };
    }
    case 'procedural': {
      stopToTalk(world, req.npc, HOLD_MINUTES);
      const c = chatContext(world, req.npc, req.player, req.conversation, req.turns);
      const w = { world, npc: req.npc, partner: req.player, offered: c.offered, told: [] as number[] };
      const reply = proceduralReply(c.input, w);
      return { op: 'procedural', reply, input: c.input, offered: c.offered, voiced: w.told };
    }
    case 'said': {
      const told = shareInChat(world, req.npc, req.player, req.reply, req.offered, req.voiced);
      return { op: 'said', told: told.map((f) => factText(world, world.knowledge.facts[f])) };
    }
    case 'apply': {
      const applied = applyProposal(world, req.npc, req.proposal);
      return { op: 'apply', applied, end: applied.some((x) => x.change.kind === 'endConversation' && x.outcome !== 'rejected') };
    }
    case 'end': {
      if (req.npcMemory?.summary) {
        applyProposal(world, req.npc, { npc: req.npc, partner: req.player, conversation: req.conversation, changes: [{ kind: 'memory', summary: req.npcMemory.summary, importance: req.npcMemory.importance }] });
      }
      // How it went, from what the conversation moved: the appraisal's affection changes toward the partner.
      const moved = world.mind.conversations.get(req.conversation)?.moved.get(`${req.player}:affection`) ?? 0;
      const npcName = nameOf(world, req.npc).split(' ')[0];
      const place = world.graph.places[world.actors.cols.place[req.npc]];
      const where = place ? ` on ${place.kind === 'street' ? place.street || place.name : place.name}` : '';
      const news = req.told.length ? `; ${npcName} told me that ${req.told.slice(0, 2).join(', and that ')}` : '';
      endChat(world, req.npc, req.player, req.minutes, {
        partner: `talked with ${npcName}${where}${news}`, importance: clamp(0.25 + 0.1 * req.told.length, 0, 0.7), warmth: clamp(0.2 + moved * 3, -1, 1),
      });
      return { op: 'end' };
    }
  }
}
