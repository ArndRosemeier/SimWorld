/**
 * The OpenRouter connection: the one place in SimWorld that talks to openrouter.ai (guarded).
 *
 * A `Transport` turns a wire request into a stream of chunks. The real one is `openRouterTransport`;
 * tests use the recorded one from `recorded.ts`, so the fast suite never touches the network.
 */
import { sseData, type WireChunk, type WireRequest } from './wire';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
/** Where a player makes a key (the settings screen links it). */
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
/** A model's page on OpenRouter (prices, providers). */
export const openRouterModelUrl = (id: string): string => `https://openrouter.ai/${id.replace(/^~/, '')}`;

export interface Transport {
  stream(req: WireRequest, signal?: AbortSignal): AsyncIterable<WireChunk>;
}

/**
 * Why a call failed. `retryable` means another model (or the same one later) may work; the router
 * moves down the task's fallback list on these and stops on the rest.
 */
export type LlmErrorKind =
  | 'no_key'         // the player has not entered a key
  | 'auth'           // 401/403: the key is wrong or revoked
  | 'credits'        // 402: the account is out of credits
  | 'rate'           // 429
  | 'unavailable'    // 5xx, provider down, model gone
  | 'bad_request'    // 400: usually a parameter this model does not take
  | 'network'        // fetch threw
  | 'timeout'
  | 'aborted'        // the caller cancelled (conversation closed)
  | 'empty'          // 200 with no content
  | 'invalid_output' // the reply did not fit the task's contract
  | 'no_model';      // nothing in the roster can do this task

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
  get retryable(): boolean {
    return this.kind === 'rate' || this.kind === 'unavailable' || this.kind === 'bad_request' || this.kind === 'network'
      || this.kind === 'timeout' || this.kind === 'empty' || this.kind === 'invalid_output';
  }
}

export function errorFromStatus(status: number, message: string): LlmError {
  if (status === 401 || status === 403) return new LlmError('auth', message, status);
  if (status === 402) return new LlmError('credits', message, status);
  if (status === 429) return new LlmError('rate', message, status);
  if (status === 400 || status === 404 || status === 422) return new LlmError('bad_request', message, status);
  return new LlmError('unavailable', message, status);
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
}>;

export interface OpenRouterOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** App attribution shown on openrouter.ai (HTTP-Referer / X-Title). */
  appUrl?: string;
  appTitle?: string;
}

async function* chunksOf(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  if (Symbol.asyncIterator in body) {
    yield* body as AsyncIterable<Uint8Array>;
    return;
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function asAbort(e: unknown, signal?: AbortSignal): LlmError {
  if (signal?.aborted) return new LlmError('aborted', 'cancelled');
  return new LlmError('network', e instanceof Error ? e.message : String(e));
}

export function openRouterTransport(opts: OpenRouterOptions): Transport {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const base = opts.baseUrl ?? OPENROUTER_BASE;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
    'HTTP-Referer': opts.appUrl ?? 'https://github.com/ArndRosemeier/SimWorld',
    'X-Title': opts.appTitle ?? 'SimWorld',
  };
  return {
    async *stream(req, signal) {
      if (!opts.apiKey) throw new LlmError('no_key', 'no OpenRouter key set');
      let res;
      try {
        res = await doFetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(req), signal });
      } catch (e) {
        throw asAbort(e, signal);
      }
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* body was not JSON */ }
        throw errorFromStatus(res.status, msg);
      }
      try {
        for await (const data of sseData(chunksOf(res.body))) {
          let chunk: WireChunk;
          try { chunk = JSON.parse(data) as WireChunk; } catch { continue; }
          yield chunk;
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
        throw asAbort(e, signal);
      }
    },
  };
}

/** One entry of OpenRouter's public model list (GET /models, no key needed): the fields the roster reads. */
export interface CatalogModel {
  id: string;
  name: string;
  created?: number;
  context_length: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  /** US dollars per token, as decimal strings. */
  pricing: { prompt: string; completion: string; input_cache_read?: string };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
  benchmarks?: { artificial_analysis?: { intelligence_index?: number | null } };
  reasoning?: { mandatory?: boolean; default_enabled?: boolean; supported_efforts?: string[] };
}

export async function fetchCatalog(fetchFn?: FetchLike, baseUrl = OPENROUTER_BASE): Promise<CatalogModel[]> {
  const f = fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const res = await f(`${baseUrl}/models`, { method: 'GET', headers: {} });
  if (!res.ok) throw errorFromStatus(res.status, `GET /models: HTTP ${res.status}`);
  return ((await res.json()) as { data: CatalogModel[] }).data;
}
