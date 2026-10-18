import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { loadWorld, saveWorld } from '../src/sim/save';
import { isPerson, tick } from '../src/sim/world';
import { A } from '../src/sim/actors';
import { cardsOf, profileOf, TAG_GRIEVING, TAG_PARENT } from '../src/sim/profile';
import { becomePlayer, playerActions, playerGo, setAutopilot } from '../src/sim/player';

const planned = testTown(7, 220);
const world = createWorld(planned, 7, { history: 1 });

test('profile: every living person has a card with a line, a household and their home', () => {
  const cards = cardsOf(world);
  const people = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => isPerson(world, i));
  assert.equal(cards.length, people.length);
  for (const c of cards) {
    assert.ok(c.line.length > 3 && !/undefined|NaN|\{/.test(c.line + c.household), `${c.name}: ${c.line} / ${c.household}`);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z));
    // Secrets never show on the line others would read.
    for (const s of c.situations) if (s.secret) assert.ok(!c.line.includes(s.text));
  }
  assert.ok(cards.some((c) => c.situations.length > 0), 'a year of history gives some lives a story');
  assert.ok(cards.some((c) => c.tags & TAG_PARENT));
  assert.deepEqual(profileOf(world, cards[5].id), cards[5], 'one card is the same as in the list');
});

test('profile: a widow is recently widowed', () => {
  const w = createWorld(testTown(8, 120), 8);
  const ids = Array.from({ length: w.actors.count }, (_, i) => i);
  // Find a married couple and let one of them die today.
  const rel = w.relations, c = rel.t.cols;
  const wife = ids.find((id) => isPerson(w, id) && rel.known(id).some((r) => c.bonds[r] & 2));
  assert.ok(wife !== undefined, 'the town has a married couple');
  const husband = c.to[rel.known(wife).find((r) => c.bonds[r] & 2)!];
  w.actors.cols.alive[husband] = 0;
  w.life.events.push({ day: Math.floor(w.clock / 1440) - 10, kind: 'death', who: husband, other: -1, place: -1, fact: -1 });
  const card = profileOf(w, wife);
  assert.ok(card.situations.some((s) => s.text === 'recently widowed'), card.line);
  assert.ok(card.tags & TAG_GRIEVING);
});

test('player: with autopilot off the sim leaves them be; sending them goes through the sim', () => {
  const w = createWorld(planned, 7);
  const id = cardsOf(w).find((c) => c.age >= 25 && c.age < 60)!.id;
  becomePlayer(w, id, false);
  const a = w.actors.cols;
  const where = a.place[id] >= 0 ? a.place[id] : a.home[id];
  tick(w, 6 * 60);
  assert.equal(a.dest[id], -1, 'nobody decided for them');
  assert.equal(a.place[id] >= 0 ? a.place[id] : a.home[id], where);
  const actions = playerActions(w);
  assert.ok(actions.some((x) => x.group === 'Here'));
  const shop = actions.find((x) => x.group === 'Shop' && x.open) ?? actions.find((x) => x.group === 'Shop')!;
  playerGo(w, shop.place, shop.activity);
  tick(w, shop.minutes + 2);
  assert.equal(a.place[id], shop.place, 'they walked there');
  assert.equal(a.activity[id], A.shop);
  tick(w, 5 * 60);
  assert.equal(a.place[id], shop.place, 'and stay until told otherwise');
  setAutopilot(w, true);
  tick(w, 3 * 60);
  assert.ok(a.place[id] !== shop.place || a.activity[id] !== A.shop, 'on autopilot their routine takes over again');
});

test('player: who the player is survives a save', () => {
  const w = createWorld(testTown(9, 60), 9);
  becomePlayer(w, cardsOf(w)[0].id, false);
  const back = loadWorld(testTown(9, 60), saveWorld(w));
  assert.deepEqual(back.player, w.player);
});
