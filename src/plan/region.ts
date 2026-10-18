/**
 * The country around the town, written as lore (the sim's `Region` contract, src/sim/region.ts).
 *
 * Nothing out there is simulated: this file decides, from the seed and the town's own geography, what the
 * townspeople know about their surroundings: the nearest big city and how to get there, the larger town with the
 * hospital, four to seven villages with their character, the river, the hills and woods, the roads. Directions
 * follow the planned town: the big city lies where the railway line leads, the sea stays where the coast is, the
 * river flows on the way it flows through town.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { Compass, LoreLine, Region, RegionPlace, RegionService } from '../sim/region';
import { cityName } from './names';
import type { Town } from './town';

/** What the region needs to know about the town. Bearings in degrees, 0 = north, 90 = east. */
export interface RegionHints {
  seed: number;
  town: string;
  coastal: boolean;
  /** Towards the sea (only meaningful when coastal). */
  seaBearing: number;
  /** 0 flat … 1 very hilly. */
  hilliness: number;
  /** 0 cold … 1 warm. */
  warmth: number;
  /** American naming (counties, "the Elk River") rather than old-world ("the River Elk", districts). */
  american: boolean;
  /** Old-world architecture weight 0..1 (castles, mills). */
  oldWorld: number;
  /** Where the railway leads away from town, null without a railway. */
  railBearing: number | null;
  /** True when the line ends in town (a branch line). */
  railTerminus: boolean;
  /** Where the river flows on to, null without a river. */
  downstreamBearing: number | null;
}

/** The region for a planned town. */
export function regionOf(town: Town): Region {
  const pr = town.terrain.profile;
  const c0 = town.macro.centres[0];
  const bearingTo = (x: number, z: number): number => bearing(x - c0.x, -(z - c0.z));
  const rail = town.macro.rail;
  const river = town.terrain.rivers[0];
  let downstream: number | null = null;
  if (river && river.pts.length >= 4) {
    const n = river.pts.length;
    const [x, z] = river.level1 <= river.level0 ? [river.pts[n - 2], river.pts[n - 1]] : [river.pts[0], river.pts[1]];
    downstream = bearingTo(x, z);
  }
  return planRegion({
    seed: pr.seed, town: cityName(pr.seed), coastal: pr.coastal, seaBearing: bearing(pr.seaDir[0], -pr.seaDir[1]),
    hilliness: pr.hilliness, warmth: pr.warmth, american: pr.arch.american > pr.arch.oldWorld, oldWorld: pr.arch.oldWorld,
    railBearing: rail && rail.pts.length >= 2 ? bearingTo(rail.pts[0], rail.pts[1]) : null, railTerminus: rail?.terminus ?? false,
    downstreamBearing: downstream,
  });
}

/** The region from hints alone (deterministic in `h.seed`). Tests use it without planning a town. */
export function planRegion(h: RegionHints): Region {
  const rng = new Rng(deriveSeed(h.seed, 'region'));
  const names = new NameBag(rng.fork('names'), h.town);
  const lore: LoreLine[] = [];
  const say = (topic: LoreLine['topic'], text: string, share: number, salience: number, about?: string) => lore.push({ topic, text, share, salience, about });
  const T = h.town;

  // Land bearings: on the coast nothing lies in the sea.
  const land = (b: number): number => {
    if (!h.coastal || angleBetween(b, h.seaBearing) >= 70) return norm(b);
    return norm(h.seaBearing + 180 + (b - h.seaBearing > 0 ? 1 : -1) * rng.range(30, 105));
  };

  // ---- the big city -----------------------------------------------------------------------------------------
  const cityBearing = h.railBearing !== null ? norm(h.railBearing + rng.range(-20, 20))
    : h.coastal ? norm(h.seaBearing + (rng.chance(0.5) ? 90 : -90) + rng.range(-20, 20)) : rng.range(0, 360);
  const cityKm = Math.round(rng.range(40, 110));
  const cityPop = roundTo(180_000 + 800_000 * rng.float() ** 2, 10_000);
  const cityServices: RegionService[] = ['hospital', 'university', 'shopping centre', 'courthouse'];
  if (cityPop > 300_000 || rng.chance(0.6)) cityServices.push('airport');
  const byTrain = h.railBearing !== null;
  const city: RegionPlace = {
    name: names.city(h.coastal), kind: 'city', dir: compass(cityBearing), km: cityKm, population: cityPop, services: cityServices,
    travel: byTrain
      ? `about ${duration(cityKm / 80 * 60 + (h.railTerminus ? 20 : 10))} by train${h.railTerminus ? ', with a change on the way' : ''}, or ${duration(cityKm / 85 * 60 + 10)} by car`
      : `about ${duration(cityKm / 85 * 60 + 10)} by car on the highway; the bus takes much longer`,
  };

  // ---- the larger town nearby (the hospital, the county seat) ------------------------------------------------
  const nearBearing = land(rng.range(0, 360));
  const nearKm = Math.round(rng.range(12, 28));
  const near: RegionPlace = {
    name: names.town(), kind: 'town', dir: compass(nearBearing), km: nearKm, population: roundTo(rng.range(9_000, 35_000), 500),
    services: ['hospital', 'secondary school', 'courthouse'],
    travel: `about ${duration(nearKm / 60 * 60 + 5)} by car, or ${duration(nearKm / 35 * 60 + 10)} on the bus from the square`,
  };

  // ---- villages ---------------------------------------------------------------------------------------------
  const n = rng.int(4, 7);
  const base = rng.range(0, 360);
  const villages: RegionPlace[] = [];
  const characters: Character[] = [];
  for (let i = 0; i < n; i++) {
    // The first village of a coastal town sits on the coast; the others spread over the land around.
    const coastVillage = h.coastal && i === 0;
    const b = coastVillage ? norm(h.seaBearing + (rng.chance(0.5) ? 75 : -75) + rng.range(-10, 10)) : land(base + (360 / n) * i + rng.range(-15, 15));
    const km = Math.round(rng.range(2.5, 14));
    const ch = coastVillage ? FISHING : rng.weighted(CHARACTERS, (c) => c.weight(h));
    characters.push(ch);
    villages.push({
      name: names.village(), kind: 'village', dir: compass(b), km, population: roundTo(80 + 1700 * rng.float() ** 1.8, 10), services: [],
      travel: `about ${duration(km / 50 * 60 + 3)} by car${km <= 6 ? `, ${duration(km / 15 * 60)} by bike` : ''}`,
    });
  }
  const bearingOf = new Map<RegionPlace, number>();
  villages.forEach((v) => bearingOf.set(v, COMPASS_DEG[v.dir]));
  const villageToward = (b: number): RegionPlace | null => {
    let best: RegionPlace | null = null, bd = 50;
    for (const v of villages) { const d = angleBetween(bearingOf.get(v)!, b); if (d < bd) { bd = d; best = v; } }
    return best;
  };

  // ---- lore: where the town is ------------------------------------------------------------------------------
  const county = h.american ? `${names.word()} County` : `the ${names.word()} district`;
  say('place', `${T} is in ${county}.`, 1, 0.2);
  say('place', `The nearest big city is ${city.name}, about ${cityKm} km to the ${city.dir}, with around ${thousands(cityPop)} people.`, 1, 0.5, city.name);
  say('place', `Getting to ${city.name} from ${T} takes ${city.travel}.`, 0.95, 0.35, city.name);
  if (byTrain) say('place', h.railTerminus ? `${T} is at the end of a branch line: every train out goes towards ${city.name}.` : `The trains through ${T} station run to ${city.name} one way and out into the country the other.`, 0.9, 0.25, city.name);
  say('place', `${city.name} has the university, the big hospitals and the shopping centres people drive to for big shopping trips.`, 0.85, 0.3, city.name);
  if (cityServices.includes('airport')) say('place', `The nearest airport is outside ${city.name}.`, 0.85, 0.25, city.name);
  say('place', `${near.name}, about ${nearKm} km to the ${near.dir}, is the nearest larger town, with around ${thousands(near.population)} people.`, 1, 0.4, near.name);
  say('health', `The nearest hospital is in ${near.name}; an ambulance from ${T} takes about ${duration(nearKm / 70 * 60 + 5)} to get there.`, 1, 0.45, near.name);
  say('place', h.american ? `${near.name} is the county seat, with the courthouse and the county offices.` : `${near.name} is the main town of the district, with the court and the district offices.`, 0.8, 0.2, near.name);
  say('place', `A bus runs from the square in ${T} to ${near.name} every hour, less often at weekends.`, 0.85, 0.25, near.name);
  say('place', `Older pupils from around here go to the secondary school in ${near.name}.`, 0.8, 0.25, near.name);

  // ---- lore: the villages -----------------------------------------------------------------------------------
  villages.forEach((v, i) => {
    say('place', `${v.name} is a village about ${v.km} km to the ${v.dir} of ${T}, with about ${thousands(v.population)} people.`, v.km <= 6 ? 0.95 : 0.75, 0.3, v.name);
    const ch = characters[i];
    const r = rng.fork('village', i);
    const feats = r.sample(ch.features, r.int(1, 2));
    if (r.chance(0.45)) feats.push(r.pick(EXTRAS));
    if (r.chance(0.35)) feats.push(`a pub called ${pubName(r, h.coastal)}`);
    for (const f of feats) say('place', `${v.name} has ${f.replace('{city}', city.name)}.`, r.range(0.4, 0.65), 0.25, v.name);
  });

  // ---- lore: the land ---------------------------------------------------------------------------------------
  const riverName = names.river(h.american);
  say('place', `The ${riverName} runs through ${T}.`, 1, 0.25);
  if (h.downstreamBearing !== null) {
    const past = villageToward(h.downstreamBearing);
    say('place', `Downstream, the ${riverName} flows on to the ${compass(h.downstreamBearing)}${past ? `, past ${past.name}` : ''}${h.coastal ? ' and into the sea' : ''}.`, 0.75, 0.2, past?.name);
  }
  const flooded = rng.pick(villages);
  say('event', `In wet springs the ${riverName} floods the meadows near ${flooded.name}.`, 0.6, 0.3, flooded.name);
  if (h.hilliness > 0.3) {
    const ridge = rng.chance(0.4);
    const hills = `${names.word()} ${ridge ? 'Ridge' : 'Hills'}`;
    const hb = land(rng.range(0, 360));
    say('place', `The ${hills} ${ridge ? 'rises' : 'rise'} to the ${compass(hb)} of town; on clear days you can see ${ridge ? 'it' : 'them'} from the square.`, 0.9, 0.2);
    const start = villageToward(hb) ?? rng.pick(villages);
    say('place', `${start.name} is where people start walks up into the ${hills}.`, 0.5, 0.2, start.name);
  }
  const forest = rng.chance(0.5);
  const woods = `${names.word()} ${forest ? 'Forest' : 'Woods'}`;
  const wb = land(rng.range(0, 360));
  say('place', `The ${woods}, a few km to the ${compass(wb)}, ${forest ? 'is' : 'are'} good for long walks, and for mushrooms in autumn; there are deer, and people say wild boar.`, 0.7, 0.2);
  if (h.coastal) {
    say('place', `The sea lies to the ${compass(h.seaBearing)} of ${T}.`, 1, 0.2);
    say('place', `The best beach around is at ${villages[0].name}.`, 0.8, 0.3, villages[0].name);
  }
  const hwBearing = norm(cityBearing + rng.range(-35, 35));
  const junction = villageToward(hwBearing);
  say('place', `The highway to ${city.name} passes about ${Math.round(rng.range(4, 12))} km to the ${compass(hwBearing)} of town${junction ? `, with a junction by ${junction.name}` : ''}.`, 0.8, 0.2, junction?.name);

  // ---- lore: what people say -------------------------------------------------------------------------------
  const rival = rng.pick(villages);
  say('opinion', `People in ${T} and ${rival.name} have teased each other for generations; the yearly football match between their clubs is the match of the year.`, 0.6, 0.35, rival.name);
  say('opinion', `Many say ${near.name} has grown too fast, and its new shopping streets have taken trade away from ${T}.`, 0.5, 0.3, near.name);
  const commuters = rng.pick(villages);
  say('opinion', `Houses in ${commuters.name} have got expensive since people from ${city.name} started buying there.`, 0.4, 0.3, commuters.name);

  return { town: T, county, places: [city, near, ...villages], lore, rail: byTrain ? (h.railTerminus ? 'terminus' : 'through') : null };
}

// ---- village characters -------------------------------------------------------------------------------------

interface Character {
  weight: (h: RegionHints) => number;
  /** What "{village} has ..." ends with; `{city}` is replaced by the big city's name. */
  features: string[];
}

const FISHING: Character = {
  weight: () => 0,
  features: ['a little harbour with a few fishing boats', 'a fish stall on the quay that sells the morning\'s catch', 'a lifeboat station and a lighthouse'],
};

const CHARACTERS: Character[] = [
  { weight: () => 3, features: ['mostly dairy farms, and a farm shop that sells eggs, honey and cheese', 'a big harvest festival every September', 'a cattle market on the first Monday of the month'] },
  { weight: () => 1.2, features: ['a small lake where people swim in summer and skate when it freezes', 'a campsite by the lake that fills up with tourists in August'] },
  { weight: (h) => (h.hilliness > 0.35 ? 1.5 : 0), features: ['the best view over the valley, from an old lookout tower', 'a steep road up that the cyclists love'] },
  { weight: () => 1.5, features: ['a new estate of houses where young families from {city} have moved', 'no shop of its own any more, only a bakery van that comes twice a week'] },
  { weight: (h) => h.oldWorld * 1.5, features: ['a ruined castle on the hill above the houses', 'an old watermill that is now a small museum'] },
  { weight: (h) => (h.warmth > 0.6 ? 1.5 : 0), features: ['vineyards on the south slopes and a wine festival in October', 'a family winery that sells wine at the door'] },
  { weight: () => 0.8, features: ['a stone quarry that employs a few dozen people', 'a sawmill at the edge of the forest'] },
];

const EXTRAS = [
  'a riding stable', 'a garden centre people drive out to at weekends', 'a petrol station that is open all night',
  'a volunteer fire brigade that throws the best summer party around', 'a care home for the elderly',
  'a Sunday flea market in an old barn', 'a tiny old chapel that is popular for weddings',
];

function pubName(r: Rng, coastal: boolean): string {
  const noun = r.pick(['Lion', 'Swan', 'Fox', 'Plough', 'Bell', 'Stag', 'Horse', 'Oak', 'Crown', 'Wheatsheaf', ...(coastal ? ['Anchor', 'Ship'] : [])]);
  return r.chance(0.4) ? `The ${noun}` : `The ${r.pick(['Red', 'Black', 'White', 'Golden', 'Old', 'Green'])} ${noun}`;
}

// ---- names ----------------------------------------------------------------------------------------------------

const STEMS = [
  'Ash', 'Bram', 'Brook', 'Cal', 'Clay', 'Dun', 'Elder', 'Fen', 'Gar', 'Hal', 'Har', 'Kel', 'Lang', 'Mar', 'Mor', 'Nor',
  'Oak', 'Red', 'Sal', 'Stan', 'Thorn', 'Wal', 'Wen', 'Wyn', 'Alder', 'Bar', 'Corn', 'Dray', 'Hol', 'Kings', 'Lyn',
  'Mill', 'Pen', 'Rook', 'Sand', 'Stour', 'Til', 'Whit', 'Yar', 'Bel', 'Car', 'Glen', 'Lark', 'Brack', 'Hazel', 'Ever',
];
const VILLAGE_ENDS = ['by', 'ton', 'ham', 'wick', 'field', 'ford', 'stead', 'well', 'dale', 'leigh', 'worth', 'cote', 'combe', 'thorpe', 'hurst', 'bourne'];
const TOWN_ENDS = ['ford', 'bury', 'ton', 'wick', 'field', 'bridge', 'ham'];
const CITY_ENDS = ['chester', 'ford', 'bury', 'minster', 'borough', 'ton', 'field'];

/** Unique region names (never the town's own). */
class NameBag {
  private used = new Set<string>();
  constructor(private r: Rng, town: string) { this.used.add(town); }
  private fresh(make: () => string): string {
    for (let i = 0; i < 50; i++) { const s = make(); if (!this.used.has(s)) { this.used.add(s); return s; } }
    const s = `${make()} ${this.used.size}`;
    this.used.add(s);
    return s;
  }
  private join(ends: readonly string[]): string {
    const stem = this.r.pick(STEMS), end = this.r.pick(ends);
    // No tripled letters at the seam ("Hallleigh").
    return stem.endsWith(end[0]) && stem.at(-2) === end[0] ? stem + end.slice(1) : stem + end;
  }
  word(): string { return this.fresh(() => this.join(VILLAGE_ENDS)); }
  city(coastal: boolean): string { return this.fresh(() => (coastal && this.r.chance(0.4) ? `Port ${this.r.pick(STEMS)}` : this.join(CITY_ENDS))); }
  town(): string { return this.fresh(() => this.join(TOWN_ENDS)); }
  village(): string {
    return this.fresh(() => {
      const base = this.join(VILLAGE_ENDS);
      const u = this.r.float();
      if (u < 0.12) return `${this.r.pick(['Upper', 'Lower', 'Little', 'Great'])} ${base}`;
      if (u < 0.2) return `${base} ${this.r.pick(['Green', 'Cross', 'Mill', 'Bridge'])}`;
      return base;
    });
  }
  river(american: boolean): string {
    return this.fresh(() => { const s = this.r.pick(STEMS); return american ? `${s} River` : `River ${s}`; });
  }
}

// ---- small helpers ------------------------------------------------------------------------------------------

const COMPASS_DEG: Record<Compass, number> = {
  north: 0, 'north-east': 45, east: 90, 'south-east': 135, south: 180, 'south-west': 225, west: 270, 'north-west': 315,
};
const COMPASS_ORDER = Object.keys(COMPASS_DEG) as Compass[];

const norm = (b: number): number => ((b % 360) + 360) % 360;
/** Bearing of a vector (east, north), degrees from north. */
const bearing = (east: number, north: number): number => norm((Math.atan2(east, north) * 180) / Math.PI);
const angleBetween = (a: number, b: number): number => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); };
const compass = (b: number): Compass => COMPASS_ORDER[Math.round(norm(b) / 45) % 8];
const roundTo = (v: number, step: number): number => Math.max(step, Math.round(v / step) * step);
const thousands = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "twenty minutes", "an hour", "an hour and a half", "two hours" (rounded to 5 minutes / half hours). */
export function duration(minutes: number): string {
  const m = Math.max(5, Math.round(minutes / 5) * 5);
  if (m < 55) return `${m} minutes`;
  const h = Math.round(m / 30) / 2;
  if (h === 1) return 'an hour';
  if (h === 1.5) return 'an hour and a half';
  return Number.isInteger(h) ? `${h} hours` : `${Math.floor(h)} and a half hours`;
}
