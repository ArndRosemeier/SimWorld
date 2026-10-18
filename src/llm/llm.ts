/**
 * `llm.run(task, input)`: the one way SimWorld calls a language model (CLAUDE.md rule 5).
 *
 * It routes the task to roster models (best first), streams the reply, reads it with the task's
 * parser, records every attempt in the usage ledger, and moves to the next model on a retryable
 * failure (rate limit, outage, timeout, a reply that breaks the task's contract). Failures that
 * another model cannot fix (no key, bad key, no credits, the caller cancelled) end the run at once,
 * and the caller falls back to the procedural text engine.
 */
import { LlmError, type Transport } from './openrouter';
import { effortFor, type ModelEntry, type Roster } from './roster';
import { route } from './router';
import { TASKS, type TaskIO, type TaskName } from './tasks';
import { estimateCost, fromWire, type UsageLedger } from './usage';
import type { WireRequest, WireUsage } from './wire';

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with the whole text so far after every streamed piece ('' when a fallback model restarts). */
  onText?: (textSoFar: string) => void;
}

export interface RunResult<O> {
  output: O;
  /** The roster model that answered. */
  model: string;
  /** Failed attempts before it, as `model: reason`. */
  failures: string[];
}

export type Timers = { set(fn: () => void, ms: number): () => void };

export interface LlmConfig {
  transport: Transport;
  roster: () => Roster;
  ledger: UsageLedger;
  /** Labels the ledger's per-session totals. */
  session: string;
  /** Per-task model pins from the settings. */
  overrides?: () => Partial<Record<TaskName, string[]>>;
  now?: () => number;
  timers?: Timers;
}

export interface Llm {
  run<K extends TaskName>(task: K, input: TaskIO[K]['input'], opts?: RunOptions): Promise<RunResult<TaskIO[K]['output']>>;
  /** The models `run` would try for a task, in order (for the settings screen). */
  plan(task: TaskName): ModelEntry[];
}

const realTimers: Timers = { set: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); } };

/** The request for one attempt: only parameters the model takes, so `require_parameters` never excludes it for an extra. */
export function requestFor(task: TaskName, m: ModelEntry, messages: WireRequest['messages']): WireRequest {
  const spec = TASKS[task];
  const req: WireRequest = { model: m.id, messages, stream: true, max_tokens: spec.maxTokens };
  if (spec.temperature !== undefined && m.params.includes('temperature')) req.temperature = spec.temperature;
  const effort = effortFor(m, spec.effort);
  if (effort) req.reasoning = { effort, exclude: true };
  if (spec.schema) {
    req.response_format = { type: 'json_schema', json_schema: { name: spec.schema.name, strict: true, schema: spec.schema.schema } };
    req.provider = { require_parameters: true };
  }
  return req;
}

export function createLlm(cfg: LlmConfig): Llm {
  const now = cfg.now ?? (() => Date.now());
  const timers = cfg.timers ?? realTimers;

  const plan = (task: TaskName) => route(cfg.roster(), TASKS[task].routing, cfg.overrides?.()[task] ?? []);

  async function attempt<K extends TaskName>(task: K, m: ModelEntry, input: TaskIO[K]['input'], opts: RunOptions): Promise<TaskIO[K]['output']> {
    const spec = TASKS[task];
    const { messages, refs, npc } = spec.build(input);
    const req = requestFor(task, m, messages);
    const ctl = new AbortController();
    let timedOut = false;
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const cancelTimer = timers.set(() => { timedOut = true; ctl.abort(); }, spec.timeoutMs);
    const t0 = now();
    let text = '';
    let usage: WireUsage | undefined;
    let servedBy: string | undefined;
    let error: LlmError | undefined;
    let output: TaskIO[K]['output'] | undefined;
    try {
      if (opts.signal?.aborted) throw new LlmError('aborted', 'cancelled');
      for await (const chunk of cfg.transport.stream(req, ctl.signal)) {
        if (ctl.signal.aborted) break;
        if (chunk.model && chunk.model !== m.id) servedBy = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.error) throw new LlmError(chunk.error.code === 429 ? 'rate' : 'unavailable', chunk.error.message);
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) {
          text += piece;
          opts.onText?.(text);
        }
      }
      if (ctl.signal.aborted) throw timedOut ? new LlmError('timeout', `no full reply within ${spec.timeoutMs} ms`) : new LlmError('aborted', 'cancelled');
      if (!text.trim()) throw new LlmError('empty', 'the model returned no text');
      try {
        output = spec.parse(text, input, refs);
      } catch (e) {
        throw new LlmError('invalid_output', e instanceof Error ? e.message : String(e));
      }
      return output;
    } catch (e) {
      // Our own timer aborts the stream too; whatever the transport made of that, it is a timeout.
      if (timedOut) error = new LlmError('timeout', `no full reply within ${spec.timeoutMs} ms`);
      else error = e instanceof LlmError ? e : new LlmError(opts.signal?.aborted ? 'aborted' : 'network', e instanceof Error ? e.message : String(e));
      throw error;
    } finally {
      cancelTimer();
      opts.signal?.removeEventListener('abort', onAbort);
      const u = fromWire(usage);
      cfg.ledger.record({
        at: t0,
        task,
        model: m.id,
        ...(servedBy ? { servedBy } : {}),
        ...(npc !== undefined ? { npc } : {}),
        session: cfg.session,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        cachedTokens: u.cachedTokens,
        reasoningTokens: u.reasoningTokens,
        cost: u.cost ?? estimateCost(m, u),
        estimated: u.cost === undefined && (u.promptTokens > 0 || u.completionTokens > 0),
        ok: !error,
        ...(error ? { error: `${error.kind}: ${error.message}` } : {}),
        latencyMs: now() - t0,
      });
    }
  }

  return {
    plan,
    async run(task, input, opts = {}) {
      const models = plan(task);
      if (!models.length) throw new LlmError('no_model', `no enabled roster model has what ${task} needs (${TASKS[task].routing.needs.join(', ')})`);
      const failures: string[] = [];
      let last: LlmError | undefined;
      for (const m of models) {
        try {
          const output = await attempt(task, m, input, opts);
          return { output, model: m.id, failures };
        } catch (e) {
          last = e as LlmError;
          failures.push(`${m.id}: ${last.kind}: ${last.message}`);
          if (!last.retryable) break;
          opts.onText?.('');
        }
      }
      throw Object.assign(last ?? new LlmError('no_model', 'no model tried'), { failures });
    },
  };
}
