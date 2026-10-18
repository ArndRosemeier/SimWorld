/**
 * Procedural names for streets, shops and the town. Every name is invented (plan R7): the roots are plain
 * nature, trade and landscape words (no real people, no famous streets), and a town name that is a real place
 * is drawn again (src/lang/places.ts).
 *
 * Ported from Scale (src/plan/names.ts), without its US grid idioms (boulevards, numbered avenues).
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import { isRealPlace } from '../lang/places';

export const ROOTS = [
  'Ash', 'Birch', 'Cedar', 'Elm', 'Hazel', 'Linden', 'Maple', 'Oak', 'Pine', 'Willow', 'Rowan', 'Alder',
  'Hawthorn', 'Juniper', 'Laurel', 'Poplar', 'Larch', 'Holly', 'Fern', 'Heather', 'Thistle', 'Bracken', 'Sorrel', 'Bramble',
  'Mill', 'Bridge', 'Church', 'Market', 'Castle', 'Harbour', 'Abbey', 'Chapel', 'Garden', 'Orchard', 'Meadow', 'Quarry',
  'Hill', 'Brook', 'River', 'Lake', 'Spring', 'Stone', 'Copper', 'Silver', 'Flint', 'Slate', 'Amber', 'Granite',
  'Heron', 'Lark', 'Wren', 'Finch', 'Kestrel', 'Otter', 'Badger', 'Crane', 'Swallow', 'Plover', 'Linnet', 'Starling',
  'Lantern', 'Beacon', 'Anchor', 'Compass', 'Weaver', 'Tanner', 'Cooper', 'Mason', 'Potter', 'Fairview', 'Summit', 'Clover',
];
const STREET_SUFFIX = ['Street', 'Street', 'Street', 'Avenue', 'Road', 'Lane', 'Place', 'Way', 'Terrace', 'Row', 'Court', 'Drive'];

export function streetName(seed: number, id: number, cls: number): string {
  const r = new Rng(deriveSeed(seed, 'street', id));
  const root = r.pick(ROOTS);
  if (cls <= 1) return `${root} ${r.chance(0.7) ? 'Avenue' : 'Road'}`;
  return `${root} ${r.pick(STREET_SUFFIX)}`;
}

const SHOP_KINDS = [
  'Cafe', 'Bakery', 'Deli', 'Bistro', 'Pharmacy', 'Books', 'Florist', 'Tailor', 'Barber', 'Grocery', 'Wine', 'Hardware',
  'Grill', 'Pizza', 'Noodles', 'Sushi', 'Tacos', 'Laundry', 'Optician', 'Jewellery', 'Shoes', 'Records', 'Toys', 'Bank',
];
export function shopName(seed: number, id: number): { name: string; kind: string } {
  const r = new Rng(deriveSeed(seed, 'shop', id));
  const kind = r.pick(SHOP_KINDS);
  const owner = r.pick(ROOTS);
  const fmt = r.int(0, 3);
  const name = fmt === 0 ? `${owner}'s ${kind}` : fmt === 1 ? `${kind} ${owner}` : fmt === 2 ? `The ${owner} ${kind}` : `${owner} & Sons`;
  return { name, kind };
}

export function cityName(seed: number): string {
  const r = new Rng(deriveSeed(seed, 'cityname'));
  const a = ['New ', 'Port ', 'East ', 'North ', '', '', '', '', '', ''];
  const b = ['Haven', 'Bridge', 'Ford', 'Mouth', 'Field', 'Ton', 'Stead', 'Wick', 'Holm', 'Gate', 'Dale', 'Mere'];
  let name = '';
  for (let k = 0; k < 32 && (!name || isRealPlace(name)); k++) name = r.pick(a) + r.pick(ROOTS) + r.pick(b).toLowerCase();
  return name;
}
