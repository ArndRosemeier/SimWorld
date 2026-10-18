import { test } from 'node:test';
import assert from 'node:assert/strict';
import { civilDay, clockAt, dateAt, dateOfCivil, easterOf, epochFor, holidayOn, isDst, isMonday, moonPhase, seasonOf, sunAt, sunTimes } from '../src/sim/calendar';
import { WeatherModel, describeWeather, weatherAt } from '../src/sim/weather';
import { weekdayOf } from '../src/sim/time';

test('calendar: civil days round-trip, epochs are Mondays and agree with the game weekday', () => {
  for (const n of [-800000, -1, 0, 59, 10957, 20744, 40000]) {
    const d = dateOfCivil(n);
    assert.equal(civilDay(d.year, d.month, d.day), n);
  }
  assert.deepEqual(dateOfCivil(civilDay(2026, 10, 18)), { year: 2026, month: 10, day: 18, weekday: 6, dayOfYear: 290 });
  const epoch = epochFor({ year: 2026, month: 10, day: 18 }, 365 * 3);
  assert.ok(isMonday(epoch));
  const clock = clockAt(epoch, { year: 2026, month: 10, day: 18 }, 9 * 60);
  assert.equal(weekdayOf(clock), 6);
  assert.equal(dateAt(epoch, clock).day, 18);
  assert.equal(seasonOf(dateAt(epoch, clock)), 'autumn');
});

test('calendar: holidays, daylight saving, the sun and the moon', () => {
  assert.deepEqual(easterOf(2026), { month: 4, day: 5 });
  assert.deepEqual(easterOf(2027), { month: 3, day: 28 });
  assert.equal(holidayOn({ year: 2026, month: 4, day: 3 }), 'goodFriday');
  assert.equal(holidayOn({ year: 2026, month: 12, day: 25 }), 'christmasDay');
  assert.equal(holidayOn({ year: 2026, month: 10, day: 30 }), null);
  assert.equal(isDst({ year: 2026, month: 3, day: 28 }), false);
  assert.equal(isDst({ year: 2026, month: 3, day: 29 }), true);
  assert.equal(isDst({ year: 2026, month: 10, day: 25 }), false);
  const e = civilDay(2025, 12, 29);
  const day = (m: number, d: number) => (civilDay(2026, m, d) - e) * 1440;
  const june = sunTimes(e, day(6, 21)), dec = sunTimes(e, day(12, 21));
  assert.ok(june.daylight / 60 > 16 && june.daylight / 60 < 16.8, `${june.daylight}`);
  assert.ok(dec.daylight / 60 > 7.8 && dec.daylight / 60 < 8.4, `${dec.daylight}`);
  assert.ok(june.sunset > 21 * 60 && dec.sunset < 16.5 * 60);
  // Noon sun due south and high in summer; morning sun in the east; below the horizon at midnight.
  const noon = sunAt(e, day(6, 21) + Math.round(june.noon));
  assert.ok(Math.abs(noon.azimuth - Math.PI) < 0.02 && noon.elevation > 1.0 && noon.dir[2] > 0.3);
  assert.ok(sunAt(e, day(6, 21) + 7 * 60).dir[0] > 0.5);
  assert.ok(sunAt(e, day(6, 21)).elevation < 0);
  // A real full moon: 26 October 2026.
  assert.ok(Math.abs(moonPhase(e, day(10, 26) + 12 * 60) - 0.5) < 0.04);
});

test('weather: a pure function of the minute, with seasons, snow in winter and wet streets after rain', () => {
  const e = civilDay(2025, 12, 29);
  const a = new WeatherModel(7, e), b = new WeatherModel(7, e);
  // The same answer whatever was asked before, also across the weekly handover.
  const probe = [3 * 1440 + 600, 7 * 1440 + 30, 7 * 1440 + 90, 40 * 1440 + 777];
  const fwd = probe.map((c) => a.weather(c));
  const back = [...probe].reverse().map((c) => b.weather(c)).reverse();
  assert.deepEqual(fwd, back);
  let janT = 0, julT = 0, julSnow = 0, wetAfterRain = 0, rainy = 0;
  const jan = (civilDay(2026, 1, 5) - e) * 1440, jul = (civilDay(2026, 7, 6) - e) * 1440;
  for (let h = 0; h < 21 * 24; h += 3) {
    const w = a.weather(jan + h * 60), s = a.weather(jul + h * 60);
    janT += w.tempC; julT += s.tempC; julSnow += s.snow;
    if (s.rain > 0.2) { rainy++; if (a.weather(jul + h * 60 + 30).wet > 0.3) wetAfterRain++; }
  }
  const n = (21 * 24) / 3;
  assert.ok(janT / n < 3 && julT / n > 14, `jan ${janT / n} jul ${julT / n}`);
  assert.equal(julSnow, 0);
  assert.ok(rainy === 0 || wetAfterRain / rainy > 0.8);
  // A winter with lying snow somewhere in it, for most seeds.
  let snowy = 0;
  for (let s = 1; s <= 4; s++) {
    const m = new WeatherModel(s, e);
    for (let d = 0; d < 60; d += 2) if (m.weather((d + 3) * 1440 + 720).snowCm > 1) { snowy++; break; }
  }
  assert.ok(snowy >= 3, `snowy winters ${snowy}/4`);
  assert.match(describeWeather(a.weather(jan)), /°C$/);
  const world = { seed: 7, epoch: e, clock: jan };
  assert.equal(weatherAt(world), weatherAt(world));
  assert.deepEqual(weatherAt(world), a.weather(jan));
});
