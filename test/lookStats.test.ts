import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfToFloat, lookStats, lookVerdict } from '../src/render/lookStats';

/** n covered pixels of one colour, plus as many uncovered (alpha 0) ones. */
function swatch(n: number, rgb: [number, number, number]): Float32Array {
  const px = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) px.set([...rgb, 1], i * 4);
  return px;
}

test('looks: the verdict names each way a shader breaks, and passes plain finishes', () => {
  const judge = (rgb: [number, number, number], even = true, dark = false) => lookVerdict(lookStats(swatch(100, rgb)), { even, expectPx: 100, dark });
  assert.equal(judge([0.3, 0.25, 0.2]), 'ok');
  assert.equal(judge([0.0012, 0.0013, 0.0014]), 'ok', 'black paint still has a colour of its own');
  assert.equal(judge([0, 0, 0]), 'black', 'the street furniture bug: no colour under even light');
  assert.equal(judge([0, 0, 0], true, true), 'ok', 'a mirror metal has no diffuse colour');
  assert.equal(judge([0, 0, 0], false), 'ok', 'black is judged under even light only');
  assert.equal(judge([9, 9, 9]), 'white');
  assert.equal(judge([1, 0, 1], false), 'magenta');
  assert.equal(judge([NaN, 0, 0], false), 'nan');
  assert.equal(lookVerdict(lookStats(swatch(10, [0.3, 0.3, 0.3])), { even: true, expectPx: 100 }), 'empty');
  assert.equal(lookVerdict(lookStats(swatch(10, [0, 0, 0])), { even: true, expectPx: 100, seeThrough: true }), 'ok', 'rain and smoke are faint by design');
});

test('looks: half floats decode', () => {
  assert.equal(halfToFloat(0x3c00), 1);
  assert.equal(halfToFloat(0xc000), -2);
  assert.equal(halfToFloat(0x7c00), Infinity);
  assert.ok(Number.isNaN(halfToFloat(0x7e00)));
});
