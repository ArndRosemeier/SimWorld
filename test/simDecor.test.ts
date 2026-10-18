import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { daysOf } from '../src/sim/calendar';
import { DECOR_HALLOWEEN, DECOR_XMAS_LIGHTS, DECOR_XMAS_TREE, homeDecor } from '../src/sim/decor';
import { log } from '../src/sim/life';
import { ageOf } from '../src/sim/world';

test('decor: Halloween, more with children; Christmas lights then trees; none in July; grieving households skip it', () => {
  const w = createWorld(testTown(43, 1000), 43);
  const at = (y: number, m: number, d: number) => { w.clock = (daysOf(y, m, d) - w.epoch) * 1440 + 12 * 60; return homeDecor(w); };
  const homes = new Set(w.households.filter((h) => h.members.length).map((h) => h.home));
  const count = (f: Uint8Array, bit: number) => [...homes].filter((p) => f[p] & bit).length;

  assert.equal(count(at(2026, 7, 2).flags, 0xff), 0, 'nothing in early July');
  const early = count(at(2026, 10, 18).flags, DECOR_HALLOWEEN), late = count(at(2026, 10, 31).flags, DECOR_HALLOWEEN);
  assert.ok(late > early && late > homes.size * 0.15, `Halloween fills in: ${early} → ${late} of ${homes.size}`);
  // Families with young children decorate far more often.
  const hw = at(2026, 10, 31).flags;
  const kids = w.households.filter((h) => h.members.some((m) => ageOf(w, m) < 13));
  const none = w.households.filter((h) => h.members.length && !kids.includes(h));
  const rate = (hs: typeof kids) => hs.filter((h) => hw[h.home] & DECOR_HALLOWEEN).length / Math.max(1, hs.length);
  assert.ok(rate(kids) > rate(none) * 1.5, `with kids ${rate(kids)} vs ${rate(none)}`);
  assert.equal(count(at(2026, 11, 10).flags, DECOR_HALLOWEEN), 0, 'gone by mid-November');

  const lights = count(at(2026, 12, 5).flags, DECOR_XMAS_LIGHTS), trees = count(at(2026, 12, 5).flags, DECOR_XMAS_TREE);
  const xmas = at(2026, 12, 24).flags;
  assert.ok(lights > 0 && trees === 0, 'lights from Advent, trees not yet');
  assert.ok(count(xmas, DECOR_XMAS_TREE) > homes.size * 0.4 && count(xmas, DECOR_XMAS_LIGHTS) > lights, 'by Christmas Eve');
  assert.ok(count(at(2027, 1, 3).flags, DECOR_XMAS_TREE) > 0 && count(at(2027, 1, 10).flags, 0xff) === 0, 'down after Epiphany');

  // A death in a decorating household: it skips Christmas.
  at(2026, 12, 24);
  const hh = w.households.find((h) => h.members.length > 1 && xmas[h.home] & DECOR_XMAS_TREE && w.households.filter((o) => o.home === h.home).length === 1)!;
  log(w, Math.floor(w.clock / 1440) - 10, 'death', hh.members[0], -1, hh.home);
  assert.equal(homeDecor(w).flags[hh.home], 0, 'a house in mourning stays dark');
});
