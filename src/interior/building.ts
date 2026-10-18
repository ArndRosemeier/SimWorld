/**
 * A building's whole interior: every storey planned (src/interior/storey.ts) with the theme its
 * use calls for, the homes in it, and the spots where its people sleep, sit and work. What the
 * building is for comes from the planner (`b.use`, `b.amenity`, `dwellingsOf(b)`) and, when the
 * caller has it, from the society sim's place (its staff and capacity): a café gets tables for
 * its guests, a bakery a work table per baker, an office a desk per office worker, every flat a
 * kitchen, a bathroom and somewhere to sleep.
 *
 * New in SimWorld; Scale planned one storey when the player walked in (src/interior/Interiors.ts
 * with InteriorGen.planCores, planFloor and shopKindOf). Pure: a function of the building.
 */
import { Rng, deriveSeed, hash32 } from '@futuremagic/core';
import { offset } from '../geom/clip';
import { distPointPolyEdge as distPolyEdge, pointInPoly, polyArea, polyBounds, type Poly } from '../geom/geom2';
import { dwellingsOf, streetDoor, type BuildingDesc } from '../plan/building';
import { PLACE_KIND_OF, type AmenityKind } from '../plan/amenities';
import { buildingTiers } from '../build/massing';
import { KINDS, defaultStaff } from '../sim/placeKinds';
import type { StaffSlot } from '../sim/places';
import { coreFits, planCores } from './cores';
import { planStorey, type StoreyUse } from './storey';
import { homeItems, homeProgram, type HomeRoom } from './fill/home';
import { workItems, workProgram, type Need, type Work } from './fill/work';
import type { FloorPlan, Furn, FurnUse, Spot } from './types';

/** What the people of a workplace are, when the caller knows (the sim's place): its staff and capacity. */
export interface PlaceUse { staff: readonly StaffSlot[]; capacity: number }

/** One home in the building. */
export interface Unit {
  /** Storeys it has rooms on. */
  floors: number[];
  rooms: number;
  /** Floor area (m²). */
  area: number;
  /** People it has beds for. */
  sleeps: number;
}

export interface Interior {
  storeys: FloorPlan[];
  /** The homes (`dwellingsOf(b)` of them where the floor allows). */
  units: Unit[];
  /** The workplace on the ground floor (or in the whole building), if any. */
  work: Work | null;
  spots: Spot[];
}

/** Storey height and level above the ground floor (Scale: buildingLayout floorBottom). */
export const storeyLevel = (b: BuildingDesc, f: number): number => (f <= 0 ? 0 : b.groundH + (f - 1) * b.floorH);
const storeyHeight = (b: BuildingDesc, f: number): number => (f === 0 ? b.groundH : b.floorH);

/** The facade outline of storey f: its setback tier. */
export function storeyFacade(b: BuildingDesc, f: number, tiers = buildingTiers(b)): Poly {
  let t = tiers[0];
  for (const q of tiers) if (q.fromFloor <= f) t = q;
  return t.poly;
}

/** The inside outline of storey f: its facade, 20 cm in. */
export function storeyPoly(b: BuildingDesc, f: number, tiers = buildingTiers(b)): Poly {
  const outer = storeyFacade(b, f, tiers);
  const inner = offset([outer], -0.2, 'miter');
  return inner.length ? inner.sort((a, c) => Math.abs(area(c.outer)) - Math.abs(area(a.outer)))[0].outer : outer;
}
const area = polyArea;

/** The workplace layout of an amenity (a shop is a clothes shop one time in three, else a general store). */
export function workOf(b: BuildingDesc): Work | null {
  const a = b.amenity;
  if (!a) return b.use === 'office' ? 'office' : b.use === 'industrial' ? 'workshop' : b.shopfront || b.use === 'retail' ? 'vacant' : null;
  const MAP: Record<AmenityKind, Work> = {
    pharmacy: 'pharmacy', police: 'police', bakery: 'bakery', butcher: 'butcher', post: 'post', bank: 'bank', library: 'library',
    hairdresser: 'hairdresser', garage: 'garage', pub: 'pub', bar: 'pub', cafe: 'cafe', icecream: 'icecream', restaurant: 'restaurant',
    pizzeria: 'restaurant', grocer: 'grocery', shop: 'grocery', office: 'office', workshop: 'workshop', factory: 'factory', vacant: 'vacant',
  };
  return a === 'shop' && hash32(b.seed ^ 0x51c7e3) % 3 === 0 ? 'clothes' : MAP[a];
}

/** Most staff on site at once, over a week in half hours (shifts past midnight included). */
export function peakStaff(slots: readonly StaffSlot[]): number {
  let peak = 0;
  for (let d = 0; d < 7; d++) for (let t = 0; t < 32 * 60; t += 30) {
    let n = 0;
    for (const s of slots) if (s.days & (1 << d) && s.start <= t && t < s.end) n += s.count;
    peak = Math.max(peak, n);
  }
  return peak;
}

/** Who a workplace's floors are for: staff on site at once (shared over `floors`), and seats. */
function needOf(b: BuildingDesc, place: PlaceUse | undefined, floors: number): Need {
  const kind = b.amenity ? PLACE_KIND_OF[b.amenity] : null;
  if (!kind) return { staff: 0, seats: 0 };
  const staff = peakStaff(place?.staff ?? defaultStaff(kind));
  const cap = place?.capacity ?? KINDS[kind].capacity;
  const sv = KINDS[kind].services;
  const seats = sv.includes('eat') || sv.includes('socialize') ? cap : sv.includes('leisure') ? cap / 2 : 0;
  return { staff: Math.ceil(staff / Math.max(1, floors)), seats };
}

/** What each storey is for. */
function usesOf(b: BuildingDesc, place: PlaceUse | undefined): StoreyUse[] {
  const n = Math.max(1, b.floors);
  if (b.use === 'parking' || b.style === 'garage') return Array.from({ length: n }, () => ({ kind: 'parking' }));
  const work = workOf(b), homes = dwellingsOf(b);
  const whole = b.use === 'office' || b.use === 'industrial' || b.use === 'retail' || b.use === 'civic' || (work && !homes);
  // Storeys with the workplace: the ground floor, or all of them (an office block, a hall, a shop with rooms over it).
  const workFloors = work ? (whole ? n : 1) : 0;
  const need = needOf(b, place, b.amenity === 'office' ? workFloors : 1);
  const uses: StoreyUse[] = [];
  const rooms = (w: Work, f: number, nd: Need): StoreyUse => ({
    kind: 'rooms', program: workProgram(w, f === 0), unit: -1,
    items: (type, A) => workItems(w, type, A, new Rng(deriveSeed(b.seed, 'items', f, type)), nd),
  });
  for (let f = 0; f < n; f++) {
    if (f < workFloors) {
      // Above a hall or a shop: its offices (the staff room, the bookkeeping).
      const w = f === 0 || work === 'office' ? work! : 'office';
      uses.push(rooms(w, f, f === 0 || work === 'office' ? need : { staff: 1, seats: 0 }));
      continue;
    }
    const first = workFloors;
    if (homes === 1) {
      // One home over the building's storeys: living below, sleeping above.
      const part = n - first <= 1 ? 'flat' : f === first ? 'day' : 'night';
      uses.push({ kind: 'rooms', program: homeProgram(part, f === 0), unit: 0, part, items: (type, A) => homeItems(type as HomeRoom, A, new Rng(deriveSeed(b.seed, 'items', f, type))) ?? [] });
      continue;
    }
    const per = b.style === 'house' ? 1 : b.units;
    uses.push(per > 0 ? { kind: 'flats', count: per, first: (f - first) * per } : rooms('office', f, { staff: 2, seats: 0 }));
  }
  return uses;
}

/** Plans every storey of a building. `place`: the sim's place for its workplace, when known. */
export function planInterior(b: BuildingDesc, place?: PlaceUse): Interior {
  const n = Math.max(1, b.floors), tiers = buildingTiers(b);
  const polys = Array.from({ length: n }, (_, f) => storeyPoly(b, f, tiers));
  const door = streetDoor(b);
  const maxH = Math.max(b.groundH, b.floorH);
  const cores = planCores(b, polys[0], maxH, door);
  const uses = usesOf(b, place);
  const stairOn = (f: number) => !!cores.stair && f >= 0 && f < n && coreFits(cores.stair, polys[f]);
  const storeys: FloorPlan[] = [];
  for (let f = 0; f < n; f++) {
    // A home storey cut so that a home lacks something it must have is cut again (a few tries, the best kept).
    let best: FloorPlan | null = null, bestD = Infinity;
    for (let k = 0; k < RETRIES && bestD > 0; k++) {
      const r = new Rng(deriveSeed(b.seed, 'interior', f, k));
      const plan = planStorey(b, polys[f], f, storeyLevel(b, f), storeyHeight(b, f), uses[f], cores, stairOn(f) && stairOn(f + 1), f > 0 && stairOn(f) && stairOn(f - 1), f === 0 ? door : null, r);
      const d = defects(plan, uses[f]);
      if (d < bestD) { best = plan; bestD = d; }
    }
    storeys.push(best!);
  }
  const spots = spotsOf(storeys);
  const kind = b.amenity ? PLACE_KIND_OF[b.amenity] : null;
  standIn(storeys, spots, kind ? peakStaff(place?.staff ?? defaultStaff(kind)) : 0);
  return { storeys, units: unitsOf(storeys), work: workOf(b), spots };
}

/** Rooms where staff without a desk or counter of their own stand and work. */
const STAND = new Set<string>(['shop', 'office', 'dining', 'bakehouse', 'salon', 'reading', 'workshop', 'garage', 'factory', 'storage', 'lobby', 'meeting']);

/**
 * A workplace whose furniture gives fewer workplaces than its staff on site at once (an odd lot
 * with no room for another counter): the rest stand in its biggest rooms, on free floor.
 */
function standIn(storeys: FloorPlan[], spots: Spot[], staff: number): void {
  let short = staff - spots.filter((p) => p.unit < 0 && (p.use === 'work' || p.use === 'serve')).length;
  if (short <= 0) return;
  const rooms = storeys.flatMap((s) => s.rooms.filter((r) => r.unit < 0 && STAND.has(r.type)).map((r) => ({ s, r, a: Math.abs(area(r.poly)) })));
  rooms.sort((p, q) => q.a - p.a || p.s.floor - q.s.floor);
  for (const { s, r } of rooms) {
    const [x0, z0, x1, z1] = polyBounds(r.poly);
    for (let x = x0 + 0.6; x < x1 - 0.5 && short > 0; x += 1.2) for (let z = z0 + 0.6; z < z1 - 0.5 && short > 0; z += 1.2) {
      if (!pointInPoly(r.poly, x, z) || distPolyEdge(r.poly, x, z) < 0.5) continue;
      if (s.furniture.some((f) => f.h > 0.05 && onPiece(f, x, z, 0.35))) continue;
      if (spots.some((p) => p.floor === s.floor && Math.hypot(p.x - x, p.z - z) < 0.8)) continue;
      spots.push({ use: 'work', floor: s.floor, x, z, yaw: 0, unit: -1 });
      short--;
    }
    if (short <= 0) return;
  }
}

/** Is (x, z) on a piece's footprint, grown by `m`? */
function onPiece(f: Furn, x: number, z: number, m: number): boolean {
  const dx = x - f.x, dz = z - f.z, c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  return Math.abs(dx * c - dz * sn) < f.w / 2 + m && Math.abs(dx * sn + dz * c) < f.d / 2 + m;
}

/** Tries per storey. */
const RETRIES = 4;

/**
 * What the homes on a storey lack: a living room, somewhere to cook and a toilet on a home's day
 * floor, a bed and a toilet on its night floor (a flat is both).
 */
export function defects(plan: FloorPlan, use: StoreyUse): number {
  if (use.kind === 'parking' || (use.kind === 'rooms' && !use.part)) return 0;
  const day = use.kind === 'flats' || use.part !== 'night', night = use.kind === 'flats' || use.part !== 'day';
  const has = new Map<number, Set<string>>();
  const at = (u: number) => has.get(u) ?? (has.set(u, new Set()), has.get(u)!);
  for (const r of plan.rooms) if (r.unit >= 0) at(r.unit).add(r.type);
  for (const f of plan.furniture) if (f.unit !== undefined && f.unit >= 0) at(f.unit).add(f.kind);
  let n = 0;
  for (const h of has.values()) {
    if (day && !h.has('living')) n++;
    if (day && !h.has('kitchenRow')) n++;
    if (night && !h.has('bed') && !h.has('bedDouble')) n++;
    if (night && !h.has('toilet')) n++;
  }
  return n;
}

function unitsOf(storeys: FloorPlan[]): Unit[] {
  const units: Unit[] = [];
  for (const s of storeys) {
    for (const room of s.rooms) {
      if (room.unit < 0) continue;
      const u = (units[room.unit] ??= { floors: [], rooms: 0, area: 0, sleeps: 0 });
      if (!u.floors.includes(s.floor)) u.floors.push(s.floor);
      u.rooms++;
      u.area += Math.abs(area(room.poly));
    }
    for (const f of s.furniture) if (f.unit !== undefined && f.unit >= 0 && units[f.unit]) units[f.unit].sleeps += f.kind === 'bedDouble' ? 2 : f.kind === 'bed' ? 1 : 0;
  }
  for (let i = 0; i < units.length; i++) units[i] ??= { floors: [], rooms: 0, area: 0, sleeps: 0 };
  return units;
}

/**
 * Where a piece puts its person: on a seat or a bed; in front of a bench, a machine, an oven or a
 * car lift; behind a counter (its staff side). A salon chair has its client in it and the
 * hairdresser behind; a bar has stools along its front.
 */
function spotsOfPiece(f: Furn, floor: number, out: Spot[]): void {
  if (!f.use) return;
  const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
  const unit = f.unit ?? -1;
  const at = (use: FurnUse, along: number, ahead: number, yaw: number) => out.push({ use, floor, x: f.x + rx * along + fx * ahead, z: f.z + rz * along + fz * ahead, yaw, unit });
  const SEATS = new Set(['chair', 'officeChair', 'sofa', 'armchair', 'bunk']);
  if (f.use === 'sleep') { const k = f.kind === 'bedDouble' ? 2 : 1; for (let i = 0; i < k; i++) at('sleep', k === 2 ? (i - 0.5) * f.w / 2 : 0, 0, f.yaw); return; }
  if (f.kind === 'salonChair') { at('sit', 0, 0, f.yaw); at('work', 0, -(f.d / 2 + 0.35), f.yaw); return; }
  if (f.use === 'serve') {
    const k = Math.max(1, Math.floor(f.w / 1.2));
    for (let i = 0; i < k; i++) at('serve', (i - (k - 1) / 2) * (f.w / k), -(f.d / 2 + 0.45), f.yaw);
    if (f.kind === 'barCounter') for (let x = -f.w / 2 + 0.4; x < f.w / 2 - 0.2; x += 0.65) at('sit', x, f.d / 2 + 0.45, f.yaw + Math.PI);
    return;
  }
  if (f.use === 'sit' || SEATS.has(f.kind)) {
    const k = f.kind === 'sofa' ? Math.max(2, Math.round(f.w / 0.75)) : 1;
    for (let i = 0; i < k; i++) at(f.use, (i - (k - 1) / 2) * (f.w / k), 0, f.yaw);
    return;
  }
  // Work at the front of it, facing it.
  at('work', 0, f.d / 2 + 0.4, f.yaw + Math.PI);
}

function spotsOf(storeys: FloorPlan[]): Spot[] {
  const out: Spot[] = [];
  for (const s of storeys) for (const f of s.furniture) spotsOfPiece(f, s.floor, out);
  return out;
}
