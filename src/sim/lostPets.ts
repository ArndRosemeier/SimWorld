/**
 * Pets that go missing (town-realism §1.3 "lost cat" posters, track H): now and then a dog or a cat strays from home
 * and stays out near a park, the woods or another street. The household knows at once and puts posters up on its
 * street and the nearest notice boards (src/sim/media.ts). The more people know (the posters, the paper, the gossip),
 * the likelier someone spots it: the finder is the person who knows and lives nearest to where it is. Cats sometimes
 * just come home. After four weeks the family gives up; the pet never comes back.
 *
 * While missing, the pet's day is spent where it strayed (src/sim/schedule.ts asks `lostAt`), so the view shows it
 * there and not at home.
 */
import { clamp } from '@futuremagic/core';
import type { ActorId } from './actors';
import { dateOf, dayAndMonth } from './calendar';
import { addFact, beliefAbout, witness } from './knowledge';
import { feel, happens, leaveTown, log } from './life';
import { nearestBoards, postNotice } from './media';
import { remember } from './memory';
import type { PlaceId } from './places';
import type { Household } from './people';
import { SPECIES } from './species';
import { dayOf } from './time';
import { firstName, isPerson, nameOf, placesOf, tickRng, type World } from './world';

export interface LostPet {
  /** Where it is (a park, the woods, a field, a street away from home). */
  at: PlaceId;
  /** Game day it went missing. */
  since: number;
  owner: ActorId;
  /** The notice on the boards and lamp posts. */
  notice: number;
}

/** Strays per pet per year. Cats roam and go missing more often, and come home on their own more often. */
const STRAY_PER_YEAR: Record<string, number> = { dog: 0.06, cat: 0.15 };
const HOME_ALONE: Record<string, number> = { dog: 0.01, cat: 0.06 };
/** Days before the family gives up. */
const GIVE_UP = 28;
/** Knowers who make finding it near certain within a few days. */
const SEARCHERS = 100;

/** The missing pets (actor → where and since when). */
export const lostPets = (world: World): Map<ActorId, LostPet> => (world.life.lost ??= new Map());

/** Where a missing pet is, -1 if it is not missing. */
export const lostAt = (world: World, id: ActorId): PlaceId => world.life.lost?.get(id)?.at ?? -1;

/** The search for missing pets and new strays, over the `days` ending now (from `passDays`). */
export function lostPetsDay(world: World, days: number): void {
  const day = dayOf(world.clock);
  const lost = lostPets(world);
  for (const [id, l] of [...lost]) search(world, id, l, day, days);
  const rng = tickRng(world, 'strays');
  for (const hh of world.households) {
    if (!hh.members.length || world.life.away.has(hh.id)) continue;
    for (const pet of hh.animals) {
      const species = SPECIES[world.actors.cols.species[pet]].name;
      const rate = STRAY_PER_YEAR[species];
      if (!rate || lost.has(pet) || !rng.chance(happens(rate, days))) continue;
      goMissing(world, pet, rng.int(0, 1 << 30));
    }
  }
}

/** `pet` strays from home (to a place picked by `salt`): the household knows, and the posters go up. */
export function goMissing(world: World, pet: ActorId, salt: number): void {
  const a = world.actors.cols, hh = world.households[world.animals.cols.household[a.row[pet]]];
  const day = dayOf(world.clock), home = hh.home, homeStreet = world.streetOf[home];
  const near = placesOf(world, ['park', 'woods', 'field', 'street']).filter((p) => world.streetOf[p] !== homeStreet && world.travel.minutes(home, p) <= 30);
  if (!near.length) return;
  const at = near[salt % near.length];
  const owner = world.animals.cols.keeper[a.row[pet]] >= 0 ? world.animals.cols.keeper[a.row[pet]] : hh.members[0];
  const species = SPECIES[a.species[pet]].name;
  const fact = addFact(world, { topic: 'family', text: `{object}'s ${species} {subject} has gone missing`, subject: pet, object: owner, place: homeStreet, magnitude: 0.45 });
  witness(world, fact, hh.members);
  for (const m of hh.members) {
    feel(world, m, 'fear', m === owner ? 0.6 : 0.4);
    remember(world, m, { who: [pet], summary: `our ${species} ${nameOf(world, pet)} went missing`, importance: 0.6, emotion: 'fear', fact });
  }
  const notice = postNotice(world, {
    kind: 'lostPet', title: `Lost ${species}`, lines: [nameOf(world, pet), `Missing since ${dayAndMonth(dateOf(world, world.clock))}`, `Please call ${firstName(world, owner)}, ${world.graph.places[home].name}`],
    fact, at: [...new Set([homeStreet, ...nearestBoards(world, home, 2)].filter((p) => p >= 0))], from: day, until: day + GIVE_UP, about: pet,
  });
  lostPets(world).set(pet, { at, since: day, owner, notice: notice.id });
  log(world, day, 'petLost', pet, owner, home, fact);
}

function search(world: World, pet: ActorId, l: LostPet, day: number, days: number): void {
  const lost = lostPets(world), a = world.actors.cols;
  const hh = world.households[world.animals.cols.household[a.row[pet]]];
  if (!a.alive[pet] || !hh || !hh.members.length) { lost.delete(pet); return; }
  const species = SPECIES[a.species[pet]].name;
  const notice = world.media.notices.find((n) => n.id === l.notice);
  const fact = notice?.fact ?? -1;
  // Who knows it is missing (outside the family), and who of them lives nearest to where it is.
  let knowers = 0, finder = -1, best = Infinity;
  if (fact >= 0) for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id) || hh.members.includes(id) || beliefAbout(world, id, fact) < 0) continue;
    knowers++;
    const d = world.travel.minutes(a.home[id], l.at);
    if (d < best || (d === best && id < finder)) { best = d; finder = id; }
  }
  const rng = tickRng(world, 'search', pet);
  const pFound = 1 - Math.pow(1 - 0.02 - 0.3 * clamp(knowers / SEARCHERS, 0, 1), days);
  const pHome = 1 - Math.pow(1 - (HOME_ALONE[species] ?? 0), days);
  const home = a.home[pet];
  if (finder >= 0 && rng.chance(pFound)) return comeHome(world, pet, l, hh, day, finder);
  if (rng.chance(pHome)) return comeHome(world, pet, l, hh, day, -1);
  if (day - l.since < GIVE_UP) return;
  // The family gives up.
  const gone = addFact(world, { topic: 'family', text: `{object}'s ${species} {subject} never came home`, subject: pet, object: l.owner, place: world.streetOf[home], magnitude: 0.35 });
  witness(world, gone, hh.members);
  for (const m of hh.members) feel(world, m, 'sadness', m === l.owner ? 0.7 : 0.4);
  remember(world, l.owner, { who: [pet], summary: `${nameOf(world, pet)} never came home`, importance: 0.6, emotion: 'sadness', fact: gone });
  if (notice) notice.until = day;
  lost.delete(pet);
  log(world, day, 'departed', pet, l.owner, home, gone);
  leaveTown(world, pet, rng.fork('gone'));
}

function comeHome(world: World, pet: ActorId, l: LostPet, hh: Household, day: number, finder: ActorId): void {
  const home = hh.home;
  const text = finder >= 0 ? `{object} found {subject}, the missing ${SPECIES[world.actors.cols.species[pet]].name}, and brought it home` : '{subject} came home on its own';
  const fact = addFact(world, { topic: 'family', text, subject: pet, object: finder, place: world.streetOf[home], magnitude: 0.35 });
  witness(world, fact, finder >= 0 ? [...hh.members, finder] : hh.members);
  for (const m of hh.members) feel(world, m, 'joy', 0.6);
  if (finder >= 0) {
    // Gratitude both ways: the family warms to the finder, the finder to them.
    const c = world.relations.t.cols;
    for (const m of hh.members) for (const [x, y] of [[m, finder], [finder, m]]) {
      const r = world.relations.ensure(x, y);
      c.affection[r] = Math.min(1, c.affection[r] + (x === finder ? 0.1 : 0.3));
      c.familiarity[r] = Math.max(c.familiarity[r], 0.3);
    }
    remember(world, finder, { who: [l.owner, pet], summary: `I found ${nameOf(world, l.owner)}'s lost ${SPECIES[world.actors.cols.species[pet]].name} and brought it home`, importance: 0.5, emotion: 'joy', fact });
  }
  remember(world, l.owner, { who: finder >= 0 ? [pet, finder] : [pet], summary: finder >= 0 ? `${nameOf(world, finder)} found ${nameOf(world, pet)}` : `${nameOf(world, pet)} came home`, importance: 0.5, emotion: 'joy', fact });
  const notice = world.media.notices.find((n) => n.id === l.notice);
  if (notice) {
    notice.title = 'Found';
    notice.lines = [`${nameOf(world, pet)} is home safe.`, finder >= 0 ? `Thank you, ${firstName(world, finder)}!` : 'Thank you all for looking.'];
    notice.fact = fact;
    notice.until = day + 3;
  }
  lostPets(world).delete(pet);
  log(world, day, 'petFound', pet, finder, home, fact);
}
