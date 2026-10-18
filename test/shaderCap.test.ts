import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderCap } from '../src/render/shaders/cap';

/** A fake clock with 60 fps frames: every requested frame callback runs 16.7 ms later. */
function sim() {
  let t = 0;
  const frames: (() => void)[] = [];
  const cap = new ShaderCap(() => t, (fn) => frames.push(fn));
  const step = () => { t += 1000 / 60; cap.newFrame(); const f = frames.splice(0); for (const fn of f) fn(); };
  return { cap, step, now: () => t };
}

test('warm-up: no cap while inactive', async () => {
  const { cap } = sim();
  for (let i = 0; i < 20; i++) (await cap.slot())();
});

test('active: one at a time, next starts >= 200 ms after the previous ended, <= 5 per second, one per frame', async () => {
  const { cap, step, now } = sim();
  cap.active = true;
  const builds: { start: number; end: number }[] = [];
  let pending = 0;
  // Each build takes 3 frames (50 ms) before it releases its slot.
  for (let i = 0; i < 12; i++) {
    pending++;
    void cap.slot().then((release) => {
      const b = { start: now(), end: -1 };
      builds.push(b);
      let left = 3;
      const tick = () => { if (--left > 0) { queue.push(tick); return; } b.end = now(); release(); pending--; };
      queue.push(tick);
    });
  }
  const queue: (() => void)[] = [];
  for (let f = 0; f < 60 * 10 && pending; f++) { step(); await Promise.resolve(); for (const fn of queue.splice(0)) fn(); }
  assert.equal(builds.length, 12);
  for (let i = 1; i < builds.length; i++) {
    assert.ok(builds[i].start >= builds[i - 1].end, 'one in flight');
    assert.ok(builds[i].start - builds[i - 1].end >= 200 - 1e-6, `gap ${builds[i].start - builds[i - 1].end}`);
  }
  for (const b of builds) assert.ok(builds.filter((x) => x.start > b.start - 1000 && x.start <= b.start).length <= 5);
});

test('a build that never releases blocks the next one', async () => {
  const { cap, step } = sim();
  cap.active = true;
  await cap.slot(); // never released
  let got = false;
  void cap.slot().then(() => { got = true; });
  for (let f = 0; f < 120; f++) { step(); await Promise.resolve(); }
  assert.equal(got, false);
});
