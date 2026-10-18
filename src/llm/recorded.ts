/**
 * Recorded LLM responses, so tests never touch the network (plan R6, docs/CI.md "No real waiting").
 *
 * A recording is the exact chunk stream OpenRouter sent for one request. `replayTransport` plays
 * recordings back in order, one per call, whatever the request: prompts keep improving, and a test
 * that pinned the prompt byte-for-byte would break on every wording change. Instead each recording
 * keeps the hash of the request it was made from, and the transport lists the calls whose request
 * has drifted since (`drift`), so `npm run llm:record` can be run when the answers may have changed.
 *
 * `recordingTransport` wraps the real transport and hands every exchange to a sink (the record
 * script writes them to test/fixtures/llm/).
 */
import { hashString } from '@futuremagic/core';
import type { DecisionRequest, DecisionResponse } from './decide';
import { LlmError, errorFromStatus, type Transport } from './openrouter';
import type { WireChunk, WireRequest, WireUsage } from './wire';

export interface Recording {
  /** What the exchange shows, e.g. "speech: baker greets a regular". */
  name: string;
  model: string;
  /** `requestHash` of the request it answered. */
  requestHash: string;
  /** The streamed chunks, or the HTTP error the call got before streaming. */
  chunks?: WireChunk[];
  httpError?: { status: number; message: string };
  /** A decision model's answer (src/llm/decide.ts), for `decide` calls. */
  decision?: DecisionResponse;
  /** Hand-written in the shape OpenRouter sends, not captured from a real call. */
  synthetic?: boolean;
}

/** A stable hash of the parts of a request that shape the answer. */
export function requestHash(req: WireRequest | DecisionRequest): string {
  let key: unknown = req;
  if ('messages' in req) { const { model, messages, response_format, max_tokens, temperature, reasoning } = req; key = { model, messages, response_format, max_tokens, temperature, reasoning }; }
  return (hashString(JSON.stringify(key)) >>> 0).toString(16).padStart(8, '0');
}

/** Chunks as OpenRouter streams them: the text in pieces, then a usage chunk. */
export function chunksFor(text: string, opts: { model: string; usage?: WireUsage; pieces?: number; id?: string }): WireChunk[] {
  const n = Math.max(1, Math.min(opts.pieces ?? 4, text.length));
  const size = Math.ceil(text.length / n);
  const out: WireChunk[] = [];
  for (let i = 0; i < text.length; i += size) out.push({ id: opts.id ?? 'gen-recorded', model: opts.model, choices: [{ delta: { content: text.slice(i, i + size) }, finish_reason: null }] });
  out.push({ id: opts.id ?? 'gen-recorded', model: opts.model, choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: opts.usage ?? { prompt_tokens: 0, completion_tokens: 0 } });
  return out;
}

export interface ReplayTransport extends Transport {
  /** The requests made so far, in order (chat and decision calls). */
  readonly requests: (WireRequest | DecisionRequest)[];
  /** Recordings whose request hash no longer matches the request that replayed them. */
  readonly drift: string[];
  /** Recordings not yet used. */
  remaining(): number;
}

/** Plays recordings back in order. Running out is an error: a test made a call nobody recorded. */
export function replayTransport(recordings: Recording[]): ReplayTransport {
  const queue = [...recordings];
  const requests: (WireRequest | DecisionRequest)[] = [];
  const drift: string[] = [];
  return {
    requests,
    drift,
    remaining: () => queue.length,
    async *stream(req, signal) {
      requests.push(req);
      const rec = queue.shift();
      if (!rec) throw new Error(`replayTransport: no recording left for a ${req.model} call`);
      if (rec.requestHash !== requestHash(req)) drift.push(rec.name);
      if (rec.httpError) throw errorFromStatus(rec.httpError.status, rec.httpError.message);
      for (const c of rec.chunks ?? []) {
        if (signal?.aborted) throw new LlmError('aborted', 'cancelled');
        yield c;
      }
    },
    async decide(req) {
      requests.push(req);
      const rec = queue.shift();
      if (!rec) throw new Error(`replayTransport: no recording left for a ${req.model} decision`);
      if (rec.httpError) throw errorFromStatus(rec.httpError.status, rec.httpError.message);
      if (rec.requestHash !== requestHash(req)) drift.push(rec.name);
      if (!rec.decision) throw new Error(`replayTransport: recording ${rec.name} is not a decision`);
      return rec.decision;
    },
  };
}

/** Wraps a transport and reports each finished exchange (chunks or HTTP error) to `sink`. */
export function recordingTransport(inner: Transport, sink: (req: WireRequest | DecisionRequest, rec: Omit<Recording, 'name'>) => void): Transport {
  return {
    async *stream(req, signal) {
      const chunks: WireChunk[] = [];
      try {
        for await (const c of inner.stream(req, signal)) {
          chunks.push(c);
          yield c;
        }
        sink(req, { model: req.model, requestHash: requestHash(req), chunks });
      } catch (e) {
        if (e instanceof LlmError && e.status !== undefined) sink(req, { model: req.model, requestHash: requestHash(req), httpError: { status: e.status, message: e.message } });
        throw e;
      }
    },
    ...(inner.decide ? {
      async decide(req: DecisionRequest, signal?: AbortSignal) {
        const decision = await inner.decide!(req, signal);
        sink(req, { model: req.model, requestHash: requestHash(req), decision });
        return decision;
      },
    } : {}),
  };
}
