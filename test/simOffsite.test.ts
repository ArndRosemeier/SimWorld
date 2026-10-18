import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/synth';
import { testTown } from '../src/sim/testTown';
import { ageOf, isPerson, jobOf, tick } from '../src/sim/world';
import type { Mode } from '../src/sim/travel';

test('offsite: commuters work in the city, older children go to the secondary school by bus', () => {
  const graph = testTown(31, 1200);
  const before = graph.places.length;
  const w = createWorld(graph, 31);
  assert.equal(graph.places.length, before, "the planner's graph is left as it is");
  const away = (p: number) => w.graph.places[p].kind === 'away';
  const commuters = Array.from({ length: w.actors.count }, (_, i) => i).filter((id) => isPerson(w, id) && jobOf(w, id) && away(jobOf(w, id)!.place));
  const workers = Array.from({ length: w.actors.count }, (_, i) => i).filter((id) => isPerson(w, id) && jobOf(w, id)).length;
  assert.ok(commuters.length / workers > 0.08 && commuters.length / workers < 0.4, `${commuters.length} of ${workers} commute`);
  const pc = w.people.cols;
  for (let id = 0; id < w.actors.count; id++) {
    if (!isPerson(w, id)) continue;
    const age = ageOf(w, id), school = pc.school[w.actors.cols.row[id]];
    if (age >= 11 && age <= 15) assert.equal(school, w.offsite.secondary);
    if (age >= 6 && age <= 10) assert.ok(school >= 0 && !away(school));
  }
  // A Tuesday: watch the morning.
  w.clock = 1440 + 360;
  for (let id = 0; id < w.actors.count; id++) w.actors.cols.until[id] = w.clock;
  const modes = new Map<Mode, number>();
  for (let m = 0; m < 240; m++) {
    tick(w, 1);
    for (const t of w.trips) if (t.depart === w.clock - 1 && away(t.to)) {
      modes.set(t.mode, (modes.get(t.mode) ?? 0) + 1);
      // Bus and train riders are on a real run of the timetable, which gets there when they do.
      if (t.mode === 'bus' || t.mode === 'train') assert.ok(t.run >= 0, 'a ride without a run');
    }
  }
  assert.ok((modes.get('bus') ?? 0) > 0 && (modes.get('car') ?? 0) > 0 && (modes.get('train') ?? 0) > 0, JSON.stringify([...modes]));
  // 10:00: commuters and pupils are out of town.
  const out = commuters.filter((id) => w.actors.cols.place[id] === jobOf(w, id)!.place).length;
  assert.ok(out > commuters.length * 0.6, `${out} of ${commuters.length} commuters at work`);
  const pupils = Array.from({ length: w.actors.count }, (_, i) => i).filter((id) => isPerson(w, id) && pc.school[w.actors.cols.row[id]] === w.offsite.secondary);
  assert.ok(pupils.filter((id) => w.actors.cols.place[id] === w.offsite.secondary).length > pupils.length * 0.7, 'pupils not at school');
  // Nobody meets anyone out there.
  assert.ok(w.encounters.every((e) => !away(e.place)));
});
