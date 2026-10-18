import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { tick } from '../src/sim/world';
import { ACTOR_PERSON } from '../src/sim/actors';
import { applyProposal, PER_CONVERSATION } from '../src/sim/mind/apply';
import type { Proposal, ProposalChange } from '../src/sim/mind/proposal';
import { relation } from '../src/sim/relations';
import { addFact, beliefsOf, witness, reach } from '../src/sim/knowledge';
import { intentionsOf } from '../src/sim/intentions';
import { memoriesOf, recall } from '../src/sim/memory';
import { T_AGREE, T_CONSC, V_LOYAL } from '../src/sim/people';

const fresh = () => createWorld(testTown(5, 120), 5);
const people = (w: ReturnType<typeof fresh>) => Array.from({ length: w.actors.count }, (_, i) => i).filter((i) => w.actors.cols.kind[i] === ACTOR_PERSON);
const turn = (npc: number, partner: number, changes: ProposalChange[], conversation = 'c1'): Proposal => ({ npc, partner, conversation, changes });

test('applyProposal: "you love me now" moves affection only a little per turn and per conversation', () => {
  const w = fresh();
  const [npc, player] = people(w).slice(10, 12);
  w.relations.t.cols.affection[w.relations.ensure(npc, player)] = 0;
  w.people.cols.traits[w.actors.cols.row[npc] * 5 + T_AGREE] = 1;
  const before = 0;
  const r1 = applyProposal(w, npc, turn(npc, player, [{ kind: 'relation', toward: player, affection: 1, reason: 'told to' }]));
  assert.equal(r1[0].outcome, 'softened');
  const after1 = relation(w, npc, player)!.affection;
  assert.ok(after1 - before <= 0.15 + 1e-6);
  for (let i = 0; i < 10; i++) applyProposal(w, npc, turn(npc, player, [{ kind: 'relation', toward: player, affection: 1, reason: 'again' }]));
  assert.ok(relation(w, npc, player)!.affection - before <= PER_CONVERSATION + 1e-6);
  // A new conversation has a fresh budget.
  applyProposal(w, npc, turn(npc, player, [{ kind: 'relation', toward: player, affection: 1, reason: 'next day' }], 'c2'));
  assert.ok(relation(w, npc, player)!.affection - before > PER_CONVERSATION);
});

test('applyProposal: references to people or places that do not exist are rejected', () => {
  const w = fresh();
  const [npc, player] = people(w).slice(10, 12);
  const res = applyProposal(w, npc, turn(npc, player, [
    { kind: 'relation', toward: 999999, trust: 0.1, reason: '' },
    { kind: 'intention', intention: 'go', place: 99999, reason: '' },
    { kind: 'intention', intention: 'meet', reason: 'no person' },
  ]));
  assert.deepEqual(res.map((r) => r.outcome), ['rejected', 'rejected', 'rejected']);
  assert.equal(w.mind.log.length, 3);
});

test('applyProposal: a claim becomes a belief sourced to the partner, weighted by trust, and can spread', () => {
  const w = fresh();
  const [npc, player, subject] = people(w).slice(10, 13);
  w.relations.t.cols.trust[w.relations.ensure(npc, player)] = 0.9;
  const res = applyProposal(w, npc, turn(npc, player, [{ kind: 'belief', claim: { text: 'the mayor is selling the park', about: subject, topic: 'politics', secret: false }, plausibility: 0.8 }]));
  assert.equal(res[0].outcome === 'rejected', false);
  const b = beliefsOf(w, npc).find((x) => x.fact.text === 'the mayor is selling the park')!;
  assert.equal(b.source, player);
  assert.equal(b.fact.truth, false);
  assert.ok(b.confidence > 0.5);
  assert.ok(recall(w, npc, { text: 'what about the park?' })[0].summary.includes('park'));
  tick(w, 1440);
  assert.ok(reach(w, b.fact.root).any >= 2, 'the NPC passed it on');
});

test('applyProposal: a promised secret and family loyalty gate "tell" intentions', () => {
  const w = fresh();
  const ps = people(w);
  const npc = ps[10], player = ps[11], gossip = ps[12];
  const fam = w.relations.known(npc).map((r) => w.relations.t.cols.to[r]).find((o) => w.relations.isFamily(npc, o) && w.actors.cols.kind[o] === ACTOR_PERSON);
  assert.ok(fam !== undefined, 'npc has family');
  w.people.cols.values[w.actors.cols.row[npc] * 4 + V_LOYAL] = 0.9;
  w.relations.t.cols.trust[w.relations.ensure(npc, gossip)] = 0.2;
  const f = addFact(w, { topic: 'health', subject: fam, text: '{subject} is in debt', magnitude: 0.6 });
  witness(w, f, [npc]);
  const res = applyProposal(w, npc, turn(npc, player, [{ kind: 'intention', intention: 'tell', person: gossip, claimText: 'is in debt', reason: 'asked' }]));
  assert.equal(res[0].outcome, 'rejected');
  assert.match(res[0].note, /loyalty/);
  // Someone they trust may hear it.
  w.relations.t.cols.trust[w.relations.ensure(npc, gossip)] = 0.9;
  const ok = applyProposal(w, npc, turn(npc, player, [{ kind: 'intention', intention: 'tell', person: gossip, claimText: 'is in debt', reason: 'asked' }], 'c2'));
  assert.equal(ok[0].outcome, 'applied');
  assert.equal(intentionsOf(w, npc)[0].fact, f);
});

test('applyProposal: a lie becomes a false story the partner believes; speculation stays a memory', () => {
  const w = fresh();
  const [npc, player, victim] = people(w).slice(40, 43);
  w.relations.t.cols.trust[w.relations.ensure(player, npc)] = 0.8;
  const res = applyProposal(w, npc, turn(npc, player, [
    { kind: 'utterance', claim: { text: 'the baker waters down the milk', about: victim, topic: 'business', secret: false }, form: 'lie' },
    { kind: 'utterance', claim: { text: 'the pool will close', topic: 'politics', secret: false }, form: 'speculation' },
  ]));
  assert.deepEqual(res.map((r) => r.outcome), ['applied', 'applied']);
  const heard = beliefsOf(w, player).find((b) => b.fact.text === 'the baker waters down the milk')!;
  assert.equal(heard.source, npc);
  assert.equal(heard.fact.truth, false);
  assert.equal(heard.fact.originator, npc);
  assert.ok(!beliefsOf(w, npc).some((b) => b.fact.text.includes('milk')), 'the liar does not believe it');
  assert.ok(!w.knowledge.facts.some((f) => f.text === 'the pool will close'), 'speculation is not a fact');
  assert.ok(memoriesOf(w, npc).some((m) => m.summary.includes('pool')));
});

test('applyProposal: quitting is carried out (after notice for conscientious people) and the town hears of it', () => {
  const w = fresh();
  const worker = people(w).find((id) => w.people.cols.job[w.actors.cols.row[id]] >= 0)!;
  const p = w.actors.cols.row[worker];
  w.people.cols.traits[p * 5 + T_CONSC] = 0.9;
  w.people.cols.traits[p * 5 + T_AGREE] = 0.5;
  const job = w.jobs[w.people.cols.job[p]];
  const res = applyProposal(w, worker, turn(worker, people(w)[0], [{ kind: 'intention', intention: 'quitJob', reason: 'fed up with the boss' }]));
  assert.equal(res[0].outcome, 'softened');
  assert.match(res[0].note, /notice/);
  tick(w, 1440 + 180);
  assert.equal(w.people.cols.job[p], -1);
  assert.equal(job.holder, -1);
  assert.ok(memoriesOf(w, worker).some((m) => m.summary.includes('quit my job')));
  assert.ok(beliefsOf(w, worker).some((b) => b.fact.topic === 'job' && b.fact.subject === worker));
});

test('applyProposal: "meet me at the café at five" sends the NPC there and the meeting happens', () => {
  const w = fresh();
  const [npc, player] = people(w).slice(30, 32);
  const cafe = w.graph.places.find((pl) => pl.kind === 'cafe')!.id;
  const at = Math.floor(w.clock / 1440) * 1440 + 17 * 60 - 60; // 16:00 (cafés close at 19:00)
  applyProposal(w, npc, turn(npc, player, [{ kind: 'intention', intention: 'meet', person: player, place: cafe, at, reason: 'promised' }]));
  // The player's character turns up too.
  applyProposal(w, player, turn(player, npc, [{ kind: 'intention', intention: 'meet', person: npc, place: cafe, at, reason: 'promised' }]));
  tick(w, at - w.clock + 40);
  assert.ok(memoriesOf(w, npc).some((m) => m.summary.startsWith('met ')), 'they met');
  assert.equal(intentionsOf(w, npc).length, 0);
});
