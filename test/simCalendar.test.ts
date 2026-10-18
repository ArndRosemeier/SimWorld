import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  christmasMarket, civilOf, dateOf, daysOf, easter, epochFor, formatDate, gameDayOf, holidaysOn, runsLike, schoolDay,
  schoolHoliday, seasonOf, sunTimes, weekdayOfDays,
} from '../src/sim/calendar';
import { createWorld } from '../src/sim/synth';
import { testTown } from '../src/sim/testTown';
import { isOpen, worksOn } from '../src/sim/schedule';
import { weekdayOf } from '../src/sim/time';

const day = (w: { epoch: number; seed: number }, y: number, m: number, d: number, minute = 600) => gameDayOf(w, y, m, d) * 1440 + minute;

test('calendar: real dates, weekdays and Easter', () => {
  assert.equal(daysOf(1970, 1, 1), 0);
  assert.equal(daysOf(2000, 3, 1), 11017);
  for (const n of [-1000, 0, 11016, 20744, 60000]) { const c = civilOf(n); assert.equal(daysOf(c.year, c.month, c.day), n); }
  assert.equal(weekdayOfDays(daysOf(2026, 10, 19)), 0); // a Monday
  assert.deepEqual(easter(2026), { year: 2026, month: 4, day: 5 });
  assert.deepEqual(easter(2027), { year: 2027, month: 3, day: 28 });
  assert.deepEqual(easter(2000), { year: 2000, month: 4, day: 23 });
  // Market from the Friday before the first Advent Sunday (29 Nov 2026) to 23 December.
  assert.deepEqual(christmasMarket(2026).map((d) => civilOf(d).day), [27, 23]);
});

test('calendar: game day 0 is a Monday and play starts on the given date', () => {
  const e = epochFor({ year: 2026, month: 10, day: 19 }, 7 * 52);
  const w = { epoch: e, seed: 1 };
  assert.equal(weekdayOfDays(e), 0);
  assert.equal(formatDate(dateOf(w, 7 * 52 * 1440)), 'Monday 19 October 2026');
  const world = createWorld(testTown(3, 120), 3, { date: { year: 2026, month: 10, day: 21 } });
  const d = dateOf(world, world.clock);
  assert.deepEqual([d.month, d.day, d.weekday], [10, 19, weekdayOf(world.clock)]);
  assert.equal(seasonOf(d), 'autumn');
});

test('calendar: the sun rises late in winter and sets late in summer', () => {
  const w = { epoch: 0, seed: 1 };
  const at = (y: number, m: number, dd: number) => sunTimes(dateOf(w, daysOf(y, m, dd) * 1440), 51);
  const mid = at(2026, 6, 21), dec = at(2026, 12, 21);
  assert.ok(mid.rise > 4 * 60 + 30 && mid.rise < 5 * 60 + 15, `June sunrise ${mid.rise}`); // summer time
  assert.ok(mid.set > 21 * 60 && mid.set < 21 * 60 + 45, `June sunset ${mid.set}`);
  assert.ok(dec.rise > 8 * 60 && dec.set < 16 * 60 + 15, `December ${dec.rise}-${dec.set}`);
});

test('calendar: holidays, school terms, and the town keeps them', () => {
  const world = createWorld(testTown(4, 200), 4);
  const kinds = (y: number, m: number, d: number) => holidaysOn(world, day(world, y, m, d)).map((h) => h.kind);
  assert.deepEqual(kinds(2026, 12, 25), ['christmas']);
  assert.deepEqual(kinds(2027, 3, 26), ['goodFriday']);
  assert.ok(kinds(2026, 12, 5).includes('christmasMarket'));
  assert.equal(kinds(2026, 11, 3).length, 0);
  const july = Array.from({ length: 31 }, (_, i) => kinds(2027, 7, i + 1).includes('summerFestival')).filter(Boolean).length;
  assert.equal(july, 2, 'the summer festival is one weekend in July');

  // Good Friday runs like a Sunday; the school is shut in the holidays and on weekends.
  assert.equal(runsLike(world, day(world, 2027, 3, 26)), 6);
  assert.equal(schoolHoliday(world, day(world, 2026, 8, 10)), 'the summer holidays');
  assert.equal(schoolHoliday(world, day(world, 2026, 12, 30)), 'the Christmas holidays');
  assert.equal(schoolHoliday(world, day(world, 2027, 1, 2)), 'the Christmas holidays');
  assert.ok(schoolDay(world, day(world, 2026, 11, 4)));
  assert.ok(!schoolDay(world, day(world, 2026, 11, 7)));

  const pl = (k: string) => world.graph.places.find((p) => p.kind === k)!.id;
  assert.ok(isOpen(world, pl('school'), day(world, 2026, 11, 4)));
  assert.ok(!isOpen(world, pl('school'), day(world, 2026, 10, 28)), 'open in the autumn half-term');
  const shop = world.graph.places.find((p) => p.kind === 'supermarket' || p.kind === 'grocer' || p.kind === 'bakery')!.id;
  assert.ok(isOpen(world, shop, day(world, 2026, 12, 23)));
  assert.ok(!isOpen(world, shop, day(world, 2026, 12, 25)), 'shop open on Christmas Day');
  assert.ok(!isOpen(world, shop, day(world, 2026, 12, 24, 15 * 60)), 'shop open on Christmas Eve afternoon');
  const office = world.jobs.find((j) => world.graph.places[j.place].kind === 'office' || world.graph.places[j.place].kind === 'townhall');
  if (office) assert.ok(!worksOn(world, office, day(world, 2026, 12, 25)) && worksOn(world, office, day(world, 2026, 12, 22)));
});
