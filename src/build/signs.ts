/**
 * The town's signs as instance lists (town-realism track A): every sign spot of the planner
 * (src/plan/signs.ts) turned into furniture instances on the ground or the wall, each tied to what
 * it says (`SignWhat`): a business's name or hours, a home's estate board, a public building's
 * name, a street's name, the town's name. The words themselves are not here: the main thread draws
 * them from the sim's town face into atlas slots and hides what is not there today (an estate
 * board when nothing is for sale), src/render/signsView.ts. Pure; the town workers run it once.
 */
import { hash32, hashToFloat } from '@futuremagic/core';
import { CURB_H } from '../world/ground';
import { SITE } from '../plan/placeGraph';
import { HANG_OUT, signSpots, type FrontSign } from '../plan/signs';
import type { TownRoads } from '../plan/roads';
import type { Town } from '../plan/town';
import { buildingBase } from './massing';
import type { SlotSize } from './textAtlasLayout';
import { InstanceLists, type ModelInstances } from './instanceLists';

/** Floats per instance: x, y, z, yaw, across, up, then what it says (index into `SignsData.what`), the paint (rgb sRGB, 0 the model's). */
export const SIGN_STRIDE = 10;

/**
 * What a sign shows. `place` is a PlaceId of the planner's graph (the town face's index); `slot`
 * the atlas slot size its lettering needs, null for a part that only follows the board it holds
 * (a post).
 *  - front: the business's name in its style; hours: its opening hours; estate: "for sale" / "to
 *    let" (shown only when the place has that look); site: a public building's name; street: a
 *    street's name; town: the town's name (the back: "thank you for visiting"); post: the
 *    street-name post itself (always shown).
 */
export type SignWhat =
  | { t: 'front'; place: number; style: FrontSign['style']; slot: SlotSize }
  | { t: 'hours'; place: number; slot: SlotSize }
  | { t: 'estate'; place: number; slot: SlotSize }
  | { t: 'site'; place: number; slot: SlotSize }
  | { t: 'street'; name: string; slot: SlotSize }
  | { t: 'town'; back: boolean; slot: SlotSize }
  | { t: 'post'; slot: null };

/** One model's instances (`model`: 'f:<FurnitureKind>:<variant>', as street props). */
export type SignGroup = ModelInstances;

export interface SignsData {
  groups: SignGroup[];
  what: SignWhat[];
  /** The town's name. */
  town: string;
}

const BOARD = 'f:signBoard:0', BOARD2 = 'f:signBoard:1';

/** The planner's places as far as signs need them (`placeGraphOf(town).places`). */
export type SignPlaces = readonly { id: number; kind: string; building: number }[];

/** Every sign of the town; `places` are the planner's (`placeGraphOf`), `name` the town's. */
export function signInstances(town: Town, roads: TownRoads, places: SignPlaces, name: string): SignsData {
  const { terrain } = town;
  const spots = signSpots(town, roads);
  const lists = new InstanceLists();
  const what: SignWhat[] = [];
  const say = (w: SignWhat) => what.push(w) - 1;
  const addSign = (model: string, x: number, y: number, z: number, yaw: number, across: number, up: number, w: number, paint: readonly number[] = [0, 0, 0]) =>
    lists.add(model, x, y, z, yaw, across, up, w, paint[0], paint[1], paint[2]);
  // The planner's places by building: the workplace and the home in each.
  const work = new Map<number, number>(), home = new Map<number, number>();
  for (const p of places) {
    if (p.building < 0) continue;
    if (p.kind === 'house' || p.kind === 'apartments' || p.kind === 'farmhouse') home.set(p.building, p.id);
    else if (!work.has(p.building)) work.set(p.building, p.id);
  }
  const floor = new Map<number, number>();
  const base = (code: number) => {
    let y = floor.get(code);
    if (y === undefined) floor.set(code, (y = buildingBase(town.cells[code >>> 16].buildings[code & 0xffff], terrain).base));
    return y;
  };
  for (const f of spots.fronts) {
    const place = work.get(f.code);
    if (place === undefined) continue;
    const y0 = base(f.code);
    const paint = signPaint(f.code);
    const slot: SlotSize = f.style === 'hanging' ? 'card' : f.style === 'plate' ? 'strip' : 'wide';
    addSign(f.style === 'hanging' ? BOARD2 : BOARD, f.x, y0 + f.y, f.z, f.style === 'hanging' ? f.yaw + Math.PI / 2 : f.yaw, f.width, f.height, say({ t: 'front', place, style: f.style, slot }), paint);
    if (f.style === 'hanging') {
      // The bracket it hangs from, out of the wall above it (its +X along the wall's normal).
      const nx = -Math.sin(f.yaw), nz = -Math.cos(f.yaw);
      addSign('f:signBracket:0', f.x - nx * HANG_OUT, y0 + f.y + f.height / 2 + 0.08, f.z - nz * HANG_OUT, f.yaw + Math.PI / 2, 1, 1, say({ t: 'post', slot: null }));
    }
    addSign(BOARD, f.hours.x, y0 + f.hours.y, f.hours.z, f.yaw, 0.24, 0.24, say({ t: 'hours', place, slot: 'card' }), [0.92, 0.92, 0.9]);
  }
  for (const h of spots.homes) {
    const place = home.get(h.code);
    if (place === undefined) continue;
    const w = say({ t: 'estate', place, slot: 'card' });
    if (h.onWall) addSign(BOARD, h.x, base(h.code) + h.y, h.z, h.yaw, 0.6, 0.6, w, ESTATE_PAINT);
    else {
      const y = terrain.height(h.x, h.z);
      // Sideways to the street, so both faces read from the pavement; the board hangs from the arm.
      const yaw = h.yaw + Math.PI / 2, ax = Math.cos(yaw), az = -Math.sin(yaw);
      addSign('f:signPost:1', h.x, y, h.z, yaw, 1, 1, w);
      addSign(BOARD2, h.x + ax * 0.35, y + 1.45, h.z + az * 0.35, yaw, 0.6, 0.6, w, ESTATE_PAINT);
    }
  }
  for (const s of spots.sites) {
    const place = work.get(SITE + s.site);
    if (place === undefined) continue;
    const y = terrain.height(s.x, s.z) + CURB_H;
    addSign('f:signFrame:1', s.x, y, s.z, s.yaw, 1, 1, say({ t: 'post', slot: null }));
    addSign(BOARD, s.x, y + 0.85, s.z, s.yaw, 1.6, 0.8, say({ t: 'site', place, slot: 'board' }), [0.16, 0.22, 0.32]);
  }
  const post = say({ t: 'post', slot: null });
  const streets = new Map<number, number>();
  for (const c of spots.corners) {
    const y = terrain.height(c.x, c.z) + CURB_H;
    addSign('f:signPost:0', c.x, y, c.z, 0, 1, 1, post);
    c.blades.forEach((b, k) => {
      let w = streets.get(b.street);
      if (w === undefined) streets.set(b.street, (w = say({ t: 'street', name: roads.streets[b.street].name, slot: 'strip' })));
      addSign(BOARD2, c.x, y + 2.55 + k * 0.24, c.z, b.yaw, 0.96, 0.12, w, [0.95, 0.95, 0.95]);
    });
  }
  const front = say({ t: 'town', back: false, slot: 'board' }), back = say({ t: 'town', back: true, slot: 'board' });
  for (const g of spots.gateways) {
    const y = terrain.height(g.x, g.z);
    addSign('f:signFrame:0', g.x, y, g.z, g.yaw, 1, 1, post);
    addSign(BOARD, g.x, y + 1.6, g.z, g.yaw, 2.4, 1.2, front, [0.9, 0.9, 0.88]);
    addSign(BOARD, g.x, y + 1.6, g.z, g.yaw + Math.PI, 2.4, 1.2, back, [0.9, 0.9, 0.88]);
  }
  return { groups: lists.groups(), what, town: name };
}

/** The paint of an estate agent's board (white). */
const ESTATE_PAINT = [0.95, 0.95, 0.95] as const;

/** A business sign's body colour: dark, from the building (the lettering brings the colour). */
function signPaint(code: number): number[] {
  const h = hashToFloat(hash32(code * 2654435761));
  return [0.1 + h * 0.15, 0.1 + ((h * 7) % 1) * 0.12, 0.12 + ((h * 13) % 1) * 0.1];
}
