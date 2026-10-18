/**
 * What each place kind means to the society sim: which activities it serves, how much people chat there
 * (gossip hubs, plan §2.2), and default capacity, opening hours and staff. The planner may use the defaults
 * (`defaultHours`, `defaultStaff`) instead of inventing its own, so a pub is the same pub in tests and in towns.
 */
import type { Hours, PlaceKind, StaffSlot } from './places';
import { EVERY_DAY, WEEKDAYS } from './places';

/** Places with a public notice board at the door (src/sim/media.ts puts notices up there; the signs view draws the boards). */
export const BOARD_KINDS: readonly PlaceKind[] = ['townhall', 'library', 'church', 'supermarket', 'post', 'newsagent', 'square'];

export type Category = 'home' | 'food' | 'service' | 'institution' | 'work' | 'outdoor' | 'vacant' | 'away';

/** Activities a visitor (not staff) can do at a place. */
export type Service = 'eat' | 'shop' | 'socialize' | 'leisure' | 'worship' | 'exercise' | 'errand' | 'doctor' | 'school' | 'roam' | 'graze';

export interface KindInfo {
  category: Category;
  services: readonly Service[];
  /** Conversations started per present person per minute (before personality). Hubs are high. */
  chat: number;
  /** Default capacity for a normal-size place. */
  capacity: number;
}

const k = (category: Category, services: Service[], chat: number, capacity: number): KindInfo => ({ category, services, chat, capacity });

export const KINDS: Record<PlaceKind, KindInfo> = {
  house: k('home', [], 0.02, 8),
  apartments: k('home', [], 0.02, 40),
  farmhouse: k('home', [], 0.02, 10),
  bakery: k('food', ['shop', 'eat'], 0.04, 15),
  butcher: k('food', ['shop'], 0.03, 10),
  supermarket: k('food', ['shop'], 0.01, 80),
  grocer: k('food', ['shop'], 0.03, 15),
  cafe: k('food', ['eat', 'socialize'], 0.05, 30),
  pub: k('food', ['eat', 'socialize'], 0.07, 60),
  restaurant: k('food', ['eat', 'socialize'], 0.03, 50),
  pharmacy: k('service', ['shop', 'errand'], 0.02, 10),
  doctor: k('service', ['doctor'], 0.02, 20),
  dentist: k('service', ['doctor'], 0.01, 10),
  hairdresser: k('service', ['errand'], 0.06, 8),
  garage: k('service', ['errand'], 0.02, 10),
  bank: k('service', ['errand'], 0.01, 15),
  post: k('service', ['errand'], 0.02, 15),
  shop: k('service', ['shop'], 0.02, 20),
  petrol: k('service', ['shop'], 0.015, 10),
  hardware: k('service', ['shop'], 0.02, 25),
  clothes: k('service', ['shop'], 0.02, 15),
  florist: k('service', ['shop'], 0.03, 8),
  newsagent: k('service', ['shop'], 0.05, 8),
  charity: k('service', ['shop'], 0.03, 10),
  takeaway: k('food', ['eat'], 0.02, 15),
  hotel: k('service', ['eat'], 0.02, 40),
  estateagent: k('service', ['errand'], 0.02, 8),
  beauty: k('service', ['errand'], 0.06, 6),
  physio: k('service', ['doctor'], 0.02, 10),
  gym: k('service', ['exercise'], 0.02, 40),
  funeral: k('service', ['errand'], 0.01, 15),
  vacant: k('vacant', [], 0, 0),
  school: k('institution', ['school'], 0.03, 400),
  kindergarten: k('institution', ['school'], 0.02, 80),
  townhall: k('institution', ['errand'], 0.02, 40),
  police: k('institution', ['errand'], 0.01, 15),
  fire: k('institution', [], 0.02, 20),
  church: k('institution', ['worship'], 0.03, 200),
  library: k('institution', ['leisure'], 0.01, 40),
  station: k('institution', ['errand'], 0.005, 100),
  vet: k('service', ['errand'], 0.02, 10),
  carehome: k('institution', [], 0.03, 60),
  office: k('work', [], 0.015, 40),
  workshop: k('work', [], 0.02, 15),
  factory: k('work', [], 0.01, 200),
  farm: k('work', ['graze'], 0.01, 20),
  park: k('outdoor', ['leisure', 'exercise', 'roam'], 0.008, 300),
  square: k('outdoor', ['leisure', 'socialize'], 0.01, 300),
  sports: k('outdoor', ['exercise', 'socialize'], 0.03, 80),
  cemetery: k('outdoor', ['leisure'], 0.005, 100),
  street: k('outdoor', ['roam'], 0.002, 1000),
  woods: k('outdoor', ['leisure', 'exercise', 'roam'], 0.002, 1000),
  field: k('outdoor', ['graze', 'roam'], 0.001, 1000),
  // Out of town: nobody meets anyone there in the sim (the city's crowds are not simulated).
  away: k('away', [], 0, 100000),
};

/** Residents' rooms in a care home per inhabitant of the town (the planner's and testTown's care home). */
export const CARE_ROOMS_PER_PERSON = 0.025;

export const isHome = (kind: PlaceKind): boolean => KINDS[kind].category === 'home';

const MON_SAT = 0b0111111;
const SAT = 0b0100000;
const SUN = 0b1000000;
const h = (days: number, open: number, close: number): Hours => ({ days, open: open * 60, close: close * 60 });

/** Default opening hours per kind ([] = always open, or never open to the public for pure workplaces). */
export function defaultHours(kind: PlaceKind): Hours[] {
  switch (kind) {
    case 'bakery': return [h(MON_SAT, 6.5, 18), h(SUN, 7.5, 11)];
    case 'butcher': return [h(WEEKDAYS, 8, 18), h(SAT, 8, 13)];
    case 'supermarket': return [h(MON_SAT, 7, 21)];
    case 'grocer': return [h(MON_SAT, 8, 19)];
    case 'cafe': return [h(EVERY_DAY, 8, 19)];
    case 'pub': return [h(0b1001111, 16, 25), h(0b0110000, 16, 26)];
    case 'restaurant': return [h(0b1111110, 11.5, 14.5), h(0b1111110, 17.5, 22.5)];
    case 'pharmacy': return [h(WEEKDAYS, 8, 18.5), h(SAT, 8, 13)];
    case 'doctor': return [h(WEEKDAYS, 8, 12), h(0b0011011, 14, 18)];
    case 'dentist': return [h(WEEKDAYS, 8, 17)];
    case 'hairdresser': return [h(0b0111110, 9, 18)];
    case 'garage': return [h(WEEKDAYS, 7.5, 17)];
    case 'bank': return [h(WEEKDAYS, 9, 16)];
    case 'post': return [h(WEEKDAYS, 9, 18), h(SAT, 9, 12)];
    case 'shop': return [h(MON_SAT, 9.5, 18.5)];
    case 'petrol': return [h(EVERY_DAY, 6, 22)];
    case 'hardware': return [h(WEEKDAYS, 8, 19), h(SAT, 8, 16)];
    case 'clothes': return [h(WEEKDAYS, 9.5, 18.5), h(SAT, 9.5, 16)];
    case 'florist': return [h(WEEKDAYS, 8.5, 18), h(SAT, 8, 13)];
    case 'newsagent': return [h(MON_SAT, 6, 18), h(SUN, 7, 12)];
    case 'charity': return [h(MON_SAT, 10, 16)];
    case 'takeaway': return [h(0b1001111, 16.5, 23), h(0b0110000, 16.5, 24)];
    case 'hotel': return [];
    case 'estateagent': return [h(WEEKDAYS, 9, 18), h(SAT, 10, 13)];
    case 'beauty': return [h(0b0111110, 9, 18)];
    case 'physio': return [h(WEEKDAYS, 8, 18)];
    case 'gym': return [h(WEEKDAYS, 6, 22), h(0b1100000, 8, 20)];
    case 'funeral': return [h(WEEKDAYS, 9, 17)];
    case 'school': return [h(WEEKDAYS, 7.75, 15.5)];
    case 'kindergarten': return [h(WEEKDAYS, 7, 17)];
    case 'townhall': return [h(WEEKDAYS, 8, 16)];
    case 'church': return [h(EVERY_DAY, 8, 18)];
    case 'library': return [h(0b0111110, 10, 18)];
    case 'vet': return [h(WEEKDAYS, 8, 18)];
    case 'sports': return [h(EVERY_DAY, 8, 22)];
    case 'cemetery': return [h(EVERY_DAY, 7, 20)];
    default: return [];
  }
}

const s = (role: string, count: number, days: number, start: number, end: number, minAge = 18): StaffSlot =>
  ({ role, count, days, start: start * 60, end: end * 60, minAge });

/**
 * Default staff for a place of `kind`; `scale` 1 = a normal place, 2 = big (a large supermarket, a busy school).
 * Shifts cover the opening hours; weekend shifts are separate slots so nobody works seven days.
 */
export function defaultStaff(kind: PlaceKind, scale = 1): StaffSlot[] {
  const n = (x: number) => Math.max(1, Math.round(x * scale));
  switch (kind) {
    case 'bakery': return [s('baker', n(1), MON_SAT, 3.5, 11.5, 20), s('owner', 1, MON_SAT, 6, 14, 30), s('sales assistant', n(2), MON_SAT, 6.5, 14, 16), s('sales assistant', n(1), MON_SAT, 12, 18, 16), s('sales assistant', 1, SUN, 7.5, 11, 16)];
    case 'butcher': return [s('butcher', n(2), MON_SAT, 7, 16, 20)];
    case 'supermarket': return [s('store manager', 1, WEEKDAYS, 8, 17, 28), s('cashier', n(3), MON_SAT, 7, 14, 16), s('cashier', n(3), MON_SAT, 14, 21, 16), s('stocker', n(2), MON_SAT, 6, 14, 16)];
    case 'grocer': return [s('grocer', n(2), MON_SAT, 7.5, 19, 20)];
    case 'cafe': return [s('owner', 1, 0b0011111, 7.5, 16, 25), s('barista', n(1), EVERY_DAY, 7.5, 13.5, 16), s('barista', n(1), EVERY_DAY, 13, 19, 16)];
    case 'pub': return [s('landlord', 1, 0b1111110, 15, 25, 25), s('bartender', n(2), EVERY_DAY, 16, 25, 18)];
    case 'restaurant': return [s('chef', n(1), 0b1111110, 10, 22.5, 20), s('cook', n(1), 0b1111110, 11, 22.5, 18), s('waiter', n(2), 0b1111110, 11, 22.5, 16)];
    case 'pharmacy': return [s('pharmacist', n(1), MON_SAT, 8, 18.5, 26), s('pharmacy assistant', n(1), WEEKDAYS, 8, 17, 18)];
    case 'doctor': return [s('doctor', n(1), WEEKDAYS, 7.5, 18, 30), s('nurse', n(2), WEEKDAYS, 7.5, 17, 20), s('receptionist', 1, WEEKDAYS, 7.5, 16, 18)];
    case 'dentist': return [s('dentist', 1, WEEKDAYS, 8, 17, 28), s('dental nurse', n(1), WEEKDAYS, 8, 17, 18)];
    case 'hairdresser': return [s('hairdresser', n(2), 0b0111110, 9, 18, 17)];
    case 'garage': return [s('mechanic', n(2), WEEKDAYS, 7.5, 17, 17), s('owner', 1, WEEKDAYS, 7.5, 17, 30)];
    case 'bank': return [s('bank clerk', n(2), WEEKDAYS, 8.5, 16.5, 20), s('branch manager', 1, WEEKDAYS, 8, 17, 30)];
    case 'post': return [s('postal clerk', n(1), WEEKDAYS, 8.5, 18, 18), s('postman', n(2), MON_SAT, 6, 13, 18)];
    case 'shop': return [s('shopkeeper', 1, MON_SAT, 9, 18.5, 22), s('sales assistant', n(1), MON_SAT, 9.5, 18.5, 16)];
    case 'petrol': return [s('owner', 1, WEEKDAYS, 8, 17, 28), s('cashier', n(1), EVERY_DAY, 6, 14, 16), s('cashier', n(1), EVERY_DAY, 14, 22, 16)];
    case 'hardware': return [s('owner', 1, MON_SAT, 8, 17, 28), s('sales assistant', n(2), MON_SAT, 8, 16, 17), s('sales assistant', n(1), WEEKDAYS, 12, 19, 17)];
    case 'clothes': return [s('owner', 1, MON_SAT, 9.5, 18.5, 25), s('sales assistant', n(1), MON_SAT, 9.5, 18.5, 16)];
    case 'florist': return [s('florist', 1, MON_SAT, 7.5, 18, 22), s('sales assistant', n(1), 0b0111000, 9, 15, 16)];
    case 'newsagent': return [s('newsagent', 1, MON_SAT, 5.5, 14, 25), s('sales assistant', n(1), MON_SAT, 12, 18, 16), s('sales assistant', 1, SUN, 7, 12, 16), s('paper round', n(2), MON_SAT, 6, 7.5, 13)];
    case 'charity': return [s('shop manager', 1, MON_SAT, 9.5, 16.5, 25), s('shop assistant', n(1), MON_SAT, 10, 16, 16)];
    case 'takeaway': return [s('owner', 1, 0b1111110, 15.5, 24, 25), s('cook', n(1), EVERY_DAY, 16, 24, 18), s('counter assistant', n(1), 0b1111000, 16.5, 23, 16)];
    case 'hotel': return [s('hotel manager', 1, WEEKDAYS, 8, 17, 30), s('receptionist', n(1), EVERY_DAY, 6.5, 14.5, 18), s('receptionist', n(1), EVERY_DAY, 14.5, 22.5, 18), s('housekeeper', n(2), EVERY_DAY, 8, 14, 17), s('cook', n(1), EVERY_DAY, 6, 14, 18)];
    case 'estateagent': return [s('estate agent', n(1), WEEKDAYS, 9, 18, 25), s('office assistant', 1, WEEKDAYS, 9, 17, 18)];
    case 'beauty': return [s('beautician', n(2), 0b0111110, 9, 18, 18)];
    case 'physio': return [s('physiotherapist', n(2), WEEKDAYS, 8, 18, 24), s('receptionist', 1, WEEKDAYS, 8, 14, 18)];
    case 'gym': return [s('gym manager', 1, WEEKDAYS, 9, 18, 25), s('fitness trainer', n(1), WEEKDAYS, 16, 22, 18), s('fitness trainer', 1, 0b1100000, 9, 15, 18)];
    case 'funeral': return [s('funeral director', 1, WEEKDAYS, 8, 17, 30), s('funeral assistant', n(1), WEEKDAYS, 8, 17, 20)];
    case 'carehome': return [s('care home manager', 1, WEEKDAYS, 8, 17, 30), s('nurse', n(1), EVERY_DAY, 6, 14, 21), s('nurse', n(1), EVERY_DAY, 14, 22, 21), s('nurse', 1, EVERY_DAY, 22, 30, 21), s('carer', n(3), EVERY_DAY, 6.5, 14.5, 18), s('carer', n(2), EVERY_DAY, 14, 22, 18), s('cook', 1, EVERY_DAY, 6, 14, 18), s('cleaner', n(1), WEEKDAYS, 7, 13, 18)];
    case 'school': return [s('head teacher', 1, WEEKDAYS, 7.5, 16, 35), s('teacher', n(12), WEEKDAYS, 7.5, 15.5, 24), s('caretaker', 1, WEEKDAYS, 7, 16, 20), s('school secretary', 1, WEEKDAYS, 7.5, 13, 20)];
    case 'kindergarten': return [s('kindergarten teacher', n(5), WEEKDAYS, 7, 15, 20), s('kindergarten teacher', n(2), WEEKDAYS, 10, 17, 20)];
    case 'townhall': return [s('mayor', 1, WEEKDAYS, 8, 17, 35), s('town clerk', n(4), WEEKDAYS, 8, 16, 20)];
    case 'police': return [s('police officer', n(2), EVERY_DAY, 6, 14, 21), s('police officer', n(2), EVERY_DAY, 14, 22, 21), s('police officer', 1, EVERY_DAY, 22, 30, 21)];
    case 'fire': return [s('firefighter', n(3), EVERY_DAY, 7, 19, 20), s('firefighter', n(2), EVERY_DAY, 19, 31, 20)];
    case 'church': return [s('priest', 1, EVERY_DAY, 8, 18, 30), s('sexton', 1, 0b1100000, 8, 13, 20)];
    case 'library': return [s('librarian', n(2), 0b0111110, 9.5, 18, 22)];
    case 'station': return [s('station clerk', n(1), EVERY_DAY, 6, 14, 18), s('station clerk', n(1), EVERY_DAY, 14, 22, 18)];
    case 'vet': return [s('vet', 1, WEEKDAYS, 8, 18, 28), s('vet assistant', n(1), WEEKDAYS, 8, 17, 18)];
    case 'office': return [s('office worker', n(12), WEEKDAYS, 8, 17, 20), s('manager', n(2), WEEKDAYS, 8, 18, 30)];
    case 'workshop': return [s('craftsman', n(4), WEEKDAYS, 7, 16, 17), s('master craftsman', 1, WEEKDAYS, 7, 16, 30)];
    case 'factory': return [s('factory worker', n(20), WEEKDAYS, 6, 14, 18), s('factory worker', n(15), WEEKDAYS, 14, 22, 18), s('foreman', n(2), WEEKDAYS, 6, 14, 30), s('engineer', n(3), WEEKDAYS, 8, 17, 25)];
    case 'farm': return [s('farmer', 1, EVERY_DAY, 5, 18, 20), s('farmhand', n(1), MON_SAT, 6, 15, 16)];
    case 'sports': return [s('groundskeeper', 1, WEEKDAYS, 8, 16, 18), s('coach', 1, 0b0111110, 15, 21, 20)];
    case 'cemetery': return [s('gardener', 1, WEEKDAYS, 7, 15, 18)];
    default: return [];
  }
}
