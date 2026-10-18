import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACADE_LAYER_COUNT, FACADE_TILE_METERS, GROUND_LAYER_COUNT, GROUND_TILE_METERS, INTERIOR_LAYER_COUNT, INTERIOR_TILE_METERS, generateFacadeLayer, generateGroundLayer, generateInteriorLayer, type TexLayer } from '../src/build/texgen';
import { TNoise, newCell, worley } from '../src/build/texgen/core';
import { newHit, randomCourses } from '../src/build/texgen/layout';

// Cheap layers at a small size: facade 11 (metal panel), ground 5 (cobble), interior 8 (wall tiles).
const S = 64;

/** Mean absolute difference of channel c between columns (or rows) a and b of a size x size RGBA8 image. */
function lineDiff(img: Uint8Array, c: number, a: number, b: number, rows: boolean): number {
  let sum = 0;
  for (let k = 0; k < S; k++) {
    const ia = rows ? a * S + k : k * S + a, ib = rows ? b * S + k : k * S + b;
    sum += Math.abs(img[ia * 4 + c] - img[ib * 4 + c]);
  }
  return sum / S;
}

/** The seam (last line to first) is no harsher than the harshest pair of neighbouring lines inside. */
function assertTiles(name: string, img: Uint8Array, c: number): void {
  for (const rows of [false, true]) {
    let inner = 0;
    for (let k = 0; k < S - 1; k++) inner = Math.max(inner, lineDiff(img, c, k, k + 1, rows));
    const seam = lineDiff(img, c, S - 1, 0, rows);
    assert.ok(seam <= inner + 1, `${name} channel ${c} ${rows ? 'top/bottom' : 'left/right'}: seam ${seam.toFixed(1)} vs at most ${inner.toFixed(1)} inside`);
  }
}

function assertRanges(name: string, l: TexLayer): void {
  assert.equal(l.albedo.length, S * S * 4);
  assert.equal(l.normal.length, S * S * 4);
  let hmin = 255, hmax = 0;
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) assert.ok(l.albedo[o + c] >= 6 && l.albedo[o + c] <= 243, `${name}: albedo clamped to [0.025, 0.95]`);
    assert.ok(l.albedo[o + 3] >= 5, `${name}: roughness >= 0.02`);
    const nx = l.normal[o] / 127.5 - 1, ny = l.normal[o + 1] / 127.5 - 1;
    assert.ok(nx * nx + ny * ny <= 1.02, `${name}: normal xy inside the unit disc`);
    hmin = Math.min(hmin, l.normal[o + 2]); hmax = Math.max(hmax, l.normal[o + 2]);
  }
  assert.equal(hmin, 0, `${name}: height normalised (deepest = 0)`);
  assert.equal(hmax, 255, `${name}: height normalised (highest = 255)`);
}

test('texgen: layers are deterministic, tile seamlessly and keep the channel conventions', () => {
  assert.equal(FACADE_TILE_METERS.length, FACADE_LAYER_COUNT);
  assert.equal(GROUND_TILE_METERS.length, GROUND_LAYER_COUNT);
  assert.equal(INTERIOR_TILE_METERS.length, INTERIOR_LAYER_COUNT);
  for (const [name, gen] of [['facade 11', () => generateFacadeLayer(11, S)], ['ground 5', () => generateGroundLayer(5, S)], ['interior 8', () => generateInteriorLayer(8, S)]] as const) {
    const a = gen(), b = gen();
    assert.deepEqual(a.albedo, b.albedo, `${name}: albedo deterministic`);
    assert.deepEqual(a.normal, b.normal, `${name}: normal deterministic`);
    assertRanges(name, a);
    for (const c of [0, 1, 2]) assertTiles(name, a.albedo, c);
    assertTiles(name, a.normal, 2);
  }
  assert.throws(() => generateGroundLayer(GROUND_LAYER_COUNT, S), /out of range/);
});

test('texgen: the noise, cells and block layouts the layers are made of wrap around the tile', () => {
  const n = new TNoise(7, 2.4), cell = newCell(), cell2 = newCell();
  const layout = randomCourses(2.4, [0.4, 0.4, 0.4, 0.4, 0.4, 0.4], 0.5, 1.0, 66), h1 = newHit(), h2 = newHit();
  for (let k = 0; k < 50; k++) {
    const u = (k * 0.137) % 1, v = (k * 0.291) % 1;
    for (const f of [(a: number, b: number) => n.fbm(a, b, 0.3, 4), (a: number, b: number) => n.ridged(a, b, 0.5, 3), (a: number, b: number) => n.turb(a, b, 0.2, 3, 0.5, 0.7)]) {
      assert.ok(Math.abs(f(u, v) - f(u + 1, v)) < 1e-9 && Math.abs(f(u, v) - f(u, v + 1)) < 1e-9, 'TNoise is periodic in u and v');
    }
    worley(3, u * 9, v * 9, 9, 9, 1, cell, true);
    worley(3, u * 9 + 9, v * 9 - 9, 9, 9, 1, cell2, true);
    assert.equal(cell.id, cell2.id, 'worley cells wrap');
    assert.ok(Math.abs(cell.f1 - cell2.f1) < 1e-9 && Math.abs(cell.edge - cell2.edge) < 1e-9, 'worley distances wrap');
    layout.at(u * 2.4, v * 2.4, h1);
    layout.at(u * 2.4 - 2.4, v * 2.4 + 2.4, h2);
    assert.equal(h1.id, h2.id, 'block layouts wrap');
  }
});
