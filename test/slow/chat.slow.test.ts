/**
 * A live conversation end to end (slow tier, by hand only; needs OPENROUTER_API_KEY or OPEN_ROUTER_KEY, skips without
 * it): the sim worker's chat ops on a small town, the default models, the same steps as src/game/chat.ts. Checks the
 * reply streams, every appraisal is a Proposal `applyProposal` takes, a rumour the player tells becomes a belief, and
 * the talk ends with memories on both sides. Prints the exchange and its cost.
 *
 *   OPEN_ROUTER_KEY=sk-or-... NODE_USE_ENV_PROXY=1 npm run test:slow -- test/slow/chat.slow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../../src/sim/testTown';
import { createWorld } from '../../src/sim/synth';
import { ACTOR_PERSON } from '../../src/sim/actors';
import { beliefsOf } from '../../src/sim/knowledge';
import { memoriesOf } from '../../src/sim/memory';
import { chatOp } from '../../src/chat/ops';
import { createLlm, openRouterTransport, DEFAULT_ROSTER, UsageLedger, type Turn } from '../../src/llm';

const KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY ?? '';

test('live: a conversation streams, changes the NPC through applyProposal and is remembered', { skip: !KEY && 'no OPENROUTER_API_KEY' }, async () => {
  const w = createWorld(testTown(5, 300), 5);
  const adults = Array.from({ length: w.actors.count }, (_, i) => i)
    .filter((i) => w.actors.cols.kind[i] === ACTOR_PERSON && w.clock / 1440 - w.actors.cols.birth[i] > 30 * 365);
  const [npc, player] = [adults[20], adults[21]];
  const ledger = new UsageLedger();
  const llm = createLlm({ transport: openRouterTransport({ apiKey: KEY }), roster: () => DEFAULT_ROSTER, ledger, session: 'slow' });
  const start = chatOp(w, { op: 'start', npc, player });
  assert.ok(start.op === 'start' && start.header);
  const turns: Turn[] = [];
  let last;
  let applied = 0;
  for (const line of ['Hello! Busy day?', 'I heard the old mill is going to be turned into flats next year. Did you know?', 'Well, nice talking to you. See you around!']) {
    turns.push({ speaker: 'partner', text: line });
    const t = chatOp(w, { op: 'turn', npc, player, conversation: 'slow', turns });
    assert.ok(t.op === 'turn');
    let pieces = 0;
    const r = await llm.run('npc.speech', t.input, { onText: () => pieces++ });
    assert.ok(pieces > 1, 'the reply streams in pieces');
    turns.push({ speaker: 'npc', text: r.output });
    last = { ...t.input, turns: [...turns] };
    const a = await llm.run('npc.appraisal', { context: last, reply: r.output });
    const ap = chatOp(w, { op: 'apply', npc, proposal: a.output.proposal });
    assert.ok(ap.op === 'apply');
    applied += ap.applied.length;
    console.log(`> ${line}\n< ${r.output}\n  ${ap.applied.map((c) => `${c.change.kind}:${c.outcome}`).join(', ') || '(no change)'}${a.output.dropped.length ? ` dropped: ${a.output.dropped.join('; ')}` : ''}`);
  }
  assert.ok(applied > 0, 'the conversation changed something in their mind');
  assert.ok(beliefsOf(w, npc).some((b) => /mill/i.test(b.text)), 'the rumour became a belief');
  const before = [memoriesOf(w, npc).length, memoriesOf(w, player).length];
  const s = (await llm.run('memory.summary', last!)).output;
  chatOp(w, { op: 'end', npc, player, conversation: 'slow', minutes: 5, told: [], npcMemory: { summary: s.summary, importance: s.importance / 10 } });
  assert.ok(memoriesOf(w, npc).length > before[0] && memoriesOf(w, player).length > before[1]);
  console.log('memory:', s.summary, '\ncost:', ledger.total());
});
