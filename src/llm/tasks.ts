/**
 * The LLM tasks (plan R6). Each declares what it needs from a model (routing), how much thinking it
 * wants, its prompt and how its reply is read. `llm.run(task, input)` is the only way to run one.
 *
 *  - npc.speech      the NPC's reply in a chat, streamed (writing; quality first)
 *  - npc.appraisal   what the reply changed in the NPC's mind, as JSON (structured, fast; cheapest)
 *  - memory.summary  a finished conversation as an episodic memory (structured, cheap)
 *  - npc.reflection  occasional insights from many memories (reasoning; rare)
 *  - skip.digest     what the player's person learned during a time skip (cheap, long context)
 */
import { APPRAISAL_SCHEMA, appraisalMessages, parseAppraisal, stripFence, type AppraisalInput, type AppraisalResult } from './appraisal';
import { backgroundBlock, refsFor, RefTable, speechMessages, transcript, type Memory, type Message, type NpcCard, type NpcPromptInput, type PersonRef, type PlaceRef } from './prompt';
import type { Effort } from './roster';
import type { Routing } from './router';
import type { JsonSchema } from './wire';

export interface TaskSpec<I, O> {
  routing: Routing;
  effort: Effort;
  maxTokens: number;
  temperature?: number;
  /** Per attempt, ms. */
  timeoutMs: number;
  schema?: { name: string; schema: JsonSchema };
  build(input: I): { messages: Message[]; refs: RefTable; npc?: number };
  /** Read the full reply. Throw if it does not fit the task's contract (the router then tries the next model). */
  parse(text: string, input: I, refs: RefTable): O;
}

// --- memory.summary -------------------------------------------------------------------------------

export interface SummaryOutput {
  summary: string;
  importance: number;
}

const SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences at most, from the speaker\'s point of view, in the past tense, with names: what was said and what it meant to them.' },
    importance: { type: 'integer', minimum: 1, maximum: 10, description: '1 forgettable small talk .. 10 life-changing' },
  },
  required: ['summary', 'importance'],
  additionalProperties: false,
};

// --- npc.reflection -------------------------------------------------------------------------------

export interface ReflectionInput {
  npc: NpcCard;
  /** Recent and important memories, oldest first. */
  memories: Memory[];
  people: PersonRef[];
  places: PlaceRef[];
}

export interface Insight {
  text: string;
  about: { people: number[]; places: number[] };
  importance: number;
}

export interface ReflectionOutput {
  insights: Insight[];
  dropped: string[];
}

const REFLECTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      description: 'One to three conclusions the person draws from these memories, in their own voice ("I have started to trust [P2]").',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          about: { type: 'array', items: { type: 'string' }, description: 'refs of the people and places it is about' },
          importance: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['text', 'about', 'importance'],
        additionalProperties: false,
      },
    },
  },
  required: ['insights'],
  additionalProperties: false,
};

// --- skip.digest ----------------------------------------------------------------------------------

export interface DigestInput {
  /** The player's person: the digest holds only what they would know. */
  pov: NpcCard;
  /** "Monday 3 May" .. "Sunday 9 May". */
  from: string;
  to: string;
  /** What this person did, saw and heard during the skip, oldest first (built from their own memories and beliefs). */
  events: { when: string; text: string; importance: number }[];
}

// --- the table ------------------------------------------------------------------------------------

export interface TaskIO {
  'npc.speech': { input: NpcPromptInput; output: string };
  'npc.appraisal': { input: AppraisalInput; output: AppraisalResult };
  'memory.summary': { input: NpcPromptInput; output: SummaryOutput };
  'npc.reflection': { input: ReflectionInput; output: ReflectionOutput };
  'skip.digest': { input: DigestInput; output: string };
}

export type TaskName = keyof TaskIO;

const parseJson = (text: string): Record<string, unknown> => {
  const v = JSON.parse(stripFence(text)) as unknown;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not a JSON object');
  return v as Record<string, unknown>;
};

/** Models sometimes prefix the speaker's name or echo the stage note; keep only the spoken line. */
export function cleanSpeech(text: string, name: string): string {
  let s = text.trim();
  s = s.replace(/^\[Not spoken[\s\S]*?\]\s*/i, '');
  const first = name.split(/\s+/)[0];
  s = s.replace(new RegExp(`^(?:${escapeRe(name)}|${escapeRe(first)})(?:\\s*\\[P\\d+\\])?\\s*:\\s*`, 'i'), '');
  s = s.replace(/^"([\s\S]*)"$/, '$1').trim();
  return s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const TASKS: { [K in TaskName]: TaskSpec<TaskIO[K]['input'], TaskIO[K]['output']> } = {
  'npc.speech': {
    routing: { needs: ['writing'], rank: 'quality' },
    effort: 'none',
    maxTokens: 400,
    temperature: 0.9,
    timeoutMs: 30_000,
    build(input) {
      const refs = refsFor(input);
      return { messages: speechMessages(input, refs), refs, npc: input.npc.id };
    },
    parse(text, input) {
      const s = cleanSpeech(text, input.npc.name);
      if (!s) throw new Error('empty reply');
      return s;
    },
  },

  'npc.appraisal': {
    routing: { needs: ['structured', 'fast'], rank: 'cost' },
    effort: 'none',
    maxTokens: 900,
    temperature: 0.2,
    timeoutMs: 20_000,
    schema: { name: 'appraisal', schema: APPRAISAL_SCHEMA },
    build(input) {
      const refs = refsFor(input.context);
      return { messages: appraisalMessages(input, refs), refs, npc: input.context.npc.id };
    },
    parse: parseAppraisal,
  },

  'memory.summary': {
    routing: { needs: ['structured', 'cheap'], prefers: ['writing'], rank: 'cost' },
    effort: 'low',
    maxTokens: 300,
    temperature: 0.3,
    timeoutMs: 30_000,
    schema: { name: 'memory', schema: SUMMARY_SCHEMA },
    build(input) {
      const refs = refsFor(input);
      return {
        npc: input.npc.id,
        refs,
        messages: [
          { role: 'system', content: `You turn a finished conversation into one memory of the speaker, ${input.npc.name}. Write it the way they would remember it: what mattered to them, not a transcript. Use names, not refs. Judge importance by what it means for their life.` },
          { role: 'system', content: backgroundBlock(input, refs) },
          { role: 'user', content: `${input.scene.clock}, at ${input.scene.place.name}.\n\n${transcript(input, refs)}` },
        ],
      };
    },
    parse(text) {
      const v = parseJson(text);
      const summary = typeof v.summary === 'string' ? v.summary.trim() : '';
      if (!summary || typeof v.importance !== 'number') throw new Error('summary or importance missing');
      return { summary: summary.slice(0, 400), importance: Math.max(1, Math.min(10, Math.round(v.importance))) };
    },
  },

  'npc.reflection': {
    routing: { needs: ['reasoning', 'structured'], prefers: ['writing'], rank: 'quality' },
    effort: 'medium',
    maxTokens: 2500,
    timeoutMs: 90_000,
    schema: { name: 'reflection', schema: REFLECTION_SCHEMA },
    build(input) {
      const refs = new RefTable();
      refs.person(input.npc.id, input.npc.name);
      for (const p of input.people) refs.person(p.id, p.name);
      for (const l of input.places) refs.place(l.id, l.name);
      const people = input.people.map((p) => `- ${p.name} [${refs.person(p.id)}]${p.bonds?.length ? ` (${p.bonds.join(', ')})` : ''}`);
      const places = input.places.map((l) => `- ${l.name} [${refs.place(l.id)}], ${l.kind}`);
      return {
        npc: input.npc.id,
        refs,
        messages: [
          { role: 'system', content: `You are the inner voice of ${input.npc.name}, ${input.npc.age}${input.npc.occupation ? `, ${input.npc.occupation}` : ''}. ${input.npc.biography}\nFrom the memories below, draw the few conclusions this person would draw about the people and the life around them. Only what follows from the memories; no new facts.` },
          { role: 'user', content: [`People:`, ...people, `Places:`, ...places, `Memories, oldest first:`, ...input.memories.map((m) => `- ${m.when}: ${m.summary}`)].join('\n') },
        ],
      };
    },
    parse(text, _input, refs) {
      const v = parseJson(text);
      const dropped: string[] = [];
      const insights: Insight[] = [];
      for (const i of Array.isArray(v.insights) ? v.insights : []) {
        const o = i as Record<string, unknown>;
        if (typeof o?.text !== 'string' || !o.text.trim()) { dropped.push('insight without text'); continue; }
        const about = refs.split(o.about, (r) => dropped.push(`insight: unknown ref ${JSON.stringify(r)}`));
        insights.push({ text: refs.unref(o.text.trim()).slice(0, 300), about, importance: typeof o.importance === 'number' ? Math.max(1, Math.min(10, Math.round(o.importance))) : 5 });
      }
      return { insights, dropped };
    },
  },

  'skip.digest': {
    routing: { needs: ['cheap', 'long_context'], prefers: ['writing'], rank: 'cost' },
    effort: 'low',
    maxTokens: 900,
    temperature: 0.6,
    timeoutMs: 60_000,
    build(input) {
      const refs = new RefTable();
      refs.person(input.pov.id);
      // The 200 most important, told in order.
      const keep = new Set([...input.events].sort((a, b) => b.importance - a.importance).slice(0, 200));
      const events = input.events.filter((e) => keep.has(e));
      return {
        npc: input.pov.id,
        refs,
        messages: [
          { role: 'system', content: `Time passed in a town while the player was away. Write what ${input.pov.name} remembers of it, addressed to the player as "you" (they are ${input.pov.name}). Lead with what matters most to this person. Only what is in the list; nothing else happened as far as they know. A few short paragraphs, plain and warm, no headings.` },
          { role: 'user', content: `From ${input.from} to ${input.to}:\n${events.map((e) => `- ${e.when}: ${e.text}`).join('\n')}` },
        ],
      };
    },
    parse(text) {
      const s = text.trim();
      if (!s) throw new Error('empty digest');
      return s;
    },
  },
};
