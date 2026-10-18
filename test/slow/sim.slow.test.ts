/**
 * Society sim at full size (plan R3/R4, risk 2): 2,000 people plus their animals, ticked one game minute at a
 * time for a week. Reports ms per tick and rumour reach; fails if a tick averages over the budget or anyone starves.
 * Also: twenty years of life events in daily steps, with the population and the books checked; thirty years of town
 * history and a one-year time skip, timed.
 * Slow tier: `npm run test:slow` or Actions → Slow tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../../src/sim/testTown';
import { createWorld } from '../../src/sim/synth';
import { isPerson, tick } from '../../src/sim/world';
import { lifeDay } from '../../src/sim/life';
import { chronicle, digest } from '../../src/sim/chronicle';
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
  const starving = persons.filter((id) => isPerson(world, id) && world.actors.cols.needs[id * NEED_COUNT + N_FOOD] < 0.05).length;
  console.log(`actors ${world.actors.count} (people ${persons.length}), synth ${synthMs.toFixed(0)} ms, ${perTick.toFixed(3)} ms/tick, ` +
    `rumour reach by day ${curve.join(', ')}, facts ${world.knowledge.facts.length}, beliefs ${world.knowledge.beliefs.count - world.knowledge.free.length}, relations ${world.relations.liveRows}`);
  assert.ok(perTick < TICK_BUDGET_MS, `${perTick.toFixed(3)} ms per tick`);
  assert.equal(starving, 0);
  assert.ok(curve[6] > curve[0] && curve[6] >= 100, 'the story spreads');
});

test('life: twenty years of a 2,000-person town stay plausible (births, deaths, moves; population within 15%)', () => {
  const world = createWorld(testTown(2027, 2000), 2027);
  const people = () => { let n = 0; for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id)) n++; return n; };
  const start = people();
  const t0 = performance.now();
  for (let d = 0; d < 20 * 365; d++) { world.clock = (Math.floor(world.clock / 1440) + 1) * 1440; lifeDay(world); }
  const perDay = (performance.now() - t0) / (20 * 365);
  const by: Record<string, number> = {};
  for (const e of world.life.events) {
    const k = e.kind === 'death' && world.actors.cols.kind[e.who] !== ACTOR_PERSON ? 'animal death' : e.kind;
    by[k] = (by[k] ?? 0) + 1;
  }
  const end = people();
  console.log(`people ${start} → ${end}, ${perDay.toFixed(2)} ms/day; per year: ${Object.entries(by).map(([k, v]) => `${k} ${(v / 20).toFixed(1)}`).join(', ')}`);
  assert.ok(Math.abs(end - start) / start < 0.15, `population ${start} → ${end}`);
  assert.ok(by.birth / 20 > 8 && by.death / 20 > 8, 'births and deaths at town scale');
  assert.ok(perDay < 10, `${perDay.toFixed(2)} ms per day`);
});

test('chronicle: 30 years of history and then a one-year skip, for 2,000 people, in loading-screen time', () => {
  const t0 = performance.now();
  const world = createWorld(testTown(2028, 2000), 2028, { history: 30 });
  const historyMs = performance.now() - t0;
  let people = 0;
  for (let id = 0; id < world.actors.count; id++) if (isPerson(world, id)) people++;
  const since = world.clock;
  const t1 = performance.now();
  chronicle(world, 365);
  const skipMs = performance.now() - t1;
  const someone = Array.from({ length: world.actors.count }, (_, i) => i).find((i) => isPerson(world, i) && digest(world, i, since).length >= 5) ?? -1;
  console.log(`history 30 y: ${historyMs.toFixed(0)} ms, ${people} people, ${world.life.events.length} events, ${world.knowledge.facts.length} facts; ` +
    `skip 1 y: ${skipMs.toFixed(0)} ms; a digest: ${someone >= 0 ? digest(world, someone, since, 5).map((d) => d.text).join(' | ') : 'none'}`);
  assert.ok(Math.abs(people - 2000) / 2000 < 0.2, `${people} people after history`);
  assert.ok(historyMs < 15000 && skipMs < 15000, 'time');
  assert.ok(someone >= 0, 'someone has a year to tell about');
});
