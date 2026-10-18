import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRegion, type RegionHints } from '../src/plan/region';
import { testTown } from '../src/sim/testTown';
import { createWorld } from '../src/sim/synth';
import { forget, knowsStanding, SOURCE_COMMON, standingOf } from '../src/sim/knowledge';
import { ageOf, householdOf, isPerson } from '../src/sim/world';
import { COMPASS } from '../src/sim/region';

const hints: RegionHints = {
  seed: 7, town: 'Testford', coastal: true, seaBearing: 270, hilliness: 0.6, warmth: 0.7, american: false, oldWorld: 0.8,
  railBearing: 90, railTerminus: false, downstreamBearing: 250,
};
const region = planRegion(hints);
const world = createWorld(testTown(7, 200), 7, { region });
const people = Array.from({ length: world.actors.count }, (_, i) => i).filter((i) => isPerson(world, i));

test('region: deterministic, unique names, a city, a larger town, villages, nothing in the sea', () => {
  assert.deepEqual(planRegion(hints), region);
  assert.notDeepEqual(planRegion({ ...hints, seed: 8 }).places.map((p) => p.name), region.places.map((p) => p.name));
  const [city, near, ...villages] = region.places;
  assert.equal(city.kind, 'city');
  assert.ok(city.services.includes('hospital') && city.services.includes('university'));
  assert.equal(near.kind, 'town');
  assert.ok(villages.length >= 4 && villages.length <= 7);
  const names = [region.town, ...region.places.map((p) => p.name)];
  assert.equal(new Set(names).size, names.length);
  // The sea is to the west: only the coastal village may lie west-ish, on the shore.
  for (const v of villages.slice(1)) assert.ok(!['west', 'south-west', 'north-west'].includes(v.dir), `${v.name} lies ${v.dir}`);
  assert.ok(['north', 'north-east', 'east', 'south-east', 'south'].includes(city.dir), `city along the railway, ${city.dir}`);
  for (const p of region.places) assert.ok((COMPASS as readonly string[]).includes(p.dir));
  for (const l of region.lore) assert.ok(!/[{}]/.test(l.text) && l.share > 0 && l.share <= 1, l.text);
});

test('lore is standing knowledge: everyone knows the basics, a share knows the details, it never fades', () => {
  const lore = world.region!.lore;
  const everyone = lore.filter((s) => s.share >= 1);
  assert.ok(everyone.length >= 3);
  for (const id of people) for (const s of everyone) assert.ok(knowsStanding(world, id, s));
  const partial = lore.find((s) => s.share > 0.3 && s.share < 0.7)!;
  const adults = people.filter((id) => ageOf(world, id) >= 12);
  const others = adults.filter((id) => !partial.holders.has(id));
  const knowing = others.filter((id) => knowsStanding(world, id, partial)).length / others.length;
  assert.ok(Math.abs(knowing - partial.share) < 0.2, `share ${partial.share}, known by ${knowing.toFixed(2)}`);
  const child = people.find((id) => ageOf(world, id) < 12)!;
  assert.ok(!knowsStanding(world, child, partial));
  // No belief rows for lore: the gossip table only holds the seeded news.
  assert.ok(world.knowledge.beliefs.count < 50);
  const before = standingOf(world, adults[0]).length;
  for (let i = 0; i < 30; i++) forget(world);
  assert.equal(standingOf(world, adults[0]).length, before);
  assert.ok(standingOf(world, adults[0]).every((b) => b.source === SOURCE_COMMON));
});

test('people have ties out there: where they grew up, known at home, with the lore of that place', () => {
  const origin = world.region!.origin;
  const adults = people.filter((id) => ageOf(world, id) >= 18);
  const from = adults.filter((id) => origin.has(id)).length / adults.length;
  assert.ok(from > 0.35 && from < 0.75, `from elsewhere ${from.toFixed(2)}`);
  const id = adults.find((p) => origin.get(p) && region.places.slice(2).some((v) => v.name === origin.get(p)) && (householdOf(world, p)?.members.length ?? 0) > 1)!;
  const place = origin.get(id)!;
  const mine = standingOf(world, id).map((b) => b.text);
  assert.ok(mine.some((t) => t.endsWith(`grew up in ${place}`)), mine.join('\n'));
  const mate = householdOf(world, id)!.members.find((m) => m !== id && isPerson(world, m))!;
  assert.ok(standingOf(world, mate).some((b) => b.fact.subject === id && b.text.endsWith(`grew up in ${place}`)));
  for (const [i, l] of region.lore.entries()) if (l.about === place) assert.ok(knowsStanding(world, id, world.region!.lore[i]), l.text);
  assert.ok(people.some((p) => standingOf(world, p).some((b) => / lives in /.test(b.text))));
});
