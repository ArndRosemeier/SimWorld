/**
 * Background chatter (plan §4): what you overhear when two people meet. Grounded in the sim: the news line of an
 * exchange *is* the belief passing at that encounter (`Encounter.told` / `toldBack`), told in the teller's voice and
 * answered in the listener's (sympathy, glee, doubt, "that's my sister you're talking about", or "that's not what I
 * heard" when they hold another version of the story). When nothing passes, people make small talk about what is
 * real around them: the weather now, what is on in town, the holiday, local lore, being tired or hungry, work, the
 * family, the place they are in.
 *
 * `overhear(world, encounter, memory)` voices one encounter of the last tick; `overheard` all of them. Pure and
 * deterministic (the stream is the sim's `tickRng(world, 'chatter', a, b)`), cheap enough for every encounter.
 * The street view shows the lines as speech bubbles and the chat panel's "Nearby" channel lists them; a line that
 * carries a fact (`fact >= 0`) is something the player learned by listening.
 *
 * Ideas from Scale's street lines and barks (src/game/street/lines.ts, src/ui/Barks.ts: pools per topic, bubbles);
 * no code ported, the conversation layer is new.
 */
import type { Rng } from '@futuremagic/core';
import { ACTIVITIES, ACTOR_PERSON, type ActorId } from '../sim/actors';
import { agendaOn, type Occasion } from '../sim/agenda';
import { holidayOn, weekdayName, dateOf } from '../sim/calendar';
import type { Encounter } from '../sim/encounters';
import { avoids } from '../sim/intentions';
import { beliefAbout, isAbout, knowsStanding, SOURCE_WITNESSED, type Fact } from '../sim/knowledge';
import type { PlaceId } from '../sim/places';
import { NEED_COUNT, N_FOOD, N_REST, SPECIES } from '../sim/species';
import { dayOf, minuteOfDay } from '../sim/time';
import { isCold, isFoul, isHot, isNiceOut, weatherAt } from '../sim/weather';
import { ageOf, firstName, householdOf, isPerson, jobOf, nameOf, tickRng, type World } from '../sim/world';
import type { ActName } from './acts';
import { isSeeable } from './facts';
import { capital, decap, fillSlots, lowerStart, bare, type PickContext, type TalkMemory } from './grammar';
import { clause, phrase, say, toneOf, voiced } from './realise';
import { Discourse, familiarity, isDwelling, isFamilyTie, kinWord, namesOf, objectForm, placeName, pronoun, refer, tie } from './refer';
import { voiceOf, type Voice } from './voice';

/** One line of an overheard exchange. */
export interface Line {
  speaker: ActorId;
  text: string;
  /** The fact this line passes on (the player may learn it by listening), -1 for small talk. */
  fact: number;
}

/** What two people said at an encounter, in order. */
export interface Exchange {
  place: PlaceId;
  /** Who started (the encounter's `a`) and who answered. */
  a: ActorId;
  b: ActorId;
  kind: Encounter['kind'];
  /** Clock minute. */
  time: number;
  lines: Line[];
}

/** Every encounter of the last tick as an exchange (filtered by `keep`, e.g. near the camera). */
export function overheard(world: World, memory: TalkMemory | null = null, keep?: (e: Encounter) => boolean): Exchange[] {
  const out: Exchange[] = [];
  for (const e of world.encounters) {
    if (keep && !keep(e)) continue;
    const x = overhear(world, e, memory);
    if (x) out.push(x);
  }
  return out;
}

/** The words of one encounter of the last tick, or null when nothing is said aloud. */
export function overhear(world: World, e: Encounter, memory: TalkMemory | null = null): Exchange | null {
  const rng = tickRng(world, 'chatter', e.a, e.b);
  const x: Exchange = { place: e.place, a: e.a, b: e.b, kind: e.kind, time: world.clock, lines: [] };
  if (e.kind === 'animal') animal(world, e, x, rng, memory);
  else if (e.kind === 'snub') snub(world, e, x, rng, memory);
  else if (ageOf(world, e.a) < TALKS || ageOf(world, e.b) < TALKS) little(world, e, x, rng, memory);
  else new Talk(world, e, x, rng, memory).unfold();
  return x.lines.length ? x : null;
}

// ---- a conversation ----------------------------------------------------------------------------------------

class Talk {
  private readonly d: Discourse;
  private readonly voices = new Map<ActorId, Voice>();

  /** The next topic follows news, so it opens with "Anyway". */
  private segue = false;

  /** What these two already talked about today (topics are not raised twice in a day). */
  private readonly today: { met: number; topics: Set<string> };

  constructor(private readonly world: World, private readonly e: Encounter, private readonly x: Exchange, private readonly rng: Rng, private readonly memory: TalkMemory | null) {
    this.d = new Discourse(e.a, e.b, rng);
    this.today = memory ? memory.today(e.a, e.b, dayOf(world.clock)) : { met: 0, topics: new Set() };
  }

  private voice(id: ActorId): Voice {
    let v = this.voices.get(id);
    if (!v) this.voices.set(id, (v = voiceOf(this.world, id)));
    return v;
  }

  private ctx(id: ActorId): PickContext { return { rng: this.rng, memory: this.memory, speaker: id }; }

  /** Make `who` the speaker of the discourse (pronouns and "you" follow). */
  private as(who: ActorId): void { if (this.d.speaker !== who) this.d.turn(); }

  private other(who: ActorId): ActorId { return who === this.e.a ? this.e.b : this.e.a; }

  /**
   * `who` says a phrase of `act` with these slots (phrases whose slots cannot all be filled are skipped). `opens`:
   * the line starts a topic, so it may get a filler in front. Returns the line said, or null when nothing fitted.
   */
  private line(who: ActorId, act: ActName, slots: Record<string, string | undefined> = {}, opens = false, keep?: (s: string) => boolean): string | null {
    this.as(who);
    const v = this.voice(who), ctx = this.ctx(who);
    const all = { ...this.common(who), ...slots };
    const p = phrase(act, v, ctx, (s) => (!keep || keep(s)) && [...s.matchAll(/\{(\w+)\}/g)].every((m) => all[m[1]] !== undefined));
    if (!p) return null;
    let body = fillSlots(p, all);
    // A new topic after the news is marked as one ("Anyway, …").
    if (this.segue) {
      this.segue = false;
      const s = phrase('segue', v, ctx);
      body = s.endsWith(',') ? `${s} ${decap(body, namesOf(this.world))}` : `${s} ${body}`;
      opens = false;
    }
    // (A pet phrase only on a line that starts something: "…, mark my words" ends an answer oddly.)
    const text = voiced(body, v, ctx, { names: opens ? namesOf(this.world) : undefined, pet: opens });
    this.utter(who, text, -1);
    return text;
  }

  /** A line onto the exchange; one person saying two things in a row is one turn. */
  private utter(who: ActorId, text: string, fact: number): void {
    const last = this.x.lines[this.x.lines.length - 1];
    if (last && last.speaker === who) { last.text = `${last.text} ${text}`; if (last.fact < 0) last.fact = fact; }
    else this.x.lines.push({ speaker: who, text, fact });
  }

  /** Slots every line may use ({name} only when the speaker knows the listener's name). */
  private common(who: ActorId): Record<string, string | undefined> {
    const m = minuteOfDay(this.world.clock);
    const tod = m < 300 ? 'Evening' : m < 720 ? 'Morning' : m < 1080 ? 'Afternoon' : 'Evening';
    const to = this.other(who);
    const known = familiarity(this.world, who, to) >= 0.1 || this.world.relations.isFamily(who, to);
    return { tod, todl: tod.toLowerCase(), name: known ? this.address(who, to) : undefined, wow: '{wow}' };
  }


  /** How `who` addresses `to`: first name, or "Mrs Keller" from a child or a formal old person to an adult. */
  private address(who: ActorId, to: ActorId): string {
    const w = this.world;
    const ageW = ageOf(w, who), ageT = ageOf(w, to);
    const fam = w.relations.isFamily(who, to);
    const formal = !fam && ageT >= 25 && (ageW < 16 || (ageW >= 68 && this.voice(who).formality > 0.7 && familiarity(this.world, who, to) < 0.5));
    if (!formal) return firstName(w, to);
    return `${w.actors.cols.sex[to] === 0 ? 'Mrs' : 'Mr'} ${w.people.last[w.actors.cols.row[to]]}`;
  }

  /** Low on rest or mood: "I've been better". */
  private low(who: ActorId): boolean {
    const a = this.world.actors.cols;
    return a.mood[who] < -0.25 || a.needs[who * NEED_COUNT + N_REST] < 0.25;
  }

  unfold(): void {
    const { world: w, e } = this;
    // Bad news to break: no cheery "How are you?" first.
    const grave = [e.told, e.toldBack].some((f) => f >= 0 && ['tragic', 'sad'].includes(toneOf(w.knowledge.facts[f])));
    this.greet(grave);
    let news = 0, heavy = false;
    for (const [teller, listener, f] of [[e.a, e.b, e.told], [e.b, e.a, e.toldBack]] as const) {
      if (f < 0) continue;
      heavy = this.news(teller, listener, w.knowledge.facts[f], news > 0) || heavy;
      news++;
    }
    // After an argument or sad news nobody turns to the weather.
    // Met already today: less to say.
    const topics = heavy ? 0 : this.today.met > 0 ? (this.rng.float() < 0.35 && news === 0 ? 1 : 0) : news === 0 ? 1 + (this.rng.float() < (this.voice(e.a).verbosity + this.voice(e.b).verbosity) / 2 ? 1 : 0) : this.rng.float() < 0.1 ? 1 : 0;
    this.segue = news > 0;
    this.smallTalk(topics);
    this.segue = false;
    this.part(heavy);
    this.today.met++;
  }

  // ---- greeting and parting ----

  private greet(grave: boolean): void {
    const { world: w, e, rng } = this;
    const home = w.actors.cols.home;
    if (home[e.a] === e.place && home[e.b] === e.place) {
      if (!grave && rng.float() < 0.35) this.line(e.a, 'greet.home');
      return;
    }
    if (rng.float() >= 0.85) return;
    // Met already today: no "how are you?" again.
    if (this.today.met > 0) {
      // Workmates see each other all day; "hello again" is for running into someone twice.
      const job = jobOf(w, e.a);
      if (this.today.met === 1 && !(job && job.place === e.place) && rng.float() < 0.5) this.line(e.a, 'greet.again');
      return;
    }
    const known = familiarity(this.world, e.a, e.b) >= 0.2;
    const asks = known && !grave && rng.float() < 0.5;
    if (!this.line(e.a, asks ? 'greet.how' : known ? 'greet.known' : 'greet.stranger')) return;
    if (asks) {
      this.line(e.b, this.low(e.b) ? 'greet.fine.low' : 'greet.fine');
      this.line(e.a, this.low(e.a) ? 'mood.low' : 'greet.fine.back');
      if (this.low(e.a)) this.line(e.b, 'mood.low.reply');
    } else if (rng.float() < 0.8) this.line(e.b, 'greet.reply');
  }

  /** `heavy`: after bad news or an argument ("Well. I'd better get on."). */
  private part(heavy: boolean): void {
    const { e } = this;
    if (this.x.lines.length === 0 || this.rng.float() < 0.3) return;
    const who = this.rng.float() < 0.5 ? e.a : e.b;
    const night = minuteOfDay(this.world.clock) >= 21 * 60 || minuteOfDay(this.world.clock) < 4 * 60;
    if (this.world.actors.cols.home[e.a] === e.place && this.world.actors.cols.home[e.b] === e.place && !night) return;
    this.line(who, night ? 'part.night' : heavy ? 'part.heavy' : 'part');
    if (this.rng.float() < 0.7) this.line(this.other(who), night ? 'part.night' : 'part.reply');
  }

  // ---- news ----

  /**
   * The teller passes a story on; the listener answers what was said, and the talk follows from that answer: an
   * argument over versions, doubt and its defence, "who told you?" and what the listener makes of the source, a
   * question the story raises (answered from the town's agenda where it can be), or a detail from the teller.
   */
  /** Returns whether the talk turned heavy (an argument, sad news), so it should not drift into small talk. */
  private news(teller: ActorId, listener: ActorId, f: Fact, also: boolean): boolean {
    const w = this.world, rng = this.rng;
    this.as(teller);
    const lv = this.voice(listener);
    const tone = toneOf(f);
    const sad = tone === 'tragic' || tone === 'sad';
    // News about the teller's own household is theirs to tell ("we're off to the lakes"), not hearsay.
    const hh = householdOf(w, teller);
    const kin = f.subject >= 0 ? tie(w, teller, f.subject) : null;
    const self = isAbout(f, teller) || (hh !== null && f.subject >= 0 && householdOf(w, f.subject) === hh) || (tone === 'news' && !!kin && isFamilyTie(kin));
    const said = { source: false };
    // One's own news is announced ("Did I tell you?", "I've got some sad news"), not dropped in.
    const close = !!kin && isFamilyTie(kin);
    const opener: ActName | true = also ? 'news.open.also' : self || close ? (sad || tone === 'bad' ? 'news.open.sad' : tone === 'news' ? 'news.open.self.small' : self ? 'news.open.self' : true) : true;
    this.utter(teller, say(w, f, teller, listener, { rng, memory: this.memory, discourse: this.d, opener, said }), f.id);
    const c = w.knowledge.beliefs.cols;
    const r = beliefAbout(w, listener, f.id);
    const held = r >= 0 ? w.knowledge.facts[c.fact[r]] : null;
    const knew = r >= 0 && c.heardAt[r] < w.clock;
    const about = this.aboutSlots(listener, f);

    const bad = sad || tone === 'bad' || tone === 'crime';
    // The teller's own news, or their family's: congratulations or sympathy (also when the listener had heard).
    const yours = close && (tone === 'good' || bad || tone === 'scandal');
    if (self || yours) {
      const act: ActName = tone === 'scandal' ? 'react.yours.scandal'
        : self && knew ? (bad ? 'react.yours.bad' : 'react.self.knew') : self ? (tone === 'good' ? 'react.self.good' : bad ? 'react.self.bad' : 'react.self.news')
          : tone === 'good' ? 'react.yours.good' : 'react.yours.bad';
      const reply = this.line(listener, act, about) ?? '';
      // "How are you all holding up?" wants an answer, not "Thanks".
      if (act === 'react.yours.scandal') this.line(teller, 'react.yours.scandal.answer');
      else if (bad && /\?$/.test(reply)) this.line(teller, 'react.yours.answer');
      else if (act !== 'react.self.news' && act !== 'react.self.knew' && rng.float() < 0.6) this.line(teller, 'react.self.close');
      return bad || tone === 'scandal';
    }
    // They hold another version of the story: the distortion shows as an argument.
    // (Not when either of them is the story, or it is the teller's family: they would know.)
    if (held && held.id !== f.id && !isAbout(held, listener) && !isAbout(f, teller) && !isAbout(f, listener)) return this.versions(teller, listener, f, held, r);
    if (knew) {
      this.line(listener, 'react.knew');
      if (rng.float() < 0.5) this.line(teller, 'knew.back');
      return sad;
    }
    const family = f.subject >= 0 ? tie(w, listener, f.subject) : null;
    if (family && isFamilyTie(family) && tone !== 'news' && tone !== 'event' && tone !== 'politics') {
      const word = kinWord(w, f.subject, family, lv, rng) ?? 'family';
      this.line(listener, tone === 'good' ? 'react.family.good' : tone === 'scandal' ? 'react.family.scandal' : 'react.family.bad', { ...about, tie: word });
      if (tone === 'scandal') this.line(teller, 'family.scandal.back');
      return tone !== 'good';
    }
    // A sceptic doubts a story worth doubting, not a holiday or a new job.
    const doubtful = tone === 'scandal' || tone === 'crime' || tone === 'tragic' || tone === 'sad' || tone === 'bad';
    if (doubtful && lv.sceptic > 0.55 && r >= 0 && c.confidence[r] < 0.55 && rng.float() < 0.7) {
      const byName = about.who !== undefined && (tone === 'scandal' || tone === 'crime') && rng.float() < 0.4;
      this.line(listener, byName ? 'doubt.who' : 'doubt', about);
      this.defend(teller, f);
      if (rng.float() < 0.7) this.line(listener, 'doubt.close');
      return true;
    }
    this.line(listener, this.reaction(listener, lv, tone, f), about);
    this.followUp(teller, listener, f, tone, about, said.source);
    if (f.secret && rng.float() < 0.6) {
      this.line(teller, 'secret.close');
      if (rng.float() < 0.6) this.line(listener, 'secret.reply');
    }
    // A break-in or a lost job leaves no room for "I'm in a good mood today".
    return sad || tone === 'crime' || tone === 'bad' || tone === 'scandal';
  }

  /** Two versions of one story meet. Returns whether they argued. */
  private versions(teller: ActorId, listener: ActorId, f: Fact, held: Fact, r: number): boolean {
    const w = this.world, rng = this.rng, c = w.knowledge.beliefs.cols;
    if (held.subject === f.subject && held.object === f.object && held.place === f.place) {
      const tone = toneOf(f);
      if (tone !== 'bad' && tone !== 'sad' && tone !== 'tragic' && tone !== 'crime' && tone !== 'scandal') {
        // A bigger or smaller engagement is the same engagement.
        this.line(listener, 'react.knew');
        return false;
      }
      // Only the size differs: one of them heard it bigger.
      const worse = held.magnitude > f.magnitude;
      this.line(listener, worse ? 'correct.worse' : 'correct.milder');
      this.line(teller, worse ? 'worse.back' : 'milder.back');
      return true;
    }
    this.as(listener);
    const lv = this.voice(listener);
    this.d.topicPlace = held.place;
    const theirs = clause(w, held, this.d, this.ctx(listener), lv);
    const src = c.source[r];
    const named = src >= 0 && src !== teller && rng.float() < 0.4 ? refer(w, src, this.d, 'subj', lv) : undefined;
    this.line(listener, named ? 'correct.src' : 'correct', { fact: theirs, Fact: capital(theirs), src: named });
    // The teller stands by it when they saw it or are sure; otherwise they give way.
    const tr = beliefAbout(w, teller, f.id);
    const how = tr >= 0 ? c.source[tr] : -1, sure = tr >= 0 ? c.confidence[tr] : 0.5;
    if (how === SOURCE_WITNESSED) this.line(teller, 'insist.witnessed');
    else if (how >= 0 && sure > 0.7 && this.line(teller, 'insist.told', this.sourceSlots(teller, how))) { /* said */ }
    else {
      this.line(teller, 'concede');
      if (rng.float() < 0.4) this.line(listener, 'concede.close');
      return true;
    }
    if (rng.float() < 0.6) this.line(listener, 'differ.close');
    return true;
  }

  /** The teller defends a story the listener doubts. */
  private defend(teller: ActorId, f: Fact): void {
    const w = this.world;
    const r = beliefAbout(w, teller, f.id);
    const src = r >= 0 ? w.knowledge.beliefs.cols.source[r] : -1;
    if (src === SOURCE_WITNESSED) this.line(teller, 'defend.witnessed');
    else if (src >= 0 && src !== this.other(teller) && this.line(teller, 'defend.told', this.sourceSlots(teller, src))) { /* said */ }
    else this.line(teller, 'defend.vague');
  }

  /**
   * Slots naming a source as the teller would ({src}, {src_o}, {src_pro}, {src_them}). `explicit`: a name even when a
   * pronoun would do (an answer to "who told you?" says who).
   */
  private sourceSlots(teller: ActorId, src: ActorId, explicit = false): Record<string, string> {
    this.as(teller);
    const w = this.world;
    let np = refer(w, src, this.d, 'subj', this.voice(teller));
    if (explicit && np === pronoun(w, src, 'subj')) np = familiarity(this.world, this.other(teller), src) >= 0.2 ? firstName(w, src) : nameOf(w, src);
    return { src: np, src_o: objectForm(np), src_pro: pronoun(w, src, 'subj'), src_them: pronoun(w, src, 'obj') };
  }

  /** After the reaction, maybe one more beat: who told you, a question the story raises, or a detail. */
  private followUp(teller: ActorId, listener: ActorId, f: Fact, tone: ReturnType<typeof toneOf>, about: Record<string, string | undefined>, sourced: boolean): void {
    const rng = this.rng, lv = this.voice(listener), tv = this.voice(teller);
    const roll = rng.float();
    const question = this.storyQuestion(f);
    // "Who told you?" only when the teller did not say.
    if (roll < 0.15 + 0.3 * lv.gossip) { if (!sourced && this.canSay(teller, f)) this.askSource(teller, listener, f); return; }
    if (question && roll < 0.55 + 0.2 * lv.warmth) { this.answerQuestion(teller, listener, f, question, about); return; }
    if (roll < 0.35 + 0.25 * tv.verbosity) {
      // "At the Crown, of all places" is worth saying; "at a house on Elm Street" is not.
      const at = f.place >= 0 && (tone === 'scandal' || tone === 'crime') && !/\{place\}/.test(f.text) && !isDwelling(this.world, f.place) ? f.place : -1;
      const ago = this.ago(teller, f);
      if (at >= 0 && rng.float() < 0.5) this.line(teller, 'detail.place', { P: placeName(this.world, at, this.d) });
      else if (ago && tone !== 'news' && tone !== 'good') this.line(teller, 'detail.heard', { ago });
      else return;
      if (rng.float() < 0.5) this.line(listener, 'detail.ack');
    }
  }

  /** When the teller heard it, in words ("this morning", "yesterday", "last week"), or null. */
  private ago(teller: ActorId, f: Fact): string | null {
    const w = this.world, r = beliefAbout(w, teller, f.id);
    if (r < 0) return null;
    const at = w.knowledge.beliefs.cols.heardAt[r];
    const days = dayOf(w.clock) - dayOf(at);
    if (days === 0) { const m = minuteOfDay(at); return w.clock - at < 90 ? 'just now' : m < 720 ? 'this morning' : 'earlier today'; }
    if (days === 1) return minuteOfDay(at) >= 18 * 60 ? 'last night' : 'yesterday';
    if (days < 7) return `on ${weekdayName(dateOf(w, at).weekday)}`;
    if (days < 14) return 'last week';
    return days < 45 ? 'a few weeks ago' : 'a while back';
  }

  /** Whether the teller can say where they had the story ("I saw it myself" fits a fight, not someone's holiday). */
  private canSay(teller: ActorId, f: Fact): boolean {
    const r = beliefAbout(this.world, teller, f.id);
    if (r < 0 || this.world.knowledge.beliefs.cols.source[r] !== SOURCE_WITNESSED) return true;
    return isSeeable(toneOf(f));
  }

  private askSource(teller: ActorId, listener: ActorId, f: Fact): void {
    const w = this.world;
    this.line(listener, 'ask.source');
    const r = beliefAbout(w, teller, f.id);
    const src = r >= 0 ? w.knowledge.beliefs.cols.source[r] : -1;
    if (src === SOURCE_WITNESSED) { this.line(teller, 'answer.witnessed'); return; }
    if (src >= 0 && isAbout(f, src)) {
      // "He told me himself" only when "he" is clear; "the Gerbers are away" leaves it open, so the name.
      const np = this.d.clear(w, src) ? pronoun(w, src, 'subj') : this.sourceSlots(teller, src, true).src;
      this.line(teller, 'answer.source.self', { Pro: capital(np), pro: np, self: w.actors.cols.sex[src] === 0 ? 'herself' : 'himself' });
      return;
    }
    if (src >= 0 && src !== listener && !(f.secret && this.rng.float() < 0.5)) {
      this.line(teller, 'answer.source', this.sourceSlots(teller, src, true));
      // What the listener makes of that source: their own trust in them, if they know them.
      const tr = w.relations.row(listener, src);
      if (tr < 0 || familiarity(this.world, listener, src) < 0.2) { if (this.rng.float() < 0.5) this.line(listener, 'source.neutral'); return; }
      const trust = w.relations.t.cols.trust[tr];
      // (Just named, so "she'd know"; a doubt names them: "Marta? Well, maybe.")
      this.line(listener, trust > 0.6 ? 'source.trusted' : trust < 0.32 ? 'source.doubted' : 'source.neutral', { src: trust > 0.6 ? pronoun(w, src, 'subj') : firstName(w, src) });
      return;
    }
    this.line(teller, 'answer.source.vague');
    if (this.rng.float() < 0.5) this.line(listener, 'source.vague.back');
  }

  /** The question a story raises, if any. */
  private storyQuestion(f: Fact): 'funeral' | 'wedding' | 'jobless' | 'ill' | 'baby' | null {
    if (f.subject < 0) return null;
    const t = f.text;
    if (/^\{subject\} died$/.test(t)) return 'funeral';
    if (/got engaged$/.test(t)) return 'wedding';
    if (/lost their job/.test(t)) return 'jobless';
    if (/seriously ill|taken to hospital/.test(t)) return 'ill';
    if (/had a baby$/.test(t) && f.object >= 0) return 'baby';
    return null;
  }

  /** The listener asks what the story raises; the teller answers from what the town knows (the agenda, the baby). */
  private answerQuestion(teller: ActorId, listener: ActorId, f: Fact, q: NonNullable<ReturnType<Talk['storyQuestion']>>, about: Record<string, string | undefined>): void {
    const w = this.world;
    const asked = this.line(listener, `ask.${q}` as ActName, about);
    if (!asked) return;
    if (q === 'baby') {
      const kid = w.actors.cols.sex[f.object] === 0 ? 'girl' : 'boy';
      this.line(teller, 'answer.kid', { kid, Kid: capital(kid) });
      if (this.rng.float() < 0.6) this.line(listener, 'answer.kid.close');
      return;
    }
    if (q === 'funeral' || q === 'wedding') {
      const occ = this.occasionAbout(f.subject, q);
      if (occ) {
        const when = this.when(occ);
        this.as(teller);
        this.line(teller, 'answer.when', { when, When: capital(when), P: occ.place >= 0 ? placeName(w, occ.place, this.d) : undefined });
        if (this.rng.float() < 0.6) this.line(listener, 'answer.when.close');
        return;
      }
    }
    this.line(teller, 'answer.dunno');
    if (this.rng.float() < 0.5) this.line(listener, 'answer.dunno.close');
  }

  /** A funeral or wedding on the agenda about `who`, in the next weeks. */
  private occasionAbout(who: ActorId, kind: 'funeral' | 'wedding'): Occasion | null {
    for (const o of this.world.agenda.once) if (o.kind === kind && o.about.includes(who) && o.start >= this.world.clock) return o;
    return null;
  }

  private reaction(listener: ActorId, v: Voice, tone: ReturnType<typeof toneOf>, f: Fact): ActName {
    switch (tone) {
      case 'tragic': return 'react.tragic';
      case 'sad': return 'react.sad';
      case 'bad': return 'react.bad';
      case 'good': {
        const r = f.subject >= 0 ? this.world.relations.row(listener, f.subject) : -1;
        return r >= 0 && this.world.relations.t.cols.affection[r] < -0.3 ? 'react.good.grudging' : 'react.good';
      }
      case 'scandal': return v.gossip > 0.5 || (v.formality < 0.6 && v.warmth < 0.7) ? 'react.scandal.gossip' : 'react.scandal.prim';
      case 'crime': return 'react.crime';
      case 'politics': return 'react.politics';
      case 'event': return 'react.event';
      default: return 'react.news';
    }
  }

  /** Slots about the story's subject for a reaction ({who}, {pro}, {is}); none when there is no subject. */
  private aboutSlots(listener: ActorId, f: Fact): Record<string, string | undefined> {
    const s = f.subject;
    if (s < 0 || s === listener || this.world.actors.cols.kind[s] !== ACTOR_PERSON) return {};
    const known = familiarity(this.world, listener, s) >= 0.15 || this.d.mentioned(s);
    return {
      who: known ? firstName(this.world, s) : undefined,
      pro: pronoun(this.world, s, 'subj'), Pro: capital(pronoun(this.world, s, 'subj')), pro_obj: pronoun(this.world, s, 'obj'), is: 'is',
    };
  }

  // ---- small talk ----

  private smallTalk(n: number): void {
    const topics = this.topics();
    for (let i = 0; i < n && topics.length; i++) {
      let total = 0;
      for (const t of topics) total += t.weight;
      let roll = this.rng.float() * total, k = 0;
      while (k < topics.length - 1 && roll >= topics[k].weight) { roll -= topics[k].weight; k++; }
      const [t] = topics.splice(k, 1);
      t.say();
    }
  }

  private topics(): { weight: number; say: () => void }[] {
    const w = this.world, { e } = this, rng = this.rng;
    const out: { weight: number; say: () => void }[] = [];
    const a = rng.float() < 0.65 ? e.a : e.b, b = this.other(a);
    const topics = this.today.topics;
    // A topic once a day per pair: the second time they meet they talk about something else.
    const propose = (key: string, weight: number, f: () => void) => {
      if (weight > 0 && !topics.has(key)) out.push({ weight, say: () => { topics.add(key); f(); } });
    };

    // The weather now.
    const wx = weatherAt(w);
    const kind: ActName = isFoul(wx) ? (wx.snow > wx.rain ? 'weather.snow' : 'weather.storm')
      : wx.precip > 0.08 ? (wx.snow > wx.rain ? 'weather.snow' : wx.precip > 0.3 ? 'weather.rain' : 'weather.drizzle')
        : wx.ice ? 'weather.ice' : wx.fog > 0.55 ? 'weather.fog' : isHot(wx) ? 'weather.hot' : isCold(wx) ? 'weather.cold'
          : isNiceOut(wx) ? 'weather.nice' : wx.wind > 0.7 ? 'weather.windy' : wx.cover > 0.75 ? 'weather.grey' : 'weather.mild';
    const notable = kind !== 'weather.mild' && kind !== 'weather.grey';
    propose(kind, notable ? 1.6 : 0.6, () => {
      const said = this.line(a, kind, {}, true) ?? '';
      const bad = kind !== 'weather.nice' && kind !== 'weather.mild';
      const bright = bad && this.voice(b).warmth > 0.65 && rng.float() < 0.4;
      // "It is, isn't it?" answers "Lovely day, isn't it?", not "Bit of sun, at least."
      const asked = /\?$/.test(said) || /^(What|Isn't|Such|How)\b/.test(said);
      this.line(b, !bad ? 'weather.reply.nice' : bright ? 'weather.reply.bright' : 'weather.reply.bad', {}, false, (s) => asked || !/^(It is|Isn't it|Indeed it is|It's)\b/.test(s));
      if (!bright && this.voice(a).verbosity > 0.55 && rng.float() < 0.45) {
        this.line(a, bad ? 'weather.more.bad' : 'weather.more.nice');
        if (rng.float() < 0.5) this.line(b, 'weather.more.ack');
      }
    });

    // A holiday today.
    const hol = holidayOn(w, w.clock);
    const holAct = hol ? HOLIDAY_ACT[hol.kind] : undefined;
    if (holAct) propose('holiday', 3, () => {
      const said = this.line(a, holAct, {}, true);
      if (!said) return;
      const greeting = holAct === 'holiday.christmas' || holAct === 'holiday.newYear' || (holAct === 'holiday.easter' && said.startsWith('Happy'));
      this.line(b, greeting ? 'holiday.reply.greeting' : said.endsWith('?') ? 'holiday.reply.question' : 'holiday.reply.statement');
    });

    // What is on in town in the next days.
    const occ = this.upcoming(b);
    if (occ) propose(`occ:${occ.name}`, occ.id < 0 ? 0.3 : 1.5, () => {
      const when = this.when(occ);
      if (occ.kind === 'funeral') {
        this.line(a, 'occasion.sad', { occ: occ.name, when });
        this.line(b, 'occasion.sad.reply');
        return;
      }
      const ask = rng.float() < 0.65;
      this.line(a, ask ? 'occasion.ask' : 'occasion.say', { occ: occ.name, Occ: capital(occ.name), when }, true);
      if (!ask) { this.line(b, 'occasion.say.reply'); return; }
      const goes = occ.guests?.includes(b) || rng.float() < 0.3 + occ.pull * 0.6;
      this.line(b, goes ? 'occasion.yes' : 'occasion.no');
      if (rng.float() < 0.6) this.line(a, goes ? 'occasion.yes.back' : 'occasion.no.back');
    });

    // Local lore.
    const lore = this.lore(a);
    // Worth telling when not everyone knows it, or when it matters.
    if (lore && lore.share < 0.8) propose(`lore:${lore.text}`, (0.3 + 0.5 * this.voice(a).verbosity) * (0.2 + lore.salience * 1.5) * (1.6 - lore.share), () => {
      // "Many say Morwick has grown too fast" after "They say" would say it twice.
      const said = lowerStart(bare(lore.text)).replace(/^(many|some|most|people|locals|older people)( [a-z]+)? (say|think|reckon|complain)( that)? /, '');
      this.line(a, 'lore', { lore: said }, true);
      this.line(b, lore.share >= 0.85 ? 'lore.reply.known' : 'lore.reply.new');
    });

    // How they feel.
    const needs = w.actors.cols.needs, mood = w.actors.cols.mood;
    if (needs[a * NEED_COUNT + N_REST] < 0.35) propose('tired', 1.2, () => { this.line(a, 'tired'); this.line(b, 'tired.reply'); });
    if (needs[a * NEED_COUNT + N_FOOD] < 0.3) propose('hungry', 1, () => { this.line(a, 'hungry'); this.line(b, 'hungry.reply'); });
    if (mood[a] < -0.3) propose('mood', 0.8, () => { this.line(a, 'mood.low'); this.line(b, this.voice(b).warmth > 0.4 ? 'mood.low.reply' : 'mood.low.cold'); });
    else if (mood[a] > 0.5) propose('mood', 0.4, () => { this.line(a, 'mood.high'); this.line(b, 'mood.high.reply'); });

    // Work or school, when they know each other a little.
    const r = w.relations.row(a, b);
    const known = r >= 0 ? w.relations.t.cols.familiarity[r] : 0;
    const job = jobOf(w, b);
    if (known > 0.2 && job && job.place >= 0 && job.place !== e.place) propose('work', 0.7, () => {
      this.as(a);
      this.line(a, 'work.ask', { work: placeName(w, job.place, this.d) });
      this.line(b, 'work.reply');
      if (rng.float() < 0.45) this.line(a, 'work.back');
    });
    else if (known > 0.15 && ageOf(w, b) < 19 && ageOf(w, a) >= 19 && w.people.cols.school[w.actors.cols.row[b]] >= 0) propose('school', 0.6, () => {
      this.line(a, 'school.ask');
      this.line(b, 'school.reply');
      if (rng.float() < 0.45) this.line(a, 'school.back');
    });

    // Asking after the family.
    const kin = this.kinToAskAbout(a, b);
    if (kin >= 0) propose(`kin:${kin}`, 0.8, () => {
      this.as(a);
      const np = refer(w, kin, this.d, 'obj', this.voice(a));
      this.line(a, 'family.ask', { kin: np });
      const pro = capital(pronoun(w, kin, 'subj'));
      const ill = w.actors.cols.health[kin] < 0.5;
      this.line(b, ill ? 'family.reply.ill' : 'family.reply', { Pro: pro, is: 'is' });
      if (rng.float() < 0.6) this.line(a, ill ? 'family.back.ill' : 'family.back', { pro_obj: pronoun(w, kin, 'obj') });
    });

    // The place they are in.
    const acts = e.place >= 0 ? PLACE_ACT[w.graph.places[e.place].kind] : undefined;
    if (acts) propose('place', 0.7, () => {
      const moan = acts.moan && (!acts.good || rng.float() < 0.5);
      this.line(a, moan ? acts.moan! : acts.good!, {}, true);
      this.line(b, moan ? 'place.reply.moan' : 'place.reply.good');
    });

    // What the other one is up to.
    // (Out and about: at home nobody asks "Grabbing something to eat?")
    const doing = e.place >= 0 && !isDwelling(w, e.place) ? DOING_ACT[ACTIVITIES[w.actors.cols.activity[b]]] : undefined;
    if (doing && known > 0.1) propose('doing', 0.9, () => {
      this.line(a, doing, {}, true);
      this.line(b, `${doing}.reply` as ActName);
    });

    // The time of year, and the weekend coming.
    const date = dateOf(w, w.clock);
    const season = date.month <= 2 || date.month === 12 ? 'winter' : date.month <= 5 ? 'spring' : date.month <= 8 ? 'summer' : 'autumn';
    // (Once a day per speaker: nobody tells ten people the leaves are turning.)
    const mine = this.memory?.today(a, a, dayOf(w.clock)).topics;
    if (!mine?.has('season')) propose('season', 0.2, () => {
      mine?.add('season');
      this.line(a, `season.${season}` as ActName, {}, true);
      this.line(b, 'season.reply');
    });
    if (known > 0.2 && (date.weekday === 3 || date.weekday === 4)) propose('weekend', 0.7, () => {
      this.line(a, 'weekend.ask');
      this.line(b, 'weekend.reply');
      if (rng.float() < 0.5) this.line(a, 'weekend.back');
    });
    return out;
  }

  /** The next occasion in town that `who` might go to (today after now, or within six days). */
  private upcoming(who: ActorId): Occasion | null {
    const w = this.world, today = dayOf(w.clock);
    for (let d = today; d <= today + 6; d++) {
      for (const o of agendaOn(w, d)) {
        if (o.start < w.clock || o.kind === 'binDay' || o.kind === 'club' || o.kind === 'service' || o.pull <= 0) continue;
        if (o.about.includes(who) || o.about.includes(this.other(who))) continue;
        if (o.guests && !o.guests.includes(who) && !o.guests.includes(this.other(who))) continue;
        return o;
      }
    }
    return null;
  }

  /** "today", "tonight", "tomorrow", "on Saturday" ("this week" when the name already says the day). */
  private when(o: Occasion): string {
    const w = this.world, start = o.start, days = dayOf(start) - dayOf(w.clock);
    if (days === 0) return minuteOfDay(start) >= 17 * 60 ? 'tonight' : 'today';
    if (days === 1) return minuteOfDay(start) >= 17 * 60 ? 'tomorrow night' : 'tomorrow';
    const day = weekdayName(dateOf(w, start).weekday);
    return o.name.includes(day) ? 'this week' : `on ${day}`;
  }

  /** A piece of local knowledge `who` has. */
  private lore(who: ActorId): { text: string; salience: number; share: number } | null {
    const w = this.world, reg = w.region;
    if (!reg || reg.lore.length === 0) return null;
    for (let t = 0; t < 4; t++) {
      const s = reg.lore[this.rng.int(0, reg.lore.length - 1)];
      if (knowsStanding(w, who, s)) return { text: w.knowledge.facts[s.fact].text, salience: s.salience, share: s.share };
    }
    return null;
  }

  /** Someone in `b`'s family that `a` knows, who is not here. */
  private kinToAskAbout(a: ActorId, b: ActorId): ActorId {
    const w = this.world;
    const hh = householdOf(w, b);
    if (!hh || hh === householdOf(w, a)) return -1;
    const cands = hh.members.filter((m) => m !== b && isPerson(w, m) && w.actors.cols.place[m] !== this.e.place && w.relations.isFamily(b, m));
    if (!cands.length) return -1;
    const m = cands[this.rng.int(0, cands.length - 1)];
    const r = w.relations.row(a, m);
    return r >= 0 && w.relations.t.cols.familiarity[r] > 0.12 ? m : -1;
  }
}

const HOLIDAY_ACT: Partial<Record<string, ActName>> = {
  christmas: 'holiday.christmas', boxingDay: 'holiday.christmas', christmasEve: 'holiday.christmasEve', newYear: 'holiday.newYear',
  newYearsEve: 'holiday.newYearsEve', easter: 'holiday.easter', easterMonday: 'holiday.easter', halloween: 'holiday.halloween',
  summerFestival: 'holiday.summerFestival', christmasMarket: 'holiday.christmasMarket',
};

/** What can be said about a kind of place: something nice, a moan. */
/** Asking someone what they are up to, by their activity (each act has a `.reply` bank). */
const DOING_ACT: Partial<Record<string, ActName>> = {
  shop: 'doing.shop', walkDog: 'doing.walkDog', exercise: 'doing.exercise', errand: 'doing.errand', eat: 'doing.eat',
  doctor: 'doing.doctor', travel: 'doing.travel', worship: 'doing.worship', leisure: 'doing.leisure',
};

const PLACE_ACT: Partial<Record<string, { good?: ActName; moan?: ActName }>> = {
  pub: { good: 'place.pub.good' }, cafe: { good: 'place.cafe.good' }, bakery: { good: 'place.bakery.good', moan: 'place.bakery.moan' },
  supermarket: { moan: 'place.shop.moan' }, shop: { moan: 'place.shop.moan' }, grocer: { moan: 'place.shop.moan' },
  church: { good: 'place.church.good' }, park: { good: 'place.park.good' }, school: { moan: 'place.school.moan' }, doctor: { moan: 'place.doctor.moan' },
};

// ---- one-liners --------------------------------------------------------------------------------------------

/** One avoids the other: a curt word, maybe an answer. */
function snub(world: World, e: Encounter, x: Exchange, rng: Rng, memory: TalkMemory | null): void {
  const leaver = avoids(world, e.a, e.b, -1) ? e.a : e.b, other = leaver === e.a ? e.b : e.a;
  for (const [who, act] of [[leaver, 'snub'], [other, 'snub.reply']] as const) {
    if (act === 'snub.reply' && rng.float() < 0.5) break;
    const v = voiceOf(world, who), ctx = { rng, memory, speaker: who };
    x.lines.push({ speaker: who, text: voiced(phrase(act, v, ctx), v, ctx), fact: -1 });
  }
}

/** A person talks to an animal: their own pet, someone's dog, a deer in the woods. */
/** Age from which a child holds a conversation; younger ones get talked to. */
const TALKS = 4;

/** Someone with a baby or toddler: a word to the little one (two little ones say nothing we would write down). */
function little(world: World, e: Encounter, x: Exchange, rng: Rng, memory: TalkMemory | null): void {
  const big = ageOf(world, e.a) >= TALKS ? e.a : ageOf(world, e.b) >= TALKS ? e.b : -1;
  if (big < 0 || rng.float() < 0.4) return;
  const tot = big === e.a ? e.b : e.a;
  const own = householdOf(world, tot) !== null && householdOf(world, tot) === householdOf(world, big);
  const v = voiceOf(world, big), ctx = { rng, memory, speaker: big };
  const text = fillSlots(phrase(own ? 'little.own' : 'little', v, ctx), { name: firstName(world, tot), boy: world.actors.cols.sex[tot] !== 0 ? 'boy' : 'girl' });
  x.lines.push({ speaker: big, text: voiced(text, v, ctx, { pet: false }), fact: -1 });
}

function animal(world: World, e: Encounter, x: Exchange, rng: Rng, memory: TalkMemory | null): void {
  const a = world.actors.cols;
  const person = a.kind[e.a] === ACTOR_PERSON ? e.a : e.b, beast = person === e.a ? e.b : e.a;
  if (a.kind[person] !== ACTOR_PERSON || a.kind[beast] === ACTOR_PERSON || rng.float() < 0.4) return;
  const sp = SPECIES[a.species[beast]];
  const own = householdOf(world, beast) !== null && householdOf(world, beast) === householdOf(world, person);
  const act: ActName = sp.name === 'dog' ? (own ? 'animal.own.dog' : 'animal.dog') : sp.name === 'cat' ? (own ? 'animal.own.cat' : 'animal.cat')
    : sp.class === 'livestock' ? 'animal.farm' : 'animal.wild';
  const v = voiceOf(world, person), ctx = { rng, memory, speaker: person };
  const male = a.sex[beast] !== 0;
  const text = fillSlots(phrase(act, v, ctx), { pet: world.animals.name[a.row[beast]] ?? 'boy', boy: male ? 'boy' : 'girl', it: male ? 'him' : 'her', species: sp.name });
  x.lines.push({ speaker: person, text: voiced(text, v, ctx, { pet: false }), fact: -1 });
}
