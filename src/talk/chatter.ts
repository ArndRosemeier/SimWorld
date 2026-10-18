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
import { ACTOR_PERSON, type ActorId } from '../sim/actors';
import { agendaOn, type Occasion } from '../sim/agenda';
import { holidayOn, weekdayName, dateOf } from '../sim/calendar';
import type { Encounter } from '../sim/encounters';
import { avoids } from '../sim/intentions';
import { beliefAbout, isAbout, knowsStanding, SOURCE_WITNESSED, type Fact } from '../sim/knowledge';
import type { PlaceId } from '../sim/places';
import { NEED_COUNT, N_FOOD, N_REST, SPECIES } from '../sim/species';
import { dayOf, minuteOfDay } from '../sim/time';
import { isCold, isFoul, isHot, isNiceOut, weatherAt } from '../sim/weather';
import { ageOf, firstName, householdOf, isPerson, jobOf, tickRng, type World } from '../sim/world';
import type { ActName } from './acts';
import { capital, fillSlots, lowerStart, bare, type PickContext, type TalkMemory } from './grammar';
import { clause, phrase, say, toneOf, voiced } from './realise';
import { Discourse, isFamilyTie, kinWord, namesOf, objectForm, placeName, pronoun, refer, tie } from './refer';
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
  else new Talk(world, e, x, rng, memory).unfold();
  return x.lines.length ? x : null;
}

// ---- a conversation ----------------------------------------------------------------------------------------

class Talk {
  private readonly d: Discourse;
  private readonly voices = new Map<ActorId, Voice>();

  constructor(private readonly world: World, private readonly e: Encounter, private readonly x: Exchange, private readonly rng: Rng, private readonly memory: TalkMemory | null) {
    this.d = new Discourse(e.a, e.b, rng);
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

  /** `who` says a phrase of `act` with these slots. Returns false when the act has nothing fitting. */
  /**
   * `who` says a phrase of `act` with these slots (phrases whose slots cannot all be filled are skipped). `opens`:
   * the line starts a topic, so it may get a filler in front. Returns false when nothing fitted.
   */
  private line(who: ActorId, act: ActName, slots: Record<string, string | undefined> = {}, opens = false): boolean {
    this.as(who);
    const v = this.voice(who), ctx = this.ctx(who);
    const all = { ...this.common(who), ...slots };
    const p = phrase(act, v, ctx, (s) => [...s.matchAll(/\{(\w+)\}/g)].every((m) => all[m[1]] !== undefined));
    if (!p) return false;
    const text = fillSlots(p, all);
    this.x.lines.push({ speaker: who, text: voiced(text, v, ctx, { names: opens ? namesOf(this.world) : undefined }), fact: -1 });
    return true;
  }

  /** Slots every line may use. */
  private common(who: ActorId): Record<string, string> {
    const m = minuteOfDay(this.world.clock);
    const tod = m < 300 ? 'Evening' : m < 720 ? 'Morning' : m < 1080 ? 'Afternoon' : 'Evening';
    return { tod, todl: tod.toLowerCase(), name: this.address(who, this.other(who)), wow: '{wow}' };
  }

  /** How `who` addresses `to`: first name, or "Mrs Keller" from a child or a formal old person to an adult. */
  private address(who: ActorId, to: ActorId): string {
    const w = this.world;
    const ageW = ageOf(w, who), ageT = ageOf(w, to);
    const fam = w.relations.isFamily(who, to);
    const r = w.relations.row(who, to);
    const known = r >= 0 ? w.relations.t.cols.familiarity[r] : 0;
    const formal = !fam && ageT >= 25 && (ageW < 16 || (ageW >= 68 && this.voice(who).formality > 0.7 && known < 0.5));
    if (!formal) return firstName(w, to);
    return `${w.actors.cols.sex[to] === 0 ? 'Mrs' : 'Mr'} ${w.people.last[w.actors.cols.row[to]]}`;
  }

  unfold(): void {
    const { world: w, e } = this;
    this.greet();
    let news = 0;
    for (const [teller, listener, f] of [[e.a, e.b, e.told], [e.b, e.a, e.toldBack]] as const) {
      if (f < 0) continue;
      this.news(teller, listener, w.knowledge.facts[f]);
      news++;
    }
    const topics = news === 0 ? 1 + (this.rng.float() < (this.voice(e.a).verbosity + this.voice(e.b).verbosity) / 2 ? 1 : 0) : this.rng.float() < 0.25 ? 1 : 0;
    this.smallTalk(topics);
    this.part();
  }

  // ---- greeting and parting ----

  private greet(): void {
    const { world: w, e } = this;
    const home = w.actors.cols.home;
    if (home[e.a] === e.place && home[e.b] === e.place) {
      if (this.rng.float() < 0.35) this.line(e.a, 'greet.home');
      return;
    }
    const r = w.relations.row(e.a, e.b);
    const known = r >= 0 && w.relations.t.cols.familiarity[r] >= 0.2;
    if (this.rng.float() < 0.85) this.line(e.a, known ? 'greet.known' : 'greet.stranger');
    const rb = w.relations.row(e.b, e.a);
    const knownB = rb >= 0 && w.relations.t.cols.familiarity[rb] >= 0.2;
    if (this.x.lines.length && this.rng.float() < 0.8) this.line(e.b, knownB ? 'greet.reply.known' : 'greet.reply.stranger');
  }

  private part(): void {
    const { e } = this;
    if (this.x.lines.length === 0 || this.rng.float() < 0.3) return;
    const who = this.rng.float() < 0.5 ? e.a : e.b;
    const night = minuteOfDay(this.world.clock) >= 21 * 60 || minuteOfDay(this.world.clock) < 4 * 60;
    if (this.world.actors.cols.home[e.a] === e.place && this.world.actors.cols.home[e.b] === e.place && !night) return;
    this.line(who, night ? 'part.night' : 'part');
    if (this.rng.float() < 0.7) this.line(this.other(who), night ? 'part.night' : 'part.reply');
  }

  // ---- news ----

  private news(teller: ActorId, listener: ActorId, f: Fact): void {
    const w = this.world, rng = this.rng;
    this.as(teller);
    const lv = this.voice(listener);
    this.x.lines.push({ speaker: teller, text: say(w, f, teller, listener, { rng, memory: this.memory, discourse: this.d }), fact: f.id });
    const tone = toneOf(f);
    const c = w.knowledge.beliefs.cols;
    const r = beliefAbout(w, listener, f.id);
    const held = r >= 0 ? w.knowledge.facts[c.fact[r]] : null;
    const self = isAbout(f, teller);

    // They hold another version of the story: the distortion shows as an argument.
    if (held && held.id !== f.id) {
      this.line(listener, 'disagree');
      if (held.subject === f.subject && held.object === f.object && held.place === f.place) {
        // Only the size differs: one of them heard it bigger.
        this.line(listener, held.magnitude > f.magnitude ? 'disagree.worse' : 'disagree.milder');
      } else {
        this.as(listener);
        const theirs = clause(w, held, this.d, this.ctx(listener), lv);
        const src = c.source[r] >= 0 && c.source[r] !== teller ? refer(w, c.source[r], this.d, 'subj', lv) : undefined;
        this.line(listener, 'disagree.mine', { fact: theirs, src });
      }
      this.line(teller, 'disagree.back');
      return;
    }
    if (r >= 0 && c.heardAt[r] < w.clock) { this.line(listener, 'react.knew'); return; }

    const subjectSlots = this.aboutSlots(listener, f);
    const family = f.subject >= 0 && f.subject !== teller ? tie(w, listener, f.subject) : null;
    if (self) {
      this.line(listener, tone === 'good' ? 'react.self.good' : tone === 'tragic' || tone === 'sad' || tone === 'bad' || tone === 'crime' ? 'react.self.bad' : 'react.news', subjectSlots);
    } else if (family && isFamilyTie(family) && (tone !== 'news' && tone !== 'event' && tone !== 'politics')) {
      const word = kinWord(w, f.subject, family, lv, rng) ?? 'family';
      this.line(listener, tone === 'good' ? 'react.family.good' : tone === 'scandal' ? 'react.family.scandal' : 'react.family.bad', { ...subjectSlots, tie: word });
    } else if (lv.sceptic > 0.55 && r >= 0 && c.confidence[r] < 0.55 && rng.float() < 0.7) {
      this.line(listener, 'react.sceptic', subjectSlots);
      this.sourceAnswer(teller, f);
    } else {
      this.line(listener, this.reaction(listener, lv, tone, f), subjectSlots);
      if (lv.gossip > 0.6 && !self && rng.float() < 0.3) {
        this.line(listener, 'ask.source');
        this.sourceAnswer(teller, f);
      }
    }
    if (f.secret && rng.float() < 0.6) {
      this.line(teller, 'secret.close');
      if (rng.float() < 0.6) this.line(listener, 'secret.reply');
    }
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
    this.as(listener);
    const r = this.world.relations.row(listener, s);
    const known = (r >= 0 && this.world.relations.t.cols.familiarity[r] >= 0.15) || this.d.mentioned(s);
    return {
      who: known ? firstName(this.world, s) : undefined,
      pro: pronoun(this.world, s, 'subj'), Pro: capital(pronoun(this.world, s, 'subj')), pro_obj: pronoun(this.world, s, 'obj'), is: 'is',
    };
  }

  /** The teller says where they had it from. */
  private sourceAnswer(teller: ActorId, f: Fact): void {
    const w = this.world;
    const r = beliefAbout(w, teller, f.id);
    const src = r >= 0 ? w.knowledge.beliefs.cols.source[r] : -1;
    if (src === SOURCE_WITNESSED) { this.line(teller, 'answer.witnessed'); return; }
    if (src >= 0 && (src === f.subject || src === f.object)) {
      this.line(teller, 'answer.source.self', { Pro: capital(pronoun(w, src, 'subj')), pro: pronoun(w, src, 'subj'), self: w.actors.cols.sex[src] === 0 ? 'herself' : 'himself' });
      return;
    }
    if (src >= 0 && src !== this.other(teller) && !(f.secret && this.rng.float() < 0.5)) {
      this.as(teller);
      const np = refer(w, src, this.d, 'subj', this.voice(teller));
      this.line(teller, 'answer.source', { src: np, src_o: objectForm(np) });
      return;
    }
    this.line(teller, 'answer.source.vague');
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
    const add = (weight: number, f: () => void) => { if (weight > 0) out.push({ weight, say: f }); };

    // The weather now.
    const wx = weatherAt(w);
    const kind: ActName = isFoul(wx) ? (wx.snow > wx.rain ? 'weather.snow' : 'weather.storm')
      : wx.precip > 0.08 ? (wx.snow > wx.rain ? 'weather.snow' : wx.precip > 0.3 ? 'weather.rain' : 'weather.drizzle')
        : wx.ice ? 'weather.ice' : wx.fog > 0.55 ? 'weather.fog' : isHot(wx) ? 'weather.hot' : isCold(wx) ? 'weather.cold'
          : isNiceOut(wx) ? 'weather.nice' : wx.wind > 0.7 ? 'weather.windy' : wx.cover > 0.75 ? 'weather.grey' : 'weather.mild';
    const notable = kind !== 'weather.mild' && kind !== 'weather.grey';
    add(notable ? 1.6 : 0.7, () => {
      this.line(a, kind);
      const bad = kind !== 'weather.nice' && kind !== 'weather.mild';
      this.line(b, !bad ? 'weather.reply.nice' : this.voice(b).warmth > 0.65 && rng.float() < 0.4 ? 'weather.reply.bright' : 'weather.reply.agree');
      if (this.voice(a).verbosity > 0.6 && rng.float() < 0.4) this.line(a, 'weather.forecast');
    });

    // A holiday today.
    const hol = holidayOn(w, w.clock);
    const holAct = hol ? HOLIDAY_ACT[hol.kind] : undefined;
    if (holAct) add(3, () => {
      this.line(a, holAct);
      this.line(b, holAct === 'holiday.christmas' || holAct === 'holiday.newYear' || holAct === 'holiday.easter' ? 'holiday.reply' : 'occasion.yes');
    });

    // What is on in town in the next days.
    const occ = this.upcoming(b);
    if (occ) add(occ.id < 0 ? 0.35 : 1.5, () => {
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
    });

    // Local lore.
    const lore = this.lore(a);
    // Worth telling when not everyone knows it, or when it matters.
    if (lore) add((0.3 + 0.5 * this.voice(a).verbosity) * (0.2 + lore.salience * 1.5) * (1.6 - lore.share), () => {
      this.line(a, 'lore', { lore: lowerStart(bare(lore.text)) }, true);
      this.line(b, 'lore.reply');
    });

    // How they feel.
    const needs = w.actors.cols.needs, mood = w.actors.cols.mood;
    if (needs[a * NEED_COUNT + N_REST] < 0.35) add(1.2, () => { this.line(a, 'tired'); this.line(b, 'tired.reply'); });
    if (needs[a * NEED_COUNT + N_FOOD] < 0.3) add(1, () => { this.line(a, 'hungry'); this.line(b, 'hungry.reply'); });
    if (mood[a] < -0.3) add(0.8, () => { this.line(a, 'mood.low'); this.line(b, this.voice(b).warmth > 0.4 ? 'mood.low.reply' : 'place.reply'); });
    else if (mood[a] > 0.5) add(0.4, () => { this.line(a, 'mood.high'); this.line(b, 'mood.high.reply'); });

    // Work or school, when they know each other a little.
    const r = w.relations.row(a, b);
    const known = r >= 0 ? w.relations.t.cols.familiarity[r] : 0;
    const job = jobOf(w, b);
    if (known > 0.2 && job && job.place >= 0 && job.place !== e.place) add(0.7, () => {
      this.as(a);
      this.line(a, 'work.ask', { work: placeName(w, job.place, this.d) });
      this.line(b, 'work.reply');
    });
    else if (known > 0.15 && ageOf(w, b) < 19 && ageOf(w, a) >= 19 && w.people.cols.school[w.actors.cols.row[b]] >= 0) add(0.6, () => {
      this.line(a, 'school.ask');
      this.line(b, 'school.reply');
    });

    // Asking after the family.
    const kin = this.kinToAskAbout(a, b);
    if (kin >= 0) add(0.8, () => {
      this.as(a);
      const np = refer(w, kin, this.d, 'obj', this.voice(a));
      this.line(a, 'family.ask', { kin: np });
      const pro = capital(pronoun(w, kin, 'subj'));
      const ill = w.actors.cols.health[kin] < 0.5;
      this.line(b, ill ? 'family.reply.ill' : 'family.reply', { Pro: pro, is: 'is' });
    });

    // The place they are in.
    const act = e.place >= 0 ? PLACE_ACT[w.graph.places[e.place].kind] : undefined;
    if (act) add(0.7, () => { this.line(a, act); this.line(b, act === 'place.pub' ? 'place.pub.reply' : 'place.reply'); });
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

const PLACE_ACT: Partial<Record<string, ActName>> = {
  pub: 'place.pub', cafe: 'place.cafe', bakery: 'place.bakery', supermarket: 'place.shop', shop: 'place.shop', grocer: 'place.shop',
  church: 'place.church', park: 'place.park', school: 'place.school', kindergarten: 'place.school', doctor: 'place.doctor',
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
