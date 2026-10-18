/**
 * The town's vocabulary: every place and business word a player reads (signs, the map, the paper, the picker,
 * the chatter), keyed by concept, in one place. The world is invented and only "western adjacent" (Arnd,
 * 2026-10-18): the words are plain on both sides of the Atlantic, and nothing in them points to a real region
 * (no "Corner Shop" or "Convenience Store", "Petrol" or "Gas"). One spelling throughout; words that differ in
 * spelling (centre / center, colour / color) are avoided. A pure leaf: no imports, usable from the sim, the
 * planner, the text engine and the UI alike.
 */

/** What a business is called on its sign after the street or town ("Elm Pharmacy", "Clinton Industries"). */
const SIGN = {
  pharmacy: 'Pharmacy', police: 'Police', bakery: 'Bakery', butcher: 'Butcher', post: 'Post Office', bank: 'Bank',
  library: 'Library', hairdresser: 'Hair Salon', garage: 'Car Repairs', pub: 'Pub', cafe: 'Café', restaurant: 'Restaurant',
  pizzeria: 'Pizzeria', icecream: 'Ice Cream', bar: 'Bar', grocer: 'Mini Market', shop: 'Shop', office: 'Offices',
  workshop: 'Workshop', factory: 'Industries', vacant: '', hardware: 'Hardware', clothes: 'Clothing', florist: 'Flowers',
  newsagent: 'News', charity: 'Second-hand Shop', takeaway: 'Food to Go', hotel: 'Hotel', estateagent: 'Property Agency',
  beauty: 'Beauty', physio: 'Physiotherapy', gym: 'Fitness', funeral: 'Funeral Services',
} as const;

/** What a newly opened business is called after its owner ("Keller's Bakery"). */
const OWNED: Readonly<Record<string, string>> = {
  bakery: 'Bakery', butcher: 'Butcher', grocer: 'Mini Market', cafe: 'Café', pub: 'Pub', restaurant: 'Kitchen',
  takeaway: 'Food to Go', hairdresser: 'Hair Salon', beauty: 'Beauty', shop: 'Gift Shop', clothes: 'Boutique',
  florist: 'Flowers', newsagent: 'News', charity: 'Second-hand Shop', physio: 'Physiotherapy', gym: 'Fitness',
  estateagent: 'Property', hardware: 'Hardware',
};

/**
 * Name patterns of the landmarks, one picked per town: `{root}` a name root ("Oak"), `{city}` the town's name,
 * `{saint}` a saint's name.
 */
const LANDMARK = {
  church: ["St {saint}'s Church", "St {saint}'s Church", "St {saint}'s Church", "St {saint}'s Church", 'Holy Trinity Church', 'Christ Church', 'All Saints Church'],
  school: ['{root} School', '{city} School', '{root} Road School', '{root} Lane School'],
  kindergarten: ['{root} Kindergarten', 'Little Acorns Kindergarten', 'Rainbow Kindergarten', 'Little Wrens Kindergarten', "{root} Children's House"],
  clinic: ['{city} Medical Practice', '{root} Medical Practice', '{root} Clinic', '{city} Clinic'],
  sports: ['{root} Park', '{root} Field', '{city} Sports Park', '{root} Fields', '{city} Sports Field'],
  carehome: ['{root} House', '{root} Court', '{root} Lodge', '{root} Manor', 'The Willows', 'Evergreen House'],
  petrol: ['{root} Fuel Station', '{city} Fuel', 'QuickFuel', 'Roadside Fuel', '{root} Fuel Station'],
  supermarket: ['Harvest Market', 'DailyFare', 'Corner Basket', 'Pantry Lane', 'Brightcart', 'Fieldgate Foods'],
} as const satisfies Record<string, readonly string[]>;

export type SignKind = keyof typeof SIGN;
export type LandmarkNameKind = keyof typeof LANDMARK;

/** A business's sign label ("Pharmacy", "Mini Market"). */
export const signWord = (kind: SignKind): string => SIGN[kind];

/** The label of a business opened by an owner, or undefined for kinds that are not opened that way. */
export const ownedWord = (kind: string): string | undefined => OWNED[kind];

/** A landmark's name patterns (see `fillName`). */
export const landmarkPatterns = (kind: LandmarkNameKind): readonly string[] => LANDMARK[kind];

/** Fill a name pattern's `{key}` slots. */
export const fillName = (pattern: string, slots: Readonly<Record<string, string>>): string =>
  pattern.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? '');
