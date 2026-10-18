/**
 * The model roster: the models the player has, and what each is good at (plan R6, Arnd D11).
 *
 * Capability tags are hints the router matches against each task's needs. Some come straight from
 * OpenRouter's /models list (structured output, long context, price), the rest (fast, writing) are
 * judgement and editable by the player. The default picks below were chosen from OpenRouter's list on
 * 2026-10-18; `rosterFromCatalog` refreshes their prices and limits from the live list.
 */
import type { CatalogModel } from './openrouter';

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

/**
 * The default picks (OpenRouter list of 2026-10-18; prices are list prices per million tokens).
 * Chosen for: one strong writer for speech and reflection, two cheap fast structured models for the
 * appraisal (from different vendors, so one outage does not stop consequences), cheap long-context
 * models for digests and summaries.
 */
export const DEFAULT_ROSTER: Roster = {
  models: [
    {
      id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', tags: ['writing', 'reasoning', 'structured', 'long_context'],
      price: { prompt: 2, completion: 10, cacheRead: 0.1 }, contextLength: 1_000_000, maxOutput: 128_000,
      params: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'], reasoning: { mandatory: true, efforts: ['low', 'medium', 'high'] }, quality: 56, enabled: true,
    },
    {
      id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', tags: ['fast', 'cheap', 'structured', 'writing', 'long_context'],
      price: { prompt: 0.1, completion: 0.5, cacheRead: 0.01 }, contextLength: 1_000_000, maxOutput: 128_000,
      params: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'], reasoning: { mandatory: false, efforts: ['none', 'low', 'medium', 'high'] }, quality: 43.4, enabled: true,
    },
    {
      id: 'openai/gpt-6-luna', label: 'GPT-6 Luna', tags: ['fast', 'cheap', 'structured', 'long_context'],
      price: { prompt: 0.1, completion: 0.5, cacheRead: 0.01 }, contextLength: 1_050_000, maxOutput: 128_000,
      params: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'], reasoning: { mandatory: false, efforts: ['none', 'low', 'medium', 'high'] }, quality: 38.1, enabled: true,
    },
    {
      id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash', tags: ['fast', 'cheap', 'structured', 'long_context'],
      price: { prompt: 0.15, completion: 0.6, cacheRead: 0.003 }, contextLength: 1_048_576, maxOutput: 393_216,
      params: ['max_tokens', 'temperature', 'reasoning', 'response_format', 'structured_outputs'], reasoning: { mandatory: false, efforts: ['none', 'low', 'high'] }, quality: 39.5, enabled: true,
    },
    {
      id: 'google/gemini-4-argon', label: 'Gemini 4 Argon', tags: ['writing', 'reasoning', 'structured', 'long_context'],
      price: { prompt: 2, completion: 10, cacheRead: 0.1 }, contextLength: 1_048_576, maxOutput: 65_536,
      params: ['max_tokens', 'temperature', 'reasoning', 'response_format', 'structured_outputs'], reasoning: { mandatory: true, efforts: ['low', 'medium', 'high'] }, quality: 52.6, enabled: true,
    },
  ],
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
      return { ...fresh, label: e.label, enabled: e.enabled };
    }),
  };
}

/** The effort to send: the lowest the model offers that is at least `want` (thinking cannot always be turned off). */
export function effortFor(m: ModelEntry, want: Effort): Effort | undefined {
  if (!m.reasoning) return undefined;
  const at = EFFORTS.indexOf(want);
  return m.reasoning.efforts.find((e) => EFFORTS.indexOf(e) >= at) ?? m.reasoning.efforts[m.reasoning.efforts.length - 1];
}
