import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRegion } from '../src/plan/region';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { chronicle } from '../src/sim/chronicle';
import { loadWorld, saveWorld } from '../src/sim/save';
import { tick } from '../src/sim/world';

const region = planRegion({
  seed: 3, town: 'Saveham', coastal: false, seaBearing: 0, hilliness: 0.3, warmth: 0.5, oldWorld: 0.7,
  railBearing: 90, railTerminus: false, downstreamBearing: 200,
});

test('save: a loaded world goes on exactly as the saved one would have', () => {
  const planned = testTown(3, 100);
  const a = createWorld(planned, 3, { region });
  tick(a, 9 * 60);
  const bytes = saveWorld(a);
  const b = loadWorld(planned, bytes);
  assert.deepEqual(saveWorld(b), bytes, 'saving a loaded world gives the same bytes');
  for (const w of [a, b]) { tick(w, 1440); chronicle(w, 20); tick(w, 300); }
  assert.ok(Buffer.from(saveWorld(a)).equals(Buffer.from(saveWorld(b))), 'the two worlds stay the same');
  assert.equal(planned.places.length, testTown(3, 100).places.length, 'the planned town is untouched');
});

test('save: bytes from elsewhere, another version or another town are refused', () => {
  const planned = testTown(4, 40);
  const bytes = saveWorld(createWorld(planned, 4));
  assert.throws(() => loadWorld(planned, new Uint8Array(64)), /not a SimWorld save/);
  const old = bytes.slice(); old[3] = 0;
  assert.throws(() => loadWorld(planned, old), /save version/);
  assert.throws(() => loadWorld(testTown(9, 400), bytes), /another town/);
});
