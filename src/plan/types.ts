/**
 * Plan data types (ported from Scale, src/plan/types.ts, without the metro and sewers).
 * Pure data: structured-clone / transfer friendly, no three.js.
 */
import type { Poly } from '../geom/geom2';
import type { Landmark } from './landmarks';

export const enum RoadClass {
  Boulevard = 0,
  Avenue = 1,
  Street = 2,
  Lane = 3,
  Path = 4,
}

export type District =
  | 'downtown'
  | 'commercial'
  | 'oldtown'
  | 'apartments'
  | 'rowhouses'
  | 'suburban'
  | 'industrial'
  | 'port'
  | 'park'
  | 'water';

export const DISTRICTS: District[] = ['downtown', 'commercial', 'oldtown', 'apartments', 'rowhouses', 'suburban', 'industrial', 'port', 'park', 'water'];

export interface Centre {
  x: number;
  z: number;
  /** Relative importance 0..1 (main centre = 1). */
  weight: number;
  /** Influence radius in m. */
  radius: number;
}

export interface ArterialNode {
  x: number;
  z: number;
  /** Neighbouring edge ids. */
  edges: number[];
  /** Bank/coast node kind: 0 normal, 1 river bank, 2 coast. */
  kind: number;
}

export interface ArterialEdge {
  id: number;
  a: number;
  b: number;
  cls: RoadClass;
  /** Carriageway width (curb to curb) in m. */
  width: number;
  /** Sidewalk width on each side in m. */
  sidewalk: number;
  /** Polyline (x,z,...) from node a to node b. */
  pts: number[];
  /** Spans water (bridge deck). */
  bridge: boolean;
  /** Has a central median with trees. */
  median: boolean;
  /** Lanes per direction. */
  lanes: number;
}

export interface CellInfo {
  id: number;
  /** Centerline polygon (CCW) bounded by arterial edges. */
  poly: Poly;
  /** Boundary edge ids in polygon order; edgeDir[i] true if traversed a->b. */
  edges: number[];
  centroid: [number, number];
  area: number;
  district: District;
  /** 0..1 urban density at the centroid. */
  density: number;
  /** Street-grid orientation (radians) for gridded layouts. */
  gridAngle: number;
  /** 0 organic … 1 strict grid. */
  gridness: number;
  /** Era 0 (historic) … 1 (contemporary) bias for building styles. */
  era: number;
  /** Bounding radius around centroid. */
  radius: number;
}

export interface Bridge {
  edge: number;
  /** Deck polyline including approaches. */
  pts: number[];
  width: number;
  /** Deck height above water level at the middle. */
  clearance: number;
  /** Structural style. */
  style: 'arch' | 'girder' | 'truss' | 'suspension' | 'stone';
  /** Water level under the bridge. */
  waterLevel: number;
}

/** The railway past the town (plan/rail). */
export interface Railway {
  /** Centreline (x, z, …), 20 m spacing, from one edge of the world to the other. */
  pts: number[];
  /** Spans on bridges, as arc-length ranges along pts. */
  bridges: [number, number][];
  /** Direction from the town centre to the line (radians) and the line's distance from it. */
  side: number;
  offset: number;
  /** The tangent point (where the station stands) and the line's direction there (radians). */
  sx: number;
  sz: number;
  angle: number;
  /** A branch line: it ends at the station (`pts` runs from the edge of the world to it). */
  terminus: boolean;
}

export interface MacroPlan {
  seed: number;
  centres: Centre[];
  /** Historic core (old town) location. */
  core: [number, number];
  nodes: ArterialNode[];
  edges: ArterialEdge[];
  cells: CellInfo[];
  bridges: Bridge[];
  /** Town boundary radius function samples (64 angles). */
  boundary: number[];
  /** The town hall, the church, the schools, the station, … (plan/landmarks). */
  landmarks: Landmark[];
  /** The railway past the town (null: no direction kept it dry). */
  rail: Railway | null;
}
