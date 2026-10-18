import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { isPerson } from '../src/sim/world';
import { waitOf } from '../src/sim/player';
import type { Mode } from '../src/sim/travel';
import { Physics } from '../src/physics/physics';
import { heightOnGrid } from '../src/physics/solids';
import { pointInPoly } from '../src/geom/geom2';
import { Avatar } from '../src/game/avatar';
import { landOutdoors, placeSolids } from '../src/game/standing';
import type { HeightGrid } from '../src/workers/simProtocol';

// Whole towns, everyone out of doors at four times of a weekday: test/slow/takeover.slow.test.ts.

/** A square of rolling ground `half` m round (cx, cz) (its heights change by up to half a metre from one grid point to the next; two of them agree where they overlap). */
function hills(decks: HeightGrid['decks'] = [], cx = 0, cz = 0, half = 40): HeightGrid {
  const x0 = Math.floor((cx - half) / 4) * 4, z0 = Math.floor((cz - half) / 4) * 4, n = Math.ceil((2 * half) / 4) + 1, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 10 + Math.sin((x0 / 4 + i) * 1.3) * 0.5 + Math.cos((z0 / 4 + j) * 0.9) * 0.4;
  return { x0, z0, step: 4, n, h, decks };
}

/** Let a body settle where it was put. */
function settle(phys: Physics, a: Avatar, frames = 15): void {
  for (let i = 0; i < frames; i++) { a.step(1 / 30, 0, 0, false); phys.world.step(); }
}

test('takeover: in a car, on a bus or out of town they cannot be taken over until they are back on foot in town; at a place or walking they can', () => {
  const w = createWorld(testTown(5, 120), 5), a = w.actors.cols, places = w.graph.places;
  const away = places.findIndex((p) => p.kind === 'away'), id = [...Array(w.actors.count).keys()].find((i) => isPerson(w, i) && a.home[i] >= 0)!;
  const shop = places.findIndex((p, i) => p.kind !== 'away' && i !== a.home[id]);
  const trip = (to: number, mode: Mode) => { a.dest[id] = to; a.arrive[id] = w.clock + 20; w.trips.push({ who: id, from: a.place[id], to, depart: w.clock, arrive: w.clock + 20, mode, leader: -1, run: -1 }); };
  a.place[id] = a.home[id]; a.dest[id] = -1;
  assert.equal(waitOf(w, id), null, 'at home');
  trip(shop, 'foot');
  assert.equal(waitOf(w, id), null, 'walking to the shop');
  trip(shop, 'car');
  assert.deepEqual(waitOf(w, id), { kind: 'wait', why: `driving to ${places[shop].name}`, back: w.clock + 20 }, 'driving: back when they get there');
  trip(away, 'bus');
  assert.equal(waitOf(w, id)?.back, null, 'on the way out of town: not known');
  a.dest[id] = -1; a.place[id] = away; a.until[id] = w.clock + 300;
  const back = waitOf(w, id);
  assert.ok(back && back.back! > w.clock + 300, `out of town: back after they leave there and the road home (${back?.back})`);
  trip(a.home[id], 'foot');
  assert.ok(waitOf(w, id)?.why.startsWith('coming back from'), 'walking home from out of town: still on the road');
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
  const near = { buildings: [{ code: 1, poly: house, y0: 9, y1: 16, doors: [] }], circles: [8, 0, 0.4, heightOnGrid(g, 8, 0)], ground: g };
  placeSolids(phys, near, -1);
  for (const [x, z] of [[0, 0], [8, 0], [-9, 7]]) {
    const at = landOutdoors(phys, near, x, z, 1000);
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

test('takeover: the ground goes with the body, so it walks out into the fields as far as the world is drawn, and no further', async () => {
  const phys = await Physics.create(hills([], 30, 0, 100));
  const a = new Avatar(phys, 30, heightOnGrid(phys.ground, 30, 0), 0, 0);
  settle(phys, a);
  // Walking east for a minute, the ground round the body fetched again every 25 m (as the game does).
  let at = 30;
  for (let i = 0; i < 1800; i++) {
    if (a.x - at > 25) { at = a.x; placeSolids(phys, { buildings: [], circles: [], ground: hills([], at, 0, 100) }, -1); }
    a.step(1 / 30, 1, 0, true); phys.world.step();
  }
  assert.ok(a.x > 200 && a.grounded && Math.abs(a.y - heightOnGrid(phys.ground, a.x, a.z)) < 0.1, `out in the fields (x ${a.x.toFixed(0)}, feet ${a.y.toFixed(2)})`);
  a.dispose();
  // Put down beyond the walkable world: at its edge.
  placeSolids(phys, { buildings: [], circles: [], ground: hills([], 500, 0, 100) }, -1);
  assert.equal(landOutdoors(phys, null, 900, 0, 500).x, 500);
});
