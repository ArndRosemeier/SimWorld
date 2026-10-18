/**
 * OpenRouter's chat-completions wire format: only the fields SimWorld sends or reads.
 * Reference: openrouter.ai/docs (API reference: streaming, usage accounting, structured outputs).
 *
 * Every call streams. One code path for speech (which must stream) and for structured tasks keeps
 * the client small, and the final SSE chunk carries the usage either way.
 */

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** A JSON Schema object, passed through to the provider untouched. */
export type JsonSchema = { [key: string]: unknown };

export interface WireRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: true; schema: JsonSchema } };
  /** Only route to providers that honour every parameter we send (a JSON schema, above all). */
  provider?: { require_parameters?: boolean };
  /** Thinking is wasted latency for speech and appraisal; reflection turns it on. */
  reasoning?: { effort?: 'none' | 'low' | 'medium' | 'high'; exclude?: boolean };
}

/** OpenRouter's usage object; `cost` is in credits (US dollars) and is what the player was charged. */
export interface WireUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface WireError {
  code?: number | string;
  message: string;
}

export interface WireChunk {
  id?: string;
  /** The model that actually answered (can differ from the one asked for when OpenRouter falls back). */
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: WireUsage;
  error?: WireError;
}

/**
 * Split an SSE byte stream into data payloads. Comment lines (`: OPENROUTER PROCESSING`) and blank
 * lines are skipped; `[DONE]` ends the stream. Lines can be cut anywhere between reads.
 */
export async function* sseData(body: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of body) {
    buf += typeof part === 'string' ? part : decoder.decode(part, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trimStart();
      if (data === '[DONE]') return;
      yield data;
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:') && tail.slice(5).trim() !== '[DONE]') yield tail.slice(5).trimStart();
}
