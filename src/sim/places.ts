/**
 * The place graph: where actors can be and how long it takes to get between places.
 *
 * L0 (the society sim) never sees geometry. It sees places (a dwelling, the bakery on Elm Street, a park, a street
 * segment) and a road network that gives travel times. The town planner produces one with `placeGraphOf(plan)`;
 * tests make one with `testTown(seed, size)` (src/sim/testTown.ts).
 *
 * Contract between the planner (src/plan) and the sim (src/sim). Changes go through both threads.
 */

/** Index into `PlaceGraph.places`. Stable for the life of a world (saves store it). */
export type PlaceId = number;

/**
 * What a place is. The sim derives services, needs satisfied and gossip weight from the kind (src/sim/placeKinds.ts),
 * so the planner only has to say what it built.
 */
export const PLACE_KINDS = [
  // homes
  'house', 'apartments', 'farmhouse',
  // food and drink
  'bakery', 'butcher', 'supermarket', 'grocer', 'cafe', 'pub', 'restaurant',
  // services
  'pharmacy', 'doctor', 'dentist', 'hairdresser', 'garage', 'bank', 'post', 'shop',
  // more shops and services (Track F): petrol station, DIY, clothes, florist, newsagent, charity shop, takeaway,
  // hotel, estate agent, beauty salon, physiotherapist, gym, funeral home
  'petrol', 'hardware', 'clothes', 'florist', 'newsagent', 'charity', 'takeaway', 'hotel', 'estateagent', 'beauty',
  'physio', 'gym', 'funeral',
  // an empty shop unit: a closed business waiting for a new one (src/sim/economy.ts)
  'vacant',
  // institutions
  'school', 'kindergarten', 'townhall', 'police', 'fire', 'church', 'library', 'station', 'vet', 'carehome',
  // work without customers
  'office', 'workshop', 'factory', 'farm',
  // outdoors
  'park', 'square', 'sports', 'cemetery', 'street', 'woods', 'field',
  // off the map: the city, the next town, the secondary school there (added by the sim, never by the planner)
  'away',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Minutes from midnight, local game time. */
export type DayMinute = number;

/** Bit per weekday, Monday = bit 0 ... Sunday = bit 6. */
export type DayMask = number;
/** Set bits of a mask: the days in a `DayMask`, the months in a month mask. */
export const popcount = (m: number): number => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };

export const WEEKDAYS: DayMask = 0b0011111;
export const EVERY_DAY: DayMask = 0b1111111;

/** One opening window, e.g. Mon-Fri 07:00-18:30. A place may have several (lunch break, Saturday hours). */
export interface Hours {
  days: DayMask;
  open: DayMinute;
  /** May be past 1440 for windows that run past midnight (a pub to 01:00 is close = 1500). */
  close: DayMinute;
}

/** A job at a place: `count` positions of one role working one shift pattern. */
export interface StaffSlot {
  role: string; // 'baker', 'teacher', 'nurse', 'clerk', 'owner', ... (free text; the sim keys skills off it)
  count: number;
  days: DayMask;
  start: DayMinute;
  end: DayMinute; // may exceed 1440 for night shifts
  /** Minimum age for the role (16 for a shop assistant, 25 for a doctor). */
  minAge: number;
}

export interface Place {
  id: PlaceId;
  kind: PlaceKind;
  /** Display name: "Elm Street Bakery", "14 Mill Lane", "Riverside Park". */
  name: string;
  /** Street address, for talk and the notebook ("on Elm Street"). Empty for woods and fields. */
  street: string;
  /** World position in metres (x east, z south), the entrance. Lets the views map a place to geometry. */
  x: number;
  z: number;
  /** Road node the entrance connects to (index into `PlaceGraph.nodes`). */
  node: number;
  /** People who fit at once (a café 30, a house 8, a park 300). */
  capacity: number;
  /** Households that live here (house 1, apartments n; residents' rooms in a care home). 0 for other places. */
  homes: number;
  /** Opening windows; empty means always open (homes, streets, parks). */
  hours: Hours[];
  staff: StaffSlot[];
  /** The planner's building or lot id, so the views can find the geometry. -1 when none. */
  building: number;
  /**
   * Metres of road beyond the entrance, off the map (kind 'away' only): the entrance is where the road leaves town,
   * and the place itself lies this far along it. People there are out of town and not drawn.
   */
  beyond?: number;
}

/** A road-network junction. */
export interface RoadNode {
  x: number;
  z: number;
}

/** An undirected road segment between two nodes. */
export interface RoadEdge {
  a: number;
  b: number;
  /** Length in metres. */
  length: number;
  /** Walking speed factor: 1 normal, < 1 slower (steep, no sidewalk). */
  walk: number;
  /**
   * The centreline from a to b (x, z, … including both ends), when it is not a straight line. The street layer
   * (src/street) walks it; the sim only needs `length`.
   */
  pts?: number[];
  /** Where people walk: metres from the centreline to each side's walking line (mid-sidewalk; the verge on a country road, 0 on a footpath). */
  side?: number;
  /** How wide (m) the walking strip on each side is (the sidewalk; 1.4 for a verge or a path): people keep inside it. */
  walkWidth?: number;
}

export interface PlaceGraph {
  places: Place[];
  nodes: RoadNode[];
  edges: RoadEdge[];
}
