/**
 * The model roster: the models the player has, and what each is good at (plan R6, Arnd D11).
 *
 * Capability tags are hints the router matches against each task's needs. Some come straight from
 * OpenRouter's /models list (structured output, long context, price), the rest (fast, writing) are
 * judgement and editable by the player. The default picks below were tested live on 2026-10-18;
 * `rosterFromCatalog` refreshes their prices and limits from the live list.
 */
import type { CatalogModel } from './openrouter';
import type { TaskName } from './tasks';

export type Capability =
  | 'fast'         // low latency to first token: no forced thinking
  | 'cheap'        // <= $0.50 / M input and <= $2 / M output
  | 'structured'   // honours a JSON schema (response_format json_schema)
  | 'writing'      // natural, emotionally convincing dialogue
  | 'reasoning'    // thinks before answering; worth it for rare, reflective tasks
  | 'long_context'; // >= 200k tokens

export const CAPABILITIES: readonly Capability[] = ['fast', 'cheap', 'structured', 'writing', 'reasoning', 'long_context'];

export type Effort = 'none' | 'low' | 'medium' | 'high';

export interface ModelEntry {
  /** OpenRouter model id, e.g. `anthropic/claude-haiku-5.5`. */
  id: string;
  label: string;
  tags: Capability[];
  /** US dollars per million tokens (list price; the ledger records what was actually charged). */
  price: { prompt: number; completion: number; cacheRead?: number };
  contextLength: number;
  maxOutput?: number;
  /** Request parameters the model takes (from /models `supported_parameters`). */
  params: string[];
  /** Thinking: whether it can be turned off, and which efforts exist. */
  reasoning?: { mandatory: boolean; efforts: Effort[] };
  /** A general quality score (OpenRouter's Artificial Analysis intelligence index), for ranking. */
  quality?: number;
  enabled: boolean;
}

export interface Roster {
  models: ModelEntry[];
}

const CHEAP_PROMPT = 0.5;
const CHEAP_COMPLETION = 2;
const LONG_CONTEXT = 200_000;

const perMillion = (s: string | undefined): number | undefined => (s === undefined ? undefined : Math.round(Number(s) * 1e6 * 1e6) / 1e6);

const EFFORTS: readonly Effort[] = ['none', 'low', 'medium', 'high'];

/** The tags that follow from the catalog alone. `fast` and `writing` are judgement, never derived. */
export function derivedTags(m: CatalogModel): Capability[] {
  const tags: Capability[] = [];
  const p = perMillion(m.pricing.prompt) ?? Infinity;
  const c = perMillion(m.pricing.completion) ?? Infinity;
  if (p <= CHEAP_PROMPT && c <= CHEAP_COMPLETION) tags.push('cheap');
  if (m.supported_parameters?.includes('structured_outputs')) tags.push('structured');
  if (m.supported_parameters?.includes('reasoning')) tags.push('reasoning');
  if (m.context_length >= LONG_CONTEXT) tags.push('long_context');
  return tags;
}

/** A roster entry for any catalog model; `tags` overrides the derived ones. */
export function entryFromCatalog(m: CatalogModel, tags?: Capability[]): ModelEntry {
  const r = m.reasoning;
  const offered = r?.supported_efforts ?? (r?.mandatory ? ['low', 'medium', 'high'] : EFFORTS);
  return {
    id: m.id,
    label: m.name,
    tags: tags ?? derivedTags(m),
    price: { prompt: perMillion(m.pricing.prompt) ?? 0, completion: perMillion(m.pricing.completion) ?? 0, cacheRead: perMillion(m.pricing.input_cache_read) },
    contextLength: m.context_length,
    maxOutput: m.top_provider?.max_completion_tokens ?? undefined,
    params: m.supported_parameters ?? [],
    reasoning: m.supported_parameters?.includes('reasoning')
      ? { mandatory: !!r?.mandatory, efforts: EFFORTS.filter((e) => offered.includes(e)) }
      : undefined,
    quality: m.benchmarks?.artificial_analysis?.intelligence_index ?? undefined,
    enabled: true,
  };
}

const PARAMS = ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'];

/**
 * The default roster (live-tested 2026-10-18 with test/slow/llm-models.slow.test.ts; prices are list
 * prices per million tokens). Arnd: the big expensive models are never defaults, and the most
 * intelligent models are often not the best role-players. `~…-latest` ids are OpenRouter aliases
 * that follow each vendor's newest model, so updates arrive without a code change; re-run the slow
 * comparison when an alias moves. Quality scores are the aliased model's on the day (aliases have none).
 */
export const DEFAULT_ROSTER: Roster = {
  models: [
    {
      // GLM 5.3 on the day. Chat: natural, first text after ~0.4 s, ~$0.0006 a line. Weak at the appraisal (8/14).
      id: '~z-ai/glm-latest', label: 'GLM (latest)', tags: ['writing', 'fast', 'structured', 'reasoning', 'long_context'],
      price: { prompt: 0.079, completion: 2.5, cacheRead: 0.078 }, contextLength: 1_048_576, maxOutput: 943_718,
      params: [...PARAMS, 'temperature'], reasoning: { mandatory: true, efforts: ['low', 'high'] }, quality: 44.8, enabled: true,
    },
    {
      // Gemini 3.8 Flash on the day. Chat: good, first text after ~1.2 s. Reflection 2/2.
      id: '~google/gemini-flash-latest', label: 'Gemini Flash (latest)', tags: ['writing', 'structured', 'reasoning', 'long_context'],
      price: { prompt: 0.825, completion: 4.125, cacheRead: 0.0825 }, contextLength: 1_048_576, maxOutput: 65_536,
      params: [...PARAMS, 'temperature'], reasoning: { mandatory: true, efforts: ['low', 'medium', 'high'] }, quality: 40.9, enabled: true,
    },
    {
      // Chat: earthy, less sanitised. Appraisal 14/14 but ~6 s. Its only thinking level is high (90 s+), so no `reasoning` tag.
      id: 'mistralai/mistral-large-4-0', label: 'Mistral Large 4', tags: ['writing', 'fast', 'structured', 'long_context'],
      price: { prompt: 0.68, completion: 2.09, cacheRead: 0.07 }, contextLength: 1_048_576, maxOutput: 262_144,
      params: [...PARAMS, 'temperature'], reasoning: { mandatory: false, efforts: ['none', 'high'] }, quality: 38.4, enabled: true,
    },
    {
      // Claude Haiku 5.5 on the day. Appraisal 28/28 (the best), ~2 s, ~$0.0005; reflection 2/2; the best digest.
      id: '~anthropic/claude-haiku-latest', label: 'Claude Haiku (latest)', tags: ['fast', 'cheap', 'structured', 'reasoning', 'long_context'],
      price: { prompt: 0.1, completion: 0.5, cacheRead: 0.01 }, contextLength: 1_000_000, maxOutput: 128_000,
      params: PARAMS, reasoning: { mandatory: false, efforts: ['none', 'low', 'medium', 'high'] }, quality: 43.4, enabled: true,
    },
    {
      // GPT-6 Luna on the day. Appraisal 23/28 at a third of Haiku's cost; the best summaries (21/21, ~$0.00008).
      id: '~openai/gpt-luna-latest', label: 'GPT Luna (latest)', tags: ['fast', 'cheap', 'structured', 'reasoning', 'long_context'],
      price: { prompt: 0.1, completion: 0.5, cacheRead: 0.01 }, contextLength: 1_050_000, maxOutput: 128_000,
      params: PARAMS, reasoning: { mandatory: false, efforts: ['none', 'low', 'medium', 'high'] }, quality: 38.1, enabled: true,
    },
    {
      // GLM 5.3 Flash on the day. The cheapest decent writer: good digests, fair summaries, natural chat; weak appraisal (16/28).
      id: '~z-ai/glm-flash-latest', label: 'GLM Flash (latest)', tags: ['writing', 'fast', 'cheap', 'structured', 'reasoning', 'long_context'],
      price: { prompt: 0.048, completion: 0.2, cacheRead: 0.006 }, contextLength: 1_048_576, maxOutput: 943_718,
      params: [...PARAMS, 'temperature'], reasoning: { mandatory: true, efforts: ['low', 'high'] }, quality: 41.8, enabled: true,
    },
    {
      // DeepSeek V4.1 Flash (2026-10-17 update) on the day. Cheap and quick; a fair digest, but unreliable at the appraisal (13/28) and summaries.
      id: '~deepseek/deepseek-flash-latest', label: 'DeepSeek Flash (latest)', tags: ['fast', 'cheap', 'structured', 'long_context'],
      price: { prompt: 0.05, completion: 0.6, cacheRead: 0.008 }, contextLength: 1_048_576, maxOutput: 943_718,
      params: [...PARAMS, 'temperature'], reasoning: { mandatory: false, efforts: ['none', 'low', 'high'] }, quality: 39.5, enabled: true,
    },
  ],
};

/**
 * The default model order per task, from the same comparison: these go first (when enabled and
 * qualified), the router fills the rest. The player's own per-task pins replace them.
 */
export const DEFAULT_TASK_MODELS: Record<TaskName, string[]> = {
  'npc.speech': ['~z-ai/glm-latest', '~google/gemini-flash-latest', 'mistralai/mistral-large-4-0'],
  'npc.appraisal': ['~anthropic/claude-haiku-latest', '~openai/gpt-luna-latest', 'mistralai/mistral-large-4-0'],
  'memory.summary': ['~openai/gpt-luna-latest', '~anthropic/claude-haiku-latest', '~z-ai/glm-flash-latest'],
  'npc.reflection': ['~anthropic/claude-haiku-latest', '~google/gemini-flash-latest', '~z-ai/glm-latest'],
  'skip.digest': ['~anthropic/claude-haiku-latest', '~z-ai/glm-flash-latest', '~deepseek/deepseek-flash-latest'],
  'talk.judge': ['~anthropic/claude-haiku-latest', '~openai/gpt-luna-latest', '~z-ai/glm-flash-latest'],
};

/**
 * Refresh a roster against the live catalog: prices, limits, parameters and quality come from the
 * catalog, tags and `enabled` stay the player's. Models the catalog no longer lists are disabled
 * (kept, so the player sees what vanished).
 */
export function rosterFromCatalog(catalog: CatalogModel[], base: Roster = DEFAULT_ROSTER): Roster {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  return {
    models: base.models.map((e) => {
      const m = byId.get(e.id);
      if (!m) return { ...e, enabled: false };
      const fresh = entryFromCatalog(m, e.tags);
      return { ...fresh, label: e.label, quality: fresh.quality ?? e.quality, enabled: e.enabled };
    }),
  };
}

/** The effort to send: the lowest the model offers that is at least `want` (thinking cannot always be turned off). */
export function effortFor(m: ModelEntry, want: Effort): Effort | undefined {
  if (!m.reasoning) return undefined;
  const at = EFFORTS.indexOf(want);
  return m.reasoning.efforts.find((e) => EFFORTS.indexOf(e) >= at) ?? m.reasoning.efforts[m.reasoning.efforts.length - 1];
}
