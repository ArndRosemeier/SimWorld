import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { isPerson } from '../src/sim/world';
import { onTheGround } from '../src/sim/player';
import { Physics } from '../src/physics/physics';
import { heightOnGrid } from '../src/physics/solids';
import { pointInPoly } from '../src/geom/geom2';
import { Avatar } from '../src/game/avatar';
import { landOutdoors, placeSolids } from '../src/game/standing';
import type { HeightGrid } from '../src/workers/simProtocol';

// Whole towns, everyone out of doors at four times of a weekday: test/slow/takeover.slow.test.ts.

/** An 80 m square of rolling ground (its heights change by up to half a metre from one grid point to the next). */
function hills(decks: HeightGrid['decks'] = []): HeightGrid {
  const n = 21, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 10 + Math.sin(i * 1.3) * 0.5 + Math.cos(j * 0.9) * 0.4;
  return { x0: -40, z0: -40, step: 4, n, h, decks };
}

/** Let a body settle where it was put. */
function settle(phys: Physics, a: Avatar, frames = 15): void {
  for (let i = 0; i < frames; i++) { a.step(1 / 30, 0, 0, false); phys.world.step(); }
}

test('takeover: someone on the road to the city is put where their road leaves the town, never kilometres out', () => {
  const w = createWorld(testTown(5, 120), 5), a = w.actors.cols;
  const away = w.graph.places.findIndex((p) => p.kind === 'away'), id = [...Array(w.actors.count).keys()].find((i) => isPerson(w, i))!;
  const gate = w.graph.places[away], lim = Math.max(Math.abs(gate.x), Math.abs(gate.z)) + 50;
  assert.deepEqual(onTheGround(w, id, 12, -30, lim), [12, -30], 'in town: where they are');
  a.dest[id] = away;
  assert.deepEqual(onTheGround(w, id, 9392, -8044, lim), [gate.x, gate.z], 'out of town: the gate their road leaves by');
  a.dest[id] = -1; a.place[id] = -1;
  const [x, z] = onTheGround(w, id, 9392, -8044, lim);
  assert.ok(Math.max(Math.abs(x), Math.abs(z)) <= lim + 1e-6 && x > 0 && z < 0, 'with no gate to go by: the edge, the same way out');
});

test('takeover: the body lands on the ground as the physics has it, outside a closed building and clear of a post, and stays there', async () => {
  const g = hills(), phys = await Physics.create(g);
  phys.world.step();
  // The ground the game uses is the physics' own: the grid's triangles, not a blend of its corners.
  for (let k = 0; k < 40; k++) {
    const x = -13.63 + ((k * 7.3) % 28), z = -13.81 + ((k * 3.7) % 28);
    const hit = phys.world.castRay(new phys.R.Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 }), 50, true)!;
    assert.ok(Math.abs(30 - hit.timeOfImpact - heightOnGrid(g, x, z)) < 1e-3, `ground at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  const house = [-3, -3, 3, -3, 3, 3, -3, 3];
  const near = { buildings: [{ code: 1, poly: house, y0: 9, y1: 16, doors: [] }], circles: [8, 0, 0.4, heightOnGrid(g, 8, 0)] };
  placeSolids(phys, near, -1);
  for (const [x, z] of [[0, 0], [8, 0], [-9, 7]]) {
    const at = landOutdoors(phys, g, near, x, z);
    assert.ok(!pointInPoly(house, at.x, at.z), `from ${x}, ${z}: not inside the house`);
    assert.ok(Math.hypot(at.x - 8, at.z) > 0.6, `from ${x}, ${z}: not in the post`);
    if (x === -9) assert.deepEqual([at.x, at.z], [-9, 7], 'room enough where they were: right there');
    const a = new Avatar(phys, at.x, at.y, at.z, 0);
    settle(phys, a);
    assert.ok(a.grounded && Math.abs(a.y - heightOnGrid(g, a.x, a.z)) < 0.05, `from ${x}, ${z}: standing on the ground (${a.y.toFixed(2)})`);
    a.dispose();
  }
});

test('takeover: a bridge deck holds the body over the water, and its parapets keep it on', async () => {
  // A deck 6 m wide (and a metre to spare) along x, 5 m over the river bed, arching a metre higher in the middle.
  const g = hills([{ ax: -14, az: 0, dx: 1, dz: 0, s0: 0, s1: 28, h0: 15, h1: 15, arch: 1, hw: 4 }]), phys = await Physics.create(g);
  assert.ok(Math.abs(heightOnGrid(g, 0, 1) - 16.15) < 1e-6, 'on the deck: its surface (plus the curb)');
  const a = new Avatar(phys, 0, heightOnGrid(g, 0, 1), 1, 0);
  settle(phys, a);
  assert.ok(a.grounded && Math.abs(a.y - 16.15) < 0.1, `standing on the deck (${a.y.toFixed(2)})`);
  // Walking for the side: the parapet stops them.
  for (let i = 0; i < 90; i++) { a.step(1 / 30, 0, 1, false); phys.world.step(); }
  assert.ok(a.z < 4.1 && a.y > 15.9, `still on the deck (z ${a.z.toFixed(2)}, feet ${a.y.toFixed(2)})`);
  a.dispose();
});
