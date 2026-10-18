/**
 * Messages between the main thread and the town workers (src/workers/town.worker.ts). Every
 * worker plans the same town from the settings (deterministic), then builds mesh data on request.
 */
import type { Indoors } from '../interior/indoors';
import type { TownMap } from '../plan/townMap';
import type { MeshData } from '../build/meshBuilder';
import type { PropGroup } from '../build/streetProps';
import type { SignsData } from '../build/signs';
import type { SignFacts } from '../render/signFacts';
import type { TreeModelData } from '../build/vegetation';
import type { TownSettings } from '../world/settings';
import type { ParcelParams } from '../world/landuse';
import type { SoundMap } from '../audio/soundMap';

import type { TerrainTileSpec as TileSpec } from '../build/terrainMesh';

export type ToTown =
  | { type: 'init'; settings: TownSettings }
  /** One cell of the town: its ground surfaces and its buildings. */
  | { type: 'cell'; cell: number }
  | { type: 'terrain'; tile: TileSpec }
  | { type: 'water'; tile: TileSpec }
  /** One public building (index in `macro.landmarks`). */
  | { type: 'landmark'; index: number }
  /** The countryside: roads, farmyards and the railway (ground), the farms' buildings. */
  | { type: 'country' }
  /** The town's river bridges: deck (ground) and structure (massing). */
  | { type: 'bridges' }
  /** Every street prop (furniture, parked cars) as instance lists per model (src/build/streetProps.ts); `kerbCars` false leaves out the cars at the kerbs (the traffic draws its own there). */
  | { type: 'props'; kerbCars?: boolean }
  /** One prop model's mesh data, by its `PropGroup.model` key. */
  | { type: 'propModel'; model: string }
  /** The town's trees, shrubs and yews as tree records (src/build/forest.ts `townTrees`). */
  | { type: 'trees' }
  /** The countryside trees of one square tile (src/build/forest.ts `ForestGen.tile`). */
  | { type: 'forest'; x0: number; z0: number; size: number }
  /** One tree or shrub model (index into src/build/vegetation.ts `VEG_MODELS`). */
  | { type: 'vegModel'; index: number }
  /** What the town sounds like where (src/audio/soundMap.ts). */
  | { type: 'sound' }
  /** Every sign (shop names, hours, estate boards, street names, town signs) as instance lists, with the planner's places as the signs' first facts (src/build/signs.ts). */
  | { type: 'signs' }
  /** The town map (src/plan/townMap.ts). */
  | { type: 'map' }
  /** The cutaway of one storey of a building (`building`: its id in the cell). */
  | { type: 'interior'; cell: number; building: number; floor: number }
  /** A whole building to walk around in, by its `Place.building` code (a town building, or a public building's walk-in body). */
  | { type: 'indoors'; building: number };

/** What the main thread needs to know about the town to lay out the view. */
export interface TownSummary {
  /** Town centre and outline radius (m). */
  x: number;
  z: number;
  radius: number;
  /** Half the side of the square world (m). */
  extent: number;
  /** Terrain height at the centre. */
  y: number;
  cells: number;
  landmarks: number;
  tiles: TileSpec[];
  parcels: ParcelParams;
  dwellings: number;
}

export type FromTown =
  | { type: 'ready'; town: TownSummary; ms: number }
  /** `chimneys`: the chimney tops (x, y, z each, world metres) of the buildings, for the smoke. */
  | { type: 'cell'; ground: MeshData | null; buildings: MeshData | null; chimneys: number[]; ms: number }
  | { type: 'terrain'; mesh: MeshData; ms: number }
  | { type: 'water'; mesh: MeshData | null; ms: number }
  | { type: 'landmark'; mesh: MeshData | null; ms: number }
  | { type: 'country'; ground: MeshData | null; buildings: MeshData | null; chimneys: number[]; ms: number }
  | { type: 'bridges'; ground: MeshData | null; buildings: MeshData | null; ms: number }
  /** `lamps`: the street lamp heads (`lampsOf`, LAMP_STRIDE floats each). */
  | { type: 'props'; groups: PropGroup[]; lamps: Float32Array; ms: number }
  /** `far`: a vehicle's far stand-in (`propFar`), null for furniture. */
  | { type: 'propModel'; mesh: MeshData; far: MeshData | null; ms: number }
  | { type: 'trees'; recs: Float32Array; ms: number }
  | { type: 'forest'; recs: Float32Array; ms: number }
  | { type: 'vegModel'; model: TreeModelData; ms: number }
  | { type: 'sound'; map: SoundMap; ms: number }
  /** `facts`: what the planner made each place (kind as a PLACE_KINDS index, name, the kind's default hours) until the sim's town face comes. */
  | { type: 'signs'; signs: SignsData; facts: SignFacts; ms: number }
  | { type: 'map'; map: TownMap; ms: number }
  /** `at`: the storey's centre (floor level), `radius` its reach; `about`: what the building is, for the HUD. */
  | { type: 'interior'; mesh: MeshData | null; at: [number, number, number]; radius: number; floors: number; about: string; ms: number }
  /** `mesh`: every storey furnished (origin `at`); `indoors`: its walls, furniture, floors, stairs, doors and spots in world coordinates. */
  | { type: 'indoors'; mesh: MeshData | null; at: [number, number, number]; indoors: Indoors; about: string; ms: number }
  | { type: 'error'; message: string };
