/**
 * The public buildings one can walk into: a landmark's walk-in body (the box part its kind marks `body`, src/plan/kit.ts
 * LmPart.body: the church's nave, the school's main block, the clinic, the care home, the fire station's engine hall,
 * the supermarket, the station building, the petrol kiosk) as a building the interior planner furnishes for its
 * kind (src/interior/fill/work.ts: pews before the altar, classrooms off a corridor, consulting rooms, residents'
 * rooms, the engines, aisles and tills, the ticket hall), with the windows its walls are drawn with.
 *
 * New in SimWorld.
 */
import type { BuildingDesc } from '../plan/building';
import { landmarkParts, partOutline, type LmPart } from '../plan/landmarkParts';
import type { Landmark } from '../plan/landmarks';
import { SITE_KIND } from '../plan/placeGraph';
import { bodyOpenings, type WallWindows } from '../build/massing';
import type { Terrain } from '../world/terrain';
import type { PlaceUse } from './building';

/** A landmark's walk-in body: the building the planner furnishes, the kind it is furnished as, its windows. */
export interface LandmarkBody { b: BuildingDesc; place: PlaceUse; windows: WallWindows[] }

/** The walk-in body of `lm` (null when its kind has none: the town hall's hall is its own, the sports ground has none). `place`: the sim's staff and capacity. */
export function landmarkBody(lm: Landmark, terrain: Terrain, place?: PlaceUse): LandmarkBody | null {
  const parts = landmarkParts(lm, terrain), p = parts.find((q) => q.body);
  return p ? { b: bodyDesc(lm, p), place: { ...place, kind: SITE_KIND[lm.kind] }, windows: bodyOpenings(parts) } : null;
}

/** The body part as a building: its box (front: the -v side, towards the square or the street), storeys from its material. */
function bodyDesc(lm: Landmark, p: LmPart): BuildingDesc {
  const floors = p.body!, H = p.y1 - p.y0, poly = partOutline(p)!;
  const groundH = floors > 1 ? p.m.gh : H, floorH = floors > 1 ? (H - groundH) / (floors - 1) : H;
  return {
    id: lm.id, poly, front: 0, style: 'modern', use: 'civic', floors, floorH, groundH, roof: 'flat', pitch: 0, setbacks: [],
    wall: 0, trim: 0, roofMat: 0, accent: 0, bay: p.m.bay, shopfront: false, seed: lm.seed, attached: false, units: 0, landmark: true,
  };
}
