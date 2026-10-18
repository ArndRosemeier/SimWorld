/**
 * The usage ledger: every LLM call with its tokens and cost, summed per task, model, NPC and session
 * (Arnd D5: no budget enforcement, but usage is tracked and displayed).
 *
 * Cost is what OpenRouter says it charged (`usage.cost` on the last stream chunk). When a response
 * carries no cost (a call cut off before its usage chunk), the ledger estimates it from the roster's
 * list price and marks the entry `estimated`.
 *
 * Totals are kept as running sums, so trimming old entries (the ledger keeps the newest
 * `maxEntries`) never changes the numbers the player sees.
 */
import type { TaskName } from './tasks';
import type { WireUsage } from './wire';
import type { ModelEntry } from './roster';

export interface UsageEntry {
  /** Wall-clock ms (Date.now-like, injected). */
  at: number;
  task: TaskName;
  /** The roster model asked for. */
  model: string;
  /** The model OpenRouter says answered, when it differs. */
  servedBy?: string;
  npc?: number;
  session: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** US dollars. */
  cost: number;
  estimated: boolean;
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export interface UsageTotals {
  calls: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  cost: number;
  /** True if any part of `cost` is a list-price estimate. */
  estimated: boolean;
}

export type UsageAxis = 'task' | 'model' | 'npc' | 'session';

const zero = (): UsageTotals => ({ calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cost: 0, estimated: false });

function add(t: UsageTotals, e: UsageEntry): void {
  t.calls++;
  if (!e.ok) t.failures++;
  t.promptTokens += e.promptTokens;
  t.completionTokens += e.completionTokens;
  t.cachedTokens += e.cachedTokens;
  t.reasoningTokens += e.reasoningTokens;
  t.cost += e.cost;
  t.estimated ||= e.estimated;
}

/** List-price cost of a usage, for when OpenRouter did not report one. Cached input is billed at the cache price. */
export function estimateCost(m: Pick<ModelEntry, 'price'> | undefined, u: Pick<UsageEntry, 'promptTokens' | 'completionTokens' | 'cachedTokens'>): number {
  if (!m) return 0;
  const cached = Math.min(u.cachedTokens, u.promptTokens);
  const cacheRate = m.price.cacheRead ?? m.price.prompt;
  return ((u.promptTokens - cached) * m.price.prompt + cached * cacheRate + u.completionTokens * m.price.completion) / 1e6;
}

/** Fold OpenRouter's usage object into ledger fields. */
export function fromWire(u: WireUsage | undefined): Pick<UsageEntry, 'promptTokens' | 'completionTokens' | 'cachedTokens' | 'reasoningTokens'> & { cost?: number } {
  return {
    promptTokens: u?.prompt_tokens ?? 0,
    completionTokens: u?.completion_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
    cost: typeof u?.cost === 'number' ? u.cost : undefined,
  };
}

export interface LedgerSnapshot {
  version: 1;
  entries: UsageEntry[];
  totals: Record<UsageAxis | 'all', Record<string, UsageTotals>>;
}

export class UsageLedger {
  private entries: UsageEntry[] = [];
  private sums: Record<UsageAxis | 'all', Map<string, UsageTotals>> = { all: new Map(), task: new Map(), model: new Map(), npc: new Map(), session: new Map() };
  private listeners = new Set<(e: UsageEntry) => void>();

  constructor(readonly maxEntries = 2000) {}

  record(e: UsageEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    const keys: [UsageAxis | 'all', string | undefined][] = [['all', 'all'], ['task', e.task], ['model', e.servedBy ?? e.model], ['npc', e.npc === undefined ? undefined : String(e.npc)], ['session', e.session]];
    for (const [axis, key] of keys) {
      if (key === undefined) continue;
      const m = this.sums[axis];
      let t = m.get(key);
      if (!t) m.set(key, (t = zero()));
      add(t, e);
    }
    for (const fn of this.listeners) fn(e);
  }

  total(): UsageTotals {
    return { ...(this.sums.all.get('all') ?? zero()) };
  }

  /** Totals per key along one axis, most expensive first. */
  by(axis: UsageAxis): [string, UsageTotals][] {
    return [...this.sums[axis]].map(([k, t]): [string, UsageTotals] => [k, { ...t }]).sort((a, b) => b[1].cost - a[1].cost || (a[0] < b[0] ? -1 : 1));
  }

  /** The newest entries, oldest first. */
  recent(n = 50): UsageEntry[] {
    return this.entries.slice(-n);
  }

  /** Called after every recorded call (for the usage display). Returns an unsubscribe function. */
  onRecord(fn: (e: UsageEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toJSON(): LedgerSnapshot {
    const totals = {} as LedgerSnapshot['totals'];
    for (const [axis, m] of Object.entries(this.sums) as [UsageAxis | 'all', Map<string, UsageTotals>][]) totals[axis] = Object.fromEntries(m);
    return { version: 1, entries: [...this.entries], totals };
  }

  static fromJSON(s: LedgerSnapshot, maxEntries?: number): UsageLedger {
    const l = new UsageLedger(maxEntries);
    l.entries = [...s.entries];
    for (const axis of Object.keys(l.sums) as (UsageAxis | 'all')[]) l.sums[axis] = new Map(Object.entries(s.totals[axis] ?? {}).map(([k, t]) => [k, { ...t }]));
    return l;
  }
}
