/**
 * Messages between the main thread and the town workers (src/workers/town.worker.ts). Every
 * worker plans the same town from the settings (deterministic), then builds mesh data on request.
 */
import type { MeshData } from '../build/meshBuilder';
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
  /** What the town sounds like where (src/audio/soundMap.ts). */
  | { type: 'sound' };

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
  | { type: 'cell'; ground: MeshData | null; buildings: MeshData | null; ms: number }
  | { type: 'terrain'; mesh: MeshData; ms: number }
  | { type: 'water'; mesh: MeshData | null; ms: number }
  | { type: 'landmark'; mesh: MeshData | null; ms: number }
  | { type: 'country'; ground: MeshData | null; buildings: MeshData | null; ms: number }
  | { type: 'bridges'; ground: MeshData | null; buildings: MeshData | null; ms: number }
  | { type: 'sound'; map: SoundMap; ms: number }
  | { type: 'error'; message: string };
