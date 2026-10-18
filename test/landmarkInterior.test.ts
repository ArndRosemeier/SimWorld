import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTown } from '../src/plan/town';
import { pointInPoly } from '../src/geom/geom2';
import { planInterior } from '../src/interior/building';
import { indoorsOf } from '../src/interior/indoors';
import { landmarkBody } from '../src/interior/landmark';

const town = planTown({ seed: 1, size: 0 });

test('public buildings: every one but the town hall and the sports ground has a walk-in body furnished for its kind', () => {
  const seen: string[] = [];
  for (const lm of town.macro.landmarks) {
    const body = landmarkBody(lm, town.terrain);
    if (lm.kind === 'townhall' || lm.kind === 'sports') { assert.equal(body, null, lm.kind); continue; }
    assert.ok(body, `${lm.kind} has a body`);
    const I = planInterior(body.b, body.place);
    assert.ok(I.doors.length > 0, `${lm.kind}: a street door`);
    const ind = indoorsOf(I, lm.base, body.windows);
    assert.ok(ind.outer.some((w) => w.windows.length), `${lm.kind}: windows in its walls`);
    const kinds = new Set(I.storeys.flatMap((s) => s.rooms.map((r) => r.type)));
    const furn = I.storeys.flatMap((s) => s.furniture);
    for (const d of I.doors) assert.ok(I.storeys[0].poly.length >= 8 && Number.isFinite(d.x), `${lm.kind}: door placed`);
    for (const f of furn) assert.ok(I.storeys.some((s) => pointInPoly(s.poly, f.x, f.z)), `${lm.kind}: ${f.kind} inside`);
    for (const p of I.spots) assert.ok(pointInPoly(I.storeys[p.floor].poly, p.x, p.z), `${lm.kind}: a ${p.use} spot inside`);
    if (lm.kind === 'church') {
      const altar = furn.find((f) => f.kind === 'altar'), door = I.doors[0];
      assert.ok(kinds.has('nave') && altar, 'church: a nave with its altar');
      const far = (f: { x: number; z: number }) => Math.hypot(f.x - door.x, f.z - door.z);
      for (const p of furn.filter((f) => f.kind === 'pew')) assert.ok(far(p) < far(altar), 'church: the pews between the door and the altar');
      assert.ok(ind.spots.filter((p) => p.use === 'sit').length >= 10, 'church: pews to sit on');
    }
    if (lm.kind === 'school') assert.ok(I.storeys.every((s) => s.rooms.some((q) => q.type === 'classroom')), 'school: classrooms on every floor');
    if (lm.kind === 'clinic') assert.ok(kinds.has('consulting'), 'clinic: a consulting room');
    if (lm.kind === 'carehome') assert.ok(ind.spots.some((p) => p.use === 'sleep'), 'care home: beds');
    seen.push(lm.kind);
  }
  assert.ok(seen.includes('church') && seen.includes('school'), `seen ${seen.join(', ')}`);
});
