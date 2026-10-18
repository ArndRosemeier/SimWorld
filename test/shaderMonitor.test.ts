import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderMonitor } from '../src/render/shaders/monitor';

test('monitor: a blocking build over 100 ms is a violation, an async one is not', () => {
  const m = new ShaderMonitor(() => 0);
  m.record('node-sync', 120, 'rock', 0);
  m.record('gpu-pipeline-async', 300, 'rock', 0);
  const v = m.violations();
  assert.equal(v.length, 1);
  assert.match(v[0], /node-sync "rock" blocked 120 ms/);
});

test('monitor: a blocking build over the 10 ms target is a warning, not a violation', () => {
  const m = new ShaderMonitor(() => 0);
  m.record('gl-link', 35, 'facade', 0);
  m.record('gl-link', 6, 'ground', 500);
  assert.deepEqual(m.violations(), []);
  assert.equal(m.warnings().length, 1);
  assert.match(m.warnings()[0], /"facade" took 35 ms/);
});

test('monitor: after warm-up, the next build must start >= 200 ms after the previous one ended', () => {
  const m = new ShaderMonitor(() => 0);
  for (let i = 0; i < 10; i++) m.record('node-sync', 5, 'w', i); // warm-up: anything goes
  assert.deepEqual(m.violations(), []);
  m.phase = 'run';
  // 50 ms builds, each starting 200 ms after the previous ended: 250 ms apart.
  for (let i = 0; i < 4; i++) m.record('node-async', 50, 'ok', 1000 + i * 250);
  assert.deepEqual(m.violations(), []);
  // Starts 200 ms after the previous *start*, but only 150 ms after it ended.
  m.record('node-async', 50, 'too soon', 1000 + 3 * 250 + 200);
  assert.ok(m.violations().some((v) => v.includes('"too soon" started 150 ms after the previous build ended')));
});

test('monitor: more than 5 starts within a second is a violation', () => {
  const m = new ShaderMonitor(() => 0);
  m.phase = 'run';
  for (let i = 0; i < 6; i++) m.record('node-async', 1, 'x', i * 199);
  assert.ok(m.violations().some((v) => v.includes('within one second')));
});
