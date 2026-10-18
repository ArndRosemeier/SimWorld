import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOTS, cityName, shopName, streetName } from '../src/plan/names';
import { isRealPlace } from '../src/lang/places';

test('names: no town name is a real place (plan R7), and the deny list catches real ones in any form', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const n = cityName(seed);
    assert.ok(n.length > 3 && !isRealPlace(n), `seed ${seed}: ${n}`);
  }
  for (const n of ['Springfield', 'North Ashford', 'St Kingston', 'Port riverton']) assert.ok(isRealPlace(n), n);
  assert.ok(!isRealPlace('Wrenholm'));
});

test('names: streets and shops have invented roots and no US grid idioms', () => {
  const people = ['Lincoln', 'Madison', 'Franklin', 'Jefferson', 'Hudson', 'Tesla', 'Newton', 'Darwin', 'Bowery', 'Essex', 'Albion'];
  for (const p of people) assert.ok(!ROOTS.includes(p), p);
  for (let id = 0; id < 2000; id++) {
    const s = streetName(7, id, id % 3);
    assert.ok(!/Boulevard|\d/.test(s), s);
    assert.ok(!/Jeweler|Diner/.test(shopName(7, id).name));
  }
});
