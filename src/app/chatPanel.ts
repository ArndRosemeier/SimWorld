/**
 * The chat panel (plan §5): docked on the right, about a third of the screen, a first-class part of play rather than
 * a pop-up. Tabs: the conversation (header with who they are to you and how they seem, the talk with streamed
 * replies and a typing indicator, what you learnt, and on request what each reply changed in their mind), past
 * conversations, and the LLM usage (cost and tokens per task, model and person). Text only.
 *
 * Pure DOM; the game (src/game/chat.ts) drives it.
 */
import type { ChatHeader } from '../chat/ops';
import type { UsageLedger, UsageTotals } from '../llm';
import { readPref, writePref } from '../persist/prefs';
import type { AppliedChange } from '../sim/mind/proposal';
import { button, checkbox, el } from './dom';

const CSS = `
:root { --chat-w: clamp(320px, 34vw, 560px); }
.chat-launch { padding: 4px 14px; border: 1px solid #4f4232aa; border-radius: 3px; background: #050607cc; color: #cfd6dc; font: 13px/1.3 'Alegreya Sans', system-ui, sans-serif; letter-spacing: 0.08em; cursor: pointer; }
.chat-launch:hover, .chat-launch:focus-visible { color: #ece3d0; border-color: #e9b85c; outline: none; }
.chat { position: fixed; top: 0; right: 0; bottom: 0; z-index: 24; width: var(--chat-w); display: none; flex-direction: column; background: #0d0f11ee; border-left: 1px solid #4f4232; box-shadow: -8px 0 32px #0008; color: #cfd6dc; font: 14px/1.45 'Alegreya Sans', system-ui, sans-serif; }
.chat.open { display: flex; }
@media (max-width: 700px) { :root { --chat-w: 100vw; } .chat { border-left: none; } }
.chat-tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid #4f423288; }
.chat-tabs button { padding: 5px 10px; border: 1px solid transparent; border-bottom: none; border-radius: 3px 3px 0 0; background: none; color: #7a6f5e; font: 13px/1.2 inherit; font-family: inherit; letter-spacing: 0.05em; cursor: pointer; }
.chat-tabs button.on { color: #ece3d0; border-color: #4f423288; background: #050607; }
.chat-tabs .grow { flex: 1; }
.chat-tabs .chat-x { color: #b9ad96; }
.chat-head { padding: 12px 16px 10px; border-bottom: 1px solid #4f423266; }
.chat-head h2 { margin: 0; font: 400 22px/1.15 'IM Fell English', Georgia, serif; letter-spacing: 0.04em; color: #ece3d0; }
.chat-head .sub { color: #b9ad96; font-size: 13px; }
.chat-head .looks { color: #7a6f5e; font-size: 13px; font-style: italic; }
.chat-body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.chat-line { max-width: 88%; padding: 7px 11px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-line.you { align-self: flex-end; background: #2a2418; color: #ece3d0; border: 1px solid #4f4232; }
.chat-line.npc { align-self: flex-start; background: #15191c; border: 1px solid #2c3236; }
.chat-line .who { display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7a6f5e; margin-bottom: 2px; }
.chat-line em { color: #b9ad96; }
.chat-note { align-self: center; max-width: 92%; color: #7a6f5e; font-size: 12.5px; text-align: center; }
.chat-note.warn { color: #d9a15c; }
.chat-note.told { color: #9fb58e; }
.chat-changes { align-self: flex-start; max-width: 92%; margin-top: -4px; padding: 4px 10px; border-left: 2px solid #4f4232; color: #8d8573; font-size: 12px; }
.chat:not(.changes) .chat-changes { display: none; }
.chat-changes .rejected { color: #a5675c; text-decoration: line-through; }
.chat-changes .softened { color: #b9a46a; }
.chat-dots span { display: inline-block; width: 6px; height: 6px; margin: 0 2px; border-radius: 50%; background: #7a6f5e; animation: chat-dot 1.2s infinite ease-in-out; }
.chat-dots span:nth-child(2) { animation-delay: 0.2s; } .chat-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes chat-dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.chat-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #4f423266; }
.chat-input textarea { flex: 1; min-height: 44px; max-height: 160px; resize: vertical; padding: 8px 10px; border: 1px solid #4f4232; border-radius: 4px; background: #050607; color: #ece3d0; font: 14px/1.4 inherit; font-family: inherit; }
.chat-input textarea:focus { outline: none; border-color: #e9b85c; }
.chat-input button, .chat-foot button, .chat-btn { padding: 5px 10px; border: 1px solid #4f4232; border-radius: 3px; background: none; color: #b9ad96; font: 13px/1.2 inherit; font-family: inherit; cursor: pointer; }
.chat-input button:hover, .chat-foot button:hover, .chat-btn:hover { color: #ece3d0; border-color: #e9b85c; }
.chat-input button:disabled { opacity: 0.4; cursor: default; }
.chat-foot { display: flex; align-items: center; gap: 8px; padding: 6px 12px 10px; color: #7a6f5e; font-size: 12px; }
.chat-foot .grow { flex: 1; }
.chat-foot label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.chat-foot input { accent-color: #e9b85c; }
.chat-empty { color: #7a6f5e; text-align: center; margin-top: 30%; padding: 0 12px; }
.chat-past h3 { margin: 4px 0 2px; font: 600 14px/1.3 inherit; font-family: inherit; color: #ece3d0; }
.chat-past .when { color: #7a6f5e; font-size: 12px; }
.chat-past details { border-bottom: 1px solid #4f423244; padding: 6px 0; }
.chat-past summary { cursor: pointer; }
.chat-past p { margin: 3px 0; font-size: 13px; }
.chat-usage table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
.chat-usage th { text-align: left; color: #7a6f5e; font-weight: 400; border-bottom: 1px solid #4f423266; padding: 3px 4px; }
.chat-usage td { padding: 3px 4px; border-bottom: 1px solid #4f423222; }
.chat-usage td.n { text-align: right; font-variant-numeric: tabular-nums; }
.chat-usage .big { font: 400 26px/1.2 'IM Fell English', Georgia, serif; color: #ece3d0; }
`;

export const money = (usd: number): string => (usd === 0 ? '$0' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`);

/** A finished conversation, for the Past tab. */
export interface PastChat {
  npc: number;
  name: string;
  when: string;
  lines: { you: boolean; text: string }[];
}

export type ChatTab = 'talk' | 'past' | 'usage';
type Tab = ChatTab;

export interface ChatPanelHooks {
  send(text: string): void;
  close(): void;
  settings(): void;
  /** Names for the usage table's per-person rows. */
  nameOf(npc: number): string;
}

export class ChatPanel {
  readonly root = el('aside', 'chat');
  readonly launcher = button('chat-launch', 'Chat', () => (this.isOpen ? this.hide() : this.open(this.talking ? 'talk' : 'past')));
  private readonly head = el('div', 'chat-head');
  private readonly body = el('div', 'chat-body');
  /** Past and Usage are drawn here, so the talk keeps its place. */
  private readonly other = el('div', 'chat-body');
  private readonly input = el('textarea', '');
  private readonly sendBtn = button('', 'Say', () => this.submit());
  private readonly status = el('span', 'grow');
  private readonly usageLine = el('span', '');
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly inputRow = el('div', 'chat-input');
  private tab: Tab = 'talk';
  private talking = false;
  private typing: HTMLElement | null = null;
  /** Show what each reply changed in the person's mind (the dev overlay of plan §5). */
  showChanges = readPref('chat.changes') === '1';
  past: PastChat[] = [];

  constructor(private readonly hooks: ChatPanelHooks, private readonly ledger: UsageLedger) {
    const style = el('style', '');
    style.textContent = CSS;
    document.head.append(style);
    this.root.setAttribute('aria-label', 'Conversation');
    const tabs = el('div', 'chat-tabs');
    for (const [t, label] of [['talk', 'Talk'], ['past', 'Past'], ['usage', 'Usage']] as [Tab, string][]) {
      const b = button('', label, () => this.showTab(t));
      this.tabs.set(t, b);
      tabs.append(b);
    }
    const close = button('chat-x', 'Close', () => (this.talking ? hooks.close() : this.hide()));
    close.title = 'End the conversation and close (Esc)';
    tabs.append(el('span', 'grow'), close);
    this.input.placeholder = 'Say something…';
    this.input.rows = 2;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); hooks.close(); }
      e.stopPropagation();
    });
    this.inputRow.append(this.input, this.sendBtn);
    const foot = el('div', 'chat-foot');
    const changes = el('label', '');
    const box = checkbox(this.showChanges, (on) => { this.showChanges = on; writePref('chat.changes', on ? '1' : '0'); this.root.classList.toggle('changes', on); });
    changes.title = 'Show what each reply changed in their mind';
    changes.append(box, document.createTextNode('Mind'));
    const settings = button('', 'Models & key', () => hooks.settings());
    foot.append(this.status, changes, this.usageLine, settings);
    this.root.append(tabs, this.head, this.body, this.other, this.inputRow, foot);
    this.launcher.title = 'Past conversations and LLM usage';
    // The launcher goes in the screen's top bar, beside Menu (src/app/shell.ts `addTool`).
    document.body.append(this.root);
    ledger.onRecord(() => this.refreshUsage());
    this.refreshUsage();
  }

  get isOpen(): boolean { return this.root.classList.contains('open'); }

  /** Start a conversation view. `mode` says who voices the person (shown small in the footer). */
  begin(h: ChatHeader, mode: string): void {
    this.talking = true;
    this.head.replaceChildren(
      el('h2', '', h.name),
      el('div', 'sub', `${h.age}${h.occupation ? `, ${h.occupation}` : ''} · ${h.knows}`),
      el('div', 'looks', `${h.she ? 'She' : 'He'} ${h.looks}.`),
    );
    this.body.replaceChildren();
    this.note(`You are ${h.playerName}. Type to talk; Enter sends, Esc ends the conversation.`);
    this.setMode(mode);
    this.open('talk');
    this.busy(false);
    this.input.focus();
  }

  setMode(mode: string): void { this.status.textContent = mode; }

  /** The conversation is over: the transcript stays readable, the input goes. */
  finish(): void {
    this.talking = false;
    this.stopTyping();
    this.busy(true);
  }

  open(tab: Tab): void {
    this.root.classList.add('open');
    this.root.classList.toggle('changes', this.showChanges);
    document.body.classList.add('chat-open');
    this.showTab(tab);
  }

  hide(): void {
    this.root.classList.remove('open');
    document.body.classList.remove('chat-open');
    this.input.blur();
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const [t, b] of this.tabs) b.classList.toggle('on', t === tab);
    const talk = tab === 'talk';
    this.head.style.display = talk && this.head.childElementCount ? '' : 'none';
    this.inputRow.style.display = talk && this.talking ? '' : 'none';
    this.body.style.display = talk ? '' : 'none';
    this.other.style.display = talk ? 'none' : '';
    if (talk) {
      if (!this.talking && !this.body.childElementCount) this.body.append(el('div', 'chat-empty', 'Walk up to someone on the street and press T to talk to them.'));
      this.scroll();
      return;
    }
    const view = el('div', '');
    if (tab === 'past') this.fillPast(view);
    else this.fillUsage(view);
    this.other.className = `chat-body ${view.className}`;
    this.other.replaceChildren(...view.childNodes);
  }

  private submit(): void {
    const text = this.input.value.trim();
    // While they answer, a line is still taken (the chat sends it next); only a finished talk refuses it.
    if (!text || !this.talking) return;
    this.input.value = '';
    this.hooks.send(text);
  }

  busy(b: boolean): void {
    this.sendBtn.disabled = b;
    this.input.disabled = b && !this.talking;
  }

  private scroll(): void { this.body.scrollTop = this.body.scrollHeight; }

  line(you: boolean, name: string, text: string): HTMLElement {
    this.stopTyping();
    const d = el('div', `chat-line ${you ? 'you' : 'npc'}`);
    d.append(el('span', 'who', name));
    const t = el('span', '');
    setSpoken(t, text);
    d.append(t);
    this.body.append(d);
    this.scroll();
    return t;
  }

  /** The person's reply as it streams in: `set` with the text so far, '' for "still thinking". */
  streamReply(name: string): { set(text: string): void } {
    this.startTyping();
    let t: HTMLElement | null = null;
    return {
      set: (text: string) => {
        if (!text) { if (t) { t.parentElement!.remove(); t = null; } this.startTyping(); return; }
        if (!t) t = this.line(false, name, '');
        setSpoken(t, text);
        this.scroll();
      },
    };
  }

  startTyping(): void {
    if (this.typing) return;
    this.typing = el('div', 'chat-line npc chat-dots');
    this.typing.append(el('span', ''), el('span', ''), el('span', ''));
    this.typing.setAttribute('aria-label', 'typing');
    this.body.append(this.typing);
    this.scroll();
  }

  stopTyping(): void {
    this.typing?.remove();
    this.typing = null;
  }

  note(text: string, kind: '' | 'warn' | 'told' = ''): void {
    const typing = this.typing;
    const n = el('div', `chat-note ${kind}`, text);
    if (typing) this.body.insertBefore(n, typing); else this.body.append(n);
    this.scroll();
  }

  /** What one reply changed in the person's mind (shown when "Mind" is ticked). */
  changes(applied: AppliedChange[], dropped: string[]): void {
    if (!applied.length && !dropped.length) return;
    const box = el('div', 'chat-changes');
    for (const a of applied) {
      const row = el('div', a.outcome);
      row.textContent = `${describe(a)}${a.note ? ` (${a.note})` : ''}`;
      box.append(row);
    }
    for (const d of dropped) box.append(el('div', 'rejected', `model output dropped: ${d}`));
    this.body.append(box);
    this.scroll();
  }

  private refreshUsage(): void {
    const t = this.ledger.total();
    this.usageLine.textContent = t.calls ? `${money(t.cost)}${t.estimated ? '~' : ''} · ${t.calls} calls` : '';
    this.usageLine.title = 'What the language models have cost so far (from OpenRouter)';
    this.launcher.textContent = t.calls ? `Chat · ${money(t.cost)}` : 'Chat';
    if (this.isOpen && this.tab === 'usage') this.showTab('usage');
  }

  private fillPast(view: HTMLElement): void {
    view.className = 'chat-past';
    if (!this.past.length) { view.append(el('div', 'chat-empty', 'No conversations yet.')); return; }
    for (const c of [...this.past].reverse()) {
      const d = el('details', '');
      const s = el('summary', '');
      s.append(el('h3', '', c.name), el('span', 'when', `${c.when} · ${c.lines.length} lines`));
      d.append(s);
      for (const l of c.lines) d.append(el('p', '', `${l.you ? 'You' : c.name.split(' ')[0]}: ${l.text}`));
      view.append(d);
    }
  }

  private fillUsage(view: HTMLElement): void {
    view.className = 'chat-usage';
    const t = this.ledger.total();
    view.append(el('div', 'big', money(t.cost)), el('p', '', `${t.calls} calls${t.failures ? `, ${t.failures} failed` : ''} · ${fmtTokens(t.promptTokens)} in, ${fmtTokens(t.completionTokens)} out${t.cachedTokens ? `, ${fmtTokens(t.cachedTokens)} cached` : ''}${t.estimated ? ' · partly estimated from list prices' : ''}`));
    const addTable = (title: string, rows: [string, UsageTotals][]) => {
      if (!rows.length) return;
      const tb = el('table', '');
      const hr = el('tr', '');
      for (const h of [title, 'calls', 'tokens', 'cost']) hr.append(el('th', '', h));
      tb.append(hr);
      for (const [k, v] of rows.slice(0, 12)) {
        const tr = el('tr', '');
        tr.append(el('td', '', k), el('td', 'n', String(v.calls)), el('td', 'n', fmtTokens(v.promptTokens + v.completionTokens)), el('td', 'n', money(v.cost)));
        tb.append(tr);
      }
      view.append(tb);
    };
    addTable('Task', this.ledger.by('task').map(([k, v]) => [TASK_WORDS[k] ?? k, v]));
    addTable('Model', this.ledger.by('model'));
    addTable('Person', this.ledger.by('npc').map(([k, v]) => [this.hooks.nameOf(Number(k)), v]));
    addTable('Session', this.ledger.by('session'));
    if (!t.calls) view.append(el('p', '', 'No language model calls yet. Add your OpenRouter key under "Models & key" to have people answer with an LLM; without one, the town answers on its own.'));
  }
}

const TASK_WORDS: Record<string, string> = {
  'npc.speech': 'Chat replies', 'npc.appraisal': 'Reading replies (mind changes)', 'memory.summary': 'Memories of talks',
  'npc.reflection': 'Reflections', 'skip.digest': 'Time-skip digests',
};

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** Spoken text with *actions* in italics (as text nodes: model output never becomes markup). */
function setSpoken(t: HTMLElement, text: string): void {
  t.replaceChildren();
  const parts = text.split(/(\*[^*\n]+\*)/g);
  for (const p of parts) {
    if (!p) continue;
    if (/^\*[^*]+\*$/.test(p)) t.append(el('em', '', p.slice(1, -1)));
    else t.append(document.createTextNode(p));
  }
}

function describe(a: AppliedChange): string {
  const c = a.change;
  const delta = (x: number | undefined, w: string) => (x ? `${w} ${x > 0 ? '+' : ''}${x.toFixed(2)}` : '');
  switch (c.kind) {
    case 'relation': return `feelings: ${[delta(c.trust, 'trust'), delta(c.affection, 'affection'), delta(c.respect, 'respect')].filter(Boolean).join(', ')}${c.reason ? `: ${c.reason}` : ''}`;
    case 'emotion': return `${c.emotion} +${c.delta.toFixed(2)}${c.reason ? `: ${c.reason}` : ''}`;
    case 'belief': return `believes "${c.claim.text}" (plausibility ${c.plausibility.toFixed(2)})`;
    case 'utterance': return `${c.form === 'lie' ? 'lied' : 'guessed'}: "${c.claim.text}"`;
    case 'intention': return `plans to ${c.intention}${c.reason ? `: "${c.reason}"` : ''}`;
    case 'memory': return `remembers: ${c.summary}`;
    case 'endConversation': return `wants to end the conversation${c.reason ? `: ${c.reason}` : ''}`;
  }
}
