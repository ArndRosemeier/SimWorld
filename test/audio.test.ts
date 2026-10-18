import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, type SoundMap, type SoundSource } from '../src/audio/soundMap';
import { Soundscape, SCHOOL_BELLS, type Listener, type SoundEnv } from '../src/audio/soundscape';
import { moodOf, nextPiece, parseTracks } from '../src/audio/music';
import { soundEnvOf, soundOverrides } from '../src/audio/env';
import { DEFAULT_LATITUDE, daysOf, epochFor } from '../src/sim/calendar';
import { strikesIn } from '../src/sim/weather';
import { StreetSounds, type StreetAudio } from '../src/traffic/sounds';
import type { TrafficMsg } from '../src/traffic/feed';
import { VEHICLE_KINDS } from '../src/build/vehicles';
import { ROOM_IDS, ROOM_SLOT, murmurLevel, reverbOf, roomKindOf, roomMix, roomShots, type Room, type RoomPerson } from '../src/audio/room';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../public/sounds/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** A 1 km square town: built in the middle, a river along the east edge, gardens, a church, a school, a farm. */
function testMap(): SoundMap {
  const n = 25, step = 40, x0 = -500, z0 = -500;
  const grid = Object.fromEntries(CHANNELS.map((c) => [c, new Uint8Array(n * n)])) as SoundMap['grid'];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = x0 + (i + 0.5) * step;
    grid.built[k] = Math.abs(x) < 250 ? 200 : 0;
    grid.water[k] = x > 400 ? 255 : 0;
    grid.rural[k] = Math.abs(x) > 300 ? 230 : 0;
  }
  const sources: SoundSource[] = [
    { kind: 'church', x: 0, y: 25, z: 0 },
    { kind: 'school', x: 100, y: 2, z: 0 },
    { kind: 'farm', x: -450, y: 1, z: 0 },
  ];
  for (let i = 0; i < 40; i++) sources.push({ kind: 'garden', x: -200 + (i % 8) * 25, y: 1, z: 150 + Math.floor(i / 8) * 25 });
  return { x0, z0, step, n, grid, height: new Float32Array(n * n), sources, coastal: false };
}

const map = testMap();
const here: Listener = { x: 20, y: 1.7, z: 20, ground: 0 };
/** Game clock of weekday `d` (0 Monday) at hh:mm. */
const at = (d: number, hh: number, mm = 0): number => d * 1440 + hh * 60 + mm;
const env = (clock: number, o: Partial<SoundEnv> = {}): SoundEnv => ({ clock, month: 5, night: 0, rain: 0, wind: 0.1, ...o });

/** Every shot of one game minute (the soundscape is primed at the minute before). */
function minuteShots(s: Soundscape, clock: number, o: Partial<SoundEnv> = {}, l = here) {
  s.shots(l, env(clock - 1, o));
  return s.shots(l, env(clock, o));
}

test('the church strikes the hour by day and keeps quiet at night; the strikes are spaced and carry far', () => {
  const s = new Soundscape(map, 1);
  const three = minuteShots(s, at(2, 15)).filter((x) => x.id === 'bell_toll');
  assert.equal(three.length, 3);
  assert.deepEqual(three.map((x) => x.delay), [0, 2.6, 5.2]);
  assert.ok(three.every((x) => x.y === 25 && x.refDist >= 60));
  assert.equal(minuteShots(new Soundscape(map, 1), at(2, 12)).filter((x) => x.id === 'bell_toll').length, 12);
  assert.equal(minuteShots(new Soundscape(map, 1), at(2, 23)).filter((x) => x.id === 'bell_toll').length, 0);
  assert.equal(minuteShots(new Soundscape(map, 1), at(2, 15, 1)).filter((x) => x.id === 'bell_toll').length, 0);
  assert.equal(minuteShots(new Soundscape(map, 1), at(2, 15), {}, { x: 4000, y: 2, z: 0, ground: 0 }).length, 0, 'out of earshot');
});

test('the school bell rings on school days only, the schoolyard is loud at break, the Sunday peal before the service', () => {
  for (const m of SCHOOL_BELLS) {
    assert.equal(minuteShots(new Soundscape(map, 2), at(1, 0, m)).filter((x) => x.id === 'school_bell').length, 1);
    assert.equal(minuteShots(new Soundscape(map, 2), at(5, 0, m)).filter((x) => x.id === 'school_bell').length, 0, 'Saturday');
    assert.equal(minuteShots(new Soundscape(map, 2), at(1, 0, m), { schoolDay: false }).filter((x) => x.id === 'school_bell').length, 0, 'holidays');
  }
  const s = new Soundscape(map, 2);
  assert.ok(s.loops(here, env(at(1, 10))).some((c) => c.id === 'kids_playground'));
  assert.ok(!s.loops(here, env(at(1, 11))).some((c) => c.id === 'kids_playground'));
  assert.ok(!s.loops(here, env(at(1, 10), { rain: 0.6 })).some((c) => c.id === 'kids_playground'), 'they stay in when it pours');
  assert.ok(s.loops(here, env(at(6, 9, 47))).some((c) => c.id === 'bell_peal'));
  assert.ok(!s.loops(here, env(at(6, 10, 5))).some((c) => c.id === 'bell_peal'));
  assert.ok(!s.loops(here, env(at(0, 9, 47))).some((c) => c.id === 'bell_peal'));
});

test('lawns are mown on dry Saturdays in the season, never on Sundays, at most three mowers heard', () => {
  const s = new Soundscape(map, 3);
  const garden: Listener = { x: -100, y: 1.7, z: 200, ground: 0 };
  const count = (d: number, o: Partial<SoundEnv> = {}): number => {
    let most = 0, total = 0;
    for (let m = 9 * 60; m < 18 * 60; m += 7) {
      const k = s.loops(garden, env(at(d, 0, m), o)).filter((c) => c.id === 'lawnmower').length;
      most = Math.max(most, k); total += k;
    }
    assert.ok(most <= 3);
    return total;
  };
  assert.ok(count(5) > 0, 'Saturday');
  assert.equal(count(6), 0, 'Sunday');
  assert.equal(count(5, { rain: 0.3 }), 0, 'wet');
  assert.equal(count(5, { month: 0 }), 0, 'January');
});

test('the same minute always sounds the same; a jump in time is not replayed', () => {
  const run = (): string => {
    const s = new Soundscape(map, 4);
    const out: string[] = [];
    for (let m = at(1, 6); m < at(1, 9); m++) for (const x of s.shots(here, env(m))) out.push(`${m}:${x.id}:${x.delay.toFixed(2)}`);
    return out.join(',');
  };
  assert.equal(run(), run());
  assert.ok(run().includes('dog_bark'), 'dogs bark in the morning');
  const s = new Soundscape(map, 4);
  s.shots(here, env(at(2, 6, 59)));
  assert.equal(s.shots(here, env(at(2, 14, 5))).filter((x) => x.id === 'bell_toll').length, 0, 'the skipped hours do not all ring at once');
});

test('the beds follow the place, the hour, the weather and the height', () => {
  const s = new Soundscape(map, 5);
  const town = s.ambience(here, env(at(1, 8))).levels;
  assert.ok(town.amb_city_day > 0.3 && town.amb_city_night < 0.01 && town.amb_river < 0.01);
  const riverside = s.ambience({ x: 480, y: 1.7, z: 0, ground: 0 }, env(at(1, 8))).levels;
  assert.ok(riverside.amb_river > 0.5 && riverside.amb_city_day < town.amb_city_day);
  const night = s.ambience(here, env(at(1, 2), { night: 1 })).levels;
  assert.ok(night.amb_city_night > 0.3 && night.amb_city_day < 0.01);
  assert.ok(s.ambience(here, env(at(6, 8))).levels.amb_city_day < town.amb_city_day, 'a quiet Sunday morning');
  const rain = s.ambience(here, env(at(1, 8), { rain: 0.9 })).levels;
  assert.ok(rain.amb_rain_heavy > 0.8 && rain.amb_city_day < town.amb_city_day);
  const high = s.ambience({ ...here, y: 600 }, env(at(1, 8)));
  assert.ok(high.muffle < 3000 && high.levels.amb_city_day < town.amb_city_day && high.levels.amb_wind_gust > 0.3);
  assert.equal(s.ambience(here, env(at(1, 8))).muffle, 20000);
});

test('music: the piece fits the hour and the weather, falls back to a day piece, never repeats when there is a choice', () => {
  const tracks = parseTracks({ tracks: { title: { file: 't.mp3', seconds: 100, mood: 'title' }, d1: { file: 'a.mp3', seconds: 90, mood: 'day' }, d2: { file: 'b.mp3', seconds: 90, mood: 'day' }, n: { file: 'n.mp3', seconds: 90, mood: 'night' }, bad: { file: 3 } } });
  assert.deepEqual(Object.keys(tracks), ['title', 'd1', 'd2', 'n']);
  assert.equal(moodOf(env(at(1, 14))), 'day');
  assert.equal(moodOf(env(at(1, 2), { night: 1 })), 'night');
  assert.equal(moodOf(env(at(1, 14), { rain: 0.5 })), 'rain');
  assert.equal(moodOf(env(at(6, 9))), 'sunday');
  assert.equal(nextPiece(tracks, env(at(1, 2), { night: 1 }), 1, 0, null).id, 'n');
  assert.ok(['d1', 'd2'].includes(nextPiece(tracks, env(at(1, 19)), 1, 0, null).id!), 'no evening piece: a day piece');
  for (let i = 0; i < 20; i++) assert.notEqual(nextPiece(tracks, env(at(1, 14)), 1, i, 'd1').id, 'd1');
  const g = nextPiece(tracks, env(at(1, 14)), 1, 0, null).gap;
  assert.ok(g >= 240 && g <= 600);
});

test('the environment comes from the calendar and the weather: night by the sun, Christmas rings like a Sunday, no school then', () => {
  // The world as the screen hands it to the sound (src/game/SimClient.ts screenWorld): the date's week, the minute.
  const hear = (q: URLSearchParams) => {
    const [y, mo, d] = q.get('date')!.split('-').map(Number), [hh, mm] = q.get('time')!.split(':').map(Number);
    const epoch = epochFor({ year: y, month: mo, day: d }, 0);
    const world = { seed: 7, epoch, latitude: DEFAULT_LATITUDE, clock: (daysOf(y, mo, d) - epoch) * 1440 + hh * 60 + mm };
    return soundEnvOf(world, undefined, soundOverrides(q));
  };
  const at = (date: string, time: string) => hear(new URLSearchParams({ date, time }));
  const xmas = at('2026-12-25', '09:45');
  assert.equal(xmas.feast, true);
  assert.equal(xmas.schoolDay, false);
  assert.equal(xmas.month, 11);
  assert.ok(new Soundscape(map, 1).loops(here, xmas).some((c) => c.id === 'bell_peal'), 'a Christmas morning peal');
  const tue = at('2026-10-20', '12:00');
  assert.equal(tue.schoolDay, true);
  assert.ok(tue.night < 0.05 && at('2026-10-20', '02:00').night > 0.95);
  assert.ok(at('2026-06-20', '21:00').night < at('2026-12-20', '21:00').night + 1e-9 && at('2026-12-20', '17:30').night > 0.9, 'December dusk comes early');
  const wet = hear(new URLSearchParams({ date: '2026-10-20', time: '12:00', rain: '0.8' }));
  assert.equal(wet.rain, 0.8);
  assert.deepEqual(strikesIn(3, 100, 0), []);
  assert.deepEqual(strikesIn(3, 100, 1), strikesIn(3, 100, 1));
  let n = 0;
  for (let m = 0; m < 200; m++) n += strikesIn(3, m, 1).length;
  assert.ok(n > 120 && n < 320, `${n} strikes in 200 storm minutes`);
});

test('the agenda rings the bells: the peal before each service, after a wedding, the knell before a funeral; none at the town hall', () => {
  const s = new Soundscape(map, 4);
  const church = { x: 30, z: 10 }, hall = { x: -200, z: -300 };
  const service = { kind: 'service' as const, start: at(6, 10), end: at(6, 11), ...church };
  const peal = (clock: number, occasions: SoundEnv['occasions']) => s.loops(here, env(clock, { occasions })).filter((c) => c.id === 'bell_peal');
  assert.equal(peal(at(6, 9, 45), [service]).length, 1, 'before the service');
  assert.equal(peal(at(6, 9, 45), [service])[0].y, 25, 'from the tower');
  assert.equal(peal(at(6, 9, 56), [service]).length, 0, 'quiet once it starts');
  assert.equal(peal(at(6, 9, 45), []).length, 0, 'no service today: no peal');
  const wedding = { kind: 'wedding' as const, start: at(5, 13), end: at(5, 14), ...church };
  assert.equal(peal(at(5, 13, 30), [wedding]).length, 0);
  assert.equal(peal(at(5, 14, 3), [wedding]).length, 1, 'as the couple come out');
  assert.equal(peal(at(5, 14, 3), [{ ...wedding, ...hall }]).length, 0, 'the town hall has no bells');
  assert.ok(minuteShots(new Soundscape(map, 4), at(5, 14), { occasions: [wedding] }).some((x) => x.id === 'crowd_cheer'));
  const funeral = { kind: 'funeral' as const, start: at(2, 11), end: at(2, 12, 30), ...church };
  const knell = minuteShots(new Soundscape(map, 4), at(2, 10, 55), { occasions: [funeral] }).filter((x) => x.id === 'bell_toll');
  assert.deepEqual(knell.map((x) => x.delay), [0, 20, 40]);
  assert.ok(knell.every((x) => x.pitch < 1), 'a deeper, slower stroke');
  assert.equal(minuteShots(new Soundscape(map, 4), at(2, 11, 5), { occasions: [funeral] }).filter((x) => x.id === 'bell_toll').length, 0);
});

test('the agenda fills the square: the market crowd while it runs, the match with its whistles, nothing out of earshot', () => {
  const s = new Soundscape(map, 5);
  const market = { kind: 'market' as const, start: at(5, 7, 30), end: at(5, 13), x: 0, z: 60 };
  const crowd = (clock: number, l = here) => s.loops(l, env(clock, { occasions: [market] })).filter((c) => c.id === 'amb_crowd');
  assert.equal(crowd(at(5, 10)).length, 1);
  assert.equal(crowd(at(5, 14)).length, 0, 'packed up');
  assert.equal(crowd(at(5, 10), { x: 2000, y: 2, z: 0, ground: 0 }).length, 0, 'out of earshot');
  assert.ok(s.loops(here, env(at(5, 10), { occasions: [market], rain: 1 })).find((c) => c.id === 'amb_crowd')!.gain < crowd(at(5, 10))[0].gain, 'fewer people in the rain');
  const match = { kind: 'match' as const, start: at(5, 15), end: at(5, 16, 45), x: 50, z: -40 };
  const whistles = [at(5, 15), at(5, 15, 45), at(5, 16), at(5, 16, 45)];
  for (const m of whistles) assert.ok(minuteShots(new Soundscape(map, 5), m, { occasions: [match] }).some((x) => x.id === 'ref_whistle'), `whistle at ${m}`);
  assert.ok(!minuteShots(new Soundscape(map, 5), at(5, 15, 20), { occasions: [match] }).some((x) => x.id === 'ref_whistle'));
  assert.ok(minuteShots(new Soundscape(map, 5), at(5, 15, 20), { occasions: [match] }).some((x) => x.id === 'ball_kick'));
});

test('street sounds: a car rushes past once, a bus hisses as it stands, a siren loops while it is on, a horn at its moment', () => {
  const kind = (k: string) => VEHICLE_KINDS.indexOf(k as never);
  // Three vehicles over six seconds: a car along z = 5 through the listener's street, an ambulance on a call, a bus standing.
  const msg = (siren: boolean): TrafficMsg => ({
    times: Float64Array.from([10, 10.1]),
    cars: Int32Array.from([1, kind('sedan'), 0, 2, kind('ambulance'), 0, 3, kind('bus'), 0]),
    poses: Float32Array.from([-100, 0, 5, 0, 100, 0, 5, 0, 300, 0, 0, 0, 300, 0, 50, 0, 20, 0, 20, 0, 20, 0, 20, 0]),
    state: Float32Array.from([1, 0, 0, 1, 1, 0, siren ? 3 : -3, 1, 1, 0, 2, 1]),
    paint: new Float32Array(9), parked: null, parkedCars: null, posts: null, closed: new Uint8Array(0),
    horns: Float64Array.from([10.05, 10, 1, 10, 1]),
  });
  const heard: string[] = [];
  const loops = new Map<string, number>();
  const audio: StreetAudio = {
    play: (id) => { heard.push(id); },
    loop: (id) => { loops.set(id, (loops.get(id) ?? 0) + 1); return { set: () => {}, stop: () => loops.set(id, loops.get(id)! - 1) }; },
  };
  const s = new StreetSounds(), m = msg(true);
  for (let c = 10; c <= 10.1; c += 0.1 / 60) s.listen(0.1, 0, 1.7, 0, c, m, audio);
  assert.deepEqual(heard.filter((h) => h === 'car_passby').length, 1);
  assert.deepEqual(heard.filter((h) => h === 'bus_airbrake').length, 1);
  assert.deepEqual(heard.filter((h) => h.startsWith('car_horn')), ['car_horn_long']);
  assert.equal(loops.get('ambulance_siren'), 1, 'one siren, kept going');
  assert.equal(loops.get('car_idle'), undefined, 'no engine standing near the listener');
  // At the scene the blue lights stay on, the siren stops.
  s.listen(0.1, 0, 1.7, 0, 10.1, msg(false), audio);
  assert.equal(loops.get('ambulance_siren'), 0);
});

test('a room murmurs with the people in it: a packed pub roars, a shop hums, a sleeping home is near silent', () => {
  assert.equal(roomKindOf('pub'), 'bar');
  assert.equal(roomKindOf('cafe'), 'cafe');
  assert.equal(roomKindOf('supermarket'), 'shop');
  assert.equal(roomKindOf('house'), 'home');
  assert.equal(roomKindOf('church'), 'church');
  assert.equal(murmurLevel('bar', 1), 0, 'nobody talks alone');
  assert.ok(murmurLevel('bar', 3) < murmurLevel('bar', 8) && murmurLevel('bar', 8) < murmurLevel('bar', 14));
  assert.equal(murmurLevel('bar', 40), murmurLevel('bar', 14), 'full is full');
  const crowd = (n: number, awake = true): RoomPerson[] => Array.from({ length: n }, (_, i) => ({ x: (i % 5) * 1.2, y: 0, z: Math.floor(i / 5) * 1.2, awake }));
  const l = { x: 0, y: 1.6, z: 0 };
  const level = (room: Room, id: string) => roomMix(room, l).find((c) => c.id === id)!.gain;
  assert.ok(level({ kind: 'bar', people: crowd(14) }, 'amb_crowd') > 0.9);
  assert.ok(level({ kind: 'bar', people: crowd(14) }, 'terrace_clatter') > 0.3, 'glasses and cutlery under the voices');
  assert.ok(level({ kind: 'shop', people: crowd(14) }, 'amb_crowd') < level({ kind: 'bar', people: crowd(14) }, 'amb_crowd') / 2);
  assert.ok(level({ kind: 'shop', people: crowd(2) }, 'amb_interior') > level({ kind: 'bar', people: crowd(2) }, 'amb_interior'), 'a shop hums');
  const sleeping: Room = { kind: 'home', people: crowd(3, false) };
  assert.equal(level(sleeping, 'amb_crowd'), 0);
  assert.ok(level(sleeping, 'amb_interior') < level({ kind: 'home', people: crowd(3) }, 'amb_interior'));
  assert.ok(reverbOf('church').seconds > 2 * reverbOf('bar').seconds && reverbOf('church').wet > reverbOf('home').wet, 'a hush with a long echo');
});

test('the small sounds of a room: clinks in the pub, none from the sleeping or in the church; seeded', () => {
  const crowd = (n: number, awake = true): RoomPerson[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, awake }));
  const over = (room: Room) => Array.from({ length: 300 }, (_, slot) => roomShots(room, 9, slot)).flat();
  const pub = over({ kind: 'bar', people: crowd(12) });
  assert.ok(pub.filter((s) => s.clink > 0).length > 60, 'glasses clink');
  assert.ok(pub.every((s) => s.delay >= 0 && s.delay < ROOM_SLOT + 3));
  assert.equal(over({ kind: 'home', people: crowd(3, false) }).length, 0, 'asleep: silence');
  assert.equal(over({ kind: 'church', people: crowd(20) }).filter((s) => s.clink > 0).length, 0);
  assert.deepEqual(roomShots({ kind: 'bar', people: crowd(12) }, 9, 17), roomShots({ kind: 'bar', people: crowd(12) }, 9, 17));
  for (const id of ROOM_IDS) assert.ok(id in manifest, `${id} in the manifest`);
});

test('indoors the street and the weather go dull and quiet', () => {
  const s = new Soundscape(map, 1);
  const out = s.ambience(here, env(at(2, 12), { rain: 0.8 }));
  const inside = s.ambience({ ...here, indoor: 1 }, env(at(2, 12), { rain: 0.8 }));
  assert.ok(inside.muffle < 3000 && out.muffle > 15000);
  assert.ok(inside.levels.amb_rain_heavy < out.levels.amb_rain_heavy / 2);
});
