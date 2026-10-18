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
  | 'grocer' | 'shop' | 'office' | 'workshop' | 'factory' | 'vacant';

/** The eatery kind (terrace, tables) of a kind that is a place to eat or drink. */
export const EATERY_OF: Partial<Record<AmenityKind, Eatery>> = {
  bakery: Eatery.Bakery, pub: Eatery.Bar, cafe: Eatery.Cafe, restaurant: Eatery.Restaurant, pizzeria: Eatery.Pizzeria, icecream: Eatery.IceCream, bar: Eatery.Bar,
};

/** The society sim's place kind for an amenity (null: an empty shop, no place). */
export const PLACE_KIND_OF: Record<AmenityKind, PlaceKind | null> = {
  pharmacy: 'pharmacy', police: 'police', bakery: 'bakery', butcher: 'butcher', post: 'post', bank: 'bank', library: 'library',
  hairdresser: 'hairdresser', garage: 'garage', pub: 'pub', cafe: 'cafe', restaurant: 'restaurant', pizzeria: 'restaurant',
  icecream: 'cafe', bar: 'pub', grocer: 'grocer', shop: 'shop', office: 'office', workshop: 'workshop', factory: 'factory', vacant: null,
};

/** What a kind is called on a sign ("Elm Street Pharmacy"). */
export const AMENITY_LABEL: Record<AmenityKind, string> = {
  pharmacy: 'Pharmacy', police: 'Police', bakery: 'Bakery', butcher: 'Butcher', post: 'Post Office', bank: 'Bank', library: 'Library',
  hairdresser: 'Hair Studio', garage: 'Garage', pub: 'Arms', cafe: 'Café', restaurant: 'Restaurant', pizzeria: 'Pizzeria',
  icecream: 'Ice Cream', bar: 'Bar', grocer: 'Corner Shop', shop: 'Shop', office: 'Offices', workshop: 'Workshop', factory: 'Works', vacant: '',
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
