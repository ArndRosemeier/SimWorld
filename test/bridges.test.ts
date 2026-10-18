import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMacroPlan } from '../src/plan/macro';
import { Terrain } from '../src/world/terrain';
import { makeProfile } from '../src/world/settings';
import { buildBridges } from '../src/build/bridges';
import { GROUND_LAYER_COUNT } from '../src/build/ground';
import type { MeshData } from '../src/build/meshBuilder';

// The macro plan alone (no cells, no countryside rivers): seed 1 has one arch bridge.
const terrain = new Terrain(makeProfile({ seed: 1, size: 0 }), false);
const macro = buildMacroPlan(terrain);

test('the town bridges: a deck from bank to bank over the water, and a sound structure', () => {
  assert.ok(macro.bridges.length > 0, 'seed 1 has a river bridge');
  const { deck, structure } = buildBridges(macro.bridges, terrain, macro.edges);
  assert.ok(deck && structure, 'both meshes built');
  const d = deck.build(), s = structure.build();
  for (const [name, m] of [['deck', d], ['structure', s]] as [string, MeshData][]) {
    const nv = m.attrs.position.array.length / 3;
    assert.ok(nv > 50, `${name}: non-empty`);
    for (const k in m.attrs) for (const v of m.attrs[k].array) if (!Number.isFinite(v)) assert.fail(`${name}.${k} not finite`);
    for (const i of m.index) if (i >= nv) assert.fail(`${name}: index out of range`);
  }
  for (const l of d.attrs.aLayer.array) assert.ok(Number.isInteger(l) && l >= 0 && l < GROUND_LAYER_COUNT, `layer ${l}`);
  assert.equal(s.attrs.color.size, 3);

  // The deck meets the ground at both nodes and stands clear of the water in the middle.
  const br = macro.bridges[0], P = br.pts, n = P.length;
  const near = (x: number, z: number) => {
    let best = Infinity, y = 0;
    const A = d.attrs.position.array;
    for (let i = 0; i < A.length; i += 3) { const q = Math.hypot(A[i] - x, A[i + 2] - z); if (q < best) { best = q; y = A[i + 1]; } }
    return y;
  };
  for (const [x, z] of [[P[0], P[1]], [P[n - 2], P[n - 1]]]) assert.ok(Math.abs(near(x, z) - terrain.height(x, z)) < 0.3, 'deck end on the ground');
  const mx = (P[0] + P[n - 2]) / 2, mz = (P[1] + P[n - 1]) / 2;
  assert.ok(near(mx, mz) > br.waterLevel + 1.5, 'deck above the water');

  const again = buildBridges(macro.bridges, terrain, macro.edges);
  assert.deepEqual(again.deck!.build().attrs.position.array, d.attrs.position.array, 'deterministic');
});
