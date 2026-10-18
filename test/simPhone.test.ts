import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { createWorld } from '../src/sim/synth';
import { testTown } from '../src/sim/testTown';
import { call, phoneCalls } from '../src/sim/phone';
import { addFact, beliefsOf, witness } from '../src/sim/knowledge';
import { bondBit, FAMILY_MASK } from '../src/sim/relations';
import { householdOf, isPerson } from '../src/sim/world';
import { A } from '../src/sim/actors';

test('phone: in the evening people call family and friends elsewhere, never strangers, and news goes down the line', () => {
  const w = createWorld(testTown(51, 600), 51);
  const a = w.actors.cols, c = w.relations.t.cols;
  for (let id = 0; id < w.actors.count; id++) if (a.alive[id]) a.activity[id] = A.idle;
  w.clock = 3 * 60;
  assert.equal(phoneCalls(w), 0, 'calls at 3 am');
  w.clock = 19 * 60;
  const before = Float64Array.from({ length: w.relations.t.count }, (_, r) => c.lastMet[r]);
  const n = phoneCalls(w);
  assert.ok(n > 20, `${n} calls at 7 pm`);
  for (let r = 0; r < w.relations.t.count; r++) {
    if (c.lastMet[r] === before[r]) continue;
    assert.ok((c.bonds[r] & (FAMILY_MASK | bondBit('friend'))) || (c.affection[r] > 0.45 && c.familiarity[r] > 0.55), 'called someone not close');
  }
  // A mother tells her son, who lives elsewhere, what she saw.
  const persons = Array.from({ length: w.actors.count }, (_, i) => i).filter((i) => isPerson(w, i));
  const mum = persons.find((p) => persons.some((q) => w.relations.has(p, q, 'child') && householdOf(w, q) !== householdOf(w, p)))!;
  const son = persons.find((q) => w.relations.has(mum, q, 'child') && householdOf(w, q) !== householdOf(w, mum))!;
  const story = addFact(w, { topic: 'crime', subject: persons[3], text: '{subject} was arrested', magnitude: 0.9 });
  witness(w, story, [mum]);
  const rng = new Rng(3);
  let calls = 0;
  while (!beliefsOf(w, son).some((b) => b.fact.root === story) && calls < 30) { call(w, mum, son, rng); calls++; }
  assert.ok(calls < 30, 'the son never heard');
});
