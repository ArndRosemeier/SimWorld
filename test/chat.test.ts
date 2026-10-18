import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { ACTOR_PERSON, A } from '../src/sim/actors';
import { addFact, beliefAbout, believe, witness } from '../src/sim/knowledge';
import { memoriesOf } from '../src/sim/memory';
import { chatOp, TALK_MIN_AGE } from '../src/chat/ops';
import { ageOf } from '../src/sim/world';
import { chatContext } from '../src/chat/context';
import { stopToTalk } from '../src/sim/mind/chat';
import type { Turn } from '../src/llm';

// One small town for the whole file: chats are cheap, worlds are not.
const w = createWorld(testTown(11, 120), 11);
const people = Array.from({ length: w.actors.count }, (_, i) => i).filter((i) => w.actors.cols.kind[i] === ACTOR_PERSON);
const [npc, player, other, third] = people.slice(30, 34);
const ask = (text: string): Turn[] => [{ speaker: 'partner', text }];

test('chat: the prompt holds only what the NPC believes; a promised secret stays out unless they trust you deeply', () => {
  const theirs = addFact(w, { topic: 'job', subject: other, text: '{subject} found a new job at the bakery', magnitude: 0.6 });
  const notTheirs = addFact(w, { topic: 'crime', subject: third, text: '{subject} was seen breaking into the garage', magnitude: 0.8 });
  witness(w, theirs, [npc]);
  witness(w, notTheirs, [player]);
  const secret = addFact(w, { topic: 'romance', subject: third, text: '{subject} is secretly courting the mayor', magnitude: 0.7, secret: true });
  w.knowledge.beliefs.cols.flags[believe(w, npc, secret, 0.9, other)] |= 1; // told under "don't tell anyone"

  const texts = (trust: number) => {
    w.relations.t.cols.trust[w.relations.ensure(npc, player)] = trust;
    return chatContext(w, npc, player, 'c0', ask('Any news about the town?')).input.beliefs.map((b) => b.text).join('\n');
  };
  const wary = texts(0.3);
  assert.match(wary, /new job at the bakery/);
  assert.doesNotMatch(wary, /breaking into the garage/, 'what only the player knows never reaches the NPC');
  assert.doesNotMatch(wary, /courting the mayor/, 'a promised secret is kept from someone they hardly trust');
  assert.match(texts(0.95), /courting the mayor.*in confidence/);
});

test('chat: the procedural reply is stable per line and passes news on into the partner\'s beliefs', () => {
  const news = addFact(w, { topic: 'other', subject: other, text: '{subject} is moving to the city next month', magnitude: 0.9 });
  witness(w, news, [npc]);
  const turns = ask('Any news?');
  const a = chatOp(w, { op: 'procedural', npc, player, conversation: 'c1', turns });
  const b = chatOp(w, { op: 'procedural', npc, player, conversation: 'c1', turns });
  assert.ok(a.op === 'procedural' && b.op === 'procedural');
  assert.ok(a.reply.length > 0);
  assert.equal(a.reply, b.reply);
  // Whatever they voice from what they hold, the partner now has a version of it.
  const said = chatOp(w, { op: 'said', npc, player, reply: `Did you hear? ${a.input.beliefs.find((x) => /moving to the city/.test(x.text))?.text ?? ''}`, offered: a.offered });
  assert.ok(said.op === 'said' && said.told.some((t) => /moving to the city/.test(t)), JSON.stringify(said));
  assert.ok(beliefAbout(w, player, news) >= 0);
});

test('chat: a walker stops to talk, and both remember the talk once it ends', () => {
  const a = w.actors.cols;
  a.dest[npc] = a.home[npc];
  const start = chatOp(w, { op: 'start', npc, player });
  assert.ok(start.op === 'start' && start.header && start.header.player === player);
  assert.equal(a.dest[npc], -1);
  assert.equal(a.activity[npc], A.socialize);
  stopToTalk(w, npc, 5);
  const before = [memoriesOf(w, npc).length, memoriesOf(w, player).length];
  chatOp(w, { op: 'end', npc, player, conversation: 'c2', minutes: 6, told: ['Tom is moving'], npcMemory: { summary: 'chatted about Tom moving away', importance: 0.4 } });
  assert.equal(memoriesOf(w, npc).length, before[0] + 1);
  assert.equal(memoriesOf(w, player).length, before[1] + 1);
  assert.match(memoriesOf(w, player).at(-1)!.summary, /Tom is moving/);
});

test('chat: nobody holds a conversation with a toddler', () => {
  const tot = people.find((id) => ageOf(w, id) < TALK_MIN_AGE);
  if (tot === undefined) return;
  const r = chatOp(w, { op: 'start', npc: tot, player });
  assert.ok(r.op === 'start' && r.header === null);
});
