/**
 * The player's language-model setup (D5, D11): their own OpenRouter key, their model roster, their per-task model
 * picks, and the usage ledger, kept in the browser (src/persist) and turned into the one `Llm` the game calls.
 * Without a key every chat is answered by the procedural engine; the game is fully playable either way.
 */
import {
  createLlm, DEFAULT_ROSTER, fetchCatalog, openRouterTransport, rosterFromCatalog, UsageLedger,
  type DecisionName, type LedgerSnapshot, type Llm, type Roster, type TaskName, type Transport,
} from '../llm';
import { readJsonPref, readPref, writePref } from '../persist/prefs';

const K_KEY = 'llm.key';
const K_ROSTER = 'llm.roster';
const K_PINS = 'llm.pins';
const K_USAGE = 'llm.usage';
/** Entries kept with the saved ledger (the totals keep counting beyond them). */
const SAVED_ENTRIES = 300;

export type Pins = Partial<Record<TaskName | DecisionName, string[]>>;

export class LlmSetup {
  key: string;
  roster: Roster;
  pins: Pins;
  readonly ledger: UsageLedger;
  readonly llm: Llm;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.key = readPref(K_KEY) ?? '';
    this.roster = readJsonPref<Roster>(K_ROSTER, DEFAULT_ROSTER);
    if (!Array.isArray(this.roster?.models)) this.roster = DEFAULT_ROSTER;
    this.pins = readJsonPref<Pins>(K_PINS, {});
    const saved = readJsonPref<LedgerSnapshot | null>(K_USAGE, null);
    let ledger: UsageLedger;
    try { ledger = saved?.version === 1 ? UsageLedger.fromJSON(saved, SAVED_ENTRIES) : new UsageLedger(SAVED_ENTRIES); } catch { ledger = new UsageLedger(SAVED_ENTRIES); }
    this.ledger = ledger;
    this.ledger.onRecord(() => { this.saveUsageSoon(); this.changed(); });
    // The transport reads the key on every call, so a new key works at once.
    const transport: Transport = { stream: (req, signal) => openRouterTransport({ apiKey: this.key }).stream(req, signal) };
    this.llm = createLlm({
      transport, ledger: this.ledger, session: `play ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      roster: () => this.roster, overrides: () => this.pins,
    });
  }

  get hasKey(): boolean { return this.key.trim().length > 0; }

  setKey(key: string): void {
    this.key = key.trim();
    writePref(K_KEY, this.key);
    this.changed();
  }

  setRoster(r: Roster): void {
    this.roster = r;
    writePref(K_ROSTER, JSON.stringify(r));
    this.changed();
  }

  setPins(p: Pins): void {
    this.pins = p;
    writePref(K_PINS, JSON.stringify(p));
    this.changed();
  }

  /** Back to the tested defaults (roster and picks; the key and usage stay). */
  resetModels(): void {
    this.setRoster(DEFAULT_ROSTER);
    this.setPins({});
  }

  /** Prices, limits and parameters from OpenRouter's public model list (no key needed). */
  async refreshFromCatalog(): Promise<void> {
    this.setRoster(rosterFromCatalog(await fetchCatalog(), this.roster));
  }

  /** Called whenever the key, the models or the usage change. Returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private saveUsageSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writePref(K_USAGE, JSON.stringify(this.ledger.toJSON()));
    }, 1500);
  }
}
