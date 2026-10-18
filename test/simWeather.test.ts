import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateOf, daysOf, gameDayOf, moonPhase, moonPosition, sunPosition, sunTimes } from '../src/sim/calendar';
import { WeatherModel, describeWeather, heatingShare, weatherAt } from '../src/sim/weather';

test('sky: the sun stands where the calendar says, the moon has its real phase', () => {
  const w = { epoch: daysOf(2025, 12, 29), seed: 1, latitude: 51 };
  const at = (m: number, d: number, minute: number) => gameDayOf(w, 2026, m, d) * 1440 + minute;
  const june = sunTimes(dateOf(w, at(6, 21, 0)), 51);
  // Noon (13:00 summer time) due south and high; up in the east at 07:00; below the horizon at midnight; on the
  // horizon at sunrise.
  const noon = sunPosition(w, at(6, 21, 13 * 60));
  assert.ok(Math.abs(noon.azimuth - Math.PI) < 0.01 && noon.elevation > 1.0 && noon.dir[2] > 0.3);
  assert.ok(sunPosition(w, at(6, 21, 7 * 60)).dir[0] > 0.5);
  assert.ok(sunPosition(w, at(6, 21, 0)).elevation < 0);
  assert.ok(Math.abs(sunPosition(w, at(6, 21, june.rise)).elevation * 180 / Math.PI + 0.83) < 0.3);
  // A real full moon: 26 October 2026.
  assert.ok(Math.abs(moonPhase(w, at(10, 26, 12 * 60)) - 0.5) < 0.04);
  assert.ok(moonPosition(w, at(10, 26, 0)).elevation > 0.5, 'a full moon is high at midnight');
});

test('weather: a pure function of the minute, with seasons, snow in winter and wet streets after rain', () => {
  const e = daysOf(2025, 12, 29);
  const a = new WeatherModel(7, e), b = new WeatherModel(7, e);
  // The same answer whatever was asked before, also across the weekly handover.
  const probe = [3 * 1440 + 600, 7 * 1440 + 30, 7 * 1440 + 90, 40 * 1440 + 777];
  const fwd = probe.map((c) => a.weather(c));
  const back = [...probe].reverse().map((c) => b.weather(c)).reverse();
  assert.deepEqual(fwd, back);
  let janT = 0, julT = 0, julSnow = 0, wetAfterRain = 0, rainy = 0;
  const jan = (daysOf(2026, 1, 5) - e) * 1440, jul = (daysOf(2026, 7, 6) - e) * 1440;
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

test('weather: keyed to the date, so a town started on any day sees the same Christmas', () => {
  const a = daysOf(2026, 11, 2), b = daysOf(2026, 12, 21); // two Mondays
  const xmas = daysOf(2026, 12, 25);
  const wa = new WeatherModel(5, a).weather((xmas - a) * 1440 + 600), wb = new WeatherModel(5, b).weather((xmas - b) * 1440 + 600);
  assert.equal(wa.kind, wb.kind);
  assert.ok(Math.abs(wa.tempC - wb.tempC) < 1e-9 && Math.abs(wa.snowCm - wb.snowCm) < 1e-6 && Math.abs(wa.windDir - wb.windDir) < 1e-9);
});

test('weather: homes heat when it is cold, most in the morning and the evening', () => {
  assert.equal(heatingShare(20, 8 * 60), 0);
  assert.ok(heatingShare(0, 8 * 60) > 0.85);
  assert.ok(heatingShare(8, 8 * 60) > heatingShare(12, 8 * 60));
  assert.ok(heatingShare(0, 3 * 60) < heatingShare(0, 19 * 60) / 2);
});
