import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechMessages, refsFor, parseAppraisal, cleanSpeech, TASKS, APPRAISAL_SCHEMA } from '../src/llm';
import { replyContains } from '../src/llm/appraisal';
import { bakeryScene, RUTH, TOM, ANNA, BAKERY, FOUNTAIN } from './fixtures/llm/town';

test('speech prompt: stable head first, per-turn note on the newest line, roles alternate', () => {
  const a = bakeryScene();
  const b = { ...bakeryScene(), turns: [...a.turns, { speaker: 'npc' as const, text: 'Says who?' }, { speaker: 'partner' as const, text: 'Everyone at the pub.' }], memories: [{ when: 'years ago', summary: 'The mill nearly closed once before.' }] };
  const ma = speechMessages(a);
  const mb = speechMessages(b);
  assert.deepEqual(ma.slice(0, 2), mb.slice(0, 2), 'rules and card are identical across turns (cacheable prefix)');
  assert.deepEqual(mb.map((m) => m.role), ['system', 'system', 'user', 'assistant', 'user']);
  assert.equal(mb[2].content, 'Morning, Ruth! Did you hear the mill is closing?', 'older turns carry no stage note');
  assert.match(mb[4].content, /^\[Not spoken\. Saturday 07:40, at Keller's Bakery \[L1\]/);
  assert.match(mb[4].content, /The mill nearly closed once before\.\]\n\nEveryone at the pub\.$/);
  assert.throws(() => speechMessages({ ...a, turns: [{ speaker: 'npc', text: 'hi' }] }));
});

test('speech prompt: the epistemic firewall holds: only the NPC\'s own beliefs, people and places appear', () => {
  const card = speechMessages(bakeryScene())[1].content;
  assert.match(card, /You are Ruth Keller \[P1\], 52, woman, baker/);
  assert.match(card, /Tom Brandt \[P2\], your customer\. Tom Brandt is someone you know well\. You like them, mostly trust them and respect them\./);
  assert.match(card, /Anna Keller \[P3\] \(your sister\): someone you know intimately\. You are fond of them, completely trust them and admire them\./);
  assert.match(card, /- Anna Keller is looking for a new flat \(you are sure; heard from Anna Keller \[P3\]\)/);
  assert.match(card, /the market fountain \[L2\], square/);
  // Nothing about the mill closing is in Ruth's prompt except Tom's line: she has no belief about it.
  assert.doesNotMatch(card, /mill is closing/i);
});

test('refs: stable order, case-insensitive resolve, unknown refs resolve to nothing', () => {
  const r = refsFor(bakeryScene());
  assert.deepEqual([r.person(RUTH), r.person(TOM), r.person(ANNA), r.place(BAKERY), r.place(FOUNTAIN)], ['P1', 'P2', 'P3', 'L1', 'L2']);
  assert.deepEqual(r.resolve('p3'), { kind: 'person', id: ANNA });
  assert.equal(r.resolve('P9'), undefined);
});

const reply = "Closing? Says who? *wipes hands* Look, love, I'll ask Anna tonight, she cleans for the Brandts. Meet me at the fountain at five and I'll tell you.";
const input = { context: bakeryScene(), reply };

test('appraisal: refs become ids, the partner is the belief source, zero steps and unknown refs are dropped', () => {
  const json = JSON.stringify({
    relations: [{ toward: 'P2', trust: -1, affection: 0, respect: null, reason: 'spreads gossip' }, { toward: 'P3', trust: 0, affection: 0, respect: 0, reason: 'nothing' }, { toward: 'P1', trust: 1, affection: null, respect: null, reason: 'self' }],
    emotion: { kind: 'surprise', intensity: 2, toward: null },
    beliefs: [{ claim: 'The mill is closing', about: ['P7'], stance: 'doubts' }],
    utterances: [{ claim: '[P3] cleans for the Brandts', about: ['[P3]'], kind: 'lie' }],
    intentions: [
      { kind: 'meet', person: 'P2', place: 'L2', topic: null, item: null, when: { in_minutes: null, clock: '17:00', day: 0 }, quote: "Meet me at the fountain at five" },
      { kind: 'tell', person: 'P3', place: null, topic: 'the mill', item: null, when: null, quote: 'I will tell Anna everything' },
      { kind: 'fly', person: null, place: null, topic: null, item: null, when: null, quote: 'x' },
    ],
    memory: { summary: 'Tom said the mill is closing.', importance: 14 },
    end_conversation: null,
  });
  const { proposal, dropped } = parseAppraisal('```json\n' + json + '\n```', input, refsFor(input.context));
  assert.deepEqual(proposal.relations, [{ toward: TOM, trust: -1, reason: 'spreads gossip' }]);
  assert.deepEqual(proposal.emotion, { kind: 'surprise', intensity: 2 });
  assert.deepEqual(proposal.beliefs, [{ claim: 'The mill is closing', about: { people: [], places: [] }, source: TOM, stance: 'doubts' }]);
  assert.deepEqual(proposal.utterances[0].about, { people: [ANNA], places: [] });
  assert.deepEqual(proposal.intentions, [{ kind: 'meet', person: TOM, place: FOUNTAIN, when: { clock: '17:00', day: 0 }, quote: 'Meet me at the fountain at five' }]);
  assert.deepEqual(proposal.memory, { summary: 'Tom said the mill is closing.', importance: 10 });
  assert.equal(proposal.endConversation, undefined);
  assert.deepEqual([proposal.npc, proposal.partner], [RUTH, TOM]);
  assert.deepEqual(dropped.map((d) => d.split(':')[0]), ['relation', 'belief', 'intention tell', 'intention']);
  assert.match(dropped[2], /quote not found in the reply/);
  assert.throws(() => parseAppraisal('sorry, I cannot', input, refsFor(input.context)));
});

test('appraisal: the schema is strict-mode valid (every property required, no extras), and the prompt shows the reply as the last line', () => {
  const check = (s: Record<string, unknown>, path: string): void => {
    if (s.anyOf) return (s.anyOf as Record<string, unknown>[]).forEach((x, i) => check(x, `${path}|${i}`));
    if (s.type === 'object') {
      const props = Object.keys(s.properties as object);
      assert.deepEqual(s.required, props, `${path}: all properties required`);
      assert.equal(s.additionalProperties, false, path);
      for (const k of props) check((s.properties as Record<string, Record<string, unknown>>)[k], `${path}.${k}`);
    }
    if (s.type === 'array') check(s.items as Record<string, unknown>, `${path}[]`);
  };
  check(APPRAISAL_SCHEMA, 'appraisal');
  const { messages } = TASKS['npc.appraisal'].build(input);
  assert.match(messages[2].content, /Ruth Keller \[P1\]: Closing\? Says who\?[^\n]*\n\nReport what changed/);
});

test('quotes match loosely; speech is cleaned of name prefixes, quotes and echoed stage notes', () => {
  assert.ok(replyContains(reply, 'meet me at the Fountain at five!'));
  assert.ok(!replyContains(reply, 'meet me at the mill'));
  assert.equal(cleanSpeech('Ruth [P1]: "Hello, love."', 'Ruth Keller'), 'Hello, love.');
  assert.equal(cleanSpeech('[Not spoken. 07:40]\nHello.', 'Ruth Keller'), 'Hello.');
  assert.equal(cleanSpeech('Ruthless times.', 'Ruth Keller'), 'Ruthless times.');
});

test('digest keeps the most important events, in their original order', () => {
  const events = Array.from({ length: 250 }, (_, i) => ({ when: `day ${i}`, text: `event ${i}`, importance: i % 5 === 0 ? 9 : 1 }));
  const { messages } = TASKS['skip.digest'].build({ pov: bakeryScene().npc, from: 'a', to: 'b', events });
  const lines = messages[1].content.split('\n').slice(1);
  assert.equal(lines.length, 200);
  assert.equal(lines[0], '- day 0: event 0');
  assert.ok(lines.includes('- day 245: event 245'));
});
