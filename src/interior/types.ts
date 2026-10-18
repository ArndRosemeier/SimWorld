/**
 * The interior's data: one storey's rooms, inner walls with their doors, stairs, furniture and
 * ceiling lights, plus the places in it where people sleep, sit and work. Pure data, a function
 * of the building (deterministic per building seed and storey). Coordinates are world x/z; a
 * storey's `y` is metres above the building's ground-floor level.
 *
 * Ported from Scale (src/interior/InteriorGen.ts, the types), with the room and furniture kinds
 * a town needs (salons, bakehouses, workshops, garages, a police cell) and without Scale's
 * starship, museum, glasshouse, airport, lookout and arcade kinds.
 */
import type { Poly } from '../geom/geom2';

export type RoomType =
  // Homes.
  | 'living' | 'bedroom' | 'kitchen' | 'bath' | 'hall' | 'corridor'
  // Circulation and service.
  | 'stairs' | 'lobby' | 'storage'
  // Workplaces: offices, shops, places to eat and drink, services.
  | 'office' | 'meeting' | 'shop' | 'dining' | 'bakehouse' | 'salon' | 'reading' | 'cell'
  // Halls.
  | 'workshop' | 'garage' | 'factory' | 'parking' | 'nave';

export type FurnKind =
  | 'bed' | 'bedDouble' | 'wardrobe' | 'nightstand' | 'sofa' | 'armchair' | 'coffeeTable' | 'tvStand' | 'tv' | 'rug'
  | 'diningTable' | 'chair' | 'kitchenRow' | 'fridge' | 'toilet' | 'bathtub' | 'sink' | 'shower'
  | 'desk' | 'officeChair' | 'monitor' | 'meetingTable' | 'shelf' | 'bookshelf' | 'plant' | 'floorLamp' | 'painting'
  | 'counter' | 'shopShelf' | 'cafeTable' | 'barCounter' | 'palletRack' | 'crate' | 'pew' | 'altar' | 'reception' | 'column' | 'clothesStack'
  | 'screen' | 'cooler' | 'mirror' | 'coatRack' | 'clothesRail' | 'mannequin' | 'clothesShelf' | 'tallMirror'
  // SimWorld's trades and services.
  | 'displayCounter' | 'oven' | 'workTable' | 'salonChair' | 'washBasin' | 'workbench' | 'machine' | 'carLift' | 'car' | 'bunk' | 'safe';

/** Floor finishes. */
export type FloorMat = 'wood' | 'tile' | 'carpet' | 'concrete' | 'stone' | 'marble';

export interface Room {
  type: RoomType;
  /** Polygon (world). */
  poly: Poly;
  floorMat: FloorMat;
  wallColor: [number, number, number];
  /** The home it belongs to (index in `Interior.units`), -1 for common floor (stair halls, workplaces). */
  unit: number;
}

export interface IWall {
  ax: number; az: number; bx: number; bz: number;
  /** Door openings along the wall: [t0, t1] parameters 0..1. */
  doors: [number, number][];
  /** Lift shaft and stair core walls: never opened up for the way in from the street door. */
  solid?: boolean;
}

/**
 * What a piece is for, to the people in the building: 'sleep' a bed, 'sit' a seat, 'work' a
 * workplace (a desk chair, a salon chair, a machine), 'serve' a counter someone stands behind
 * (the staff's side is its back, -z).
 */
export type FurnUse = 'sit' | 'sleep' | 'work' | 'serve';

export interface Furn {
  kind: FurnKind;
  x: number; z: number; yaw: number;
  /** Size (w along local x, d along local z, h). */
  w: number; d: number; h: number;
  color: [number, number, number];
  use?: FurnUse;
  /** The home it stands in (Room.unit), -1 elsewhere. */
  unit?: number;
}

/** One flight of stairs: start (bottom) of its centre line, direction, width, run (m along), heights. */
export interface Flight {
  x: number; z: number; dx: number; dz: number; width: number; run: number;
  y0: number; y1: number;
}

export interface FloorPlan {
  floor: number;
  /** Floor level above the building's ground-floor level (m), and the storey's height. */
  y: number;
  height: number;
  /** The storey's inside outline (the tier, inset from the facade). */
  poly: Poly;
  rooms: Room[];
  walls: IWall[];
  furniture: Furn[];
  /** Flights of stairs from this floor up (two per storey), the landing between them. */
  flights: Flight[];
  landings: { poly: number[]; y: number }[];
  /** Opening these flights cut in the slab of the floor above (null: no stairs up). */
  stairHole: number[] | null;
  /** Ceiling light positions (x, z), and the fixture at each: 0 a flat panel, 1 a pendant lamp, 2 a round ceiling lamp. */
  lights: number[];
  fixtures: number[];
}

/** A place a person can be in the building: where they sleep, sit or work, and which way they face. */
export interface Spot {
  use: FurnUse;
  floor: number;
  x: number; z: number; yaw: number;
  /** The home it is in, -1 elsewhere. */
  unit: number;
}
