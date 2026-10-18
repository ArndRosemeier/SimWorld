import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { agendaOn } from '../src/sim/agenda';
import { gameDayOf } from '../src/sim/calendar';
import { engage, partnerOf } from '../src/sim/life';
import { createWorld } from '../src/sim/synth';
import { testTown } from '../src/sim/testTown';
import { ageOf, householdOf, isPerson, passDays, tick } from '../src/sim/world';
import { A } from '../src/sim/actors';

const world = createWorld(testTown(21, 600), 21);
const kinds = (day: number) => agendaOn(world, day).map((o) => o.kind);
const today = Math.floor(world.clock / 1440);

test('agenda: a weekly market, a Sunday service, bin day once a week per street', () => {
  const week = Array.from({ length: 7 }, (_, d) => kinds(today + d));
  assert.equal(week.filter((k) => k.includes('market')).length, 1);
  assert.ok(week[6].includes('service'), 'no service on Sunday');
  const streets = world.graph.places.filter((p) => p.kind === 'street').length;
  assert.equal(week.flat().filter((k) => k === 'binDay').length, streets);
  assert.ok(week[5].every((k) => k !== 'binDay') && week[6].every((k) => k !== 'binDay'), 'bins at the weekend');
});

test('agenda: the calendar brings the festival, the Christmas market and the Christmas Eve service', () => {
  const on = (y: number, m: number, d: number) => kinds(gameDayOf(world, y, m, d));
  assert.ok(on(2026, 12, 4).includes('christmasMarket'));
  assert.ok(on(2026, 12, 24).includes('service'));
  assert.ok(on(2026, 10, 31).includes('halloween'));
  const july = Array.from({ length: 31 }, (_, i) => on(2027, 7, i + 1).includes('festival')).filter(Boolean).length;
  assert.equal(july, 2);
});

test('agenda: on Sunday morning the faithful are at church, on market day people shop on the square', () => {
  const w = createWorld(testTown(22, 600), 22);
  const church = w.graph.places.find((p) => p.kind === 'church')!.id;
  const square = w.graph.places.find((p) => p.kind === 'square')!.id;
  const marketDay = Array.from({ length: 7 }, (_, d) => d).find((d) => agendaOn(w, d).some((o) => o.kind === 'market'))!;
  /** People at `place` doing `activity` at 10:30 on game day `day`, living that morning from 06:00. */
  const count = (day: number, place: number, activity: number) => {
    w.clock = day * 1440 + 360;
    for (let id = 0; id < w.actors.count; id++) w.actors.cols.until[id] = w.clock;
    tick(w, 270);
    let n = 0;
    for (let id = 0; id < w.actors.count; id++) if (isPerson(w, id) && w.actors.cols.dest[id] < 0 && w.actors.cols.place[id] === place && w.actors.cols.activity[id] === activity) n++;
    return n;
  };
  const shoppers = count(marketDay, square, A.shop), worshippers = count(6, church, A.worship);
  assert.ok(shoppers >= 5, `${shoppers} at the market`);
  assert.ok(worshippers >= 10, `${worshippers} in church`);
});

test('ceremonies: the guests come to the wedding, and afterwards the couple are married', () => {
  const w = createWorld(testTown(23, 600), 23);
  const x = Array.from({ length: w.actors.count }, (_, i) => i).find((id) => isPerson(w, id) && ageOf(w, id) >= 25 && ageOf(w, id) < 50 && partnerOf(w, id) >= 0 && !w.relations.has(id, partnerOf(w, id), 'spouse') && householdOf(w, id) === householdOf(w, partnerOf(w, id)))!;
  assert.ok(x !== undefined, 'no unmarried couple');
  const y = partnerOf(w, x);
  engage(w, Math.floor(w.clock / 1440), x, y, new Rng(5));
  const wedding = w.agenda.once.find((o) => o.kind === 'wedding')!;
  assert.ok(wedding && wedding.guests!.length >= 2);
  // Jump to midnight before the wedding day and live through it.
  w.clock = Math.floor(wedding.start / 1440) * 1440 - 1;
  for (let id = 0; id < w.actors.count; id++) w.actors.cols.until[id] = w.clock;
  tick(w, 1);
  tick(w, wedding.start + 30 - w.clock);
  const there = wedding.guests!.filter((g) => w.actors.cols.place[g] === wedding.place && w.actors.cols.dest[g] < 0).length;
  assert.ok(there >= wedding.guests!.length * 0.6, `${there} of ${wedding.guests!.length} guests at the wedding`);
  tick(w, (Math.floor(w.clock / 1440) + 1) * 1440 - w.clock);
  assert.ok(w.relations.has(x, y, 'spouse'), 'not married');
  assert.ok(!w.life.engaged.size);
});

test('ceremonies: years of life bring engagements, weddings and funerals, and the agenda does not pile up', () => {
  const w = createWorld(testTown(24, 400), 24);
  for (let d = 0; d < 3 * 365; d += 7) { w.clock = (Math.floor(w.clock / 1440) + 7) * 1440; passDays(w, 7); }
  const k = new Set(w.life.events.map((e) => e.kind));
  for (const kind of ['engagement', 'marriage', 'funeral'] as const) assert.ok(k.has(kind), `no ${kind}`);
  assert.ok(w.agenda.once.every((o) => o.start > w.clock - 8 * 1440), 'stale occasions');
});
