/**
 * What the town's places are for: one table of every kind of place people go to (the public
 * buildings on their own sites, the shops, services and pubs on ground floors, the workplaces,
 * the farms), with weekly opening hours, staff slots, how many visitors fit, what one can do
 * there and how much of a meeting point it is (where news spreads). New in SimWorld; Scale's
 * eatery kinds (plan/eatery.ts) are some of the rows here.
 *
 * Pure data plus the hour parser. The town planner (plan/town.ts) decides which building holds
 * which kind; the place graph (plan/placeGraph.ts) hands the result to the simulation.
 */
import { Eatery } from './eatery';
import type { District } from './types';
import type { LandmarkKind } from './landmarks';

/** One opening (or shift) interval: day 0 = Monday … 6 = Sunday; hours, `to` may pass 24. */
export interface Interval {
  day: number;
  from: number;
  to: number;
}

/** Ground-floor and workplace kinds (in ordinary buildings). */
export type AmenityKind =
  | 'pharmacy' | 'police' | 'bakery' | 'butcher' | 'post' | 'bank' | 'library' | 'hairdresser' | 'garage'
  | 'pub' | 'cafe' | 'restaurant' | 'pizzeria' | 'icecream' | 'bar'
  | 'grocer' | 'shop' | 'office' | 'workshop' | 'factory' | 'vacant';

/** Every kind of place an inhabitant can go to. */
export type PlaceKind = AmenityKind | LandmarkKind | 'home' | 'farm' | 'park' | 'plaza';

/** A role a place employs. */
export interface StaffSpec {
  role: string;
  /** Head count for a town of `pop` inhabitants. */
  count: (pop: number) => number;
  /** Working hours (default: the opening hours); the same people cover all of them in shifts. */
  shifts?: string;
  /** Youngest age for the job (16: a Saturday job; 18; 23+: trained). */
  minAge: number;
  /** Needs a trade or a degree (a doctor, a teacher, a baker), not just anyone. */
  qualified: boolean;
}

export interface PlaceInfo {
  label: string;
  /** Opening hours as `Mo-Fr 8-18; Sa 8-13` (see `weekly`), or null: no public opening (a home, a workplace). */
  hours: string | null;
  staff: StaffSpec[];
  /** Visitors at once (not counting staff). */
  capacity: number;
  /** What one comes for. */
  services: string[];
  /** Meeting point weight 0..1: how much people talk to each other there (news spreads). */
  hub: number;
  /** The eatery kind whose terrace and tables it gets (plan/eatery.ts), when it is one. */
  eatery?: Eatery;
}

const n = (k: number) => () => k;
/** One per `per` inhabitants, at least `min`. */
const per = (per: number, min = 1) => (pop: number) => Math.max(min, Math.round(pop / per));

/** The table. Hours follow a modern small western town: shops shut on Sunday, the pub opens late. */
export const PLACES: Record<PlaceKind, PlaceInfo> = {
  // ---- public buildings on their own sites
  townhall: { label: 'town hall', hours: 'Mo-Th 8-16; Fr 8-13', staff: [{ role: 'mayor', count: n(1), shifts: 'Mo-Fr 8-17', minAge: 30, qualified: false }, { role: 'clerk', count: per(400, 3), minAge: 18, qualified: true }], capacity: 30, services: ['civic', 'records', 'council'], hub: 0.4 },
  church: { label: 'church', hours: 'Mo-Sa 8-18; Su 8-13', staff: [{ role: 'priest', count: n(1), shifts: 'Mo-Fr 9-17; Su 8-13', minAge: 28, qualified: true }, { role: 'sexton', count: n(1), shifts: 'Sa 8-12; Su 8-13', minAge: 18, qualified: false }], capacity: 250, services: ['worship', 'wedding', 'funeral', 'counsel'], hub: 0.7 },
  school: { label: 'primary school', hours: 'Mo-Fr 7.5-15.5', staff: [{ role: 'head teacher', count: n(1), minAge: 30, qualified: true }, { role: 'teacher', count: per(180, 4), minAge: 23, qualified: true }, { role: 'caretaker', count: n(1), shifts: 'Mo-Fr 7-16', minAge: 18, qualified: false }], capacity: 260, services: ['learn'], hub: 0.6 },
  kindergarten: { label: 'kindergarten', hours: 'Mo-Fr 7-17', staff: [{ role: 'nursery teacher', count: per(250, 3), minAge: 20, qualified: true }], capacity: 70, services: ['childcare'], hub: 0.5 },
  clinic: { label: 'health centre', hours: 'Mo-Fr 8-18; Sa 9-12', staff: [{ role: 'doctor', count: per(900, 2), minAge: 27, qualified: true }, { role: 'nurse', count: per(500, 2), minAge: 21, qualified: true }, { role: 'receptionist', count: n(1), minAge: 18, qualified: false }], capacity: 25, services: ['see doctor', 'emergency'], hub: 0.35 },
  fire: { label: 'fire station', hours: null, staff: [{ role: 'firefighter', count: per(250, 6), shifts: 'Mo-Su 0-24', minAge: 18, qualified: true }], capacity: 10, services: ['fire', 'rescue'], hub: 0.3 },
  supermarket: { label: 'supermarket', hours: 'Mo-Sa 7-21', staff: [{ role: 'store manager', count: n(1), shifts: 'Mo-Fr 8-18', minAge: 25, qualified: false }, { role: 'cashier', count: per(250, 4), minAge: 16, qualified: false }, { role: 'shelf stocker', count: per(500, 2), minAge: 16, qualified: false }], capacity: 80, services: ['groceries'], hub: 0.45 },
  sports: { label: 'sports ground', hours: 'Mo-Fr 15-22; Sa-Su 9-19', staff: [{ role: 'groundskeeper', count: n(1), shifts: 'Mo-Fr 8-16', minAge: 18, qualified: false }, { role: 'coach', count: per(800, 1), shifts: 'Tu,Th 17-20; Sa 9-13', minAge: 20, qualified: false }], capacity: 400, services: ['sport', 'match', 'club'], hub: 0.65 },
  station: { label: 'railway station', hours: 'Mo-Su 5-24', staff: [{ role: 'station clerk', count: n(2), shifts: 'Mo-Sa 6-20; Su 8-18', minAge: 18, qualified: false }], capacity: 120, services: ['train', 'tickets'], hub: 0.25 },
  // ---- services on ground floors
  pharmacy: { label: 'pharmacy', hours: 'Mo-Fr 8-18.5; Sa 8-13', staff: [{ role: 'pharmacist', count: n(1), minAge: 25, qualified: true }, { role: 'pharmacy assistant', count: n(1), minAge: 18, qualified: true }], capacity: 8, services: ['medicine'], hub: 0.3 },
  police: { label: 'police post', hours: 'Mo-Fr 8-18', staff: [{ role: 'police officer', count: per(500, 3), shifts: 'Mo-Su 0-24', minAge: 20, qualified: true }], capacity: 6, services: ['report crime', 'police'], hub: 0.15 },
  bakery: { label: 'bakery', hours: 'Mo-Fr 6-18; Sa 6-13; Su 8-11', staff: [{ role: 'baker', count: n(1), shifts: 'Mo-Sa 3-11; Su 6-10', minAge: 18, qualified: true }, { role: 'shop assistant', count: n(2), minAge: 16, qualified: false }], capacity: 10, services: ['bread', 'cake', 'coffee'], hub: 0.55, eatery: Eatery.Bakery },
  butcher: { label: 'butcher', hours: 'Mo-Fr 8-18; Sa 8-13', staff: [{ role: 'butcher', count: n(1), minAge: 18, qualified: true }, { role: 'shop assistant', count: n(1), minAge: 16, qualified: false }], capacity: 8, services: ['meat'], hub: 0.35 },
  post: { label: 'post office', hours: 'Mo-Fr 9-17.5; Sa 9-12', staff: [{ role: 'postal clerk', count: n(1), minAge: 18, qualified: false }, { role: 'postman', count: per(800, 1), shifts: 'Mo-Sa 6-13', minAge: 18, qualified: false }], capacity: 8, services: ['mail', 'parcels'], hub: 0.4 },
  bank: { label: 'bank', hours: 'Mo-Fr 9-16; Th 9-18', staff: [{ role: 'bank manager', count: n(1), minAge: 28, qualified: true }, { role: 'bank clerk', count: per(1000, 2), minAge: 18, qualified: true }], capacity: 10, services: ['cash', 'loan', 'account'], hub: 0.2 },
  library: { label: 'library', hours: 'Tu-Fr 10-18; Sa 10-14', staff: [{ role: 'librarian', count: n(1), minAge: 23, qualified: true }], capacity: 30, services: ['books', 'read', 'study'], hub: 0.35 },
  hairdresser: { label: 'hairdresser', hours: 'Tu-Fr 9-18; Sa 8-14', staff: [{ role: 'hairdresser', count: n(2), minAge: 17, qualified: true }], capacity: 5, services: ['haircut'], hub: 0.6 },
  garage: { label: 'car repair garage', hours: 'Mo-Fr 7.5-17.5; Sa 8-12', staff: [{ role: 'mechanic', count: n(2), minAge: 18, qualified: true }], capacity: 4, services: ['car repair', 'fuel'], hub: 0.25 },
  grocer: { label: 'corner shop', hours: 'Mo-Sa 7-20; Su 9-13', staff: [{ role: 'shopkeeper', count: n(1), minAge: 18, qualified: false }, { role: 'shop assistant', count: n(1), minAge: 16, qualified: false }], capacity: 8, services: ['groceries', 'newspaper', 'tobacco'], hub: 0.45 },
  shop: { label: 'shop', hours: 'Mo-Fr 9.5-18.5; Sa 9.5-16', staff: [{ role: 'shopkeeper', count: n(1), minAge: 18, qualified: false }, { role: 'shop assistant', count: n(1), minAge: 16, qualified: false }], capacity: 10, services: ['shopping'], hub: 0.3 },
  // ---- eating and drinking (Scale's eatery kinds)
  pub: { label: 'pub', hours: 'Mo-Th 16-24; Fr-Sa 12-25; Su 12-23', staff: [{ role: 'landlord', count: n(1), minAge: 21, qualified: false }, { role: 'bartender', count: n(2), minAge: 18, qualified: false }], capacity: 60, services: ['drink', 'meal', 'darts'], hub: 0.95, eatery: Eatery.Bar },
  cafe: { label: 'café', hours: 'Mo-Sa 7-19; Su 9-17', staff: [{ role: 'café owner', count: n(1), minAge: 20, qualified: false }, { role: 'barista', count: n(2), minAge: 16, qualified: false }], capacity: 30, services: ['coffee', 'cake', 'breakfast'], hub: 0.8, eatery: Eatery.Cafe },
  restaurant: { label: 'restaurant', hours: 'Tu-Su 11.5-14.5; Tu-Su 17.5-23', staff: [{ role: 'chef', count: n(1), minAge: 20, qualified: true }, { role: 'cook', count: n(1), minAge: 17, qualified: false }, { role: 'waiter', count: n(2), minAge: 16, qualified: false }], capacity: 50, services: ['meal', 'drink'], hub: 0.6, eatery: Eatery.Restaurant },
  pizzeria: { label: 'pizzeria', hours: 'Mo-Su 11.5-23', staff: [{ role: 'pizza cook', count: n(1), minAge: 18, qualified: false }, { role: 'waiter', count: n(1), minAge: 16, qualified: false }], capacity: 35, services: ['meal', 'takeaway'], hub: 0.5, eatery: Eatery.Pizzeria },
  icecream: { label: 'ice-cream parlour', hours: 'Mo-Su 11-21', staff: [{ role: 'ice-cream seller', count: n(2), minAge: 16, qualified: false }], capacity: 20, services: ['ice cream'], hub: 0.5, eatery: Eatery.IceCream },
  bar: { label: 'bar', hours: 'We-Sa 18-26', staff: [{ role: 'bartender', count: n(2), minAge: 18, qualified: false }], capacity: 40, services: ['drink', 'dance'], hub: 0.85, eatery: Eatery.Bar },
  // ---- workplaces (no public opening)
  office: { label: 'office', hours: null, staff: [{ role: 'office worker', count: n(4), shifts: 'Mo-Fr 8-17', minAge: 18, qualified: true }], capacity: 4, services: ['business'], hub: 0.15 },
  workshop: { label: 'workshop', hours: null, staff: [{ role: 'craftsman', count: n(3), shifts: 'Mo-Fr 7-16', minAge: 16, qualified: true }], capacity: 2, services: ['repair', 'trade'], hub: 0.15 },
  factory: { label: 'factory', hours: null, staff: [{ role: 'foreman', count: n(1), shifts: 'Mo-Fr 6-15', minAge: 25, qualified: true }, { role: 'factory worker', count: n(10), shifts: 'Mo-Fr 6-22', minAge: 16, qualified: false }], capacity: 2, services: ['trade'], hub: 0.2 },
  farm: { label: 'farm', hours: null, staff: [{ role: 'farmer', count: n(1), shifts: 'Mo-Su 5-19', minAge: 16, qualified: false }, { role: 'farmhand', count: n(1), shifts: 'Mo-Sa 6-17', minAge: 16, qualified: false }], capacity: 4, services: ['farm shop', 'eggs'], hub: 0.2 },
  vacant: { label: 'empty shop', hours: null, staff: [], capacity: 0, services: [], hub: 0 },
  // ---- homes and open spaces
  home: { label: 'home', hours: null, staff: [], capacity: 8, services: ['live', 'visit'], hub: 0.3 },
  park: { label: 'park', hours: 'Mo-Su 0-24', staff: [], capacity: 300, services: ['walk', 'play', 'picnic'], hub: 0.45 },
  plaza: { label: 'square', hours: 'Mo-Su 0-24', staff: [], capacity: 300, services: ['walk', 'market'], hub: 0.6 },
};

/**
 * How many of each ground-floor kind a town of `pop` inhabitants has (the rest of its shop
 * fronts become shops, corner shops, offices or stand empty). `warm`: 0 cold … 1 warm climate.
 */
export function amenityCounts(pop: number, warm: number): [AmenityKind, number][] {
  const k = (per: number, min: number) => Math.max(min, Math.round(pop / per));
  return [
    // Every town has these.
    ['police', 1], ['pharmacy', k(2500, 1)], ['post', 1], ['bank', k(2500, 1)], ['library', 1], ['bakery', k(900, 1)],
    ['butcher', 1], ['hairdresser', k(900, 1)], ['garage', k(1600, 1)], ['pub', k(1300, 1)], ['cafe', k(700, 1)],
    // Then by size.
    ['restaurant', k(900, 1)], ['pizzeria', k(1800, 0)], ['icecream', warm > 0.45 ? k(2000, 1) : 0], ['bar', k(2500, 0)], ['grocer', k(800, 1)],
  ];
}

/** Districts each kind likes (weight > 1) or avoids (< 1); unlisted districts weigh 1. */
export const PREFER: Partial<Record<AmenityKind, Partial<Record<District, number>>>> = {
  police: { oldtown: 2, commercial: 2, industrial: 0.3 },
  post: { oldtown: 2, commercial: 2, industrial: 0.3 },
  bank: { oldtown: 2, commercial: 3, suburban: 0.3, industrial: 0.2 },
  library: { oldtown: 2, apartments: 1.5, industrial: 0.2 },
  pharmacy: { oldtown: 2, commercial: 2, industrial: 0.2 },
  garage: { industrial: 4, suburban: 2, port: 2, oldtown: 0.2 },
  pub: { oldtown: 3, port: 2, rowhouses: 1.5 },
  bar: { oldtown: 2, commercial: 2 },
  cafe: { oldtown: 2, commercial: 2 },
  grocer: { apartments: 2, rowhouses: 2, suburban: 2 },
  workshop: { industrial: 3, port: 2 },
};

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * Parse a week of hours: `;`-separated rules of days and one span, the days a range (`Mo-Fr`),
 * a list (`Tu,Th`) or one day, the span `from-to` in hours (decimals: 7.5 = 7:30; past 24 runs
 * into the next morning).
 */
export function weekly(spec: string): Interval[] {
  const out: Interval[] = [];
  for (const rule of spec.split(';')) {
    const m = rule.trim().match(/^([A-Za-z,-]+)\s+([\d.]+)-([\d.]+)$/);
    if (!m) throw new Error(`bad hours: "${rule}" in "${spec}"`);
    const from = Number(m[2]), to = Number(m[3]);
    if (!(to > from) || to - from > 24) throw new Error(`bad span: "${rule}"`);
    for (const part of m[1].split(',')) {
      const [a, b] = part.split('-');
      const i = DAYS.indexOf(a), j = b ? DAYS.indexOf(b) : i;
      if (i < 0 || j < 0 || j < i) throw new Error(`bad days: "${part}" in "${spec}"`);
      for (let d = i; d <= j; d++) out.push({ day: d, from, to });
    }
  }
  return out.sort((p, q) => p.day - q.day || p.from - q.from);
}

/** Is a place with these intervals open at (day 0..6, hour 0..24)? (Spans past 24 reach the next day.) */
export function openAt(hours: Interval[] | null, day: number, hour: number): boolean {
  if (!hours) return false;
  const prev = (day + 6) % 7;
  return hours.some((h) => (h.day === day && hour >= h.from && hour < h.to) || (h.day === prev && h.to > 24 && hour < h.to - 24));
}
