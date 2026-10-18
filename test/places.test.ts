import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRealPlace } from '../src/lang/places';
import { planRegion } from '../src/plan/region';

test('real places are recognised with or without "the", "River" or "Upper", invented ones are not', () => {
  for (const n of ['Salford', 'Kingston', 'the River Stour', 'Springfield', 'Upper Whitby', 'New York', 'Cedar Rapids', 'Bishops Stortford']) assert.ok(isRealPlace(n), n);
  for (const n of ['Testford', 'Varle', 'the Brenna', 'Wenleigh', 'Upper Rookcote']) assert.ok(!isRealPlace(n), n);
});

test('the region never names a well-known real place, and has no British/American switch', () => {
  for (let seed = 0; seed < 150; seed++) {
    const r = planRegion({ seed, town: 'Testford', coastal: seed % 3 === 0, seaBearing: 90, hilliness: (seed % 5) / 5, warmth: 0.5, oldWorld: 0.5, railBearing: seed % 2 ? 45 : null, railTerminus: false, downstreamBearing: 180 });
    for (const p of r.places) assert.ok(!isRealPlace(p.name), `seed ${seed}: ${p.name}`);
    assert.match(r.district, /^the \w+ district$/);
    for (const l of r.lore) assert.doesNotMatch(l.text, /\b(County|county seat|highway|petrol|River [A-Z])/, l.text);
  }
});
