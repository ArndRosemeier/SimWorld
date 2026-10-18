import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/synth';
import { testTown } from '../src/sim/testTown';
import { ageOf, hasCar, isPerson, placesOf, tick } from '../src/sim/world';
import { walkLimit } from '../src/sim/schedule';
import { isNiceOut, isWetOut, weatherAt } from '../src/sim/weather';
import { KINDS } from '../src/sim/placeKinds';
import { A } from '../src/sim/actors';

test('weather: on a wet weekend afternoon fewer people are out in the park than on a fine one', () => {
  const w = createWorld(testTown(41, 600), 41, { start: { year: 2026, month: 5, day: 4 } });
  // Weekend afternoons at 14:00 over the spring and summer: one wet, one fine.
  let wet = -1, fine = -1;
  for (let d = 5; d < 150 && (wet < 0 || fine < 0); d += d % 7 === 5 ? 1 : 6) {
    const t = d * 1440 + 14 * 60;
    const sky = weatherAt(w, t);
    let steady = true;
    for (let m = -90; m <= 0; m += 30) if (isWetOut(weatherAt(w, t + m)) !== isWetOut(sky) || isNiceOut(weatherAt(w, t + m)) !== isNiceOut(sky)) steady = false;
    if (!steady) continue;
    if (wet < 0 && isWetOut(sky)) wet = t;
    if (fine < 0 && isNiceOut(sky)) fine = t;
  }
  assert.ok(wet >= 0 && fine >= 0, 'no steady wet and fine Saturday afternoons');
  const outside = (t: number) => {
    w.clock = t - 120;
    for (let id = 0; id < w.actors.count; id++) w.actors.cols.until[id] = w.clock;
    tick(w, 120);
    let n = 0;
    for (let id = 0; id < w.actors.count; id++) {
      const p = w.actors.cols.place[id];
      if (isPerson(w, id) && w.actors.cols.dest[id] < 0 && p >= 0 && KINDS[w.graph.places[p].kind].category === 'outdoor' && w.actors.cols.activity[id] !== A.walkDog) n++;
    }
    return n;
  };
  const onFine = outside(fine), onWet = outside(wet);
  assert.ok(onWet < onFine * 0.6, `out on a wet afternoon ${onWet}, on a fine one ${onFine}`);
});

test('travel: people drive for the big shop, in the rain and in the dark, and walk further on a fine day', () => {
  const w = createWorld(testTown(42, 120), 42, { start: { year: 2026, month: 5, day: 4 } });
  const driver = Array.from({ length: w.actors.count }, (_, i) => i).find((id) => isPerson(w, id) && hasCar(w, id) && ageOf(w, id) < 60)!;
  const market = placesOf(w, ['supermarket'])[0], park = placesOf(w, ['park'])[0];
  // A dry, fine midday and a wet one.
  let fine = -1, wet = -1;
  for (let t = 12 * 60; t < 120 * 1440 && (fine < 0 || wet < 0); t += 1440) {
    if (fine < 0 && isNiceOut(weatherAt(w, t))) fine = t;
    if (wet < 0 && isWetOut(weatherAt(w, t))) wet = t;
  }
  w.clock = fine;
  const walk = walkLimit(w, driver, park, A.leisure);
  assert.ok(walkLimit(w, driver, market, A.shop) <= 3, 'the weekly shop goes in the car');
  w.clock = wet;
  assert.ok(walkLimit(w, driver, park, A.leisure) < walk * 0.5, 'rain puts people in the car');
  w.clock = fine - 12 * 60 + 60; // 01:00, dark
  assert.ok(walkLimit(w, driver, park, A.leisure) < walk, 'the dark puts people in the car');
});
