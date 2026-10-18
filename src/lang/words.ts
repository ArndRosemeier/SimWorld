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

/**
 * Clubs and groups: the name, the office titles (the first is the founder's), the big day of the year, and what
 * people say about its outcome (`prize`: {subject} is the winner; `result`: one line per possible outcome).
 */
const CLUB: Record<string, { name: string; offices: readonly string[]; big?: string; prize?: string; result?: readonly string[]; of?: string }> = {
  football: { name: 'the football club', offices: ['chair', 'treasurer', 'secretary', 'coach'], big: 'last home match of the season',
    result: ['finished top of the league and won promotion', 'finished second in the league', 'finished mid-table in the league', 'finished mid-table in the league', 'only just avoided relegation', 'were relegated'] },
  choir: { name: 'the town choir', offices: ['chair', 'treasurer', 'conductor'], big: 'Christmas concert' },
  firebrigade: { name: 'the volunteer fire brigade', offices: ['chief', 'deputy chief', 'treasurer'], big: 'open day' },
  rifle: { name: 'the rifle club', offices: ['chair', 'treasurer', 'range officer'], big: 'summer shoot and barbecue',
    prize: '{subject} won the rifle club\'s summer shoot' },
  allotment: { name: 'the community garden club', offices: ['chair', 'treasurer', 'secretary'], big: 'produce show',
    prize: '{subject} won best in show at the community garden club\'s produce show' },
  churchgroup: { name: 'the church coffee circle', offices: ['organiser'], big: 'second-hand sale' },
  youth: { name: 'the youth club', offices: ['youth leader'], big: 'disco' },
  books: { name: 'the book club', offices: ['organiser'] },
  running: { name: 'the running club', offices: ['organiser'], big: 'fun run',
    prize: '{subject} won the fun run' },
  cards: { name: 'the card club', offices: ['organiser'], big: 'winter tournament',
    prize: '{subject} won the card club\'s winter tournament' },
  history: { name: 'the local history society', offices: ['chair', 'secretary'], big: 'exhibition on the town\'s past' },
  congregation: { name: 'the congregation', of: 'the congregation of {place}', offices: ['priest', 'church elder', 'treasurer'], big: 'church fair' },
  council: { name: 'the town council', offices: ['mayor', 'deputy mayor'] },
};

/** A kind of group's words (src/sim/groups.ts). */
export const clubWords = (kind: string): (typeof CLUB)[string] => CLUB[kind];

/** Small offices in former shop units, named after the street ("Elm Insurance", "Mill Law Office"). */
const OFFICES = ['Insurance', 'Tax Advisers', 'Law Office', 'Accountants', 'Architects', 'Travel', 'Rentals', 'Opticians'] as const;

/** The kinds of small office a former shop unit may hold. */
export const officeWords = (): readonly string[] => OFFICES;

/**
 * The words on the town's boards and street furniture (src/render/signPaint.ts, the atlas pictures in
 * src/render/textAtlas.ts): estate agents' boards, door cards, notice boards, the town sign, the fixed
 * signage on street furniture. `{city}` is the town's name. No currency anywhere on a sign.
 */
const BOARD = {
  forSale: 'FOR SALE', forRent: 'FOR RENT', callToView: 'Call to view', agent: '{city} Property',
  openingHours: 'OPENING HOURS', closed: 'Closed', notices: 'NOTICES', found: 'FOUND',
  welcome: 'Welcome to', driveCarefully: 'Please drive carefully', thanks: 'thanks you for your visit',
  stop: 'STOP', bus: 'BUS', telephone: 'TELEPHONE', news: 'NEWS', post: 'POST', sewer: 'SEWER', central: 'CENTRAL',
  townHall: 'Town Hall', market: 'MARKET', summer: 'SUMMER',
  departures: 'Departures', schoolDays: 'School days', towards: 'to {place}',
  council: '{town} Town Council', underWay: 'Work in progress', readyIn: 'Ready in about {n}', weeks: '{n} weeks', months: '{n} months',
  sale: 'SALE', saleLine: 'Everything must go', nowOpen: 'NOW OPEN',
  bypass: 'The new bypass', estate: 'New homes', turbines: 'Wind turbines on the ridge', skatepark: 'The new skate park',
} as const;

export type BoardWord = keyof typeof BOARD;

/** A word on a board or a piece of street furniture ("FOR RENT", "OPENING HOURS"). */
export const boardWord = (w: BoardWord): string => BOARD[w];

/** A business's sign label ("Pharmacy", "Mini Market"). */
export const signWord = (kind: SignKind): string => SIGN[kind];

/** The label of a business opened by an owner, or undefined for kinds that are not opened that way. */
export const ownedWord = (kind: string): string | undefined => OWNED[kind];

/** A landmark's name patterns (see `fillName`). */
export const landmarkPatterns = (kind: LandmarkNameKind): readonly string[] => LANDMARK[kind];

/**
 * A home as people mention it before its street ("a house on Elm Street", "an apartment on Mill Road"). A unit in
 * a block is "an apartment", the word both sides share (plan R7); never "flat".
 */
const DWELLING: Readonly<Record<string, string>> = { house: 'a house', apartments: 'an apartment', farmhouse: 'a farmhouse' };

/** How people name a home of this place kind before its street ("a house", "an apartment"). */
export const dwellingWord = (kind: string): string => DWELLING[kind] ?? 'a place';

/** Fill a name pattern's `{key}` slots. */
export const fillName = (pattern: string, slots: Readonly<Record<string, string>>): string =>
  pattern.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? '');
