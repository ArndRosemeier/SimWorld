import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Rng } from '@futuremagic/core';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { ACTOR_ANIMAL, ACTOR_PERSON } from '../src/sim/actors';
import { addFact, beliefAbout, believe, tell, witness } from '../src/sim/knowledge';
import type { Encounter } from '../src/sim/encounters';
import { T_AGREE, T_CONSC, T_EXTRA } from '../src/sim/people';
import { firstName, isPerson, nameOf, type World } from '../src/sim/world';
import { overhear, overheard } from '../src/talk/chatter';
import { phrasings } from '../src/talk/facts';
import { contract, expand, finish, TalkMemory } from '../src/talk/grammar';
import { Discourse, realiseSlots, tie } from '../src/talk/refer';
import { say } from '../src/talk/realise';
import { inDialect, voiceOf } from '../src/talk/voice';

const fresh = () => createWorld(testTown(11, 120), 11);
const people = (w: World) => Array.from({ length: w.actors.count }, (_, i) => i).filter((i) => isPerson(w, i));
const adults = (w: World) => people(w).filter((i) => w.clock / 1440 - w.actors.cols.birth[i] > 25 * 365);
const setTrait = (w: World, id: number, t: number, v: number) => { w.people.cols.traits[w.actors.cols.row[id] * 5 + t] = v; };
const talk = (place: number, a: number, b: number, told = -1, toldBack = -1): Encounter => ({ place, a, b, kind: 'talk', told, toldBack });
/** No slot, bracket or template left in a line. */
const clean = (s: string) => !/[{}[\]]|\bundefined\b|\bnull\b|\s{2}/.test(s);

test('talk grammar: alternatives, contractions, articles and capitals', () => {
  const rng = new Rng(1);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(expand('a [b|c|d] e', rng));
  assert.deepEqual([...seen].sort(), ['a b e', 'a c e', 'a d e']);
  assert.equal(contract('I am sure he is not coming. I know who he is.'), "I'm sure he's not coming. I know who he is.");
  assert.equal(finish('a apple and a university. was it a hour?'), 'An apple and a university. Was it an hour?');
  assert.equal(finish('hello ,  you'), 'Hello, you.');
  assert.equal(finish('I heard it from Judith, the nurse,.'), 'I heard it from Judith, the nurse.');
  assert.equal(inDialect('My mum said the queue was bloody long.', 'us'), 'My mom said the line was damn long.');
});

test('talk: every story the sim tells has its words, and no slot is left in them', () => {
  // Every fact template in src/sim (dynamic parts stand in as words).
  const templates = new Set<string>();
  for (const f of fs.readdirSync('src/sim')) {
    if (!f.endsWith('.ts')) continue;
    const src = fs.readFileSync(`src/sim/${f}`, 'utf8');
    for (const m of src.matchAll(/text: (['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const t = m[2].replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, 'Willow Club');
      if (/\{(subject|object|place)\}/.test(t)) templates.add(t);
    }
  }
  assert.ok(templates.size >= 30, `found ${templates.size} templates`);
  const w = fresh();
  const [s, o, sp, li] = adults(w);
  const d = new Discourse(sp, li, new Rng(5));
  for (const t of templates) {
    const ph = phrasings({ id: 0, topic: 'event', subject: s, object: o, place: 0, time: 0, magnitude: 0.5, text: t, secret: false, root: 0, parent: -1, originator: -1, truth: true });
    assert.ok(ph.lines.length >= 1, t);
    for (const l of ph.lines) {
      const out = expand(realiseSlots(w, l, s, o, 0, d, null), d.rng);
      assert.ok(clean(out) && !/\{|subject|object/.test(out), `${t} → ${out}`);
    }
  }
});

test('talk: the news line names people for this listener: "my sister", "you", "he"', () => {
  const w = fresh();
  const all = people(w);
  // A speaker with a sibling, a listener who does not know the sibling.
  let sp = -1, sib = -1;
  for (const x of adults(w)) {
    const y = all.find((p) => p !== x && tie(w, x, p) === 'sibling');
    if (y !== undefined) { sp = x; sib = y; break; }
  }
  assert.ok(sp >= 0, 'a town has siblings');
  const li = adults(w).find((p) => p !== sp && p !== sib && w.relations.row(p, sib) < 0)!;
  const bakery = w.graph.places.find((p) => p.kind === 'bakery')!.id;
  const f = addFact(w, { topic: 'job', subject: sib, place: bakery, text: '{subject} lost their job at {place}', magnitude: 0.6 });
  witness(w, f, [sp]);
    let mine = 0;
  for (let k = 0; k < 20; k++) {
    const text = say(w, f, sp, li, { rng: new Rng(k) });
    assert.ok(clean(text), text);
    const kinned = /my (little )?(sister|brother)/i.test(text);
    assert.ok(!text.includes(firstName(w, sib)) || kinned, `a stranger is not told the first name alone: ${text}`);
    if (kinned) mine++;
  }
  assert.ok(mine >= 15, `the speaker calls their sibling that (${mine}/20)`);
  // About the speaker themself: "I", no hedge.
  const g = addFact(w, { topic: 'job', subject: sp, place: 0, text: '{subject} got a job at {place}', magnitude: 0.4 });
  witness(w, g, [sp]);
  const self = say(w, g, sp, li, { rng: new Rng(3) });
  assert.match(self, /\bI\b|\bI'm\b|\bI've\b|\bme\b|\bmy\b/, self);
  assert.ok(!/apparently|rumour|told me/i.test(self), self);
  // Deterministic.
  assert.equal(say(w, f, sp, li, { rng: new Rng(9) }), say(w, f, sp, li, { rng: new Rng(9) }));
});

test('talk: the same story comes out in many ways, and hedged by how it was heard', () => {
  const w = fresh();
  const ps = adults(w);
  const subj = ps[0];
  const f = addFact(w, { topic: 'romance', subject: subj, object: ps[1], text: '{subject} is going out with {object}', magnitude: 0.55 });
  witness(w, f, [ps[2]]);
  const mem = new TalkMemory();
  const lines = new Set<string>();
  let hedged = 0;
  for (let i = 3; i < 43; i++) {
    tell(w, ps[2], ps[i], f);
    const text = say(w, f, ps[i], ps[i + 1], { rng: new Rng(i), memory: mem });
    assert.ok(clean(text), text);
    lines.add(text);
    if (/apparently|rumour|heard|told me|said|says|according|seems|saying|they say|someone said/i.test(text)) hedged++;
  }
  assert.ok(lines.size >= 36, `${lines.size} different lines of 40`);
  assert.ok(hedged >= 15, `second-hand news is often hedged (${hedged}/40)`);
});

test('talk: voices differ by age and character', () => {
  const w = fresh();
  const ps = people(w);
  const byAge = [...ps].sort((a, b) => w.actors.cols.birth[a] - w.actors.cols.birth[b]);
  const old = byAge[0], kid = byAge[byAge.length - 1];
  for (const id of [old, kid]) { setTrait(w, id, T_CONSC, 0.5); setTrait(w, id, T_EXTRA, 0.5); setTrait(w, id, T_AGREE, 0.2); }
  const vo = voiceOf(w, old), vk = voiceOf(w, kid);
  assert.equal(vk.group, 'child');
  assert.equal(vk.swear, 0, 'children do not swear');
  assert.ok(vo.formality > vk.formality + 0.2, `old ${vo.formality} vs child ${vk.formality}`);
  assert.deepEqual(voiceOf(w, old), vo, 'a voice is stable');
  const chatty = ps[5];
  setTrait(w, chatty, T_EXTRA, 1);
  const shy = ps[6];
  setTrait(w, shy, T_EXTRA, 0);
  assert.ok(voiceOf(w, chatty).verbosity > voiceOf(w, shy).verbosity + 0.4);
});

test('talk: overhearing an encounter is hearing the belief pass, answered in the listener\'s voice', () => {
  const w = fresh();
  const ps = adults(w);
  const [a, b, subj] = [ps[3], ps[4], ps[8]];
  const f = addFact(w, { topic: 'health', subject: subj, text: '{subject} is seriously ill', magnitude: 0.7 });
  witness(w, f, [a]);
  tell(w, a, b, f);
  const x = overhear(w, talk(w.actors.cols.home[a], a, b, beliefAbout(w, b, f) >= 0 ? w.knowledge.beliefs.cols.fact[beliefAbout(w, b, f)] : f), new TalkMemory())!;
  assert.ok(x, 'something is said');
  const i = x.lines.findIndex((l) => l.fact >= 0);
  assert.ok(i >= 0, 'one line carries the story');
  assert.equal(x.lines[i].speaker, a);
  assert.ok(x.lines[i + 1] && x.lines[i + 1].speaker === b, 'the listener answers');
  for (const l of x.lines) assert.ok(clean(l.text), l.text);
  // The same minute, the same words.
  assert.deepEqual(overhear(w, talk(w.actors.cols.home[a], a, b, x.lines[i].fact)), overhear(w, talk(w.actors.cols.home[a], a, b, x.lines[i].fact)));
});

test('talk: a listener who heard another version argues', () => {
  const w = fresh();
  const ps = adults(w);
  const [a, b, s1, s2] = [ps[10], ps[11], ps[12], ps[13]];
  const f = addFact(w, { topic: 'crime', subject: s1, place: 2, text: '{subject} stole from {place}', magnitude: 0.6 });
  // b heard it pinned on someone else (a distorted retelling).
  const v = addFact(w, { topic: 'crime', subject: s2, place: 2, text: '{subject} stole from {place}', magnitude: 0.6, truth: false });
  Object.assign(w.knowledge.facts[v], { root: f, parent: f });
  witness(w, f, [a]);
  believe(w, b, v, 0.9, ps[14]);
  let argued = 0;
  for (let k = 0; k < 6; k++) {
    w.clock += 1;
    const x = overhear(w, talk(5, a, b, f))!;
    const reply = x.lines.filter((l) => l.speaker === b).map((l) => l.text).join(' ');
    if (/heard|not right|mistaken|not it|no, no/i.test(reply)) argued++;
    const mention = [firstName(w, s2), nameOf(w, s2), w.actors.cols.sex[s2] === 0 ? 'she' : 'he'];
    assert.ok(x.lines.some((l) => l.speaker === b && mention.some((m) => l.text.toLowerCase().includes(m.toLowerCase())) || /someone|my |your /i.test(l.text)), `b says whom they heard it about: ${reply}`);
  }
  assert.equal(argued, 6);
});

test('talk: small talk when no news passes, and it varies', () => {
  const w = fresh();
  const ps = adults(w);
  const mem = new TalkMemory();
  const firsts = new Set<string>();
  for (let i = 0; i < 40; i++) {
    w.clock += 7;
    const [a, b] = [ps[i % ps.length], ps[(i * 7 + 3) % ps.length]];
    if (a === b) continue;
    const x = overhear(w, talk(w.actors.cols.home[a], a, b), mem);
    if (!x) continue;
    assert.ok(x.lines.every((l) => l.fact === -1 && clean(l.text)), x.lines.map((l) => l.text).join(' | '));
    firsts.add(x.lines.map((l) => l.text).join(' '));
  }
  assert.ok(firsts.size >= 30, `${firsts.size} different conversations`);
});

test('talk: snubs and animals get a line; overheard voices a whole tick', () => {
  const w = fresh();
  const ps = adults(w);
  const snub = overhear(w, { place: 3, a: ps[0], b: ps[1], kind: 'snub', told: -1, toldBack: -1 })!;
  assert.ok(snub.lines.length >= 1 && clean(snub.lines[0].text));
  const pet = Array.from({ length: w.actors.count }, (_, i) => i).find((i) => w.actors.cols.kind[i] === ACTOR_ANIMAL && w.actors.cols.alive[i]);
  if (pet !== undefined) {
    let said = 0;
    for (let k = 0; k < 10; k++) {
      w.clock++;
      const x = overhear(w, { place: 3, a: ps[0], b: pet, kind: 'animal', told: -1, toldBack: -1 });
      if (x) { said++; assert.equal(w.actors.cols.kind[x.lines[0].speaker], ACTOR_PERSON); assert.ok(clean(x.lines[0].text), x.lines[0].text); }
    }
    assert.ok(said >= 3);
  }
  w.encounters.length = 0;
  w.encounters.push(talk(4, ps[2], ps[3]), talk(4, ps[4], ps[5]));
  assert.equal(overheard(w, null, (e) => e.a === ps[4]).length, 1);
});
