import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, TIMES_OF_DAY, minuteOfDay, minutesUntil } from '../src/sim/time';

test('time skip until a time of day: the next one at least half an hour on, never back in time', () => {
  const day = 10 * MINUTES_PER_DAY;
  assert.equal(minutesUntil(day + 9 * 60, TIMES_OF_DAY.noon), 3 * 60, 'nine in the morning to noon');
  assert.equal(minutesUntil(day + 13 * 60, TIMES_OF_DAY.noon), 23 * 60, 'past noon: noon tomorrow');
  assert.equal(minutesUntil(day + 6 * 60 + 50, TIMES_OF_DAY.morning), MINUTES_PER_DAY + 10, 'ten minutes before: the next morning');
  for (let c = day; c < day + MINUTES_PER_DAY; c += 37) {
    for (const at of Object.values(TIMES_OF_DAY)) {
      const n = minutesUntil(c, at);
      assert.ok(n >= 30 && n < MINUTES_PER_DAY + 30 && minuteOfDay(c + n) === at, `${c} to ${at}: ${n}`);
    }
  }
});
