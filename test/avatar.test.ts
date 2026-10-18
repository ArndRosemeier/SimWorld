import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Physics } from '../src/physics/physics';
import { wallBoxes } from '../src/physics/solids';
import { Avatar } from '../src/game/avatar';

/** Flat ground at y = 0 with a 0.15 m kerb from x = 4 on, 40 m square. */
const n = 41, h = new Float32Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = -20 + i >= 4 ? 0.15 : 0;

test('the body walks, steps up a kerb, and stops at a building wall', async () => {
  const phys = await Physics.create({ x0: -20, z0: -20, step: 1, n, h });
  // A 6 m square house beyond the kerb: x 8…14, z −3…3.
  phys.setSolids('b:1', wallBoxes([8, -3, 14, -3, 14, 3, 8, 3], -1, 8));
  const av = new Avatar(phys, 0, 0, 0, 0);
  phys.world.step();
  for (let i = 0; i < 30; i++) { av.step(1 / 30, 0, 0, false); phys.world.step(); }
  assert.ok(Math.abs(av.y) < 0.05, `stands on the ground (${av.y})`);
  // Walk along +x for 8 s: up the kerb, then into the wall.
  for (let i = 0; i < 240; i++) { av.step(1 / 30, 1, 0, false); phys.world.step(); }
  assert.ok(av.x > 6 && av.x < 8 - 0.2 - 0.25, `stopped at the wall (x ${av.x.toFixed(2)})`);
  assert.ok(Math.abs(av.y - 0.15) < 0.06, `up on the kerb (${av.y.toFixed(2)})`);
  assert.ok(Math.abs(av.yaw + Math.PI / 2) < 0.1, 'facing where it walked');
  // Along the wall it slides on.
  const z0 = av.z;
  for (let i = 0; i < 60; i++) { av.step(1 / 30, 0.7, 0.7, false); phys.world.step(); }
  assert.ok(av.z > z0 + 1, 'slides along the wall');
  av.dispose();
});
