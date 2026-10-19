import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { isPerson } from '../src/sim/world';
import { cardsOf } from '../src/sim/profile';
import { daysText, detailsOf } from '../src/chat/details';

const world = createWorld(testTown(7, 220), 7, { history: 1 });

test('person details: everyone gets readable sections, no raw fields or ids', () => {
  const ids = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => isPerson(world, i));
  const t0 = performance.now();
  let lines = 0, secrets = 0, family = 0, friends = 0;
  for (const id of ids) {
    const d = detailsOf(world, id);
    assert.ok(d.sections.length >= 5, `${d.name}: ${d.sections.map((s) => s.title)}`);
    assert.equal(d.sections[0].title, 'Who they are');
    for (const s of d.sections) {
      for (const text of [s.title, s.intro ?? '', ...s.items.flatMap((i) => [i.text, i.note ?? ''])]) {
        assert.ok(!/undefined|NaN|null|\{|\}|\[object/.test(text), `${d.name} / ${s.title}: ${text}`);
        lines++;
      }
      secrets += s.items.filter((i) => i.secret).length;
      if (s.title === 'Family' && s.items.length) family++;
      if (s.title === 'Friends and other people' && s.items.length) friends++;
    }
  }
  const ms = (performance.now() - t0) / ids.length;
  assert.ok(lines > ids.length * 15, `${lines} lines for ${ids.length} people`);
  assert.ok(family > ids.length * 0.25 && friends > ids.length * 0.3, `family ${family}, friends ${friends} of ${ids.length}`);
  assert.ok(ms < 20, `${ms.toFixed(1)} ms per person`);
  // Secrets in the window are exactly the card's secrets (the player is about to become them).
  const cards = cardsOf(world);
  assert.equal(secrets, cards.reduce((n, c) => n + c.situations.filter((s) => s.secret).length, 0));
});

test('person details: work days read as people say them', () => {
  assert.equal(daysText(0b0011111), 'Monday to Friday');
  assert.equal(daysText(0b1111111), 'every day');
  assert.equal(daysText(0b0010101), 'Monday, Wednesday and Friday');
});
