/**
 * The town's economy (Track F; Arnd's answer to Q3: "real but simple"). Households have monthly budgets: wages
 * from their real jobs, pensions, child benefit and unemployment support coming in; rent or mortgage, bills,
 * groceries, the car and what they spend in town's shops going out. Businesses earn from their actual customers:
 * the customer base (`customerBase`) is the real population, each person's spending on each kind of business by
 * their means, split between the places of that kind by distance, quality and their favourite place. In live play
 * the visits people actually make (`spend`, called on arrival) decide which place of a kind gets the money that
 * day, so a boycott, a new rival or the player's choices show up in the till. Plus a share from the villages around
 * and passing traffic. A business that keeps losing money closes: its staff lose their jobs, its
 * regulars find another local, the unit stands empty with a to-let board, and the town talks about it. Empty units
 * reopen as whatever the town lacks, often run by a local with savings and ambition.
 *
 * Money is per person (`people.money`, the one store); a household's savings are its adults' money. Prices are in
 * one unnamed currency (the town is placeless, D10) at modern western levels.
 *
 * Visible consequences for the render tracks: `townLooks(world)` (to-let and for-sale boards, upkeep and wealth
 * per place). Pure data like the rest of src/sim.
 */
import { clamp, hashCombine, hashToFloat, type Rng } from '@futuremagic/core';
import { A, type ActorId } from './actors';
import { addFact, witness } from './knowledge';
import { closeTo, feel, leaveTown, log, neighboursOf, vacantHomes, type LifeEventKind } from './life';
import { remember } from './memory';
import { HABITS, HABIT_COUNT, T_CONSC, V_AMBITION, type Household, type Job } from './people';
import { defaultHours, defaultStaff, isHome, KINDS } from './placeKinds';
import { PLACE_KINDS, popcount, type PlaceId, type PlaceKind, type StaffSlot } from './places';
import { rulesOf } from './politics';
import { Columns, f32, f64, i32, u8 } from './table';
import { DAYS_PER_YEAR, MINUTES_PER_DAY } from './time';
import { monthKey } from './calendar';
import { businessHours } from './hours';
import { fitRoutine, pickHabits, settle } from './synth';
import { ageOf, householdOf, isPerson, jobOf, placesOf, setPlaceKind, tickRng, traitOf, valueOf, type World } from './world';
import { ownedWord } from '../lang/words';

// ---- prices and trades -----------------------------------------------------------------------------------

/** What things cost in town (NPCs and the player pay these; the chatter and prompts quote them). */
export const PRICES = {
  loaf: 3.4, roll: 0.6, coffee: 3.2, cake: 3.9, pint: 4.6, wine: 5.8, lunch: 14, dinner: 32, pizza: 12, kebab: 8.5,
  haircut: 32, petrol: 1.85, newspaper: 2.5, flowers: 22, gym: 39, prescription: 6, stamp: 1.1,
} as const;

/** Who buys at a kind of business: adults, drinkers (18+), car households, home owners, the fit (18-65). */
type Who = 'adult' | 'drinker' | 'car' | 'owner' | 'fit';

/**
 * How a kind of business earns. `customers`: visits by townspeople, `rate` visits per eligible person per day,
 * `basket` spent per visit, `outside` extra share from the villages and passing trade. `external`: sells outside
 * the town (offices, works, farms, the hotel, the bank branch). `events`: paid per life event in town (`basket` per
 * death for the funeral home, per move for the estate agent). Kinds not listed are public (school, town hall,
 * church, surgery, care home): funded, they never close.
 */
interface Trade {
  model: 'customers' | 'external' | 'events';
  /** For `events`: which life events bring the business a customer. */
  events?: readonly LifeEventKind[];
  basket: number;
  /** Share of revenue left after stock (food, fuel, goods). */
  margin: number;
  rate: number;
  who: Who;
  outside: number;
  /** Monthly rent for the premises (and energy). */
  premises: number;
}
const t = (basket: number, margin: number, rate: number, who: Who, outside: number, premises: number): Trade => ({ model: 'customers', basket, margin, rate, who, outside, premises });
const ext = (premises: number): Trade => ({ model: 'external', basket: 0, margin: 1, rate: 0, who: 'adult', outside: 0, premises });

export const TRADES: Partial<Record<PlaceKind, Trade>> = {
  supermarket: t(38, 0.1, 0.2, 'adult', 0.35, 3500),
  grocer: t(9, 0.32, 0.07, 'adult', 0.1, 700),
  bakery: t(6.5, 0.6, 0.15, 'adult', 0.15, 800),
  butcher: t(18, 0.38, 0.035, 'adult', 0.25, 700),
  cafe: t(7.5, 0.68, 0.09, 'adult', 0.2, 900),
  pub: t(14, 0.65, 0.08, 'drinker', 0.15, 1400),
  restaurant: t(32, 0.62, 0.03, 'adult', 0.35, 1500),
  takeaway: t(16, 0.6, 0.04, 'adult', 0.2, 700),
  pharmacy: t(14, 0.3, 0.045, 'adult', 0.2, 900),
  hairdresser: t(32, 0.7, 0.025, 'adult', 0.15, 800),
  beauty: t(40, 0.6, 0.008, 'adult', 0.15, 900),
  garage: t(260, 0.5, 0.003, 'car', 0.25, 1200),
  shop: t(25, 0.45, 0.15, 'adult', 0.15, 800),
  petrol: t(55, 0.08, 0.06, 'car', 1.5, 1500),
  hardware: t(28, 0.38, 0.035, 'owner', 0.4, 1600),
  clothes: t(45, 0.42, 0.014, 'adult', 0.2, 900),
  florist: t(22, 0.6, 0.012, 'adult', 0.2, 500),
  newsagent: t(6, 0.3, 0.08, 'adult', 0.1, 500),
  charity: t(8, 0.92, 0.022, 'adult', 0.1, 300),
  estateagent: { model: 'events', events: ['arrived', 'leftHome', 'departed'], basket: 2500, margin: 0.9, rate: 0, who: 'adult', outside: 0.5, premises: 700 },
  physio: t(45, 0.7, 0.007, 'adult', 0.25, 900),
  gym: t(4.5, 0.85, 0.055, 'fit', 0.15, 1200),
  funeral: { model: 'events', events: ['death'], basket: 3800, margin: 0.5, rate: 0, who: 'adult', outside: 1.5, premises: 800 },
  hotel: ext(2500), bank: ext(1200), office: ext(2000), workshop: ext(900), factory: ext(6000), farm: ext(800),
};

/** Kinds a vacant shop unit can reopen as. */
const OPENABLE: readonly PlaceKind[] = [
  'bakery', 'butcher', 'grocer', 'cafe', 'pub', 'restaurant', 'takeaway', 'hairdresser', 'beauty', 'shop', 'clothes',
  'florist', 'newsagent', 'charity', 'physio', 'gym', 'hardware',
];

/** What a new business of a kind is called after its owner ("Keller's Bakery"): src/lang/words.ts `ownedWord`. */

/** Roles that own the business they work in (they draw from its profit instead of a wage). */
const OWNER_ROLES = new Set(['owner', 'landlord', 'shopkeeper', 'newsagent', 'florist', 'funeral director', 'estate agent']);

// ---- wages and support -------------------------------------------------------------------------------------

/** Full-time monthly net pay by role (the rest: by minimum age, a stand-in for training). */
const PAY: Record<string, number> = {
  doctor: 6500, dentist: 6000, vet: 4300, pharmacist: 3800, 'head teacher': 4200, teacher: 3100, mayor: 4000, engineer: 3800,
  manager: 3700, 'branch manager': 3600, 'store manager': 3100, 'police officer': 2800, firefighter: 2600, nurse: 2500,
  'care home manager': 3200, carer: 1750, priest: 2200, cashier: 1550, 'sales assistant': 1500, waiter: 1450, barista: 1450,
  bartender: 1550, cook: 1700, chef: 2300, 'factory worker': 2150, foreman: 2900, farmhand: 1650, mechanic: 2300,
  craftsman: 2300, 'master craftsman': 3100, 'office worker': 2400, 'bank clerk': 2400, 'postal clerk': 2050, postman: 2000,
  librarian: 2300, 'kindergarten teacher': 2350, 'town clerk': 2400, cleaner: 1500, 'paper round': 300,
  'physiotherapist': 2700, beautician: 1700, 'fitness trainer': 1800, 'gym manager': 2500, 'hotel manager': 3000,
  housekeeper: 1550, receptionist: 1800, 'funeral assistant': 1900, 'shop manager': 1900, 'office assistant': 1800,
  'counter assistant': 1450, hairdresser: 1750, baker: 2150, butcher: 2150, grocer: 1900, stocker: 1550, groundskeeper: 1900,
  coach: 2100, gardener: 1850, sexton: 1700, 'station clerk': 2100, 'pharmacy assistant': 1800, 'dental nurse': 1950,
  'vet assistant': 1800, 'school secretary': 2000, caretaker: 1900, farmer: 2200,
};
const PENSION = 1250;
const CHILD_BENEFIT = 250;
const SUPPORT = 950;
/** A care home place costs this much a month; the pension pays first, the council tops up the rest. */
const CARE_FEE = 2900;

/** Weekly hours of a job (shift length × days per week). */
const weeklyHours = (job: Job): number => ((job.end - job.start) / 60) * popcount(job.days);

/** Monthly net pay of a position (part-time pro rata, overtime capped). Owners draw from profit instead (`ownerOf`). */
export function payOf(job: Job): number {
  const full = PAY[job.role] ?? 1500 + Math.max(0, job.minAge - 16) * 70;
  return Math.round(full * Math.min(1.15, weeklyHours(job) / 39));
}

// ---- state -----------------------------------------------------------------------------------------------

export const BIZ_NONE = 0;
export const BIZ_OPEN = 1;
export const BIZ_VACANT = 2;

const BIZ_COLUMNS = {
  status: u8(),
  cash: f64(),
  /** This month so far. */
  revenue: f64(),
  visits: f32(),
  /** Last full month, for prompts and views. */
  lastRevenue: f32(),
  lastProfit: f32(),
  /** How good the business is (service, stock, the owner's care), 0..1: steers its share of customers. */
  quality: f32(1, 0.5),
  /** Consecutive months in the red. */
  red: u8(),
  /** Game day it opened or fell vacant. */
  since: i32(),
  /** A vacant unit: what it was (index into PLACE_KINDS; -1 an empty shop unit from the start). */
  former: i32(-1),
  /** External trade: revenue / costs, a slow random walk. */
  ratio: f32(1, 1.1),
  /** Live play: visits since the last day close. */
  today: f32(),
  /** Expected revenue per day from the customer base (time skip). */
  expected: f32(),
} as const;

export const TENURE_RENT = 0;
export const TENURE_MORTGAGE = 1;
export const TENURE_OWNED = 2;
export const TENURE_CARE = 3;

const HOUSEHOLD_COLUMNS = {
  /** Home the tenure belongs to (a move resets it). */
  home: i32(-1),
  tenure: u8(),
  /** Rent, mortgage or care fee per month. */
  housing: f32(),
  /** Last month's income and outgoings. */
  income: f32(),
  outgo: f32(),
  /** This month's spending in town so far. */
  spent: f32(),
  expected: f32(),
  /** 0 fine .. 1 cannot make ends meet. */
  pressure: f32(),
  /** How kept-up the home looks, 0 run-down .. 1 immaculate. */
  upkeep: f32(1, 0.6),
  /** 0 poorest .. 1 richest household in town. */
  wealth: f32(1, 0.5),
  /** Months behind on rent or mortgage. */
  arrears: u8(),
} as const;

export interface BizEvent {
  day: number;
  kind: 'closed' | 'opened' | 'evicted';
  place: PlaceId;
  /** Owner (opened) or household head (evicted), -1 if none. */
  who: ActorId;
  /** What the business was or became. */
  what: PlaceKind;
  name: string;
  fact: number;
}

export interface Economy {
  biz: Columns<typeof BIZ_COLUMNS>;
  hh: Columns<typeof HOUSEHOLD_COLUMNS>;
  /** Jobs at businesses that closed: never filled again. */
  closedJobs: Set<number>;
  /** Openings, closures and evictions, oldest first. */
  events: BizEvent[];
  /** Month index of the last review. */
  month: number;
  /** Game day of the last day close. */
  day: number;
  /** Was there a live visit since the last day close? (Otherwise the days were skipped: expected shares apply.) */
  liveSeen: boolean;
}

export function newEconomy(places: number): Economy {
  const biz = new Columns(BIZ_COLUMNS, places);
  for (let i = 0; i < places; i++) biz.add();
  return { biz, hh: new Columns(HOUSEHOLD_COLUMNS, 256), closedJobs: new Set(), events: [], month: 0, day: 0, liveSeen: false };
}

/** The calendar month of a game day, counted from year 0 (paydays and the books follow the real months). */
const monthOf = (world: World, day: number): number => monthKey(world, day * MINUTES_PER_DAY);
const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
const today = (world: World): number => Math.floor(world.clock / MINUTES_PER_DAY);

/** Is this position still there (its business has not closed)? Life events hire only into open jobs. */
export const jobOpen = (world: World, job: Job): boolean => !world.economy.closedJobs.has(job.id);

/** A position someone can be hired into: vacant, open, and not elected (the mayor comes from src/sim/politics.ts). */
export const hireable = (world: World, job: Job): boolean => job.holder < 0 && jobOpen(world, job) && job.role !== 'mayor';

// ---- settling a new world ----------------------------------------------------------------------------------

/**
 * The economy of a freshly synthesised town: tenure and savings per household, a ledger per business, the oldest
 * people living alone in the care home if the town has one. Called by `createWorld` after jobs are handed out.
 */
export function settleEconomy(world: World, rng: Rng): void {
  const e = world.economy, b = e.biz.cols;
  e.day = today(world);
  e.month = monthOf(world, e.day);
  for (const p of world.graph.places) {
    if (b.status[p.id] !== BIZ_NONE || !TRADES[p.kind]) continue;
    b.status[p.id] = BIZ_OPEN;
    b.since[p.id] = e.day - rng.int(200, 9000);
    b.ratio[p.id] = 1.1 + rng.gaussian(0, 0.05);
  }
  // The care home's rooms: the oldest and frailest living alone have moved in.
  const care = placesOf(world, ['carehome']);
  if (care.length) {
    const alone = world.households.filter((h) => h.members.length === 1 && world.graph.places[h.home].kind !== 'farmhouse' && ageOf(world, h.members[0]) >= 80)
      .sort((x, y) => ageOf(world, y.members[0]) - ageOf(world, x.members[0]));
    for (const h of alone) {
      if (rng.chance(0.4) || !moveToCareHome(world, h.members[0], rng.fork('care', h.id))) continue;
      for (const an of h.animals.slice()) leaveTown(world, an, rng);
    }
  }
  for (const h of world.households) household(world, h.id);
  // Savings: a few months of income, more for the careful and the old.
  const a = world.actors.cols, pc = world.people.cols;
  const income = monthlyIncome(world);
  for (const h of world.households) {
    const adults = h.members.filter((m) => ageOf(world, m) >= 18);
    for (const m of adults) {
      const months = Math.max(0, rng.gaussian(2 + traitOf(world, m, T_CONSC) * 4 + Math.max(0, ageOf(world, m) - 30) / 8, 2.5));
      pc.money[a.row[m]] = Math.round((income.get(h.id) ?? 0) / adults.length * months);
    }
  }
  reviewHouseholds(world, income, rng.fork('review'), false);
  customerBase(world);
  for (const p of world.graph.places) if (b.status[p.id] === BIZ_OPEN) b.cash[p.id] = fixedCosts(world, p.id) * rng.range(1, 4);
}

/**
 * The high street as the town can carry it, before anyone is hired: where the planner put more businesses of a kind
 * than the town's spending supports, the weakest have already closed and stand empty. Every business gets its
 * quality here. Called by `createWorld` after the households and before the jobs.
 */
export function levelMarket(world: World, rng: Rng): void {
  const b = world.economy.biz.cols;
  const day = today(world);
  for (const p of world.graph.places) {
    if (p.kind === 'vacant') { b.status[p.id] = BIZ_VACANT; b.since[p.id] = day - rng.int(30, 400); continue; }
    if (TRADES[p.kind]) b.quality[p.id] = clamp(rng.gaussian(0.55, 0.18), 0.05, 1);
  }
  const pools = buyerPools(world);
  const surplus: [PlaceId, PlaceKind][] = [];
  let fronts = placesOf(world, ['vacant']).length, empty = fronts;
  for (const kind of Object.keys(TRADES) as PlaceKind[]) {
    if (TRADES[kind]!.model !== 'customers') continue;
    const open = placesOf(world, [kind]).sort((x, y) => b.quality[x] - b.quality[y]);
    fronts += open.length;
    while (open.length > 1 && viability(kind, pools, open.length) < OWNER_MINIMUM) surplus.push([open.shift()!, kind]);
  }
  // Some of the surplus stands empty (a high street has a few to-let boards); the rest went to small offices:
  // the insurance agent, the tax adviser, the solicitor.
  rng.shuffle(surplus);
  for (const [place, kind] of surplus) {
    if (empty < Math.ceil(fronts * MAX_EMPTY)) {
      setPlaceKind(world, place, 'vacant', { hours: [], staff: [], capacity: 0 });
      b.status[place] = BIZ_VACANT;
      b.former[place] = PLACE_KINDS.indexOf(kind);
      b.since[place] = day - rng.int(30, 900);
      empty++;
    } else {
      const p = world.graph.places[place];
      setPlaceKind(world, place, 'office', { name: `${p.street.split(' ')[0]} ${rng.pick(SMALL_OFFICES)}`, hours: [], staff: defaultStaff('office', 0.15), capacity: 10 });
    }
  }
}

/** Share of shop fronts that may stand empty when the town is made. */
const MAX_EMPTY = 0.12;
const SMALL_OFFICES = ['Insurance', 'Tax Advisers', 'Solicitors', 'Accountants', 'Architects', 'Travel', 'Lettings', 'Opticians'];

/** What an owner must take home for a business to be worth running. */
const OWNER_MINIMUM = 1500;

/** How many people could buy at each kind of business (by `Who`). */
function buyerPools(world: World): Record<Who, number> {
  const pool: Record<Who, number> = { adult: 0, drinker: 0, car: 0, owner: 0, fit: 0 };
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id), hh = householdOf(world, id);
    for (const w of Object.keys(pool) as Who[]) if (eligible(world, age, hh, w)) pool[w]++;
  }
  return pool;
}

/** Monthly profit (before the owner's pay) each of `n` businesses of a kind can expect from the town's demand. */
function viability(kind: PlaceKind, pools: Record<Who, number>, n: number): number {
  const tr = TRADES[kind]!;
  const perMonth = (pools[tr.who] * tr.rate * tr.basket * (1 + tr.outside) * DAYS_PER_MONTH) / Math.max(1, n);
  const staff = defaultStaff(kind).reduce((s, st, i) => s + (i === 0 ? 0 : st.count * payOf({ ...st, id: -1, place: -1, holder: -1 })), 0);
  return perMonth * tr.margin - staff - tr.premises;
}

// ---- the daily close -------------------------------------------------------------------------------------

/**
 * The economy over the `days` ending now (daily in live play, per chronicle step in the time skip): revenue and
 * household spending accrue, and at each month's turn the books are closed (`reviewMonth`).
 */
export function economyDay(world: World, days: number): void {
  const e = world.economy, b = e.biz.cols, h = e.hh.cols;
  const day = today(world);
  const live = e.liveSeen;
  // Life events since the last close that bring the funeral home or the estate agent a customer (per household).
  const happened = new Map<LifeEventKind, number>();
  const seen = new Set<string>();
  for (let k = world.life.events.length - 1; k >= 0; k--) {
    const ev = world.life.events[k];
    if (ev.day <= e.day) break;
    if (ev.day > day || world.actors.cols.kind[ev.who] !== 0) continue;
    const key = ev.kind + ':' + (ev.kind === 'death' ? ev.who : ev.fact);
    if (seen.has(key)) continue;
    seen.add(key);
    happened.set(ev.kind, (happened.get(ev.kind) ?? 0) + 1);
  }
  // A kind's takings come from the customer base; live visits decide which of its places gets them.
  const kindTotal = new Map<PlaceKind, { expected: number; visits: number }>();
  for (const p of world.graph.places) {
    if (b.status[p.id] !== BIZ_OPEN || TRADES[p.kind]!.model !== 'customers') continue;
    const k = kindTotal.get(p.kind) ?? { expected: 0, visits: 0 };
    k.expected += b.expected[p.id]; k.visits += b.today[p.id];
    kindTotal.set(p.kind, k);
  }
  for (const p of world.graph.places) {
    const i = p.id;
    if (b.status[i] !== BIZ_OPEN) continue;
    const tr = TRADES[p.kind]!;
    let r = 0;
    if (tr.model === 'customers') {
      const k = kindTotal.get(p.kind)!;
      r = (live && k.visits > 0 ? (k.expected * b.today[i]) / k.visits : b.expected[i]) * days;
    }
    else if (tr.model === 'events') {
      const n = tr.events!.reduce((s, k) => s + (happened.get(k) ?? 0), 0);
      r = (n * tr.basket * (1 + tr.outside)) / Math.max(1, placesOf(world, [p.kind]).length);
    }
    else r = (wageBill(world, i) + tr.premises) * b.ratio[i] * (days / DAYS_PER_MONTH);
    b.revenue[i] += r;
    b.today[i] = 0;
  }
  for (let k = 0; k < world.households.length && k < e.hh.count; k++) h.spent[k] += h.expected[k] * days;
  e.liveSeen = false;
  const months = monthOf(world, day) - e.month;
  e.day = day;
  for (let m = 0; m < months; m++) reviewMonth(world, tickRng(world, 'economy', m));
  e.month = monthOf(world, day);
}

/**
 * Someone arrives where they planned to buy, eat or train: a customer for that business today. Called from `arrive`
 * for each arrival. Children tagging along and staff on their break do not count.
 */
export function spend(world: World, id: ActorId, place: PlaceId, activity: number): void {
  if (activity !== A.shop && activity !== A.eat && activity !== A.socialize && activity !== A.exercise && activity !== A.errand && activity !== A.doctor) return;
  const e = world.economy;
  if (e.biz.cols.status[place] !== BIZ_OPEN) return;
  const tr = TRADES[world.graph.places[place].kind];
  if (!tr || tr.model !== 'customers') return;
  const a = world.actors.cols;
  if (a.with[id] >= 0 || a.kind[id] !== 0 || ageOf(world, id) < 14) return;
  if (jobOf(world, id)?.place === place) return;
  e.biz.cols.today[place] += 1;
  e.biz.cols.visits[place] += 1;
  e.liveSeen = true;
}

/**
 * A shopping trip for free time: a kind of business the person needs now and then (the florist, the hardware
 * store, a takeaway, the gym), picked by how often people like them go, at the nearest open one. Null when the
 * person needs nothing today. The supermarket, café, pub and bakery are covered by habits already.
 */
export function shoppingTrip(world: World, id: ActorId, here: PlaceId, rng: Rng): { place: PlaceId; activity: number; minutes: [number, number] } | null {
  const age = ageOf(world, id);
  if (age < 14) return null;
  const hh = householdOf(world, id);
  const kinds: PlaceKind[] = [], weights: number[] = [];
  for (const k of TRIP_KINDS) {
    const tr = TRADES[k]!;
    if (!eligible(world, age, hh, tr.who)) continue;
    kinds.push(k); weights.push(tr.rate);
  }
  if (kinds.length === 0) return null;
  const kind = rng.weighted(kinds, (_, i) => weights[i]);
  const places = placesOf(world, [kind]);
  if (places.length === 0) return null;
  const place = world.travel.nearest(here, places);
  const activity = KINDS[kind].services.includes('eat') ? A.eat : KINDS[kind].services.includes('exercise') ? A.exercise : KINDS[kind].services.includes('shop') ? A.shop : A.errand;
  return { place, activity, minutes: activity === A.exercise ? [45, 80] : activity === A.eat ? [20, 40] : [10, 30] };
}
const COVERED = new Set<PlaceKind>(['supermarket', 'grocer', 'cafe', 'pub', 'bakery']);
const TRIP_KINDS = (Object.keys(TRADES) as PlaceKind[]).filter((k) => TRADES[k]!.model === 'customers' && !COVERED.has(k));

function eligible(world: World, age: number, hh: Household | null, who: Who): boolean {
  switch (who) {
    case 'adult': return age >= 16;
    case 'drinker': return age >= 18;
    case 'car': return age >= 18 && !!hh?.car;
    case 'owner': {
      if (age < 25 || hh === null) return false;
      // Before the budgets are settled: houses are mostly owned, flats mostly rented.
      if (hh.id >= world.economy.hh.count) return world.graph.places[hh.home].kind !== 'apartments';
      const t = world.economy.hh.cols.tenure[hh.id];
      return t !== TENURE_RENT && t !== TENURE_CARE;
    }
    case 'fit': return age >= 18 && age < 66;
  }
}

// ---- the customer base (time skip) -------------------------------------------------------------------------

/** The habit that ties a person to a business of this kind (their café, their pub, where they do the big shop). */
const HABIT_OF: Partial<Record<PlaceKind, number>> = {
  cafe: HABITS.indexOf('cafe'), bakery: HABITS.indexOf('cafe'), pub: HABITS.indexOf('pub'), supermarket: HABITS.indexOf('shop'), grocer: HABITS.indexOf('shop'),
};

/**
 * Who buys where, from the actual population: each person's visits to each kind of business, split between the
 * places of that kind by distance from home and how good each is, with most going to their favourite place when
 * they have one. Sets each business's expected daily revenue and each household's expected daily spending.
 */
export function customerBase(world: World): void {
  const e = world.economy, b = e.biz.cols, h = e.hh.cols, a = world.actors.cols, pc = world.people.cols;
  b.expected.fill(0);
  h.expected.fill(0);
  const byKind = new Map<PlaceKind, PlaceId[]>();
  for (const k of Object.keys(TRADES) as PlaceKind[]) {
    if (TRADES[k]!.model !== 'customers') continue;
    const l = placesOf(world, [k]).filter((p) => b.status[p] === BIZ_OPEN);
    if (l.length) byKind.set(k, l);
  }
  const shares = new Map<number, Float32Array>();
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 14) continue;
    const hhId = pc.household[a.row[id]];
    const hh = hhId >= 0 ? world.households[hhId] : null;
    const home = a.home[id];
    let ki = 0;
    for (const [kind, places] of byKind) {
      ki++;
      const tr = TRADES[kind]!;
      if (!eligible(world, age, hh, tr.who)) continue;
      const key = home * 64 + ki;
      let s = shares.get(key);
      if (!s) {
        s = new Float32Array(places.length);
        let sum = 0;
        for (let i = 0; i < places.length; i++) { const d = world.travel.metres(home, places[i]) / 600; s[i] = (0.5 + b.quality[places[i]]) / (1 + d * d); sum += s[i]; }
        for (let i = 0; i < places.length; i++) s[i] /= sum;
        shares.set(key, s);
      }
      const habit = HABIT_OF[kind];
      // The better-off spend more in town; households under pressure cut back.
      const means = hhId >= 0 && hhId < e.hh.count ? (0.6 + 0.8 * h.wealth[hhId]) * (1 - 0.4 * h.pressure[hhId]) : 1;
      const fav = habit !== undefined ? pc.habits[a.row[id] * HABIT_COUNT + habit] : -1;
      const favAt = fav >= 0 ? places.indexOf(fav) : -1;
      for (let i = 0; i < places.length; i++) {
        const share = favAt >= 0 ? 0.3 * s[i] + (i === favAt ? 0.7 : 0) : s[i];
        const v = tr.rate * share * means;
        b.expected[places[i]] += v * tr.basket * (1 + tr.outside);
        if (hhId >= 0 && hhId < e.hh.count) h.expected[hhId] += v * tr.basket;
      }
    }
  }
}

// ---- the monthly review ------------------------------------------------------------------------------------

function jobsAt(world: World): Map<PlaceId, Job[]> {
  const m = new Map<PlaceId, Job[]>();
  for (const j of world.jobs) {
    if (world.economy.closedJobs.has(j.id)) continue;
    const l = m.get(j.place);
    if (l) l.push(j); else m.set(j.place, [j]);
  }
  return m;
}

/** The position whose holder owns the business at `place` (null: run by a company, a charity or the public). */
export function ownerOf(world: World, place: PlaceId): Job | null {
  const kind = world.graph.places[place].kind;
  const tr = TRADES[kind];
  if (!tr || tr.model === 'external' || kind === 'charity') return null;
  let first: Job | null = null;
  for (const j of world.jobs) {
    if (j.place !== place || world.economy.closedJobs.has(j.id)) continue;
    if (OWNER_ROLES.has(j.role)) return j;
    first ??= j;
  }
  return first;
}

/** Wages paid at a place this month (filled positions, not the owner). */
function wageBill(world: World, place: PlaceId, jobs?: Job[]): number {
  const owner = ownerOf(world, place);
  let w = 0;
  for (const j of jobs ?? world.jobs.filter((x) => x.place === place && !world.economy.closedJobs.has(x.id))) if (j.holder >= 0 && j !== owner) w += payOf(j);
  return w;
}

/** Rent plus the wages a business would pay with every position filled. */
function fixedCosts(world: World, place: PlaceId): number {
  const tr = TRADES[world.graph.places[place].kind];
  if (!tr) return 0;
  const owner = ownerOf(world, place);
  let w = 0;
  for (const j of world.jobs) if (j.place === place && j !== owner && !world.economy.closedJobs.has(j.id)) w += payOf(j);
  return tr.premises + w;
}

/** Most an owner takes home in a good month. */
const DRAW_CAP = 5200;

function reviewMonth(world: World, rng: Rng): void {
  const e = world.economy, b = e.biz.cols;
  const jobs = jobsAt(world);
  const draws = new Map<ActorId, number>();
  // Businesses: costs, profit, the owner's draw, the cash in the till.
  for (const p of world.graph.places) {
    const i = p.id;
    if (b.status[i] !== BIZ_OPEN) continue;
    const tr = TRADES[p.kind]!;
    const wages = wageBill(world, i, jobs.get(i));
    const profit = b.revenue[i] * tr.margin - wages - tr.premises;
    const owner = ownerOf(world, i);
    let draw = 0;
    if (owner && owner.holder >= 0) {
      draw = clamp(profit * 0.85, 600, DRAW_CAP);
      if (b.cash[i] + profit < 0) draw = Math.min(draw, 600);
      draws.set(owner.holder, draw);
    }
    b.cash[i] += profit - draw;
    b.lastRevenue[i] = b.revenue[i];
    b.lastProfit[i] = profit - draw;
    b.red[i] = profit - draw < 0 ? Math.min(255, b.red[i] + 1) : 0;
    b.revenue[i] = 0;
    b.visits[i] = 0;
    if (tr.model === 'external') b.ratio[i] = clamp(b.ratio[i] + (1.1 - b.ratio[i]) * 0.1 + rng.gaussian(0, 0.03), 0.7, 1.5);
  }
  // Closures: out of cash, or losing money month after month (and the rare company that pulls out of town).
  for (const p of world.graph.places) {
    const i = p.id;
    if (b.status[i] !== BIZ_OPEN) continue;
    const tr = TRADES[p.kind]!;
    const fixed = fixedCosts(world, i);
    let close = false;
    if (tr.model === 'external') close = p.kind !== 'farm' && b.ratio[i] < 0.95 && rng.chance(0.04);
    else close = b.cash[i] < -2 * fixed || (tr.model === 'customers' && b.red[i] >= 4 && rng.chance(0.25));
    if (close) closeBusiness(world, i, rng.fork('close', i));
  }
  // Openings: now and then an empty unit gets a tenant (one a month at most), if the town can carry another business.
  for (const p of world.graph.places) {
    if (b.status[p.id] !== BIZ_VACANT || today(world) - b.since[p.id] < 45 || !rng.chance(0.06)) continue;
    // Only shop fronts take a new shop: a closed works or office block stays empty (or waits for the planner).
    const was = b.former[p.id] >= 0 ? PLACE_KINDS[b.former[p.id]] : null;
    if (was && KINDS[was].category !== 'food' && KINDS[was].category !== 'service') continue;
    const kind = whatTheTownLacks(world, rng);
    if (kind) openBusiness(world, p.id, kind, rng.fork('open', p.id));
    break;
  }
  // Households.
  const income = monthlyIncome(world, draws);
  reviewHouseholds(world, income, rng.fork('households'), true);
  customerBase(world);
}

/** Every household's income this month: wages, owners' draws, pensions, child benefit, support. */
function monthlyIncome(world: World, draws?: Map<ActorId, number>): Map<number, number> {
  const out = new Map<number, number>();
  const owners = new Set<ActorId>();
  for (const p of world.graph.places) { const o = TRADES[p.kind] ? ownerOf(world, p.id) : null; if (o && o.holder >= 0) owners.add(o.holder); }
  for (const h of world.households) {
    if (h.members.length === 0) continue;
    let sum = 0, kids = 0, earners = 0;
    for (const m of h.members) {
      const age = ageOf(world, m);
      if (age < 18) { kids++; continue; }
      const job = jobOf(world, m);
      if (job) { sum += owners.has(m) ? draws?.get(m) ?? 2600 : payOf(job); earners++; }
      else if (age >= 67) sum += PENSION + Math.round(hashToFloat(hashCombine(world.seed, m)) * 500);
    }
    // Support for adults out of work (not students living with their parents).
    const parentAt = h.members.some((x) => ageOf(world, x) >= 40);
    for (const m of h.members) {
      const age = ageOf(world, m);
      if (age < 18 || age >= 67 || (age < 25 && parentAt) || jobOf(world, m) || world.people.cols.school[world.actors.cols.row[m]] >= 0) continue;
      sum += earners > 0 ? SUPPORT * 0.5 : SUPPORT;
    }
    sum += kids * CHILD_BENEFIT;
    out.set(h.id, sum);
  }
  return out;
}

/** Make sure the household has a row and a tenure for its current home. */
function household(world: World, id: number): number {
  const e = world.economy, h = e.hh.cols;
  while (e.hh.count <= id) e.hh.add();
  const hh = world.households[id];
  if (h.home[id] !== hh.home) {
    const r = tickRng(world, 'tenure', id);
    const place = world.graph.places[hh.home];
    const value = 0.85 + hashToFloat(hashCombine(world.seed, hashCombine(hh.home, 77))) * 0.4;
    const headAge = hh.members.length ? ageOf(world, hh.members[0]) : 40;
    h.home[id] = hh.home;
    h.arrears[id] = 0;
    if (place.kind === 'carehome') { h.tenure[id] = TENURE_CARE; h.housing[id] = CARE_FEE; }
    else if (place.kind === 'farmhouse' || (place.kind === 'house' && r.chance(0.7)) || (place.kind === 'apartments' && r.chance(0.2))) {
      const mortgage = headAge < 58 && r.chance(0.8);
      h.tenure[id] = mortgage ? TENURE_MORTGAGE : TENURE_OWNED;
      h.housing[id] = mortgage ? Math.round((place.kind === 'apartments' ? 650 : 950) * value + r.range(0, 300)) : 0;
    } else {
      h.tenure[id] = TENURE_RENT;
      h.housing[id] = Math.round((place.kind === 'apartments' ? 680 : 1200) * value + r.range(0, 250));
    }
  }
  return id;
}

/**
 * What a household needs a month besides housing: fixed bills (energy, phone, insurance, the car's tax), and the
 * everyday spending on groceries, fuel and the rest, much of which it spends in town (`spent`).
 */
function livingCosts(world: World, hh: Household, income: number): { fixed: number; everyday: number } {
  const rules = rulesOf(world);
  let adults = 0, kids = 0;
  for (const m of hh.members) (ageOf(world, m) >= 18 ? adults++ : kids++);
  return {
    // (The council's decisions: higher local rates, and parking charges for those who drive into the centre.)
    fixed: 170 + 40 * hh.members.length + (hh.car ? 130 : 0) + (rules.ratesUp ? 12 + 4 * hh.members.length : 0) + (rules.parkingCharges && hh.car ? 18 : 0),
    everyday: 380 * adults + 200 * kids + (hh.car ? 180 : 0) + Math.max(0, income - 2500) * 0.12,
  };
}

/** The social minimum: housing (up to a cap), the bills and most of the basics, when income and savings fall short. */
const socialMinimum = (world: World, hh: Household, housing: number): number => {
  const c = livingCosts(world, hh, 0);
  return Math.min(housing, 1100) + c.fixed + c.everyday * 0.9;
};

function reviewHouseholds(world: World, income: Map<number, number>, rng: Rng, settleMonth: boolean): void {
  const e = world.economy, h = e.hh.cols, a = world.actors.cols, pc = world.people.cols;
  const evict: Household[] = [];
  for (const hh of world.households) {
    if (hh.members.length === 0) continue;
    const k = household(world, hh.id);
    const adults = hh.members.filter((m) => ageOf(world, m) >= 18);
    const savings = adults.reduce((s, m) => s + pc.money[a.row[m]], 0);
    // Support: what the state tops up when income falls short and the savings are used up (care fees included).
    const floor = socialMinimum(world, hh, h.housing[k]);
    let inc = income.get(hh.id) ?? 0;
    let supported = false;
    if (h.tenure[k] === TENURE_CARE) inc = Math.max(inc, h.housing[k] + 150);
    else if (inc < floor && savings < 6000) { inc = floor; supported = true; }
    const c = livingCosts(world, hh, inc);
    // Everyday spending: what they spent in town, or what they need if that was less (bought elsewhere).
    const out = h.housing[k] + c.fixed + Math.max(c.everyday, h.spent[k]);
    if (settleMonth && adults.length) {
      // The month's balance lands in the adults' accounts.
      const balance = inc - out;
      for (const m of adults) pc.money[a.row[m]] += balance / adults.length;
    }
    h.income[k] = inc;
    h.outgo[k] = out;
    h.spent[k] = 0;
    const buffer = savings / Math.max(300, out);
    const strain = clamp((out - inc) / Math.max(500, inc) * 1.2 + (buffer < 1 ? (1 - buffer) * 0.6 : 0), 0, 1);
    h.pressure[k] = settleMonth ? h.pressure[k] * 0.5 + strain * 0.5 : strain;
    // Behind on rent or mortgage: savings gone and still short.
    if (settleMonth && (h.tenure[k] === TENURE_RENT || h.tenure[k] === TENURE_MORTGAGE)) {
      // (Support pays the rent straight to the landlord, so only those who earn too much for it fall behind.)
      h.arrears[k] = !supported && savings < -out && inc < out ? h.arrears[k] + 1 : 0;
      if (h.arrears[k] >= 4 && rng.chance(0.3)) evict.push(hh);
    }
  }
  // Wealth by rank: income and savings.
  const live = world.households.filter((hh) => hh.members.length > 0);
  const savingsOf = (hh: Household) => hh.members.reduce((s, m) => s + (ageOf(world, m) >= 18 ? pc.money[a.row[m]] : 0), 0);
  const rank = (score: (hh: Household) => number) => {
    const sorted = live.map((hh) => ({ id: hh.id, v: score(hh) })).sort((x, y) => x.v - y.v);
    const r = new Map<number, number>();
    sorted.forEach((s, i) => r.set(s.id, sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
    return r;
  };
  const byIncome = rank((hh) => (income.get(hh.id) ?? 0) / Math.sqrt(hh.members.length)), bySavings = rank(savingsOf);
  for (const hh of live) {
    const k = hh.id;
    h.wealth[k] = byIncome.get(k)! * 0.6 + bySavings.get(k)! * 0.4;
    const head = hh.members[0];
    const target = clamp(0.25 + 0.45 * h.wealth[k] + 0.3 * traitOf(world, head, T_CONSC) - (ageOf(world, head) >= 80 ? 0.2 : 0) - h.pressure[k] * 0.3, 0, 1);
    h.upkeep[k] = settleMonth ? h.upkeep[k] + (target - h.upkeep[k]) * 0.12 : clamp(target + rng.gaussian(0, 0.08), 0, 1);
    if (settleMonth && h.pressure[k] > 0.5) strained(world, hh, h.pressure[k], rng);
  }
  for (const hh of evict) evicted(world, hh, rng.fork('evict', hh.id));
}

/** Money worries: stress and fear for the adults, and the couple bickers. */
function strained(world: World, hh: Household, pressure: number, rng: Rng): void {
  const a = world.actors.cols;
  const adults = hh.members.filter((m) => ageOf(world, m) >= 18);
  for (const m of adults) {
    a.stress[m] = Math.max(a.stress[m], pressure * 0.8);
    feel(world, m, 'fear', pressure * 0.5);
  }
  if (adults.length >= 2 && rng.chance(pressure * 0.5)) {
    const c = world.relations.t.cols;
    for (const [x, y] of [[adults[0], adults[1]], [adults[1], adults[0]]]) {
      const r = world.relations.ensure(x, y);
      c.affection[r] = clamp(c.affection[r] - 0.04 * pressure, -1, 1);
    }
  }
}

/** Four months behind: the household gives up the home and leaves town. */
function evicted(world: World, hh: Household, rng: Rng): void {
  const head = hh.members[0];
  const day = today(world);
  const neighbours = neighboursOf(world, hh.home, hh);
  const fact = addFact(world, { topic: 'family', text: '{subject} had to give up their home at {place}: they could not keep up the payments', subject: head, place: hh.home, magnitude: 0.6 });
  witness(world, fact, [...closeTo(world, head), ...neighbours]);
  world.economy.events.push({ day, kind: 'evicted', place: hh.home, who: head, what: world.graph.places[hh.home].kind, name: world.graph.places[hh.home].name, fact });
  for (const m of hh.members.slice()) { log(world, day, 'departed', m, head, hh.home, fact); leaveTown(world, m, rng.fork('leave', m)); }
  for (const an of hh.animals.slice()) leaveTown(world, an, rng.fork('leave', an));
}

// ---- closing and opening -------------------------------------------------------------------------------------

/** A place's regulars: the people who count it among their favourite places (`habits`). */
export function regularsOf(world: World, place: PlaceId): ActorId[] {
  const a = world.actors.cols, pc = world.people.cols, out: ActorId[] = [];
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const r = a.row[id];
    for (let k = 0; k < HABIT_COUNT; k++) if (pc.habits[r * HABIT_COUNT + k] === place) { out.push(id); break; }
  }
  return out;
}

/**
 * A business closes for good: the staff lose their jobs, regulars pick another favourite, the unit stands empty
 * with a to-let board, and it is the talk of the town.
 */
export function closeBusiness(world: World, place: PlaceId, rng: Rng): void {
  const ec = world.economy, b = ec.biz.cols, p = world.graph.places[place];
  const day = today(world);
  const name = p.name, kind = p.kind;
  const owner = ownerOf(world, place);
  const staff: ActorId[] = [];
  for (const j of world.jobs) {
    if (j.place !== place || ec.closedJobs.has(j.id)) continue;
    ec.closedJobs.add(j.id);
    if (j.holder < 0) continue;
    const id = j.holder;
    staff.push(id);
    j.holder = -1;
    world.people.cols.job[world.actors.cols.row[id]] = -1;
    fitRoutine(world, id, rng.fork('routine', id));
  }
  const regulars = regularsOf(world, place);
  setPlaceKind(world, place, 'vacant', { hours: [], staff: [], capacity: 0 });
  b.status[place] = BIZ_VACANT;
  b.former[place] = PLACE_KINDS.indexOf(kind);
  b.since[place] = day;
  b.cash[place] = 0;
  for (const id of regulars) pickHabits(world, id, rng.fork('habits', id));
  const ownerId = owner?.holder ?? -1;
  const fact = addFact(world, { topic: 'business', text: `${name} has closed down`, subject: ownerId >= 0 ? ownerId : -1, place, magnitude: 0.8 });
  const passers = neighboursOf(world, place);
  witness(world, fact, [...new Set([...closeTo(world, ...staff), ...regulars, ...passers])]);
  for (const id of staff) {
    feel(world, id, 'sadness', id === ownerId ? 0.9 : 0.6);
    remember(world, id, { who: staff.filter((s) => s !== id), summary: id === ownerId ? `I had to close ${name}` : `${name} closed and I lost my job`, importance: id === ownerId ? 1 : 0.85, emotion: 'sadness', fact });
    log(world, day, 'fired', id, -1, place, fact);
  }
  ec.events.push({ day, kind: 'closed', place, who: ownerId, what: kind, name, fact });
}

/** The kind of business the town would support next, or null if it is served well enough already. */
function whatTheTownLacks(world: World, rng: Rng): PlaceKind | null {
  const b = world.economy.biz.cols;
  const pools = buyerPools(world);
  const options: { kind: PlaceKind; profit: number }[] = [];
  for (const kind of OPENABLE) {
    const n = placesOf(world, [kind]).filter((p) => b.status[p] === BIZ_OPEN).length;
    if (kind === 'charity' && n > 0) continue;
    const profit = viability(kind, pools, n + 1);
    // A newcomer needs clear room: a good margin, and nobody of that kind already struggling.
    const struggling = placesOf(world, [kind]).some((p) => b.status[p] === BIZ_OPEN && b.red[p] > 0);
    if (profit > 2 * OWNER_MINIMUM && !struggling) options.push({ kind, profit });
  }
  if (options.length === 0) return null;
  return rng.weighted(options, (o) => o.profit).kind;
}

/**
 * A new business moves into an empty unit: a local with savings and ambition runs it if there is one (else
 * someone from outside, and the owner's position is filled like any vacancy), and the street notices.
 */
export function openBusiness(world: World, place: PlaceId, kind: PlaceKind, rng: Rng): void {
  const ec = world.economy, b = ec.biz.cols, pc = world.people.cols, a = world.actors.cols;
  const p = world.graph.places[place];
  const day = today(world);
  const start = defaultStaff(kind).reduce((s, st) => s + st.count, 0) * 2500 + TRADES[kind]!.premises * 4;
  // A local founder: 25-60, ambitious, with the money (or the nerve) to start.
  let owner = -1, best = 0;
  for (let id = 0; id < world.actors.count; id++) {
    if (!isPerson(world, id)) continue;
    const age = ageOf(world, id);
    if (age < 25 || age > 60) continue;
    const money = pc.money[a.row[id]];
    const score = valueOf(world, id, V_AMBITION) * (money >= start * 0.4 ? 1 : 0.15) * rng.float();
    if (score > best && score > 0.25) { best = score; owner = id; }
  }
  const surname = owner >= 0 ? world.people.last[a.row[owner]] : p.street.split(' ')[0];
  const name = `${surname}${owner >= 0 ? "'s" : ''} ${ownedWord(kind) ?? kind}`;
  const capacity = Math.round(KINDS[kind].capacity);
  setPlaceKind(world, place, kind, { name, hours: businessHours(kind, defaultHours(kind), rng), staff: defaultStaff(kind), capacity });
  for (const s of world.graph.places[place].staff) addJobs(world, place, s);
  if (rulesOf(world).sundayShops) openOnSundays(world, place);
  b.status[place] = BIZ_OPEN;
  b.since[place] = day;
  b.red[place] = 0;
  b.revenue[place] = 0;
  b.cash[place] = start;
  b.quality[place] = clamp(0.3 + 0.45 * (owner >= 0 ? traitOf(world, owner, T_CONSC) : 0.5) + rng.range(0, 0.25), 0, 1);
  const job = ownerOf(world, place);
  if (owner >= 0 && job) {
    const old = jobOf(world, owner);
    if (old) old.holder = -1;
    job.holder = owner;
    pc.job[a.row[owner]] = job.id;
    pc.money[a.row[owner]] -= start * 0.4;
    settle(world, owner, rng.fork('settle'));
  }
  const passers = neighboursOf(world, place);
  const fact = addFact(world, { topic: 'business', text: `a new ${(ownedWord(kind) ?? kind).toLowerCase()} is opening on ${p.street}: ${name}`, subject: owner, place, magnitude: 0.7 });
  witness(world, fact, [...new Set([...(owner >= 0 ? closeTo(world, owner) : []), ...passers])]);
  if (owner >= 0) remember(world, owner, { who: [], summary: `I opened ${name} on ${p.street}`, importance: 1, emotion: 'joy', fact });
  ec.events.push({ day, kind: 'opened', place, who: owner, what: kind, name, fact });
}

const addJobs = (world: World, place: PlaceId, s: StaffSlot): void => {
  for (let i = 0; i < s.count; i++) world.jobs.push({ id: world.jobs.length, place, role: s.role, days: s.days, start: s.start, end: s.end, minAge: s.minAge, holder: -1 });
};

/** Kinds that open on Sundays once the council allows it: the bigger shops (small independents keep their Sunday). */
const SUNDAY_TRADE = new Set<PlaceKind>(['supermarket', 'shop', 'clothes', 'hardware']);
const SUNDAY = 1 << 6;

/**
 * Sunday trading (a council decision, src/sim/politics.ts): a bigger shop opens 11:00 to 17:00 on Sundays, with a
 * Sunday shift of its own that is filled like any vacancy. Nothing for other kinds, or a shop already open then.
 */
export function openOnSundays(world: World, place: PlaceId): void {
  const p = world.graph.places[place];
  if (!SUNDAY_TRADE.has(p.kind) || p.hours.some((h) => h.days & SUNDAY)) return;
  const crew = p.staff.filter((s) => s.minAge <= 17);
  const role = (crew[0] ?? p.staff[p.staff.length - 1])?.role ?? 'sales assistant';
  const slot: StaffSlot = { role, count: p.kind === 'supermarket' ? 3 : 1, days: SUNDAY, start: 10 * 60 + 45, end: 17 * 60 + 15, minAge: 16 };
  setPlaceKind(world, place, p.kind, { hours: [...p.hours, { days: SUNDAY, open: 11 * 60, close: 17 * 60 }], staff: [...p.staff, slot] });
  addJobs(world, place, slot);
}

// ---- the care home -----------------------------------------------------------------------------------------

/** A free room in the town's care home, or -1 (none in town, or full). */
export function careHomeRoom(world: World): PlaceId {
  for (const c of placesOf(world, ['carehome'])) {
    const used = world.households.filter((h) => h.home === c && h.members.length > 0).length;
    if (used < world.graph.places[c].homes) return c;
  }
  return -1;
}

/** An old person moves into the town's care home (a household of one there). False if there is no room. */
export function moveToCareHome(world: World, id: ActorId, rng: Rng): boolean {
  const room = careHomeRoom(world);
  if (room < 0) return false;
  const from = householdOf(world, id);
  const hh: Household = { id: world.households.length, home: room, surname: world.people.last[world.actors.cols.row[id]], members: [], animals: [], car: false };
  world.households.push(hh);
  if (from) from.members.splice(from.members.indexOf(id), 1);
  hh.members.push(id);
  world.people.cols.household[world.actors.cols.row[id]] = hh.id;
  world.actors.cols.home[id] = room;
  household(world, hh.id);
  settle(world, id, rng);
  return true;
}

// ---- what the town looks like ----------------------------------------------------------------------------------

export const LOOK_TO_LET = 1;
export const LOOK_FOR_SALE = 2;
/** Opened in the last two months (new sign, balloons on the door). */
export const LOOK_NEW = 4;
/** Struggling: losing money for a while (the window display goes stale). */
export const LOOK_STRUGGLING = 8;

export interface TownLooks {
  /** LOOK_* bits per place. */
  flags: Uint8Array;
  /** How kept-up each home or shop front looks, 0..1 (homes: the households' upkeep; shops: how the business does). */
  upkeep: Float32Array;
  /** How well-off the people living there are, 0..1 (cars, gardens, extensions). */
  wealth: Float32Array;
}

/**
 * The visible state of the town's economy, per place, for the render tracks (street dressing, facades): to-let and
 * for-sale boards, new and struggling shops, upkeep and wealth. Cheap enough to call once a game hour.
 */
export function townLooks(world: World): TownLooks {
  const n = world.graph.places.length;
  const flags = new Uint8Array(n), upkeep = new Float32Array(n).fill(0.6), wealth = new Float32Array(n).fill(0.5);
  const ec = world.economy, b = ec.biz.cols, h = ec.hh.cols;
  const day = today(world);
  const count = new Float32Array(n);
  for (const hh of world.households) {
    if (hh.members.length === 0 || hh.id >= ec.hh.count) continue;
    const pl = hh.home;
    if (count[pl] === 0) { upkeep[pl] = 0; wealth[pl] = 0; }
    upkeep[pl] += h.upkeep[hh.id]; wealth[pl] += h.wealth[hh.id]; count[pl]++;
  }
  for (let i = 0; i < n; i++) if (count[i] > 1) { upkeep[i] /= count[i]; wealth[i] /= count[i]; }
  for (const pl of vacantHomes(world)) flags[pl] |= world.graph.places[pl].kind === 'apartments' ? LOOK_TO_LET : LOOK_FOR_SALE;
  for (const p of world.graph.places) {
    const i = p.id;
    if (b.status[i] === BIZ_VACANT) { flags[i] |= LOOK_TO_LET; upkeep[i] = clamp(0.5 - (day - b.since[i]) / 720, 0.1, 0.5); continue; }
    if (b.status[i] !== BIZ_OPEN) continue;
    if (day - b.since[i] < 60) flags[i] |= LOOK_NEW;
    if (b.red[i] >= 2) flags[i] |= LOOK_STRUGGLING;
    if (!isHome(p.kind)) upkeep[i] = clamp(0.35 + b.quality[i] * 0.45 + (b.cash[i] > 0 ? 0.15 : -0.1) - b.red[i] * 0.04, 0, 1);
  }
  return { flags, upkeep, wealth };
}

/** A household's money picture, for prompts and the chatter ("they're struggling since he lost his job"). */
export function budgetOf(world: World, hh: Household): { income: number; outgo: number; savings: number; pressure: number; tenure: number; housing: number } {
  const k = household(world, hh.id), h = world.economy.hh.cols, a = world.actors.cols;
  const savings = hh.members.reduce((s, m) => s + (ageOf(world, m) >= 18 ? world.people.cols.money[a.row[m]] : 0), 0);
  return { income: h.income[k], outgo: h.outgo[k], savings, pressure: h.pressure[k], tenure: h.tenure[k], housing: h.housing[k] };
}
