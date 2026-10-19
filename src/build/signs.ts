/**
 * The town's signs as instance lists (town-realism track A): every sign spot of the planner
 * (src/plan/signs.ts) turned into furniture instances on the ground or the wall, each tied to what
 * it says (`SignWhat`): a business's name or hours, a home's estate board, a public building's
 * name, a street's name, the town's name. The words themselves are not here: the main thread draws
 * them from the sim's town face into atlas slots and hides what is not there today (an estate
 * board when nothing is for sale), src/render/signsView.ts. Pure; the town workers run it once.
 */
import { hash32, hashToFloat } from '@futuremagic/core';
import { groundOf } from './drawnGround';
import { SITE } from '../plan/placeGraph';
import { clockSpots, HANG_OUT, POSTER_Y, signSpots, yawAxes, type FrontSign } from '../plan/signs';
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
 *    street-name post itself (always shown); cork: a notice board's cork (`stand`: the
 *    free-standing one, else the one on a wall); notice: pin `k` of the notices up at `place` (a
 *    board place's board, a shop's window, a street's lamp posts; `every`: the street's posts show
 *    its notices in turn, so post k shows notice k mod n); clock: a public clock's dial (the time
 *    of day, all clocks alike); works: the council's works board (shown while it builds there);
 *    banner: "now open" under a new shop's fascia; sale: a sale sign in a struggling shop's window; timetable, busFlag: bus stop `stop`'s timetable and its flag (the stops
 *    come from the sim worker, src/street/stops.ts, and join the signs later: `SignsShown.addStops`).
 */
export type SignWhat =
  | { t: 'front'; place: number; style: FrontSign['style']; slot: SlotSize }
  | { t: 'hours'; place: number; slot: SlotSize }
  | { t: 'estate'; place: number; slot: SlotSize }
  | { t: 'site'; place: number; slot: SlotSize }
  | { t: 'street'; name: string; slot: SlotSize }
  | { t: 'town'; back: boolean; slot: SlotSize }
  | { t: 'post'; slot: null }
  | { t: 'cork'; stand: boolean; slot: SlotSize }
  | { t: 'notice'; place: number; k: number; every: boolean; slot: SlotSize }
  | { t: 'clock'; slot: SlotSize }
  | { t: 'works'; at: 'sports' | 'gateway'; slot: SlotSize }
  | { t: 'banner'; place: number; slot: SlotSize }
  | { t: 'sale'; place: number; slot: SlotSize }
  | { t: 'timetable'; stop: number; slot: SlotSize }
  | { t: 'busFlag'; stop: number; slot: SlotSize };

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
export type SignPlaces = readonly { id: number; kind: string; name: string; building: number; x: number; z: number }[];

/** Notice boards: the wall one and the free-standing one (width, height m; pins across, in two rows under a header). */
const WALL_BOARD = { w: 1.0, h: 0.75, cols: 3 }, STAND_BOARD = { w: 1.4, h: 0.8, cols: 4 };
/** A notice's width to its height (the `sheet` slot's). */
export const SHEET = 256 / 352;
/** A board's face stands this far out from its origin (the signBoard model's depth); pinned notices just in front of it. */
const PIN_OUT = 0.022;

/** Every sign of the town; `places` are the planner's (`placeGraphOf`), `name` the town's. */
export function signInstances(town: Town, roads: TownRoads, places: SignPlaces, name: string): SignsData {
  const { terrain } = town;
  const ground = groundOf(town);
  const spots = signSpots(town, roads, places);
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
      const { nx, nz } = yawAxes(f.yaw);
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
      const y = ground(h.x, h.z);
      // Sideways to the street, so both faces read from the pavement; the board hangs from the arm.
      const yaw = h.yaw + Math.PI / 2, { ax, az } = yawAxes(yaw);
      addSign('f:signPost:1', h.x, y, h.z, yaw, 1, 1, w);
      addSign(BOARD2, h.x + ax * 0.35, y + 1.45, h.z + az * 0.35, yaw, 0.6, 0.6, w, ESTATE_PAINT);
    }
  }
  for (const s of spots.sites) {
    const place = work.get(SITE + s.site);
    if (place === undefined) continue;
    const y = ground(s.x, s.z);
    addSign('f:signFrame:1', s.x, y, s.z, s.yaw, 1, 1, say({ t: 'post', slot: null }));
    addSign(BOARD, s.x, y + 0.85, s.z, s.yaw, 1.6, 0.8, say({ t: 'site', place, slot: 'board' }), [0.16, 0.22, 0.32]);
  }
  const post = say({ t: 'post', slot: null });
  const streets = new Map<number, number>();
  for (const c of spots.corners) {
    const y = ground(c.x, c.z);
    addSign('f:signPost:0', c.x, y, c.z, 0, 1, 1, post);
    c.blades.forEach((b, k) => {
      let w = streets.get(b.street);
      if (w === undefined) streets.set(b.street, (w = say({ t: 'street', name: roads.streets[b.street].name, slot: 'strip' })));
      addSign(BOARD2, c.x, y + 2.55 + k * 0.24, c.z, b.yaw, 0.96, 0.12, w, [0.95, 0.95, 0.95]);
    });
  }
  // Notice boards (src/plan/signs.ts `boards`): a cork board with two rows of pinned notices.
  const corks = [say({ t: 'cork', stand: false, slot: 'board' }), say({ t: 'cork', stand: true, slot: 'board' })];
  const board = (place: number, x: number, y: number, z: number, yaw: number, stand: boolean) => {
    const B = stand ? STAND_BOARD : WALL_BOARD;
    addSign(BOARD, x, y, z, yaw, B.w, B.h, corks[stand ? 1 : 0], [0.35, 0.24, 0.14]);
    const { ax, az, nx, nz } = yawAxes(yaw);
    const head = B.h * 0.15, rowH = (B.h - head - 0.04) / 2, sh = rowH * 0.9, colW = (B.w - 0.08) / B.cols;
    for (let r = 0; r < 2; r++) for (let c = 0; c < B.cols; c++) {
      // (Model +X runs to the reader's left: pins read left to right.)
      const u = ((B.cols - 1) / 2 - c) * colW, v = B.h / 2 - head - (r + 0.5) * rowH;
      addSign(BOARD, x + ax * u + nx * PIN_OUT, y + v, z + az * u + nz * PIN_OUT, yaw, sh * SHEET, sh, say({ t: 'notice', place, k: r * B.cols + c, every: false, slot: 'sheet' }), [0.96, 0.96, 0.94]);
    }
  };
  const boarded = new Set<number>();
  for (const bd of spots.boards) {
    boarded.add(bd.place);
    if (bd.stand) {
      const y = ground(bd.x, bd.z);
      addSign('f:signFrame:1', bd.x, y, bd.z, bd.yaw, 1, 1, post);
      board(bd.place, bd.x, y + bd.y, bd.z, bd.yaw, true);
    } else board(bd.place, bd.x, base(bd.code) + bd.y, bd.z, bd.yaw, false);
  }
  // Notices in shop windows (a shop's opening or closing): low in the window, away from the door; a sale sign
  // on the door's side; a "now open" banner under a new shop's fascia.
  for (const f of spots.fronts) {
    const place = work.get(f.code);
    if (place === undefined || f.style !== 'fascia') continue;
    const { ax, az, nx, nz } = yawAxes(f.yaw);
    const side = (f.hours.x - f.x) * ax + (f.hours.z - f.z) * az >= 0 ? -1 : 1, off = Math.min(0.6, f.width / 4) * side;
    if (!boarded.has(place)) addSign(BOARD, f.x + ax * off - nx * 0.04, base(f.code) + 1.3, f.z + az * off - nz * 0.04, f.yaw, 0.58 * SHEET, 0.58, say({ t: 'notice', place, k: 0, every: false, slot: 'sheet' }), [0.96, 0.96, 0.94]);
    addSign(BOARD, f.x - ax * off - nx * 0.04, base(f.code) + 1.45, f.z - az * off - nz * 0.04, f.yaw, 0.5, 0.5, say({ t: 'sale', place, slot: 'card' }), [0.96, 0.96, 0.94]);
    const bw = Math.min(2.4, f.width * 0.7);
    addSign(BOARD, f.x + nx * 0.01, base(f.code) + f.y - f.height / 2 - 0.2, f.z + nz * 0.01, f.yaw, bw, bw / 8, say({ t: 'banner', place, slot: 'strip' }), [0.96, 0.96, 0.94]);
  }
  // Posters on the streets' lamp posts.
  const streetPlace = new Map<string, number>();
  for (const p of places) if (p.kind === 'street') streetPlace.set(p.name, p.id);
  for (const ps of spots.posters) {
    const place = streetPlace.get(roads.streets[ps.street].name);
    if (place === undefined) continue;
    addSign(BOARD, ps.x, terrain.height(ps.x, ps.z) + POSTER_Y, ps.z, ps.yaw, 0.42 * SHEET, 0.42, say({ t: 'notice', place, k: ps.k, every: true, slot: 'sheet' }), [0.96, 0.96, 0.94]);
  }
  const front = say({ t: 'town', back: false, slot: 'board' }), back = say({ t: 'town', back: true, slot: 'board' });
  for (const g of spots.gateways) {
    const y = ground(g.x, g.z);
    addSign('f:signFrame:0', g.x, y, g.z, g.yaw, 1, 1, post);
    addSign(BOARD, g.x, y + 1.6, g.z, g.yaw, 2.4, 1.2, front, [0.9, 0.9, 0.88]);
    addSign(BOARD, g.x, y + 1.6, g.z, g.yaw + Math.PI, 2.4, 1.2, back, [0.9, 0.9, 0.88]);
  }
  // The council's works boards (shown while it builds): a large board on the town sign's frame.
  for (const w of spots.works) {
    const y = ground(w.x, w.z);
    const said = say({ t: 'works', at: w.at, slot: 'board' });
    // (The frame goes with its board: there only while the works are on.)
    addSign('f:signFrame:0', w.x, y, w.z, w.yaw, 1, 1, said);
    addSign(BOARD, w.x, y + 1.6, w.z, w.yaw, 2.4, 1.2, said, [0.95, 0.95, 0.93]);
  }
  // Public clocks: a dial on each landmark clock face (src/plan/signs.ts `clockSpots`).
  const clock = say({ t: 'clock', slot: 'card' });
  for (const c of clockSpots(town)) addSign(BOARD, c.x, c.y, c.z, c.yaw, c.size, c.size, clock, [0.95, 0.94, 0.9]);
  return { groups: lists.groups(), what, town: name };
}

/** The paint of an estate agent's board (white). */
const ESTATE_PAINT = [0.95, 0.95, 0.95] as const;

/** A business sign's body colour: dark, from the building (the lettering brings the colour). */
function signPaint(code: number): number[] {
  const h = hashToFloat(hash32(code * 2654435761));
  return [0.1 + h * 0.15, 0.1 + ((h * 7) % 1) * 0.12, 0.12 + ((h * 13) % 1) * 0.1];
}
