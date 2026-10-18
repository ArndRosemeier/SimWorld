import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@futuremagic/core';
import { businessHours, hoursLines, withLocalHours } from '../src/sim/hours';
import { defaultHours } from '../src/sim/placeKinds';
import type { Hours } from '../src/sim/places';

const openOn = (hs: Hours[], d: number, minute: number) => hs.some((h) => (h.days & (1 << d)) !== 0 && minute >= h.open && minute < h.close);

test('hours: each business keeps its own version of its kind\'s hours', () => {
  let halfDay = 0, late = 0, mondays = 0, pubLunch = 0;
  const opens = new Set<number>();
  for (let i = 0; i < 400; i++) {
    const shop = businessHours('clothes', defaultHours('clothes'), new Rng(i));
    if (openOn(defaultHours('clothes').map((h) => ({ ...h, open: h.open - 30, close: h.close + 30 })), 2, 15 * 60) && !openOn(shop, 2, 15 * 60) && openOn(shop, 2, 11 * 60)) halfDay++;
    if (openOn(shop, 3, 19.5 * 60)) late++;
    if (!shop.some((h) => h.days & 1)) mondays++;
    for (const h of shop) opens.add(h.open);
    // A window never shrinks below two hours, and nothing opens before it closes.
    for (const h of shop) assert.ok(h.close - h.open >= 120, JSON.stringify(h));
    if (openOn(businessHours('pub', defaultHours('pub'), new Rng(i)), 6, 13 * 60)) pubLunch++;
  }
  assert.ok(halfDay > 60 && halfDay < 140, `half-day Wednesdays ${halfDay}/400`);
  assert.ok(late > 80 && late < 160, `late Thursdays ${late}/400`);
  assert.ok(mondays > 40 && mondays < 120, `closed Mondays ${mondays}/400`);
  assert.ok(pubLunch > 150 && pubLunch < 250, `Sunday lunch at the pub ${pubLunch}/400`);
  assert.ok(opens.size >= 5, 'shops open on different quarter hours');
  // Always-open places and places that keep no hours stay as they are.
  assert.deepEqual(businessHours('hotel', [], new Rng(1)), []);
});

test('hours: the world gets its own copy, schools and churches keep theirs, and it is the same for the same seed', () => {
  const places = (['clothes', 'school', 'church', 'bakery'] as const).map((kind, id) => ({ id, kind, hours: defaultHours(kind) }));
  const graph = { places } as unknown as Parameters<typeof withLocalHours>[0];
  const a = withLocalHours(graph, 7), b = withLocalHours(graph, 7);
  assert.deepEqual(a.places.map((p) => p.hours), b.places.map((p) => p.hours));
  assert.equal(a.places[1], places[1]);
  assert.equal(a.places[2], places[2]);
  assert.deepEqual(places[0].hours, defaultHours('clothes'), 'the planner\'s graph is untouched');
});

test('hours: a door sign lists every day, runs of days with the same hours on one line', () => {
  const D = (...d: number[]) => d.reduce((m, x) => m | (1 << x), 0);
  assert.deepEqual(hoursLines([{ days: D(0, 1, 3, 4), open: 540, close: 1050 }, { days: D(2), open: 540, close: 780 }, { days: D(5), open: 555, close: 750 }, { days: D(5), open: 840, close: 960 }]),
    ['Mon–Tue  9:00–17:30', 'Wed  9:00–13:00', 'Thu–Fri  9:00–17:30', 'Sat  9:15–12:30 14:00–16:00', 'Sun  Closed']);
  assert.deepEqual(hoursLines([{ days: 0b1111111, open: 660, close: 1500 }]), ['Mon–Sun  11:00–1:00']);
  assert.deepEqual(hoursLines([]), ['Mon–Sun  Closed']);
});
