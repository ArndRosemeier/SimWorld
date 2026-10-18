import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { presentAt } from '../src/sim/encounters';
import { tick } from '../src/sim/world';
import { A } from '../src/sim/actors';
import { TalkFeed, type Said } from '../src/street/talk';

test('talk you can hear: a busy pub has several conversations going, a home its family talk, and nothing is voiced out of earshot', () => {
  const w = createWorld(testTown(3, 600), 3);
  tick(w, 14 * 60 - (w.clock % 1440)); // 20:00 on the first day
  const busiest = (kinds: string[]) => w.graph.places.filter((p) => kinds.includes(p.kind)).map((p) => ({ p: p.id, n: presentAt(w, p.id).filter((id) => w.actors.cols.activity[id] !== A.sleep && w.actors.cols.dest[id] < 0).length })).sort((a, b) => b.n - a.n)[0];
  const pub = busiest(['pub', 'cafe']), home = busiest(['house', 'apartments', 'farmhouse']);
  assert.ok(pub.n >= 6 && home.n >= 2, `somewhere to listen (${pub.n} at the pub, ${home.n} at home)`);
  const feed = new TalkFeed(), deaf = new TalkFeed();
  const heard: Said[] = [];
  const rooms = [pub.p, home.p];
  for (let m = 0; m < 20; m++) {
    tick(w, 1);
    feed.afterTick(w, (_a, _b, place) => rooms.includes(place), rooms);
    deaf.afterTick(w, () => false);
    heard.push(...feed.take());
  }
  assert.equal(deaf.take().length, 0, 'nothing voiced out of earshot');
  const atPub = heard.filter((s) => s.place === pub.p), atHome = heard.filter((s) => s.place === home.p);
  const pairs = new Set(atPub.map((s) => `${Math.min(s.a, s.b)}-${Math.max(s.a, s.b)}`));
  assert.ok(atPub.length >= 10 && pairs.size >= 4, `the pub is busy: ${atPub.length} bits of talk between ${pairs.size} pairs in 20 minutes`);
  assert.ok(atHome.length >= 1, 'the family at home talks too');
  for (const s of heard) {
    assert.ok(s.lines.length > 0 && s.lines.every((l) => (l.speaker === s.a || l.speaker === s.b) && l.text.trim().length > 0), 'every line is said by one of the two');
    assert.ok(rooms.includes(s.place));
  }
});
