/**
 * Population synthesis (plan §6): top-down from the place graph. Households from dwellings, ages from household
 * types, kin across households, every job a real staff slot at a real place, schools for children, habits, pets and
 * farm animals, wildlife, and the starting web of relationships. Deterministic per seed.
 *
 * The coarse history ("the old factory fire", plan §2.4) is the chronicle's job and comes later; here every
 * relationship is plausible but has no story yet.
 */
import { Rng, deriveSeed, clamp } from '@futuremagic/core';
import { ACTOR_ANIMAL, ACTOR_PERSON, FEMALE, MALE, newActorTable, type ActorId } from './actors';
import { AnimalTable, TRAINED_LEASH, TRAINED_RECALL } from './animals';
import { newKnowledge, addFact, witness } from './knowledge';
import { newMemories } from './memory';
import { newMindLedger } from './mind/apply';
import { FEMALE_NAMES, MALE_NAMES, PET_NAMES, SURNAMES } from './names';
import { HABIT_COUNT, PersonTable, T_CONSC, T_EXTRA, T_OPEN, V_FAITH, type Habit, HABITS, type Household } from './people';
import { KINDS, isHome } from './placeKinds';
import type { PlaceGraph, PlaceId, PlaceKind } from './places';
import { bond, bondBit, FAMILY_MASK, Relations, type Bond } from './relations';
import { HUMAN, SPECIES, speciesId } from './species';
import { DAYS_PER_YEAR } from './time';
import { ageOf, placeIndex, type World } from './world';

const CHILD = bondBit('child');

type HouseholdType = 'singleYoung' | 'singleMid' | 'singleOld' | 'coupleYoung' | 'coupleMid' | 'coupleOld' | 'family' | 'singleParent' | 'multiGen' | 'flatshare';
const TYPES: [HouseholdType, number][] = [
  ['singleYoung', 0.12], ['singleMid', 0.08], ['singleOld', 0.12], ['coupleYoung', 0.1], ['coupleMid', 0.14],
  ['coupleOld', 0.08], ['family', 0.25], ['singleParent', 0.06], ['multiGen', 0.03], ['flatshare', 0.02],
];

interface Spec { age: number; sex: number; role: 'head' | 'partner' | 'child' | 'grandparent' | 'mate' }

export interface WorldOptions {
  /** Game day the world starts on (default 0, a Monday). */
  startDay?: number;
}

/** Make a world for a place graph: places indexed, population synthesised, relationships seeded, clock at 06:00. */
export function createWorld(graph: PlaceGraph, seed: number, opts: WorldOptions = {}): World {
  const idx = placeIndex(graph);
  const world: World = {
    seed, clock: (opts.startDay ?? 0) * 1440 + 360, graph, ...idx,
    actors: newActorTable(1024), people: new PersonTable(), animals: new AnimalTable(),
    households: [], jobs: [], relations: new Relations(), knowledge: newKnowledge(), memory: newMemories(),
    intentions: [], encounters: [], mind: newMindLedger(),
  };
  const rng = new Rng(deriveSeed(seed, 'synth'));
  const today = Math.floor(world.clock / 1440);

  // ---- people and households ------------------------------------------------------------------------------
  const usedNames = new Set<string>();
  const firstName = (sex: number, r: Rng) => {
    const pool = sex === FEMALE ? FEMALE_NAMES : MALE_NAMES;
    return pool[r.int(0, pool.length - 1)];
  };
  const makePerson = (age: number, sex: number, last: string, home: PlaceId, hh: number): ActorId => {
    const r = rng.fork('person', world.actors.count);
    let first = firstName(sex, r);
    for (let k = 0; k < 4 && usedNames.has(first + last); k++) first = firstName(sex, r);
    usedNames.add(first + last);
    const id = world.actors.add();
    const a = world.actors.cols;
    a.kind[id] = ACTOR_PERSON; a.species[id] = HUMAN; a.sex[id] = sex;
    a.birth[id] = today - Math.round(age * DAYS_PER_YEAR) - r.int(0, 364);
    a.home[id] = home; a.place[id] = home; a.perception[id] = SPECIES[HUMAN].perception;
    const p = world.people.addPerson(id, first, last);
    a.row[id] = p;
    const pc = world.people.cols;
    for (let t = 0; t < 5; t++) pc.traits[p * 5 + t] = clamp(r.gaussian(0.5, 0.17), 0, 1);
    for (let v = 0; v < 4; v++) pc.values[p * 4 + v] = clamp(r.gaussian(0.5, 0.18), 0, 1);
    pc.values[p * 4 + V_FAITH] = clamp(pc.values[p * 4 + V_FAITH] + (age - 45) * 0.006, 0, 1);
    pc.household[p] = hh;
    for (let n = 0; n < 5; n++) a.needs[id * 5 + n] = r.range(0.6, 1);
    return id;
  };

  const ageIn = (lo: number, hi: number) => rng.int(lo, hi);
  const specsFor = (t: HouseholdType): Spec[] => {
    const sx = () => (rng.chance(0.5) ? FEMALE : MALE);
    const couple = (lo: number, hi: number): Spec[] => {
      const a = ageIn(lo, hi);
      const s1 = sx();
      const s2 = rng.chance(0.05) ? s1 : 1 - s1;
      return [{ age: a, sex: s1, role: 'head' }, { age: clamp(a + rng.int(-5, 5), 18, 99), sex: s2, role: 'partner' }];
    };
    const kids = (parentAge: number, n: number): Spec[] => {
      const out: Spec[] = [];
      for (let i = 0; i < n; i++) out.push({ age: clamp(parentAge - ageIn(20, 40), 0, 24), sex: sx(), role: 'child' });
      return out.filter((k) => k.age <= Math.min(24, parentAge - 17));
    };
    switch (t) {
      case 'singleYoung': return [{ age: ageIn(19, 35), sex: sx(), role: 'head' }];
      case 'singleMid': return [{ age: ageIn(36, 64), sex: sx(), role: 'head' }];
      case 'singleOld': return [{ age: ageIn(65, 92), sex: rng.chance(0.65) ? FEMALE : MALE, role: 'head' }];
      case 'coupleYoung': return couple(22, 40);
      case 'coupleMid': return couple(45, 70);
      case 'coupleOld': return couple(68, 90);
      case 'family': { const c = couple(26, 54); return [...c, ...kids(c[0].age, rng.weighted([1, 2, 3, 4], (n) => [3, 5, 2, 0.5][n - 1]))]; }
      case 'singleParent': { const p: Spec = { age: ageIn(24, 52), sex: rng.chance(0.8) ? FEMALE : MALE, role: 'head' }; return [p, ...kids(p.age, rng.int(1, 2))]; }
      case 'multiGen': { const c = couple(30, 50); return [...c, ...kids(c[0].age, rng.int(1, 3)), { age: clamp(c[0].age + ageIn(24, 35), 60, 95), sex: rng.chance(0.65) ? FEMALE : MALE, role: 'grandparent' }]; }
      case 'flatshare': { const n = rng.int(2, 3); const out: Spec[] = []; for (let i = 0; i < n; i++) out.push({ age: ageIn(19, 30), sex: sx(), role: i === 0 ? 'head' : 'mate' }); return out; }
    }
  };

  const rel = world.relations;
  const family = { familiarity: 1, affection: 0.6, trust: 0.85 };
  for (const place of graph.places) {
    if (!isHome(place.kind)) continue;
    for (let h = 0; h < place.homes; h++) {
      const type: HouseholdType = place.kind === 'farmhouse' ? 'family' : rng.weighted(TYPES, (t) => t[1])[0];
      const specs = specsFor(type);
      const surname = SURNAMES[rng.int(0, SURNAMES.length - 1)];
      const hh: Household = { id: world.households.length, home: place.id, surname, members: [], animals: [], car: false };
      world.households.push(hh);
      const ids: ActorId[] = [];
      for (const s of specs) {
        const last = s.role === 'mate' || (s.role === 'partner' && rng.chance(0.3)) ? SURNAMES[rng.int(0, SURNAMES.length - 1)] : surname;
        ids.push(makePerson(s.age, s.sex, last, place.id, hh.id));
      }
      hh.members = ids;
      hh.car = specs.some((s) => s.age >= 18 && s.age < 85) && rng.chance(place.kind === 'apartments' ? 0.6 : 0.85);
      // Household bonds.
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = specs[i].role, b = specs[j].role;
        let bd: Bond = 'housemate';
        if (a === 'head' && b === 'partner') bd = specs[i].age > 28 && rng.chance(0.7) ? 'spouse' : 'partner';
        else if ((a === 'head' || a === 'partner') && b === 'child') bd = 'child';
        else if (a === 'child' && b === 'child') bd = 'sibling';
        else if (a === 'grandparent' && b === 'child') bd = 'grandchild';
        else if ((a === 'head' || a === 'partner') && b === 'grandparent') bd = a === 'head' ? 'parent' : 'relative';
        bond(rel, ids[i], ids[j], bd, bd === 'housemate' ? { familiarity: 0.8, affection: 0.3, trust: 0.5 } : { ...family, affection: rng.range(0.3, 0.9) });
      }
    }
  }

  // ---- kin across households: grown-up children living elsewhere ------------------------------------------
  const a = world.actors.cols;
  const yearsOf = (id: ActorId) => ageOf(world, id);
  const parentsPool = world.households.filter((h) => h.members.length <= 2 && h.members.every((m) => yearsOf(m) >= 48));
  rng.shuffle(parentsPool);
  for (const h of world.households) {
    const adult = h.members[0];
    if (yearsOf(adult) < 20 || yearsOf(adult) > 58 || !rng.chance(0.55)) continue;
    const k = parentsPool.findIndex((p) => p !== h && p.members.every((m) => yearsOf(m) - yearsOf(adult) >= 20 && yearsOf(m) - yearsOf(adult) <= 42));
    if (k < 0) continue;
    const parents = parentsPool[k];
    // Each parent couple gets at most three grown-up children elsewhere.
    const kidsSoFar = parents.members.length ? rel.known(parents.members[0]).filter((r) => rel.t.cols.bonds[r] & CHILD && world.actors.cols.home[rel.t.cols.to[r]] !== parents.home).length : 0;
    if (kidsSoFar >= 3) { parentsPool.splice(k, 1); continue; }
    const kinTie = { familiarity: 0.9, affection: rng.range(-0.2, 0.8), trust: 0.7 };
    for (const p of parents.members) {
      bond(rel, p, adult, 'child', kinTie);
      // The adult's own children are the parents' grandchildren.
      for (const r of rel.known(adult)) if (rel.t.cols.bonds[r] & CHILD) bond(rel, p, rel.t.cols.to[r], 'grandchild', { familiarity: 0.85, affection: 0.7, trust: 0.75 });
    }
    // Siblings: other grown-up children of the same parents.
    for (const r of rel.known(parents.members[0])) {
      const other = rel.t.cols.to[r];
      if (other !== adult && rel.t.cols.bonds[r] & CHILD && a.kind[other] === ACTOR_PERSON) bond(rel, adult, other, 'sibling', { familiarity: 0.85, affection: rng.range(-0.3, 0.8), trust: 0.65 });
    }
    // Shared surname for the lineage (unless the adult married into another name).
    if (rng.chance(0.6)) world.people.last[a.row[adult]] = parents.surname;
  }

  // ---- jobs from staff slots ------------------------------------------------------------------------------
  for (const place of graph.places) for (const s of place.staff) for (let i = 0; i < s.count; i++) {
    world.jobs.push({ id: world.jobs.length, place: place.id, role: s.role, days: s.days, start: s.start, end: s.end, minAge: s.minAge, holder: -1 });
  }
  const pc = world.people.cols;
  const seekers: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) {
    const age = yearsOf(id);
    if (age < 16 || age > 66) continue;
    const p = a.row[id];
    if (age < 19 && rng.chance(0.85)) continue; // most teenagers are at school
    if (age < 24 && rng.chance(0.3)) continue; // students
    if (rng.chance(0.08)) continue; // homemakers, carers
    seekers.push(id);
    pc.money[p] = 0;
  }
  rng.shuffle(seekers);
  const jobOrder = rng.shuffle(world.jobs.slice());
  // Senior roles first so they go to older people; farm jobs prefer farmhouse residents.
  jobOrder.sort((x, y) => y.minAge - x.minAge);
  const taken = new Set<ActorId>();
  for (const job of jobOrder) {
    const farm = graph.places[job.place].kind === 'farm';
    let best = -1, bestScore = -Infinity;
    for (let k = 0, tries = 0; k < seekers.length && tries < 40; k++) {
      const id = seekers[k];
      if (taken.has(id) || yearsOf(id) < job.minAge) continue;
      tries++;
      const home = graph.places[a.home[id]];
      const score = (farm && home.kind === 'farmhouse' ? 100 : 0) - world.travel.minutes(a.home[id], job.place, true) * 0.3 + rng.float() * 5;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (best < 0) continue;
    taken.add(best);
    job.holder = best;
    pc.job[a.row[best]] = job.id;
  }

  // ---- school, chronotype, money, habits ------------------------------------------------------------------
  const ofKind = (k: PlaceKind) => graph.places.filter((p) => p.kind === k).map((p) => p.id);
  const schools = ofKind('school'), kgs = ofKind('kindergarten');
  const habitPlaces: Record<Habit, PlaceId[]> = {
    cafe: [...ofKind('cafe'), ...ofKind('bakery')], pub: ofKind('pub'), park: [...ofKind('park'), ...ofKind('woods'), ...ofKind('square')],
    sports: ofKind('sports'), church: ofKind('church'), library: ofKind('library'), shop: [...ofKind('supermarket'), ...ofKind('grocer')],
  };
  for (let id = 0; id < world.actors.count; id++) {
    const p = a.row[id];
    const age = yearsOf(id);
    const r = rng.fork('habits', id);
    const home = a.home[id];
    if (age >= 6 && age <= 17 && pc.job[p] < 0) pc.school[p] = world.travel.nearest(home, schools);
    else if (age >= 3 && age <= 5 && r.chance(0.85)) pc.school[p] = world.travel.nearest(home, kgs);
    // Chronotype.
    let wake = Math.round(r.gaussian(400, 35)), sleep = Math.round(r.gaussian(1365, 40));
    if (age < 6) { wake = r.int(390, 450); sleep = r.int(1140, 1200); }
    else if (age < 13) { wake = r.int(400, 420); sleep = r.int(1230, 1260); }
    else if (age < 18) { wake = r.int(400, 425); sleep = r.int(1320, 1380); }
    else if (age >= 67) { wake = r.int(420, 500); sleep = r.int(1290, 1380); }
    const job = pc.job[p] >= 0 ? world.jobs[pc.job[p]] : null;
    if (job) {
      const commute = world.travel.minutes(home, job.place, world.households[pc.household[p]].car);
      if (job.end > 1440 + 120 || job.start >= 1320) {
        // Night shift: sleep after the shift.
        sleep = (job.end + commute + 30) % 1440;
        wake = (sleep + 450) % 1440;
      } else {
        wake = Math.min(wake, job.start - commute - 45);
        // Late shifts: bed after getting home, and a correspondingly late morning.
        const home2bed = job.end + commute + 45;
        if (home2bed > sleep) { sleep = home2bed; if (sleep >= 1440) wake = Math.max(wake, sleep - 1440 + 480); }
      }
    }
    pc.wake[p] = ((wake % 1440) + 1440) % 1440;
    pc.sleep[p] = ((sleep % 1440) + 1440) % 1440;
    pc.money[p] = age < 16 ? r.range(5, 40) : job ? r.range(800, 6000) : r.range(100, 2500);
    // Habits: a favourite of each kind, nearer ones likelier; whether the person has the habit at all
    // depends on personality and age.
    const traits = (t: number) => pc.traits[p * 5 + t];
    const want: Record<Habit, boolean> = {
      cafe: age >= 14 && r.chance(0.3 + traits(T_EXTRA) * 0.5),
      pub: age >= 18 && r.chance(0.15 + traits(T_EXTRA) * 0.5),
      park: r.chance(0.6),
      sports: age >= 8 && age < 70 && r.chance(0.15 + traits(T_CONSC) * 0.35),
      church: r.chance(pc.values[p * 4 + V_FAITH] * 0.8),
      library: age >= 8 && r.chance(traits(T_OPEN) * 0.4),
      shop: age >= 16,
    };
    for (let hb = 0; hb < HABIT_COUNT; hb++) {
      const h = HABITS[hb];
      const list = habitPlaces[h];
      if (!want[h] || list.length === 0) continue;
      pc.habits[p * HABIT_COUNT + hb] = r.weighted(list, (pl) => 1 / (1 + world.travel.minutes(home, pl) / 6));
    }
    a.until[id] = world.clock; // everybody decides on the first tick
  }

  // ---- relationships beyond the household -----------------------------------------------------------------
  const byPlace = (pick: (id: ActorId) => PlaceId) => {
    const m = new Map<PlaceId, ActorId[]>();
    for (let id = 0; id < world.actors.count; id++) {
      const pl = pick(id);
      if (pl >= 0) { const l = m.get(pl); if (l) l.push(id); else m.set(pl, [id]); }
    }
    return m;
  };
  const linkWithin = (group: ActorId[], bd: Bond, perPerson: number, init: { familiarity: number; affection: number; trust: number }, fit = (_x: ActorId, _y: ActorId) => true) => {
    for (const x of group) {
      for (let k = 0; k < perPerson; k++) {
        const y = group[rng.int(0, group.length - 1)];
        if (y === x || !fit(x, y)) continue;
        bond(rel, x, y, bd, { ...init, affection: init.affection + rng.range(-0.2, 0.2) });
      }
    }
  };
  // Colleagues.
  for (const staff of byPlace((id) => (pc.job[a.row[id]] >= 0 ? world.jobs[pc.job[a.row[id]]].place : -1)).values()) {
    linkWithin(staff, 'colleague', Math.min(staff.length - 1, 8), { familiarity: 0.5, affection: 0.15, trust: 0.45 });
  }
  // Classmates: same school, within a year of age.
  for (const pupils of byPlace((id) => pc.school[a.row[id]]).values()) {
    linkWithin(pupils, 'classmate', Math.min(pupils.length - 1, 10), { familiarity: 0.5, affection: 0.15, trust: 0.4 }, (x, y) => Math.abs(yearsOf(x) - yearsOf(y)) <= 1);
  }
  // Neighbours: adults on the same street.
  const street = byPlace((id) => (yearsOf(id) >= 16 ? world.streetOf[a.home[id]] : -1));
  for (const adults of street.values()) linkWithin(adults, 'neighbour', 4, { familiarity: 0.3, affection: 0.1, trust: 0.4 }, (x, y) => a.home[x] !== a.home[y]);
  // Friends: 2-5 per person aged 6+, drawn from people they already know and people of similar age.
  const everyone = Array.from({ length: world.actors.count }, (_, i) => i);
  for (const x of everyone) {
    const age = yearsOf(x);
    if (age < 6) continue;
    const want = rng.int(2, 5);
    const known = rel.known(x).map((r) => rel.t.cols.to[r]).filter((y) => !rel.isFamily(x, y));
    for (let k = 0, made = 0; k < 30 && made < want; k++) {
      const y = known.length > 0 && rng.chance(0.7) ? known[rng.int(0, known.length - 1)] : everyone[rng.int(0, everyone.length - 1)];
      if (y === x || Math.abs(yearsOf(y) - age) > (age < 18 ? 2 : 12) || rel.isFamily(x, y)) continue;
      bond(rel, x, y, 'friend', { familiarity: rng.range(0.6, 0.9), affection: rng.range(0.4, 0.85), trust: rng.range(0.5, 0.8) });
      made++;
    }
  }
  // A few grudges: neighbours or colleagues who cannot stand each other.
  for (let k = 0; k < world.actors.count * 0.03; k++) {
    const x = everyone[rng.int(0, everyone.length - 1)];
    const ks = rel.known(x).filter((r) => !(rel.t.cols.bonds[r] & (FAMILY_MASK | bondBit('friend') | bondBit('owner') | bondBit('pet'))));
    if (ks.length === 0) continue;
    const r = ks[rng.int(0, ks.length - 1)];
    rel.t.cols.affection[r] = rng.range(-0.8, -0.4);
    rel.t.cols.trust[r] = rng.range(0.05, 0.2);
  }

  // ---- animals --------------------------------------------------------------------------------------------
  const makeAnimal = (species: string, home: PlaceId, hh: number, name: string): ActorId => {
    const sp = speciesId(species);
    const r = rng.fork('animal', world.actors.count);
    const id = world.actors.add();
    a.kind[id] = ACTOR_ANIMAL; a.species[id] = sp; a.sex[id] = r.chance(0.5) ? FEMALE : MALE;
    a.birth[id] = today - r.int(60, Math.round(SPECIES[sp].lifespan * 0.7 * DAYS_PER_YEAR));
    a.home[id] = home; a.place[id] = home; a.perception[id] = SPECIES[sp].perception; a.until[id] = world.clock;
    const row = world.animals.addAnimal(id, name);
    a.row[id] = row;
    const ac = world.animals.cols;
    ac.household[row] = hh;
    ac.temperament[row] = clamp(r.gaussian(0.45, 0.2), 0, 1);
    if (sp === speciesId('dog')) ac.trained[row] = (r.chance(0.8) ? TRAINED_LEASH : 0) | (r.chance(0.5) ? TRAINED_RECALL : 0);
    return id;
  };
  const petName = () => PET_NAMES[rng.int(0, PET_NAMES.length - 1)];
  for (const hh of world.households) {
    const flat = graph.places[hh.home].kind === 'apartments';
    const pets: string[] = [];
    if (rng.chance(flat ? 0.1 : 0.3)) pets.push('dog');
    if (rng.chance(flat ? 0.15 : 0.25)) pets.push('cat');
    for (const sp of pets) {
      const id = makeAnimal(sp, hh.home, hh.id, petName());
      hh.animals.push(id);
      const carers = hh.members.filter((m) => yearsOf(m) >= 12);
      if (carers.length > 0) world.animals.cols.keeper[a.row[id]] = carers[rng.int(0, carers.length - 1)];
      for (const m of hh.members) bond(rel, m, id, 'pet', { familiarity: 1, affection: rng.range(0.4, 0.9), trust: 0.9 });
    }
  }
  for (const farm of graph.places.filter((p) => p.kind === 'farm')) {
    const farmhouse = graph.places.find((p) => p.kind === 'farmhouse' && p.node === farm.node) ?? farm;
    const hh = world.households.find((h) => h.home === farmhouse.id);
    const herd: [string, number, number][] = [['cow', 4, 8], ['chicken', 5, 10], ['horse', 0, 2], ['sheep', 0, 6]];
    for (const [sp, lo, hi] of herd) {
      const n = rng.int(lo, hi);
      for (let i = 0; i < n; i++) {
        const id = makeAnimal(sp, farm.id, hh?.id ?? -1, sp === 'chicken' ? `hen ${i + 1}` : petName());
        hh?.animals.push(id);
        if (hh) {
          const farmer = hh.members.find((m) => yearsOf(m) >= 18);
          if (farmer !== undefined) { world.animals.cols.keeper[a.row[id]] = farmer; bond(rel, farmer, id, 'pet', { familiarity: 0.9, affection: 0.5, trust: 0.8 }); }
        }
      }
    }
  }
  const people = world.people.count;
  const wildHome = (prefer: PlaceKind[]) => {
    for (const k of prefer) { const l = ofKind(k); if (l.length) return l[rng.int(0, l.length - 1)]; }
    return -1;
  };
  const wild: [string, number, PlaceKind[]][] = [['fox', people / 500, ['woods', 'park']], ['deer', people / 400, ['woods', 'field']], ['hedgehog', people / 300, ['park', 'woods']], ['owl', people / 1000, ['church', 'woods']]];
  for (const [sp, n, prefer] of wild) {
    for (let i = 0; i < Math.max(1, Math.round(n)); i++) {
      const home = wildHome(prefer);
      if (home >= 0) makeAnimal(sp, home, -1, sp);
    }
  }

  seedNews(world, rng.fork('news'));
  return world;
}

/** A handful of current stories, each known by a few eyewitnesses, so the town has something to talk about. */
function seedNews(world: World, rng: Rng): void {
  const persons: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) if (world.actors.cols.kind[id] === ACTOR_PERSON) persons.push(id);
  const adults = persons.filter((id) => world.clock / 1440 - world.actors.cols.birth[id] > 18 * 365);
  if (adults.length < 4) return;
  const places = world.graph.places.filter((p) => !isHome(p.kind) && KINDS[p.kind].category !== 'outdoor');
  const stories: [string, string, number][] = [
    ['business', '{place} is putting its prices up', 0.4],
    ['politics', 'the council wants to close the swimming pool', 0.6],
    ['romance', '{subject} has been seen with someone new', 0.6],
    ['health', '{subject} was taken to hospital', 0.7],
    ['job', '{subject} lost their job at {place}', 0.6],
    ['crime', 'someone broke into a car outside {place}', 0.7],
    ['family', '{subject} is expecting a baby', 0.5],
    ['event', 'there was a shouting match at {place}', 0.5],
  ];
  for (const [topic, text, magnitude] of stories) {
    const subject = adults[rng.int(0, adults.length - 1)];
    const place = places.length ? places[rng.int(0, places.length - 1)].id : -1;
    const f = addFact(world, { topic, subject: text.includes('{subject}') ? subject : -1, place, magnitude, text, secret: false, originator: -1 });
    const eye: ActorId[] = [];
    for (let k = rng.int(1, 3); k > 0; k--) eye.push(adults[rng.int(0, adults.length - 1)]);
    witness(world, f, eye);
  }
}
