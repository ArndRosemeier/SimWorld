/**
 * The country around the town, as its people know it (lore, not simulated): the nearest big city, the larger
 * town with the hospital, the villages around, the river, the roads. Plus the ties that keep the town from being
 * a closed box: people who grew up elsewhere, family living out there, years spent studying in the city.
 *
 * Contract between the planner (src/plan/region.ts, `regionOf(town)`, which writes the lore) and the sim, which
 * turns it into standing knowledge (`addStanding` in knowledge.ts): every lore line is a `Fact`, known by a stable
 * share of the townspeople, never forgotten and never gossiped as news.
 */
import { Rng } from '@futuremagic/core';
import type { ActorId } from './actors';
import { addFact, addStanding, type FactTopic, type Standing } from './knowledge';
import { FEMALE_NAMES, MALE_NAMES } from './names';
import { bondBit, FAMILY_MASK } from './relations';
import { ageOf, householdOf, isPerson, type World } from './world';

/** Eight compass points, as people say them ("to the north-east"). */
export const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
export type Compass = (typeof COMPASS)[number];

/** Services a place out there has that the town does not (life events and talk can send people there). */
export type RegionService = 'hospital' | 'university' | 'airport' | 'secondary school' | 'courthouse' | 'shopping centre';

export interface RegionPlace {
  name: string;
  kind: 'city' | 'town' | 'village';
  dir: Compass;
  /** Distance from the town centre, km. */
  km: number;
  population: number;
  services: RegionService[];
  /** How you get there from town, in words ("about fifty minutes by train"). */
  travel: string;
}

export interface LoreLine {
  topic: FactTopic;
  /** Plain English, no slots: "The nearest hospital is in Marwick, about 20 km to the south." */
  text: string;
  /** Share of the townspeople (aged 12+, or everyone when 1) who know it. */
  share: number;
  /** The region place it is about (its name), so people from there know it too. */
  about?: string;
  /** How likely it is to matter in a conversation, 0..1. */
  salience: number;
}

export interface Region {
  /** The town's own name. */
  town: string;
  /** The district the town lies in ("the Calder district"). */
  district: string;
  /** places[0] is the big city, places[1] the larger town nearby, the rest are villages. */
  places: RegionPlace[];
  lore: LoreLine[];
  /** The railway: through the town (to the city one way, out into the country the other), a branch line ending here, or none. */
  rail?: 'through' | 'terminus' | null;
  /** On the coast (milder, foggier weather). */
  coastal?: boolean;
}

/** The region as the world holds it (`world.region`). */
export interface RegionKnowledge {
  region: Region;
  /** Standing facts per lore line, in `region.lore` order. */
  lore: Standing[];
  /** Person → where they grew up, for those not from town ('' = far away). */
  origin: Map<ActorId, string>;
}

const CHILD_AGE = 12;

/**
 * Turn the region into standing knowledge and give some people ties to it: an origin, kin out there, studies in
 * the city. Deterministic in `rng`. Called once by `createWorld` when a region is given.
 */
export function settleRegion(world: World, region: Region, rng: Rng): RegionKnowledge {
  const lore = region.lore.map((l) => {
    const f = addFact(world, { topic: l.topic, text: l.text, magnitude: 0.2, secret: false, originator: -1 });
    return addStanding(world, f, { share: l.share, minAge: l.share >= 1 ? 0 : CHILD_AGE, salience: l.salience });
  });
  const aboutPlace = new Map<string, Standing[]>();
  region.lore.forEach((l, i) => { if (l.about) (aboutPlace.get(l.about) ?? aboutPlace.set(l.about, []).get(l.about)!).push(lore[i]); });

  const out: RegionKnowledge = { region, lore, origin: new Map() };
  world.region = out; // set first, so regionDestination sees it
  const [city, near, ...villages] = region.places;
  const knowers = (id: ActorId): ActorId[] => {
    const hh = householdOf(world, id);
    const set = new Set<ActorId>([id, ...(hh ? hh.members : [])]);
    const rel = world.relations;
    for (const r of rel.known(id)) {
      const c = rel.t.cols;
      if (c.bonds[r] & FAMILY_OR_FRIEND && c.familiarity[r] >= 0.6) set.add(c.to[r]);
    }
    return [...set].filter((p) => isPerson(world, p));
  };
  const personal = (id: ActorId, text: string, salience: number): void => {
    const f = addFact(world, { topic: 'family', subject: id, text, magnitude: 0.2, secret: false, originator: -1 });
    addStanding(world, f, { holders: knowers(id), salience });
  };

  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 18) continue;
    const r = rng.fork('ties', id);
    // Where they grew up: most in town, many in the villages, some in the city or far away.
    const u = r.float();
    if (u < 0.45) {
      // grew up here
    } else if (u < 0.92) {
      const from = u < 0.82 && villages.length ? r.weighted(villages, (p) => Math.sqrt(p.population) / p.km) : u < 0.87 ? near : city;
      out.origin.set(id, from.name);
      personal(id, `{subject} grew up in ${from.name}`, 0.4);
      for (const s of aboutPlace.get(from.name) ?? []) s.holders.add(id);
    } else {
      out.origin.set(id, '');
      personal(id, '{subject} grew up far from here and moved to town as an adult', 0.4);
    }
    // Family out there.
    if (r.chance(0.4)) {
      const where = regionDestination(world, r)!;
      const kin = r.weighted(KIN, (k) => (k.minAge <= age && age <= k.maxAge ? 1 : 0));
      if (kin.minAge <= age && age <= kin.maxAge) {
        const female = r.chance(kin.female);
        const word = female ? kin.words[1] : kin.words[0];
        const first = r.pick(female ? FEMALE_NAMES : MALE_NAMES);
        personal(id, `{subject}'s ${word} ${first} lives in ${where.name}`, 0.35);
      }
    }
    // Studied in the city.
    if (age >= 22 && city.services.includes('university') && r.chance(0.18)) personal(id, `{subject} studied at the university in ${city.name}`, 0.3);
  }
  return out;
}

const FAMILY_OR_FRIEND = FAMILY_MASK | bondBit('friend');

/** Kin who may live out there: [male word, female word], the asker's plausible age range, chance of female. */
const KIN: { words: [string, string]; minAge: number; maxAge: number; female: number }[] = [
  { words: ['brother', 'sister'], minAge: 18, maxAge: 90, female: 0.5 },
  { words: ['father', 'mother'], minAge: 18, maxAge: 70, female: 0.6 },
  { words: ['son', 'daughter'], minAge: 42, maxAge: 99, female: 0.5 },
  { words: ['cousin', 'cousin'], minAge: 18, maxAge: 99, female: 0.5 },
  { words: ['uncle', 'aunt'], minAge: 18, maxAge: 55, female: 0.55 },
];

/**
 * A real place out there for someone moving away (life events): weighted by size and nearness, or one offering
 * `service` (a care home's hospital town, a student's university city). Null when the world has no region.
 */
export function regionDestination(world: World, rng: Rng, service?: RegionService): RegionPlace | null {
  const places = world.region?.region.places.filter((p) => !service || p.services.includes(service)) ?? [];
  return places.length ? rng.weighted(places, (p) => Math.sqrt(p.population) / Math.max(3, p.km)) : null;
}
