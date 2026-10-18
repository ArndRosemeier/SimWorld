/**
 * Society sim at full size (plan R3/R4, risk 2): 2,000 people plus their animals, ticked one game minute at a
 * time for a week. Reports ms per tick and rumour reach; fails if a tick averages over the budget or anyone starves.
 * Slow tier: `npm run test:slow` or Actions → Slow tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../../src/sim/testTown';
import { createWorld } from '../../src/sim/synth';
import { tick } from '../../src/sim/world';
import { ACTOR_PERSON } from '../../src/sim/actors';
import { addFact, reach, witness } from '../../src/sim/knowledge';
import { NEED_COUNT, N_FOOD } from '../../src/sim/species';

/** Average budget per game-minute tick for 2,000 people in a worker (live play needs one per real minute). */
const TICK_BUDGET_MS = 3;

test('sim: 2,000 people for a week within the tick budget; news travels; nobody starves', () => {
  const t0 = performance.now();
  const world = createWorld(testTown(2026, 2000), 2026);
  const synthMs = performance.now() - t0;
  const persons = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => world.actors.cols.kind[i] === ACTOR_PERSON);
  const story = addFact(world, { topic: 'crime', subject: persons[100], place: 5, text: '{subject} was caught shoplifting at {place}', magnitude: 0.8 });
  witness(world, story, [persons[400], persons[900]]);
  const curve: number[] = [];
  const t1 = performance.now();
  for (let day = 0; day < 7; day++) {
    tick(world, 1440);
    curve.push(reach(world, story).any);
  }
  const perTick = (performance.now() - t1) / (7 * 1440);
  const starving = persons.filter((id) => world.actors.cols.needs[id * NEED_COUNT + N_FOOD] < 0.05).length;
  console.log(`actors ${world.actors.count} (people ${persons.length}), synth ${synthMs.toFixed(0)} ms, ${perTick.toFixed(3)} ms/tick, ` +
    `rumour reach by day ${curve.join(', ')}, facts ${world.knowledge.facts.length}, beliefs ${world.knowledge.beliefs.count - world.knowledge.free.length}, relations ${world.relations.liveRows}`);
  assert.ok(perTick < TICK_BUDGET_MS, `${perTick.toFixed(3)} ms per tick`);
  assert.equal(starving, 0);
  assert.ok(curve[6] > curve[0] && curve[6] >= 100, 'the story spreads');
});
