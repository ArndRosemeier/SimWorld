import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { tick } from '../src/sim/world';
import { ACTOR_PERSON } from '../src/sim/actors';
import { addFact, beliefAbout, beliefsOf, forget, reach, tell, witness, SOURCE_WITNESSED, exchange } from '../src/sim/knowledge';
import { T_CONSC, T_OPEN } from '../src/sim/people';

const fresh = () => createWorld(testTown(11, 120), 11);
const personsOf = (w: ReturnType<typeof fresh>) => Array.from({ length: w.actors.count }, (_, i) => i).filter((i) => w.actors.cols.kind[i] === ACTOR_PERSON);
const setTrust = (w: ReturnType<typeof fresh>, a: number, b: number, trust: number) => { w.relations.t.cols.trust[w.relations.ensure(a, b)] = trust; };

test('knowledge: witnesses are certain; being told is as sure as the teller × trust', () => {
  const w = fresh();
  const [x, y, z] = personsOf(w).slice(10, 13);
  const f = addFact(w, { topic: 'crime', subject: z, text: '{subject} stole a bike', magnitude: 0.5 });
  witness(w, f, [x]);
  assert.equal(beliefsOf(w, x)[0].source, SOURCE_WITNESSED);
  assert.equal(beliefsOf(w, x)[0].confidence, 1);
  setTrust(w, y, x, 0.9);
  setTrust(w, z, x, 0.1);
  // Make the teller careful so the story does not mutate on the way.
  w.people.cols.traits[w.actors.cols.row[x] * 5 + T_CONSC] = 1;
  w.people.cols.traits[w.actors.cols.row[x] * 5 + T_OPEN] = 0;
  tell(w, x, y, f);
  const others = personsOf(w).filter((p) => p !== x && p !== y && p !== z);
  setTrust(w, others[0], x, 0.1);
  tell(w, x, others[0], f);
  const cy = w.knowledge.beliefs.cols.confidence[beliefAbout(w, y, f)];
  const co = w.knowledge.beliefs.cols.confidence[beliefAbout(w, others[0], f)];
  assert.ok(cy > co + 0.3, `trusted ${cy} vs distrusted ${co}`);
  assert.equal(beliefsOf(w, y)[0].source, x);
});

test('knowledge: one version per story; a stronger competing version wins, a weaker one only adds doubt', () => {
  const w = fresh();
  const [x, y, l] = personsOf(w).slice(20, 23);
  const f = addFact(w, { topic: 'job', subject: x, text: '{subject} lost their job', magnitude: 0.5 });
  const v = w.knowledge.facts.length;
  w.knowledge.facts.push({ ...w.knowledge.facts[f], id: v, parent: f, truth: false, magnitude: 0.9 });
  witness(w, f, [x]);
  witness(w, v, [y]); // y "saw" the exaggerated version
  setTrust(w, l, y, 0.2);
  setTrust(w, l, x, 0.95);
  tell(w, y, l, v);
  const r = beliefAbout(w, l, f);
  assert.equal(w.knowledge.beliefs.cols.fact[r], v);
  tell(w, x, l, f);
  assert.equal(w.knowledge.beliefs.cols.fact[r], f, 'the trusted eyewitness corrects the rumour');
  assert.equal(w.knowledge.byHolder[l].length, 1);
});

test('knowledge: secrets only go to people the teller trusts', () => {
  const w = fresh();
  const [x, near, far] = personsOf(w).slice(30, 33);
  const f = addFact(w, { topic: 'romance', subject: x, text: '{subject} is seeing someone', secret: true, magnitude: 0.9 });
  const teller = personsOf(w)[40];
  witness(w, f, [teller]);
  setTrust(w, teller, far, 0.2);
  setTrust(w, teller, near, 0.95);
  const always = { float: () => 0 }; // every roll succeeds
  assert.equal(exchange(w, teller, far, 2, always), -1);
  assert.ok(exchange(w, teller, near, 2, always) >= 0);
  assert.ok(beliefsOf(w, near)[0].promised, 'told under "don\'t tell anyone"');
});

test('knowledge: unimportant news is forgotten, news about yourself is not', () => {
  const w = fresh();
  const [x, y] = personsOf(w).slice(50, 52);
  const dull = addFact(w, { topic: 'business', text: 'the bakery changed its opening hours', magnitude: 0 });
  const mine = addFact(w, { topic: 'health', subject: x, text: '{subject} has a cold', magnitude: 0 });
  witness(w, dull, [x, y]);
  witness(w, mine, [x]);
  w.knowledge.beliefs.cols.source[beliefAbout(w, y, dull)] = 99; // heard, not seen
  for (let d = 0; d < 30; d++) forget(w);
  assert.equal(beliefAbout(w, y, dull), -1);
  assert.ok(beliefAbout(w, x, mine) >= 0);
});

test('knowledge: a juicy story spreads through a town in two days, and some retellings distort it', () => {
  // 200 people (a seed where the story travels well), so it runs quickly and enough retellings happen that a
  // distortion is all but certain.
  const w = createWorld(testTown(9, 200), 9);
  const ps = personsOf(w);
  const f = addFact(w, { topic: 'crime', subject: ps[5], place: 3, text: '{subject} was arrested at {place}', magnitude: 0.8 });
  witness(w, f, [ps[60], ps[61]]);
  tick(w, 2 * 1440);
  const { any } = reach(w, f);
  assert.ok(any >= 15, `reached ${any} of ${ps.length}`);
  const variants = w.knowledge.facts.filter((x) => x.root === f && !x.truth).length;
  assert.ok(variants >= 1, 'retold stories drift');
});
