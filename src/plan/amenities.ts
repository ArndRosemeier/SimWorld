/**
 * What the town's ground floors and workplaces are for: the kinds the town planner hands out to
 * shop fronts, office blocks and halls, how many of each a town of a given size has, where each
 * likes to be, which eatery (terrace) kind it gets, and which place kind of the society sim it
 * becomes. New in SimWorld; Scale's eatery kinds (plan/eatery.ts) are some of the kinds here.
 * Opening hours, staff, capacity and services are the sim's (src/sim/placeKinds.ts), so a pub is
 * the same pub everywhere.
 *
 * The town planner (plan/town.ts) decides which building holds which kind; the place graph
 * (plan/placeGraph.ts) hands the result to the simulation.
 */
import { Eatery } from './eatery';
import type { District } from './types';
import type { PlaceKind } from '../sim/places';

/** Ground-floor and workplace kinds (in ordinary buildings). */
export type AmenityKind =
  | 'pharmacy' | 'police' | 'bakery' | 'butcher' | 'post' | 'bank' | 'library' | 'hairdresser' | 'garage'
  | 'pub' | 'cafe' | 'restaurant' | 'pizzeria' | 'icecream' | 'bar'
  | 'grocer' | 'shop' | 'office' | 'workshop' | 'factory' | 'vacant'
  | 'hardware' | 'clothes' | 'florist' | 'newsagent' | 'charity' | 'takeaway' | 'hotel' | 'estateagent' | 'beauty'
  | 'physio' | 'gym' | 'funeral';

/** The eatery kind (terrace, tables) of a kind that is a place to eat or drink. */
export const EATERY_OF: Partial<Record<AmenityKind, Eatery>> = {
  bakery: Eatery.Bakery, pub: Eatery.Bar, cafe: Eatery.Cafe, restaurant: Eatery.Restaurant, pizzeria: Eatery.Pizzeria, icecream: Eatery.IceCream, bar: Eatery.Bar,
};

/** The society sim's place kind for an amenity (an empty shop is a 'vacant' place: a business may move in). */
export const PLACE_KIND_OF: Record<AmenityKind, PlaceKind> = {
  pharmacy: 'pharmacy', police: 'police', bakery: 'bakery', butcher: 'butcher', post: 'post', bank: 'bank', library: 'library',
  hairdresser: 'hairdresser', garage: 'garage', pub: 'pub', cafe: 'cafe', restaurant: 'restaurant', pizzeria: 'restaurant',
  icecream: 'cafe', bar: 'pub', grocer: 'grocer', shop: 'shop', office: 'office', workshop: 'workshop', factory: 'factory', vacant: 'vacant',
  hardware: 'hardware', clothes: 'clothes', florist: 'florist', newsagent: 'newsagent', charity: 'charity', takeaway: 'takeaway', hotel: 'hotel',
  estateagent: 'estateagent', beauty: 'beauty', physio: 'physio', gym: 'gym', funeral: 'funeral',
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
    ['newsagent', 1], ['takeaway', k(900, 1)], ['hardware', k(2500, 1)], ['clothes', k(1500, 1)], ['florist', k(2500, 1)],
    ['charity', k(2500, 0)], ['estateagent', k(2500, 1)], ['beauty', k(1500, 1)], ['physio', k(2500, 1)], ['gym', k(2500, 0)],
    ['funeral', 1], ['hotel', k(2500, 1)],
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
  hardware: { industrial: 2, commercial: 2, oldtown: 0.5 },
  clothes: { oldtown: 2, commercial: 3, industrial: 0.2 },
  florist: { oldtown: 2, commercial: 1.5, industrial: 0.2 },
  newsagent: { oldtown: 2, apartments: 1.5, rowhouses: 1.5 },
  charity: { oldtown: 2, commercial: 1.5 },
  takeaway: { apartments: 2, commercial: 1.5, port: 1.5 },
  hotel: { oldtown: 3, commercial: 2, industrial: 0.2 },
  estateagent: { oldtown: 2, commercial: 2, industrial: 0.2 },
  beauty: { oldtown: 1.5, commercial: 2, industrial: 0.2 },
  physio: { commercial: 2, suburban: 1.5, industrial: 0.3 },
  gym: { commercial: 2, industrial: 2 },
  funeral: { oldtown: 1.5, suburban: 1.5, commercial: 0.5 },
};
