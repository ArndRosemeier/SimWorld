/**
 * Talking to an inhabitant (plan §3.2, §5): walk up to someone on the street and press T (or T while following
 * them). They stop and turn to you; the chat panel opens. Each line you type runs one turn:
 *
 *  1. the sim worker builds what the person knows for this moment (src/chat/context.ts: only their own beliefs);
 *  2. their reply streams in from `npc.speech` (or, without a key or when every model fails, the procedural engine
 *     answers from the same input, src/talk/answer.ts);
 *  3. news they passed on reaches your inhabitant's beliefs (`said`);
 *  4. `npc.appraisal` reads the exchange and its proposal goes through `applyProposal` in the sim (`apply`): feelings,
 *     beliefs, lies that start rumours, plans they committed to, memories, ending the talk.
 *
 * When the talk ends, `memory.summary` gives the person their memory of it and both remember it (`end`); they go back
 * to their day. The world keeps running while you talk.
 */
import type { ChatHeader, ChatRequest } from '../chat/ops';
import { LlmError, type AppraisalResult, type NpcPromptInput, type Turn } from '../llm';
import { ChatPanel, type PastChat } from '../app/chatPanel';
import { openLlmSettings } from '../app/llmSettings';
import type { CameraControl } from './camera';
import type { LlmSetup } from './llmSetup';
import type { SimClient } from './SimClient';
import type { Street } from './street';
import { formatDate } from '../sim/calendar';
import { hhmm, minuteOfDay } from '../sim/time';

/** How close you must be to talk to someone (m). */
export const TALK_RANGE = 6;
/** Turns of the conversation sent with each request (older ones are summarised by memory, not resent). */
const TURNS_KEPT = 24;
/** Failures that no other model fixes: no point trying again this conversation. */
const FATAL = new Set(['no_key', 'auth', 'credits', 'no_model']);

interface Conversation {
  id: string;
  header: ChatHeader;
  turns: Turn[];
  /** Game clock when it began. */
  began: number;
  told: string[];
  last: NpcPromptInput | null;
  /** The appraisal of the previous reply, applied before the next turn is built (and before the talk ends). */
  pending: Promise<void>;
  /** Cancels a reply still streaming when the talk ends. */
  abort: AbortController;
  /** The language model gave up for good in this conversation (bad key, no credits): the procedural engine answers. */
  procedural: boolean;
  busy: boolean;
  over: boolean;
}

export class Chat {
  readonly panel: ChatPanel;
  private talk: Conversation | null = null;
  private readonly names = new Map<number, string>();

  constructor(private readonly sim: SimClient, private readonly street: Street, private readonly cam: CameraControl, private readonly setup: LlmSetup) {
    this.panel = new ChatPanel({
      send: (t) => void this.send(t),
      close: () => void this.close(),
      settings: () => openLlmSettings(setup),
      nameOf: (id) => this.names.get(id) ?? `#${id}`,
    }, setup.ledger);
    setup.onChange(() => { if (this.talk) this.panel.setMode(this.mode()); });
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.code === 'KeyT' && !this.talk) { const id = this.target(); if (id >= 0) void this.open(id); }
    });
  }

  /** Your inhabitant, as the picker set it in the sim (-1 before anyone is picked: the sim then lends you a stand-in). */
  private get me(): number { return this.sim.player?.id ?? -1; }

  /** Where you stand: your inhabitant's figure while you play them, else the camera on the street. */
  private here(): { x: number; z: number } {
    const f = this.cam.mode === 'play' && this.me >= 0 ? this.street.where(this.me) : undefined;
    return f ?? this.cam.position();
  }

  get talking(): boolean { return this.talk !== null; }

  /** Who T would talk to now: the person followed, or the nearest one in reach on the street; -1 if nobody. */
  target(): number {
    if (this.cam.mode === 'drone') return -1;
    if (this.cam.mode === 'follow' && this.cam.following >= 0) return this.cam.following;
    const p = this.here();
    return this.street.peopleNear(p.x, p.z, TALK_RANGE).find((n) => n.id !== this.me)?.id ?? -1;
  }

  /** A HUD line: who you could talk to, or who you are talking to. */
  hint(): string {
    if (this.talk) return `Talking with ${this.talk.header.name} · Esc to end`;
    const now = performance.now();
    if (now - this.hintAt > 250) {
      this.hintAt = now;
      const id = this.target();
      const w = id >= 0 ? this.sim.walkers.get(id) : undefined;
      this.hintText = w ? `T: talk to ${w.info.name}` : '';
    }
    return this.hintText;
  }

  private hintAt = 0;
  private hintText = '';

  private mode(): string {
    if (!this.setup.hasKey) return 'No key: the town answers on its own';
    if (this.talk?.procedural) return 'LLM unavailable: the town answers on its own';
    const m = this.setup.llm.plan('npc.speech')[0];
    return m ? `Voiced by ${m.label}` : 'No chat model enabled';
  }

  async open(npc: number): Promise<void> {
    if (this.talk) await this.close();
    const { header } = await this.sim.chat({ op: 'start', npc, player: this.me });
    if (!header) return;
    this.names.set(npc, header.name);
    const clock = this.sim.clock;
    this.talk = {
      id: `chat-${npc}-${header.player}-${Math.floor(clock)}`, header, turns: [], began: clock, told: [], last: null,
      pending: Promise.resolve(), abort: new AbortController(), procedural: !this.setup.hasKey, busy: false, over: false,
    };
    // Face to face: they stop and turn to you. On the street the camera steps up to them; while you play someone the
    // camera stays with your inhabitant, and the person turns to them.
    const me = this.here();
    const f = this.street.where(npc);
    if (f) {
      const dx = f.x - me.x, dz = f.z - me.z, d = Math.hypot(dx, dz) || 1;
      const stand = Math.min(d, 1.6);
      const sx = f.x - (dx / d) * stand, sz = f.z - (dz / d) * stand;
      if (this.cam.mode !== 'play') { this.cam.toStreet(sx, sz, Math.atan2(-dx, -dz)); this.cam.pitch = -0.08; }
      this.street.pin(npc, sx, sz);
    }
    this.panel.begin(header, this.mode());
  }

  private async send(text: string): Promise<void> {
    const c = this.talk;
    if (!c || c.busy || c.over) return;
    c.busy = true;
    this.panel.busy(true);
    c.turns.push({ speaker: 'partner', text });
    this.panel.line(true, 'You', text);
    try {
      await c.pending;
      const turns = c.turns.slice(-TURNS_KEPT);
      const base = { npc: c.header.npc, player: c.header.player, conversation: c.id, turns };
      let reply = '', input: NpcPromptInput, offered: number[], voiced: number[] = [];
      const out = this.panel.streamReply(c.header.name);
      if (!c.procedural) {
        const t = await this.sim.chat({ op: 'turn', ...base });
        input = t.input; offered = t.offered;
        try {
          const r = await this.setup.llm.run('npc.speech', input, { signal: c.abort.signal, onText: (s) => out.set(s) });
          reply = r.output;
          out.set(reply);
        } catch (e) {
          if (c.abort.signal.aborted) return;
          out.set('');
          const err = e as LlmError;
          if (FATAL.has(err.kind)) c.procedural = true;
          this.panel.note(`No answer from the language model (${why(err)}). ${c.procedural ? 'The town answers on its own for now.' : 'The town answers on its own this time.'}`, 'warn');
          this.panel.setMode(this.mode());
        }
      }
      if (!reply) {
        const p = await this.sim.chat({ op: 'procedural', ...base });
        reply = p.reply; input = p.input; offered = p.offered; voiced = p.voiced;
        out.set(reply);
      }
      this.panel.stopTyping();
      if (this.talk !== c) return;
      c.turns.push({ speaker: 'npc', text: reply });
      c.last = { ...input!, turns: [...turns, { speaker: 'npc', text: reply }] };
      const said = await this.sim.chat({ op: 'said', npc: c.header.npc, player: c.header.player, reply, offered: offered!, voiced });
      for (const t of said.told) if (!c.told.includes(t)) { c.told.push(t); this.panel.note(`You heard: ${t}`, 'told'); }
      // What the reply changed in their mind: read by the appraisal model, applied by the sim before the next turn.
      if (!c.procedural) c.pending = this.appraise(c, input!, reply);
    } catch (e) {
      console.error('chat', e);
      this.panel.note('Something went wrong with that line.', 'warn');
    } finally {
      c.busy = false;
      if (!c.over) this.panel.busy(false);
    }
  }

  private async appraise(c: Conversation, input: NpcPromptInput, reply: string): Promise<void> {
    let result: AppraisalResult;
    try {
      // Not cancelled when the talk ends: what you said last still counts (`close` waits for it).
      result = (await this.setup.llm.run('npc.appraisal', { context: input, reply })).output;
    } catch (e) {
      if (this.talk === c) this.panel.changes([], [`appraisal failed: ${why(e as LlmError)}`]);
      return;
    }
    const req: Extract<ChatRequest, { op: 'apply' }> = { op: 'apply', npc: c.header.npc, proposal: result.proposal };
    const { applied, end } = await this.sim.chat(req);
    if (this.talk !== c) return;
    this.panel.changes(applied, result.dropped);
    if (end && !c.over) {
      c.over = true;
      this.panel.note(`${c.header.name.split(' ')[0]} ends the conversation.`);
      this.panel.finish();
      setTimeout(() => { if (this.talk === c) void this.close(); }, 4000);
    }
  }

  /** End the conversation: they remember it and go back to their day. */
  async close(): Promise<void> {
    const c = this.talk;
    if (!c) return;
    this.talk = null;
    c.over = true;
    c.abort.abort();
    this.street.unpin(c.header.npc);
    this.panel.finish();
    this.panel.hide();
    if (c.turns.length) this.keepTranscript(c);
    const minutes = Math.max(1, Math.round(this.sim.clock - c.began));
    let npcMemory: { summary: string; importance: number } | undefined;
    if (!c.procedural && c.last && c.turns.length >= 2) {
      try {
        const s = (await this.setup.llm.run('memory.summary', c.last)).output;
        npcMemory = { summary: s.summary, importance: s.importance / 10 };
      } catch { /* they remember it the procedural way below */ }
    }
    if (!npcMemory && c.turns.length >= 2) {
      const you = c.header.playerName.split(' ')[0];
      npcMemory = { summary: `had a chat with ${you}${c.told.length ? ' and passed on some news' : ''}`, importance: 0.2 };
    }
    await c.pending.catch(() => undefined);
    await this.sim.chat({ op: 'end', npc: c.header.npc, player: c.header.player, conversation: c.id, minutes, told: c.told, ...(npcMemory ? { npcMemory } : {}) });
  }

  private keepTranscript(c: Conversation): void {
    const past: PastChat = {
      npc: c.header.npc, name: c.header.name, when: `${formatDate(this.sim.view.date)} ${hhmm(Math.floor(minuteOfDay(c.began)))}`,
      lines: c.turns.map((t) => ({ you: t.speaker === 'partner', text: t.text })),
    };
    this.panel.past = [...this.panel.past.slice(-39), past];
  }
}

function why(e: LlmError): string {
  switch (e.kind) {
    case 'no_key': return 'no key set';
    case 'auth': return 'the key was not accepted';
    case 'credits': return 'the OpenRouter account is out of credits';
    case 'rate': return 'too many requests just now';
    case 'timeout': return 'it took too long';
    case 'no_model': return 'no enabled model can chat';
    case 'network': return 'no connection';
    default: return e.message ? e.message.slice(0, 120) : String(e);
  }
}
