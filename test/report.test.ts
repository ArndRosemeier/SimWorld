import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLook, parseStand, reportText, reproParams, reproUrl, type ReportFacts } from '../src/game/report';

const base: ReportFacts = {
  version: 'v0.131', realTime: '2026-10-18 18:20', base: 'https://example.test/SimWorld/',
  params: [['wx', 'rain'], ['resume', ''], ['time', '07:00'], ['seed', '9']],
  seed: 42, size: 0.5, startDate: '2026-10-18', clock: 530123.7,
  gameDay: '2026-10-19', gameDate: 'Monday 19 October 2026', gameTime: '08:03', weather: 'light rain',
  notExact: [],
  player: { id: 17, name: 'Mara Hollis', autopilot: false, doing: 'at home', placeName: 'a house on Elm Row', building: 65539, buildingAbout: 'terrace house', floor: 0 },
  body: { x: 12.345, y: 3.2, z: -40.5, yaw: 1.5708 },
  camera: { mode: 'play', x: 10, y: 5, z: -38, fx: 0.5, fy: -0.2, fz: -0.8, orbit: 1.2, pitch: -0.22, yaw: 0 },
  perf: '60 fps', browser: { agent: 'test', screen: '800×600 @1', gpu: 'none', cores: 4 },
  console: ['[error 18:19:58] boom'],
};

test('report: the repro link names the town, the minute from the start of play, the person and where they stand', () => {
  const q = reproParams(base);
  assert.equal(q.get('seed'), '42');
  assert.equal(q.get('date'), '2026-10-18');
  assert.equal(q.get('clock'), '530123');
  assert.equal(q.has('time'), false, 'the page had ?time=, the clock replaces it');
  assert.equal(q.get('wx'), 'rain', 'other parameters carry over');
  assert.equal(q.has('resume'), false, 'resume would load another world');
  assert.equal(q.get('be'), '17');
  assert.deepEqual(parseStand(q.get('stand')), { x: 12.35, y: 3.2, z: -40.5, yaw: 1.571, building: 65539 });
  assert.deepEqual(parseLook(q.get('look')), { orbit: 1.2, pitch: -0.22 });
  assert.match(reproUrl(base), /^https:\/\/example\.test\/SimWorld\/\?wx=rain&seed=42&/);
});

test('report: a world from a save or a skip is not rebuilt from the clock: the link gives the day and time, the text asks for the save', () => {
  const f = { ...base, notExact: ['played on from a save'] };
  const q = reproParams(f);
  assert.equal(q.get('date'), '2026-10-19');
  assert.equal(q.get('time'), '08:03');
  assert.equal(q.has('clock'), false);
  assert.match(reportText(f, ''), /Exact: no \(played on from a save\)/);
  assert.match(reportText(f, '', 'x.save.gz'), /attached as x\.save\.gz, add &save=/);
});

test('report: on autopilot the sim places them, so no stand; nobody played on the street gives the street camera', () => {
  const auto = reproParams({ ...base, player: { ...base.player!, autopilot: true }, body: null });
  assert.equal(auto.has('autopilot'), true);
  assert.equal(auto.has('stand'), false);
  const street = reproParams({ ...base, player: null, body: null, camera: { ...base.camera, mode: 'street', yaw: 0.5 } });
  assert.equal(street.get('street'), '10,-38');
  assert.equal(street.get('yaw'), '0.5');
  assert.equal(street.has('be'), false);
});

test('report: the text leads with the note and the link, and carries the console', () => {
  const t = reportText(base, '  cannot find the door  ').split('\n');
  assert.equal(t[1], 'Note: cannot find the door');
  assert.match(t[2], /^Repro: https:/);
  assert.ok(t.includes('  [error 18:19:58] boom'));
  assert.equal(parseStand('1,2,x,4'), null);
  assert.equal(parseStand('1,2,3,0.5')?.building, -1);
});
