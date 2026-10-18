/**
 * Themes: the town's workplaces. Each has a program (what it reserves first and what the rest of
 * the floor is cut into, for fill/split) and the items each of its rooms holds (for fill/place),
 * in order of importance, sized to the people who use it: as many workplaces as the place has
 * staff on site at once (`Need.staff`), as many seats as it has guests (`Need.seats`), as far as
 * the floor allows.
 *
 *  - offices: the ground floor reserves a lobby along the street front, every floor an open-plan
 *    office before the rest becomes meeting rooms, single offices, a tea kitchen, toilets and a
 *    store room. Open plan: pairs of desks facing each other near the windows, filing shelves
 *    along the plain walls, a water cooler by the door.
 *  - shops (corner shop, general store, clothes shop, pharmacy, butcher, bakery, ice cream): the
 *    sales floor along the street front, the counter with room behind it for the staff, shelving;
 *    a stock room and a toilet behind. A bakery bakes in the bakehouse behind (ovens, work
 *    tables), a butcher cuts in the back room.
 *  - places to eat and drink (café, pub, bar, restaurant, pizzeria): the guest room along the
 *    street front with the counter or bar and tables by the windows; the kitchen, toilets and a
 *    store behind.
 *  - services (post office, bank, police, library, hairdresser): the public counters (or the
 *    reading room, or the salon's chairs at their mirrors) in front, offices behind; the police
 *    have a cell, the bank a safe, the post office a sorting room.
 *  - halls (workshop, garage, factory): one hall with workbenches, car lifts or machines, an
 *    office, a toilet and a store at the back.
 *  - farm barns and sheds: the barn floor with stalls, hay, the tractor and workbenches; a feed
 *    store, the farm office and a toilet at the back.
 *
 * Ported from Scale (src/interior/fill/work.ts: offices, grocery, clothes shop, café); the other
 * themes and the sizing by staff and seats are new in SimWorld.
 */
import type { Rng } from '@futuremagic/core';
import { centred, plainWall, pottedPlant, wallPicture, type Item, type Cand, type Filler, type Kid } from './place';
import type { Area } from './area';
import type { Program, Reserve } from './split';
import type { RoomType } from '../types';
import { minAreaRect, polyArea } from '../../geom/geom2';
import { FABRIC, WOOD, LEAF, WHITE_WARE, type C3 } from './palette';

export type Work =
  | 'office' | 'grocery' | 'clothes' | 'cafe' | 'pub' | 'restaurant' | 'icecream' | 'bakery' | 'butcher' | 'pharmacy'
  | 'post' | 'bank' | 'police' | 'library' | 'hairdresser' | 'workshop' | 'garage' | 'factory' | 'vacant'
  // The public buildings' walk-in bodies (src/interior/landmark.ts).
  | 'church' | 'school' | 'kindergarten' | 'clinic' | 'fire' | 'supermarket' | 'carehome' | 'station' | 'townhall'
  // A farm's barns and sheds.
  | 'farm';

/** Who a storey of a workplace is for: staff on site at once, and seats for guests or clients. */
export interface Need { staff: number; seats: number }

const wc = { type: 'bath' as RoomType, len: [1.7, 2.3] as [number, number], max: 1 };
const store = (max?: number) => ({ type: 'storage' as RoomType, len: [2.2, 3.2] as [number, number], max });
const front = (type: RoomType, share: number, leave = 4.5, minLeft = 2.6): Reserve => ({ type, at: 'front', share, minLeft, leave });

export function workProgram(w: Work, ground: boolean): Program {
  switch (w) {
    case 'office':
      return {
        reserve: [...(ground ? [{ type: 'lobby' as RoomType, at: 'front' as const, depth: 5, minLeft: 3 }] : []), front('office', 0.62, 5.5, 2.8)],
        rooms: [{ type: 'meeting', len: [3.6, 5], max: 2 }, { type: 'office', len: [2.8, 3.6] }, { type: 'kitchen', len: [2.4, 3], max: 1 }, wc, { type: 'office', len: [2.8, 3.6] }, store()],
        corridor: 0, leaf: ['bath', 'storage', 'meeting'],
      };
    case 'cafe': case 'icecream':
      return { reserve: [front('dining', 0.68)], rooms: [{ type: 'kitchen', len: [3, 4.5], max: 1 }, wc, store()], corridor: 0, leaf: ['bath', 'storage'] };
    case 'pub': case 'restaurant':
      return { reserve: [front('dining', 0.66, 5)], rooms: [{ type: 'kitchen', len: [3.5, 5.5], max: 1 }, wc, store(2), { ...wc, max: 2 }], corridor: 0, leaf: ['bath', 'storage'] };
    case 'bakery':
      return { reserve: [front('shop', 0.45, 6)], rooms: [{ type: 'bakehouse', len: [4, 7], max: 1 }, wc, store(1)], corridor: 0, leaf: ['bath', 'storage'] };
    case 'butcher':
      return { reserve: [front('shop', 0.55)], rooms: [{ type: 'kitchen', len: [3, 5], max: 1 }, store(1), wc], corridor: 0, leaf: ['bath', 'storage'] };
    case 'pharmacy':
      return { reserve: [front('shop', 0.68)], rooms: [store(1), { type: 'office', len: [2.6, 3.4], max: 1 }, wc], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'post':
      return { reserve: [front('lobby', 0.5, 5)], rooms: [{ type: 'storage', len: [3.5, 6], max: 1 }, { type: 'office', len: [2.6, 3.4], max: 1 }, wc], corridor: 0, leaf: ['bath', 'office'] };
    case 'bank':
      return { reserve: [front('lobby', 0.5, 5)], rooms: [{ type: 'office', len: [2.6, 3.6] }, store(1), wc, { type: 'office', len: [2.6, 3.6] }], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'police':
      return {
        reserve: [{ type: 'lobby', at: 'front', depth: 4.5, minLeft: 3 }, front('office', 0.5, 5)],
        rooms: [{ type: 'cell', len: [2.4, 3], max: 1 }, { type: 'office', len: [2.8, 3.6] }, wc, store(1)],
        corridor: 0, leaf: ['bath', 'storage', 'cell'],
      };
    case 'library':
      return { reserve: [front('reading', 0.8, 4)], rooms: [{ type: 'office', len: [2.6, 3.4], max: 1 }, wc, store(1)], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'hairdresser':
      return { reserve: [front('salon', 0.75)], rooms: [store(1), wc], corridor: 0, leaf: ['bath'] };
    case 'workshop': case 'garage': case 'factory':
      return { reserve: [front(w, 0.8, 4.5, 3)], rooms: [{ type: 'office', len: [2.8, 4], max: 1 }, wc, store()], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'vacant':
      return { reserve: [front('shop', 0.74)], rooms: [store(), wc], corridor: 0, leaf: ['bath'] };
    case 'church':
      // The nave, a vestry at the back.
      return { reserve: [front('nave', 0.86, 3)], rooms: [{ type: 'office', len: [2.4, 3.4], max: 1 }, wc], corridor: 0, leaf: ['bath', 'office'] };
    case 'school':
      return {
        reserve: ground ? [{ type: 'lobby', at: 'front', depth: 4, minLeft: 5 }] : [],
        rooms: [{ type: 'classroom', len: [6.5, 8.5] }, { type: 'classroom', len: [6.5, 8.5] }, ...(ground ? [{ type: 'office' as RoomType, len: [3.5, 5] as [number, number], max: 1 }] : []), { ...wc, max: 2 }, { type: 'classroom', len: [6.5, 8.5] }, store(1)],
        corridor: 2.2, corridorType: 'corridor', leaf: ['bath', 'storage', 'classroom', 'office'], doorW: 1.0,
      };
    case 'kindergarten':
      return { reserve: [front('playroom', 0.62)], rooms: [{ type: 'playroom', len: [5, 7], max: 1 }, { type: 'kitchen', len: [2.6, 3.4], max: 1 }, { ...wc, max: 2 }, { type: 'office', len: [2.6, 3.4], max: 1 }], corridor: 0, leaf: ['bath', 'office'] };
    case 'clinic':
      return {
        reserve: ground ? [{ type: 'lobby', at: 'front', depth: 5, minLeft: 4 }] : [],
        rooms: [{ type: 'consulting', len: [3.2, 4.2] }, { type: 'consulting', len: [3.2, 4.2] }, wc, store(1), { type: 'office', len: [2.8, 3.6], max: 1 }],
        corridor: 1.8, corridorType: 'corridor', leaf: ['bath', 'storage', 'consulting', 'office'],
      };
    case 'carehome':
      return {
        reserve: ground ? [front('dayroom', 0.4, 6)] : [],
        rooms: [{ type: 'bedroom', len: [3.2, 4] }, { type: 'bedroom', len: [3.2, 4] }, { ...wc, max: 2 }, ...(ground ? [{ type: 'kitchen' as RoomType, len: [3, 4.5] as [number, number], max: 1 }, { type: 'office' as RoomType, len: [2.8, 3.4] as [number, number], max: 1 }] : []), store(1)],
        corridor: 1.8, corridorType: 'corridor', leaf: ['bath', 'storage', 'bedroom', 'office'],
      };
    case 'fire':
      return { reserve: [front('garage', 0.78, 4, 3)], rooms: [{ type: 'kitchen', len: [3, 4.5], max: 1 }, { type: 'office', len: [2.8, 3.6], max: 1 }, wc, store(1)], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'supermarket':
      return { reserve: [front('shop', 0.84, 5)], rooms: [{ type: 'storage', len: [4, 7], max: 1 }, { type: 'office', len: [2.6, 3.4], max: 1 }, wc], corridor: 0, leaf: ['bath', 'office'] };
    case 'townhall':
      // The counters in the front hall, the council chamber, the mayor's and the clerks' offices, a room for
      // weddings and meetings; offices and meeting rooms upstairs.
      return ground
        ? {
          reserve: [{ type: 'lobby', at: 'front', share: 0.3, minLeft: 4 }],
          rooms: [{ type: 'chamber', len: [8, 12], max: 1 }, { type: 'office', len: [3.2, 4.4] }, { type: 'meeting', len: [4.5, 6.5], max: 1 }, { ...wc, max: 2 }, { type: 'office', len: [3.2, 4.4] }, store(1)],
          corridor: 2.2, corridorType: 'corridor', leaf: ['bath', 'storage', 'office', 'meeting', 'chamber'], doorW: 1.0,
        }
        : {
          reserve: [],
          rooms: [{ type: 'office', len: [3.2, 4.4] }, { type: 'meeting', len: [4.5, 6.5], max: 1 }, { type: 'office', len: [3.2, 4.4] }, { ...wc, max: 2 }, { type: 'office', len: [3.2, 4.4] }, store(1)],
          corridor: 2.2, corridorType: 'corridor', leaf: ['bath', 'storage', 'office', 'meeting'], doorW: 1.0,
        };
    case 'farm':
      // The barn floor (stalls, hay, the tractor, a workbench); the feed store, the farm office and a toilet at the back.
      return { reserve: [front('barn', 0.75, 4, 2.6)], rooms: [{ type: 'storage', len: [5, 9] }, { type: 'office', len: [2.6, 3.4], max: 1 }, wc], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    case 'station':
      return { reserve: [front('lobby', 0.72, 4)], rooms: [{ type: 'office', len: [2.6, 3.6], max: 1 }, wc, store(1)], corridor: 0, leaf: ['bath', 'storage', 'office'] };
    default:
      return { reserve: [front('shop', 0.74)], rooms: [{ type: 'storage', len: [3, 5] }, wc], corridor: 0, leaf: ['bath'] };
  }
}

/** The items for a room of a workplace. */
export function workItems(w: Work, type: RoomType, A: Area, r: Rng, need: Need): Item[] {
  switch (type) {
    case 'lobby': return w === 'post' || w === 'bank' || w === 'townhall' ? counterHall(w, A, r, need) : w === 'station' ? ticketHall(A, r, need) : w === 'clinic' ? waitingRoom(A, r) : lobby(r, w === 'police');
    case 'office': return roomArea(A) >= 28 ? openPlan(A, r, need.staff) : singleOffice(r);
    case 'meeting': return meeting(A, r);
    case 'kitchen': return w === 'butcher' ? cuttingRoom(need) : w === 'cafe' || w === 'icecream' || w === 'pub' || w === 'restaurant' ? cafeKitchen(w === 'restaurant', need) : teaKitchen(r);
    case 'bath': return toilet();
    case 'storage': return w === 'office' || w === 'police' ? officeStore() : w === 'bank' ? strongRoom() : w === 'post' ? sorting(need) : w === 'farm' ? feedStore(A, r) : stockRoom(r);
    case 'nave': return nave(A, r, need);
    case 'chamber': return chamber(A, r);
    case 'classroom': return classroom(A, r, false);
    case 'playroom': return classroom(A, r, true);
    case 'consulting': return consulting(r);
    case 'dayroom': return dayRoom(A, r);
    case 'bedroom': return careRoom(r);
    case 'shop': return w === 'vacant' ? emptyShop(r) : w === 'supermarket' ? supermarket(A, r, need) : w === 'clothes' ? clothes(A, r) : w === 'bakery' || w === 'butcher' ? deli(w, A, r) : w === 'pharmacy' ? pharmacy(A, r) : grocery(A, r);
    case 'dining': return w === 'pub' || w === 'restaurant' ? diningRoom(A, r, need, w === 'pub') : cafe(A, r, need, w === 'icecream');
    case 'bakehouse': return bakehouse(need);
    case 'salon': return salon(A, r, need);
    case 'reading': return reading(A, r, need);
    case 'cell': return cell();
    case 'workshop': case 'factory': return hall(type, A, r, need);
    case 'garage': return w === 'fire' ? engineHall(A, r) : hall(type, A, r, need);
    case 'barn': return barn(A, r, need);
    default: return [];
  }
}

const roomArea = (A: Area) => Math.abs(polyArea(A.poly));
const many = (n: number, it: Item): Item[] => Array.from({ length: Math.max(0, Math.floor(n)) }, () => it);
/** Is a free candidate turned so that its width runs along the room's long axis? */
const alongRoom = (A: Area) => {
  const o = minAreaRect(A.poly), long = o.hu >= o.hv, ux = long ? o.ux : -o.uz, uz = long ? o.uz : o.ux;
  return (c: Cand) => Math.abs(Math.cos(c.yaw) * ux - Math.sin(c.yaw) * uz) > 0.7;
};
const DARK: C3 = [0.15, 0.15, 0.17], SCREEN: C3 = [0.08, 0.08, 0.09], DESK: C3 = [0.85, 0.84, 0.8], METAL: C3 = [0.55, 0.57, 0.6], STEEL: C3 = [0.72, 0.73, 0.75];

/** An office chair at a desk's front, turned to it. */
const seat = (dv: number, dyaw: number, need = true): Kid => ({ kind: 'officeChair', du: 0, dv, dyaw, w: 0.6, d: 0.6, h: 1.1, color: DARK, use: 'work', need });
/** Waiting chairs along a plain wall. */
/** Where a seat along the wall would rather be: a plain wall, a few steps in from the door. */
const byWall = (c: Cand, f: Filler): number => plainWall(c) + Math.min(f.doorDist(c.x, c.z), 3) * 0.2;
const waiting = (r: Rng, n: number): Item[] => many(n, { kind: 'chair', at: 'wall', w: 0.5, d: 0.5, h: 0.9, color: r.pick(FABRIC), use: 'sit', score: byWall });

/**
 * A counter staff stand behind (the back clear for them), facing the way in, a few steps from it,
 * its back towards a wall. `till`: a screen on it.
 */
const serveCounter = (kind: 'counter' | 'displayCounter' | 'barCounter' | 'reception', w: number, color: C3, till = true, d = 0.75): Item => ({
  kind, at: 'free', widths: [w, Math.max(1.2, w * 0.75), 1.2], w, d, h: kind === 'barCounter' ? 1.1 : kind === 'displayCounter' ? 1.2 : 1.0, color, use: 'serve', front: 1.0, back: 0.9, tag: 'counter',
  kids: till ? [{ kind: 'monitor', du: w / 2 - 0.4, dv: -0.1, dyaw: Math.PI, w: 0.5, d: 0.3, h: 0.3, color: SCREEN, onTop: true }] : [],
  score: (c, f) => f.facesDoor(c) * 2 - Math.abs(f.behind(c, d) - 1.15) * 3 - Math.abs(f.doorDist(c.x, c.z) - 3.2) * 0.4,
});

function openPlan(A: Area, r: Rng, staff: number): Item[] {
  const along = alongRoom(A), area = roomArea(A);
  // Two desks facing each other: the first looks to +z, its partner sits behind it turned round.
  const pair: Item = {
    kind: 'desk', at: 'free', w: 1.6, d: 0.8, h: 0.74, color: DESK,
    kids: [
      { kind: 'monitor', du: 0, dv: -0.15, w: 0.6, d: 0.05, h: 0.4, color: SCREEN, onTop: true },
      seat(0.8, Math.PI),
      { kind: 'desk', du: 0, dv: -0.8, dyaw: Math.PI, w: 1.6, d: 0.8, h: 0.74, color: DESK },
      { kind: 'monitor', du: 0, dv: -0.65, dyaw: Math.PI, w: 0.6, d: 0.05, h: 0.4, color: SCREEN, onTop: true },
      seat(-1.6, 0, false),
    ],
    // Near the windows, in tidy rows along the room.
    score: (c, f) => -Math.min(f.windowDist(c.x, c.z), 8) * 0.5 + (along(c) ? 1.5 : 0) + Math.min(f.doorDist(c.x, c.z), 3) * 0.2,
  };
  const items: Item[] = [
    { kind: 'cooler', at: 'wall', w: 0.4, d: 0.4, h: 1.2, color: [0.9, 0.9, 0.92], tall: false, front: 0.6, score: (c, f) => -Math.abs(f.doorDist(c.x, c.z) - 1.2) },
    // As many desks as people work here at once (pairs), as far as about 6 m² a desk allows.
    ...many(Math.min(area / 6, Math.max(Math.min(24, area / 12), staff)) / 2 + 0.5, pair),
    ...many(Math.min(4, area / 25), { kind: 'shelf', at: 'wall', w: 0.9, d: 0.45, h: 1.3, color: METAL, front: 0.7, score: plainWall }),
    pottedPlant(1.5, 0.55, LEAF), pottedPlant(1.4, 0.55, LEAF),
  ];
  if (area > 70) items.push({ kind: 'sofa', at: 'wall', w: 1.8, d: 0.85, h: 0.85, color: r.pick(FABRIC), use: 'sit', front: 0.8, kids: [{ kind: 'coffeeTable', du: 0, dv: 0.85, w: 1.0, d: 0.55, h: 0.42, color: WOOD[2], need: true }], score: plainWall });
  if (r.chance(0.7)) items.push(wallPicture(r.pick(FABRIC), 1.2, 0.7));
  return items;
}

function singleOffice(r: Rng): Item[] {
  const wood = r.pick(WOOD);
  return [
    {
      kind: 'desk', at: 'wall', w: 1.4, d: 0.7, h: 0.74, color: wood,
      kids: [{ kind: 'monitor', du: 0, dv: -0.1, w: 0.6, d: 0.05, h: 0.4, color: SCREEN, onTop: true }, seat(0.75, Math.PI)],
      // At the window.
      score: (c) => (c.edge?.kind === 'window' ? 2 : 0) + centred(c) * 0.2,
    },
    { kind: 'bookshelf', at: 'wall', widths: [1.6, 1.2, 0.9], w: 1.6, d: 0.35, h: 2.0, color: wood, front: 0.6, score: plainWall },
    { kind: 'chair', at: 'wall', w: 0.5, d: 0.5, h: 0.9, color: r.pick(FABRIC), use: 'sit', score: (c, f) => -f.cornerGap(c) },
    pottedPlant(1.2, 0.55, LEAF),
    wallPicture(r.pick(FABRIC), 0.8, 0.7),
  ];
}

function meeting(A: Area, r: Rng): Item[] {
  const o = minAreaRect(A.poly), long = 2 * Math.max(o.hu, o.hv), short = 2 * Math.min(o.hu, o.hv);
  const tw = Math.max(1.6, Math.min(3.2, long - 2.2)), td = short > 3.4 ? 1.2 : 0.9;
  const kids: Kid[] = [];
  const n = Math.max(1, Math.floor(tw / 0.8));
  for (let k = 0; k < n; k++) {
    const du = (k - (n - 1) / 2) * 0.8;
    for (const side of [1, -1]) kids.push({ kind: 'officeChair', du, dv: side * (td / 2 + 0.3), dyaw: side > 0 ? Math.PI : 0, w: 0.6, d: 0.6, h: 1.1, color: DARK, use: 'sit', need: k === 0 });
  }
  return [
    { kind: 'meetingTable', at: 'free', sym: true, w: tw, d: td, h: 0.75, color: WOOD[3], tag: 'table', kids, score: (c) => -Math.hypot(c.x - o.cx, c.z - o.cz) },
    // A narrow room: a small table with a chair at either end instead.
    {
      kind: 'meetingTable', at: 'free', sym: true, w: 1.4, d: 0.8, h: 0.75, color: WOOD[3], tag: 'table',
      kids: [1, -1].map((s2, i): Kid => ({ kind: 'officeChair', du: s2 * 1.05, dv: 0, dyaw: s2 * Math.PI / 2 * -1, w: 0.6, d: 0.6, h: 1.1, color: DARK, use: 'sit', need: i === 0 })),
      score: (c, f) => (f.get('table') ? -100 : 0) - Math.hypot(c.x - o.cx, c.z - o.cz) * 0.1, min: -50,
    },
    {
      // The screen on the wall at the table's end.
      kind: 'screen', at: 'wall', hung: true, w: 1.6, d: 0.06, h: 0.95, color: SCREEN,
      score: (c, f) => {
        const t = f.get('table');
        if (!t) return 0;
        const ax = Math.cos(t.yaw), az = -Math.sin(t.yaw), dx = c.x - t.x, dz = c.z - t.z;
        return Math.abs(dx * ax + dz * az) - Math.abs(dz * ax - dx * az) * 3;
      },
    },
    pottedPlant(1.3, 0.55, LEAF),
    ...(r.chance(0.6) ? [wallPicture(r.pick(FABRIC), 1.0, 0.7)] : []),
  ];
}

/** An office lobby (the reception desk facing the way in, a waiting corner), or a police front desk. */
function lobby(r: Rng, police: boolean): Item[] {
  const fab = r.pick(FABRIC);
  return [
    serveCounter('reception', 2.4, police ? [0.2, 0.24, 0.34] : [0.25, 0.25, 0.27], true, 0.8),
    ...(police ? waiting(r, 4) : [{
      kind: 'sofa', at: 'wall', w: 2.0, d: 0.9, h: 0.85, color: fab, use: 'sit',
      kids: [
        { kind: 'coffeeTable', du: 0, dv: 0.9, w: 1.1, d: 0.6, h: 0.42, color: WOOD[2], need: true },
        { kind: 'rug', du: 0, dv: 0.85, w: 2.6, d: 1.9, h: 0.01, color: r.pick(FABRIC), flat: true },
        { kind: 'armchair', du: 1.4, dv: 0.9, dyaw: -Math.PI / 2, w: 0.85, d: 0.85, h: 0.9, color: fab, use: 'sit' },
        { kind: 'armchair', du: -1.4, dv: 0.9, dyaw: Math.PI / 2, w: 0.85, d: 0.85, h: 0.9, color: fab, use: 'sit' },
      ],
      score: (c: Cand, f: Filler) => plainWall(c) + Math.min(f.doorDist(c.x, c.z), 5) * 0.3,
    } satisfies Item]),
    pottedPlant(1.6, 0.55, LEAF), pottedPlant(1.4, 0.55, LEAF),
    wallPicture(r.pick(FABRIC), 1.2, 0.7), wallPicture(r.pick(FABRIC), 1.2, 0.7),
  ];
}

/** A post office's or bank's public hall: a row of counters, waiting chairs, a leaflet shelf. */
function counterHall(w: 'post' | 'bank' | 'townhall', A: Area, r: Rng, need: Need): Item[] {
  const col: C3 = w === 'bank' ? [0.32, 0.26, 0.2] : w === 'townhall' ? WOOD[3] : [0.82, 0.62, 0.18];
  const counters = Math.max(1, Math.min(4, Math.round(roomArea(A) / 25), Math.ceil(need.staff / 2)));
  return [
    ...many(counters, serveCounter('counter', 1.6, col, true, 0.7)),
    ...waiting(r, Math.min(6, roomArea(A) / 6)),
    { kind: w === 'post' ? 'shopShelf' : 'shelf', at: 'wall', w: 1.4, d: 0.4, h: 1.6, color: w === 'post' ? [0.86, 0.86, 0.84] : METAL, front: 0.8, score: plainWall },
    pottedPlant(1.4, 0.55, LEAF),
    ...(w === 'bank' || w === 'townhall' ? [wallPicture(r.pick(FABRIC), 1.2, 0.7)] : []),
  ];
}

function teaKitchen(r: Rng): Item[] {
  return [
    { kind: 'kitchenRow', at: 'wall', widths: [3.0, 2.4, 1.8], w: 3.0, d: 0.62, h: 0.92, color: [0.92, 0.92, 0.9], tall: true, front: 0.9, score: plainWall },
    { kind: 'fridge', at: 'wall', w: 0.7, d: 0.68, h: 1.85, color: [0.9, 0.9, 0.9], front: 0.8, score: (c, f) => -f.cornerGap(c) },
    {
      kind: 'cafeTable', at: 'free', sym: true, w: 0.75, d: 0.75, h: 0.75, color: r.pick(WOOD),
      kids: [0, Math.PI].map((a, i): Kid => ({ kind: 'chair', du: 0, dv: (i ? -1 : 1) * 0.65, dyaw: a + Math.PI, w: 0.45, d: 0.45, h: 0.9, color: r.pick(WOOD), use: 'sit', need: i === 0 })),
    },
  ];
}

function toilet(): Item[] {
  return [
    { kind: 'toilet', at: 'wall', w: 0.4, d: 0.65, h: 0.75, color: WHITE_WARE, front: 0.55, score: (c, f) => -f.cornerGap(c) * 0.3 + Math.min(f.doorDist(c.x, c.z), 3) },
    { kind: 'sink', at: 'wall', w: 0.55, d: 0.45, h: 0.85, color: WHITE_WARE, front: 0.6, kids: [{ kind: 'mirror', du: 0, dv: -0.45 / 2 + 0.01, w: 0.6, d: 0.03, h: 0.8, color: [0.7, 0.78, 0.82], hung: true }], score: plainWall },
  ];
}

function officeStore(): Item[] {
  return many(4, { kind: 'shelf', at: 'wall', widths: [1.8, 0.9], w: 1.8, d: 0.45, h: 1.9, color: METAL, front: 0.6, score: (c, f) => -f.cornerGap(c) * 0.2 });
}

function stockRoom(r: Rng): Item[] {
  return [
    ...many(6, { kind: 'palletRack', at: 'wall', w: 1.3, d: 0.5, h: 2.4, color: [0.35, 0.4, 0.5], front: 0.8, score: (c, f) => -f.cornerGap(c) * 0.2 }),
    ...many(3, { kind: 'crate', at: 'free', w: 0.8, d: 0.6, h: 0.55, color: [0.6, 0.48, 0.3], score: () => r.float() }),
  ];
}

/** A farm's feed store: sacks of feed on pallets, bales of straw, a shelf of tools and tins. */
function feedStore(A: Area, r: Rng): Item[] {
  const n = Math.min(6, roomArea(A) / 6);
  return [
    ...many(n, { kind: 'crate', at: 'wall', w: 1.2, d: 1.0, h: 0.7, color: [0.82, 0.78, 0.66], score: (c, f) => -f.cornerGap(c) * 0.3 }),
    ...many(n / 2, { kind: 'hayBale', at: 'wall', w: 1.2, d: 0.9, h: 0.8, color: [0.8, 0.7, 0.4], score: () => r.float() }),
    { kind: 'shelf', at: 'wall', w: 1.4, d: 0.45, h: 1.9, color: WOOD[1], front: 0.8, score: plainWall },
  ];
}

/** A bank's strong room: the safe and shelves. */
function strongRoom(): Item[] {
  return [{ kind: 'safe', at: 'wall', w: 1.0, d: 0.8, h: 1.6, color: [0.3, 0.32, 0.34], front: 0.9, score: plainWall }, ...officeStore().slice(0, 2)];
}

/** A post office's sorting room: tables to sort at (one per postal worker on the early shift), racks of parcels. */
function sorting(need: Need): Item[] {
  return [
    ...many(Math.max(1, need.staff - 1), { kind: 'workTable', at: 'free', sym: true, w: 1.8, d: 0.9, h: 0.9, color: [0.7, 0.6, 0.45], use: 'work', front: 0.8 }),
    ...many(4, { kind: 'palletRack', at: 'wall', w: 1.3, d: 0.5, h: 2.2, color: [0.8, 0.62, 0.15], front: 0.8, score: (c, f) => -f.cornerGap(c) * 0.2 }),
  ];
}

/** The checkout by the entrance: facing into the shop, near the door, the till on it. */
const checkout = (): Item => serveCounter('counter', 1.8, WOOD[1]);

const fixtureColor = (r: Rng): C3 => r.pick<C3>([[0.86, 0.86, 0.84], [0.32, 0.33, 0.35], [0.62, 0.5, 0.36]]);
const aisleOf = (A: Area, color: C3, kind: 'shopShelf' | 'bookshelf' = 'shopShelf', h = 1.7): Item => {
  const along = alongRoom(A);
  return {
    kind, at: 'free', w: 1.8, d: 0.5, h, color, front: 0.9,
    kids: [{ kind, du: 0, dv: -0.51, dyaw: Math.PI, w: 1.8, d: 0.5, h, color, front: 0.9, need: true }],
    score: (c, f) => (along(c) ? 2 : 0) + Math.min(f.doorDist(c.x, c.z), 4) * 0.3,
  };
};

function grocery(A: Area, r: Rng): Item[] {
  const area = roomArea(A), fixture = fixtureColor(r);
  return [
    checkout(),
    ...many(Math.min(16, area / 9), aisleOf(A, fixture)),
    ...many(Math.min(12, area / 12), { kind: 'shopShelf', at: 'wall', w: 1.8, d: 0.5, h: 2.1, color: fixture, front: 0.9, score: plainWall }),
    { kind: 'fridge', at: 'wall', w: 0.9, d: 0.7, h: 1.9, color: [0.85, 0.88, 0.9], front: 0.9, score: plainWall },
    pottedPlant(1.2, 0.55, LEAF),
  ];
}

function pharmacy(A: Area, r: Rng): Item[] {
  const area = roomArea(A);
  return [
    serveCounter('counter', 2.4, [0.9, 0.92, 0.9]),
    // The medicines behind the counter, the rest on shelves along the walls and an aisle or two.
    ...many(Math.min(10, area / 8), { kind: 'shopShelf', at: 'wall', w: 1.6, d: 0.45, h: 2.1, color: [0.92, 0.93, 0.92], front: 0.9, score: plainWall }),
    ...many(Math.min(3, area / 25), aisleOf(A, [0.92, 0.93, 0.92], 'shopShelf', 1.4)),
    ...waiting(r, 2),
    pottedPlant(1.2, 0.55, LEAF),
  ];
}

function clothes(A: Area, r: Rng): Item[] {
  const area = roomArea(A), fixture = fixtureColor(r);
  return [
    // The full-length fitting mirror: flat on a plain wall, room in front.
    { kind: 'tallMirror', at: 'wall', w: 0.7, d: 0.08, h: 1.85, color: [0.3, 0.21, 0.14], front: 1.2, tall: false, tag: 'mirror', score: (c, f) => plainWall(c) * 3 + Math.min(f.doorDist(c.x, c.z), 4) * 0.4 },
    checkout(),
    // Rails of clothes down the floor and along the walls, dummies in the window.
    ...many(Math.min(14, area / 6), { kind: 'clothesRail', at: 'free', sym: true, w: 1.6, d: 0.6, h: 1.5, color: r.pick(FABRIC), front: 0.7, score: (c, f) => Math.min(f.doorDist(c.x, c.z), 4) * 0.3 }),
    ...many(Math.min(8, area / 10), { kind: 'clothesRail', at: 'wall', w: 1.8, d: 0.55, h: 1.6, color: r.pick(FABRIC), front: 0.8, score: plainWall }),
    ...many(Math.min(2, area / 25), { kind: 'mannequin', at: 'free', sym: true, w: 0.55, d: 0.45, h: 1.85, color: r.pick(FABRIC), score: (c, f) => -Math.min(f.windowDist(c.x, c.z), 6) }),
    ...many(Math.min(3, area / 25), {
      kind: 'coffeeTable', at: 'free', sym: true, w: 1.4, d: 0.8, h: 0.8, color: r.pick(WOOD), front: 0.6,
      kids: [{ kind: 'clothesStack', du: 0, dv: 0, w: 1.2, d: 0.6, h: 0.8, color: r.pick(FABRIC), onTop: true }],
      score: (c, f) => Math.min(f.doorDist(c.x, c.z), 4) * 0.3,
    }),
    ...many(Math.min(6, area / 16), { kind: 'clothesShelf', at: 'wall', w: 1.8, d: 0.5, h: 2.1, color: fixture, front: 0.9, score: plainWall }),
    pottedPlant(1.3, 0.55, LEAF), pottedPlant(1.1, 0.55, LEAF),
    wallPicture([0.75, 0.8, 0.7], 1.0, 0.7), wallPicture(r.pick(FABRIC), 0.7, 0.7),
  ];
}

/** A bakery's or butcher's shop: the glass display counter, shelves of bread or a cold cabinet, a table or two in a bakery. */
function deli(w: 'bakery' | 'butcher', A: Area, r: Rng): Item[] {
  const area = roomArea(A);
  return [
    serveCounter('displayCounter', 3.0, w === 'bakery' ? WOOD[0] : [0.85, 0.86, 0.86], true, 0.9),
    ...(w === 'bakery'
      ? many(Math.min(4, area / 8), { kind: 'shopShelf', at: 'wall', w: 1.4, d: 0.45, h: 1.8, color: WOOD[1], front: 0.8, score: plainWall })
      : [{ kind: 'fridge', at: 'wall', w: 1.2, d: 0.7, h: 1.9, color: [0.85, 0.88, 0.9], front: 0.9, score: plainWall } satisfies Item, { kind: 'shopShelf', at: 'wall', w: 1.4, d: 0.45, h: 1.8, color: [0.86, 0.86, 0.84], front: 0.8, score: plainWall } satisfies Item]),
    ...(w === 'bakery' && area > 22 ? many(2, cafeSet(r, (c, f) => -Math.min(f.windowDist(c.x, c.z), 6))) : []),
    pottedPlant(1.1, 0.55, LEAF),
  ];
}

/** The bakehouse: ovens along a plain wall, a work table per baker, racks for the trays, a sink. */
function bakehouse(need: Need): Item[] {
  return [
    ...many(2, { kind: 'oven', at: 'wall', w: 1.4, d: 1.0, h: 1.8, color: STEEL, tall: true, use: 'work', front: 1.2, score: plainWall }),
    ...many(Math.max(1, need.staff), { kind: 'workTable', at: 'free', sym: true, w: 2.0, d: 0.9, h: 0.9, color: STEEL, use: 'work', front: 0.8 }),
    ...many(2, { kind: 'palletRack', at: 'wall', w: 0.8, d: 0.6, h: 1.8, color: STEEL, front: 0.8, score: (c, f) => -f.cornerGap(c) * 0.2 }),
    { kind: 'sink', at: 'wall', w: 0.7, d: 0.55, h: 0.9, color: STEEL, front: 0.6, score: plainWall },
    { kind: 'fridge', at: 'wall', w: 0.8, d: 0.7, h: 1.9, color: STEEL, front: 0.8, score: plainWall },
  ];
}

/** A butcher's cutting room: work tables, the cold store, a sink. */
function cuttingRoom(need: Need): Item[] {
  return [
    ...many(Math.max(1, need.staff - 1), { kind: 'workTable', at: 'free', sym: true, w: 1.8, d: 0.9, h: 0.9, color: STEEL, use: 'work', front: 0.8 }),
    { kind: 'fridge', at: 'wall', w: 1.4, d: 0.8, h: 2.0, color: STEEL, front: 0.9, score: plainWall },
    { kind: 'sink', at: 'wall', w: 0.7, d: 0.55, h: 0.9, color: STEEL, front: 0.6, score: plainWall },
    { kind: 'shelf', at: 'wall', w: 0.9, d: 0.45, h: 1.8, color: METAL, front: 0.6 },
  ];
}

/** A table for two, by the windows, away from the counter. */
const cafeSet = (r: Rng, score?: Item['score']): Item => ({
  kind: 'cafeTable', at: 'free', sym: true, w: 0.75, d: 0.75, h: 0.75, color: WOOD[1],
  kids: [1, -1].map((s, i): Kid => ({ kind: 'chair', du: 0, dv: s * 0.65, dyaw: s > 0 ? Math.PI : 0, w: 0.45, d: 0.45, h: 0.9, color: WOOD[2], use: 'sit', need: i === 0 })),
  score: score ?? ((c, f) => -Math.min(f.windowDist(c.x, c.z), 6) * 0.6 + (f.get('counter') ? Math.min(Math.hypot(c.x - f.get('counter')!.x, c.z - f.get('counter')!.z), 4) * 0.3 : 0) + r.float() * 0.05),
});

/** A table for four (a restaurant's, a pub's). */
const tableFor4 = (r: Rng, wood: C3): Item => ({
  kind: 'diningTable', at: 'free', sym: true, w: 1.2, d: 0.8, h: 0.75, color: wood,
  kids: [-0.3, 0.3].flatMap((du) => [1, -1].map((s, i): Kid => ({ kind: 'chair', du, dv: s * 0.68, dyaw: s > 0 ? Math.PI : 0, w: 0.45, d: 0.45, h: 0.9, color: wood, use: 'sit', need: du < 0 && i === 0 }))),
  score: (c, f) => -Math.min(f.windowDist(c.x, c.z), 6) * 0.4 + (f.get('counter') ? Math.min(Math.hypot(c.x - f.get('counter')!.x, c.z - f.get('counter')!.z), 4) * 0.3 : 0) + r.float() * 0.05,
});

/** Tables for about `seats` guests, as far as `perM2` square metres a seat allows. */
const tables = (area: number, seats: number, perSet: number, perM2: number) => Math.min(area / (perM2 * perSet), Math.max(2, seats / perSet));

function cafe(A: Area, r: Rng, need: Need, icecream: boolean): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD);
  return [
    icecream ? serveCounter('displayCounter', 3.0, [0.9, 0.86, 0.8], true, 0.9) : serveCounter('barCounter', 3.4, wood, true, 0.7),
    ...many(tables(area, need.seats, 2, 2.4), cafeSet(r)),
    pottedPlant(1.4, 0.55, LEAF), pottedPlant(1.2, 0.55, LEAF),
    wallPicture(r.pick(FABRIC), 0.8, 0.7), wallPicture(r.pick(FABRIC), 0.8, 0.7),
  ];
}

/**
 * A pub or a restaurant: the bar (or the pass) and tables for its guests, more fours than twos
 * (`m²` of floor per seat); a pub has stools by the door too.
 */
function diningRoom(A: Area, r: Rng, need: Need, pub: boolean): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD), per = pub ? 1.8 : 2.0;
  return [
    pub ? serveCounter('barCounter', 4.2, wood, true, 0.7) : serveCounter('counter', 1.8, wood, true, 0.7),
    ...many(tables(area, need.seats, 4, per) * (pub ? 0.6 : 1), tableFor4(r, wood)),
    ...many(tables(area, need.seats, 2, per) * (pub ? 0.4 : 0.3), cafeSet(r)),
    ...(pub ? waiting(r, 2) : []),
    pottedPlant(pub ? 1.3 : 1.4, 0.55, LEAF), ...(pub ? [] : [pottedPlant(1.4, 0.55, LEAF)]),
    wallPicture(r.pick(FABRIC), pub ? 0.8 : 1.0, 0.7), wallPicture(r.pick(FABRIC), pub ? 0.8 : 1.0, 0.7),
  ];
}

/** A restaurant's (or café's) kitchen: counter rows, the range, a pass to plate up at. */
function cafeKitchen(big: boolean, need: Need): Item[] {
  return [
    { kind: 'kitchenRow', at: 'wall', widths: [3.6, 3.0, 2.4, 1.8], w: 3.6, d: 0.62, h: 0.92, color: [0.75, 0.76, 0.78], tall: true, use: 'work', front: 0.9, score: plainWall },
    { kind: 'kitchenRow', at: 'wall', widths: [2.4, 1.8], w: 2.4, d: 0.62, h: 0.92, color: [0.75, 0.76, 0.78], tall: true, use: 'work', front: 0.9, score: plainWall },
    ...(big ? [{ kind: 'oven', at: 'wall', w: 1.2, d: 0.9, h: 1.6, color: STEEL, tall: true, use: 'work', front: 1.1, score: plainWall } satisfies Item] : []),
    ...many(big ? Math.max(1, need.staff - 3) : 0, { kind: 'workTable', at: 'free', sym: true, w: 1.6, d: 0.8, h: 0.9, color: STEEL, use: 'work', front: 0.8 }),
    { kind: 'fridge', at: 'wall', w: 0.8, d: 0.7, h: 1.9, color: [0.82, 0.83, 0.85], front: 0.8, score: (c, f) => -f.cornerGap(c) },
    { kind: 'shelf', at: 'wall', w: 0.9, d: 0.45, h: 1.8, color: METAL, front: 0.6 },
  ];
}

/** A salon: a chair at its mirror on the wall for every hairdresser, a wash basin, the till, waiting chairs. */
function salon(A: Area, r: Rng, need: Need): Item[] {
  const chairColor: C3 = r.pick([[0.12, 0.12, 0.13], [0.55, 0.15, 0.15], [0.85, 0.85, 0.82]]);
  return [
    serveCounter('counter', 1.4, [0.9, 0.9, 0.88]),
    ...many(Math.max(2, need.staff + 1), {
      kind: 'mirror', at: 'wall', hung: true, w: 0.7, d: 0.03, h: 0.9, color: [0.7, 0.78, 0.82],
      kids: [{ kind: 'salonChair', du: 0, dv: 0.95, dyaw: Math.PI, w: 0.65, d: 0.65, h: 1.0, color: chairColor, use: 'work', need: true }],
      score: (c, f) => -f.cornerGap(c) * 0.1 + Math.min(f.doorDist(c.x, c.z), 4) * 0.2,
    }),
    {
      kind: 'washBasin', at: 'wall', w: 0.7, d: 0.6, h: 0.9, color: [0.12, 0.12, 0.13], front: 1.2, score: plainWall,
      kids: [{ kind: 'chair', du: 0, dv: 0.65, w: 0.6, d: 0.6, h: 0.9, color: chairColor, use: 'sit', need: true }],
    },
    ...waiting(r, Math.min(4, roomArea(A) / 8)),
    pottedPlant(1.3, 0.55, LEAF),
  ];
}

/** A library's reading room: the desk by the door, shelves in rows and along the walls, reading tables. */
function reading(A: Area, r: Rng, need: Need): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD);
  return [
    serveCounter('counter', 2.0, wood),
    ...many(tables(area, need.seats, 4, 3) * 0.5, tableFor4(r, WOOD[3])),
    ...many(Math.min(12, area / 10), aisleOf(A, wood, 'bookshelf', 2.0)),
    ...many(Math.min(14, area / 8), { kind: 'bookshelf', at: 'wall', w: 1.6, d: 0.35, h: 2.1, color: wood, front: 0.8, score: plainWall }),
    { kind: 'armchair', at: 'wall', w: 0.85, d: 0.85, h: 0.9, color: r.pick(FABRIC), use: 'sit', score: (c) => (c.edge?.kind === 'window' ? 1 : 0) },
    pottedPlant(1.4, 0.55, LEAF), pottedPlant(1.3, 0.55, LEAF),
  ];
}

/** A police cell: a bench to sit on, a toilet. */
function cell(): Item[] {
  return [
    { kind: 'bunk', at: 'wall', w: 0.8, d: 1.9, h: 0.45, color: [0.5, 0.5, 0.52], use: 'sit', front: 0.6, score: plainWall },
    { kind: 'toilet', at: 'wall', w: 0.4, d: 0.65, h: 0.75, color: STEEL, front: 0.55, score: (c, f) => -f.cornerGap(c) * 0.3 },
  ];
}

/**
 * A hall: a workshop's benches along the walls and machines on the floor, a garage's car lifts
 * (each with a car on it) and benches, a factory's rows of machines; racks along plain walls.
 */
function hall(type: 'workshop' | 'garage' | 'factory', A: Area, r: Rng, need: Need): Item[] {
  const area = roomArea(A), along = alongRoom(A), col: C3 = r.pick([[0.3, 0.42, 0.55], [0.55, 0.3, 0.2], [0.35, 0.45, 0.3]]);
  const bench: Item = { kind: 'workbench', at: 'wall', w: 2.0, d: 0.75, h: 0.9, color: WOOD[1], use: 'work', front: 1.0, score: (c) => plainWall(c) * 0.5 };
  const machine: Item = { kind: 'machine', at: 'free', w: 1.6, d: 1.2, h: 1.6, color: col, tall: false, use: 'work', front: 1.0, score: (c, f) => (along(c) ? 1.5 : 0) + Math.min(f.doorDist(c.x, c.z), 4) * 0.2 };
  const racks = many(Math.min(8, area / 40), { kind: 'palletRack', at: 'wall', w: 2.4, d: 1.0, h: 3.0, color: [0.2, 0.3, 0.6], front: 1.2, score: (c, f) => plainWall(c) - f.cornerGap(c) * 0.1 });
  if (type === 'garage') {
    return [
      // The cars come in through the front: lifts near the way in, cars along the hall.
      ...many(Math.max(1, Math.min(4, need.staff, area / 40)), {
        kind: 'carLift', at: 'free', w: 2.6, d: 5.0, h: 0.15, color: [0.75, 0.2, 0.15], use: 'work', front: 1.0,
        kids: [{ kind: 'car', du: 0, dv: 0, w: 1.8, d: 4.3, h: 1.45, color: r.pick(FABRIC), onTop: true }],
        score: (c, f) => -Math.abs(f.doorDist(c.x, c.z) - 5) * 0.3 + (along(c) ? 0 : 1),
      }),
      ...many(Math.max(2, need.staff - 2), bench),
      ...racks,
    ];
  }
  const work = Math.max(1, need.staff);
  return type === 'factory'
    ? [...many(Math.min(area / 9, work), machine), ...many(Math.min(area / 30, Math.max(1, work / 6)), bench), ...racks]
    : [...many(Math.min(area / 12, Math.ceil(work / 2) + 1), bench), ...many(Math.min(area / 18, work / 2), machine), ...racks];
}

/**
 * A barn's floor: stalls along the plain walls (each a place to work, feeding and mucking out), bales of hay stacked
 * in a corner, the tractor by the way in, workbenches, a bench to sit on at the break.
 */
function barn(A: Area, r: Rng, need: Need): Item[] {
  const area = roomArea(A), along = alongRoom(A);
  const plank = r.pick(WOOD), straw: C3 = [0.8, 0.7, 0.4], paint: C3 = r.pick([[0.2, 0.45, 0.22], [0.7, 0.18, 0.12], [0.85, 0.55, 0.12], [0.25, 0.35, 0.6]]);
  const stall: Item = { kind: 'stall', at: 'wall', w: 2.6, d: 3.0, h: 1.3, tall: false, color: plank, use: 'work', front: 1.0, score: (c, f) => plainWall(c) - f.cornerGap(c) * 0.05 };
  const bale: Item = { kind: 'hayBale', at: 'wall', w: 1.2, d: 0.9, h: 0.8, color: straw, kids: [{ kind: 'hayBale', du: 0, dv: 0, w: 1.2, d: 0.9, h: 0.8, color: straw, onTop: true }], score: (c, f) => plainWall(c) - f.cornerGap(c) * 0.3 };
  const tractor: Item = { kind: 'tractor', at: 'free', w: 2.0, d: 3.6, h: 2.1, color: paint, front: 1.2, score: (c, f) => (along(c) ? 1 : 0) - Math.abs(f.doorDist(c.x, c.z) - 5) * 0.3 };
  const bench: Item = { kind: 'workbench', at: 'wall', w: 2.0, d: 0.75, h: 0.9, color: WOOD[1], use: 'work', front: 1.0, score: (c) => plainWall(c) * 0.5 };
  const work = Math.max(2, need.staff);
  return [
    ...many(Math.min(10, area / 22, work + 3), stall),
    ...(area > 60 ? [tractor] : []),
    ...many(Math.min(2, Math.ceil(work / 2)), bench),
    ...many(Math.min(6, area / 25), bale),
    { kind: 'pew', at: 'wall', w: 1.6, d: 0.45, h: 0.9, color: WOOD[2], use: 'sit', score: byWall },
  ];
}

/** An empty shop: a few boxes left behind. */
function emptyShop(r: Rng): Item[] {
  return many(r.int(1, 3), { kind: 'crate', at: 'free', w: 0.8, d: 0.6, h: 0.55, color: [0.6, 0.48, 0.3], score: () => r.float() });
}

// ------------------------------------------------------------------------------ public buildings

/** How well a piece at `c` faces the piece tagged `tag` (1 straight at it); 0 when there is none yet. */
const towards = (c: Cand, f: Filler, tag: string): number => {
  const t = f.get(tag);
  if (!t) return 0;
  const dx = t.x - c.x, dz = t.z - c.z, d = Math.hypot(dx, dz) || 1;
  return (Math.sin(c.yaw) * dx + Math.cos(c.yaw) * dz) / d;
};

/**
 * A score for the piece the room looks at (an altar, the council's bench): at the far end from the way in, facing it,
 * in the middle, `gap` metres of floor behind it (a piece `d` deep) for whoever stands or sits there.
 */
const atFarEnd = (d: number, gap: number) => (c: Cand, f: Filler): number => towardsStreet(c, f) * 2 + f.streetDist(c.x, c.z) + centred(c) * 0.5 - Math.abs(f.behind(c, d) - gap) * 3;

/**
 * A score for a piece turned to the piece tagged `tag` (`cos` > 0: facing it at least that squarely; < 0: its back to
 * it), the nearer the better by `near` a metre: pews to the altar, desks to the board, the teacher's desk before it.
 */
const aimed = (tag: string, cos: number, near: number) => (c: Cand, f: Filler): number => {
  const t = f.get(tag), d = t ? Math.hypot(c.x - t.x, c.z - t.z) : 0, a = towards(c, f, tag);
  return (cos > 0 ? a > cos : a < cos) ? 3 - d * near : -10 - d * near;
};

/** Does a candidate face the way in from the street (1 straight at it, -1 its back to it)? */
const towardsStreet = (c: Cand, f: Filler): number => {
  const d = f.streetDist(c.x, c.z), e = 0.5;
  return d < 1e-6 ? 0 : (f.streetDist(c.x - Math.sin(c.yaw) * e, c.z - Math.cos(c.yaw) * e) - d) / e;
};
/** How far the altar stands from the street door (the pews go between). */
const altarFromDoor = (f: Filler): number => { const a = f.get('altar'); return a ? f.streetDist(a.x, a.z) : Infinity; };

/**
 * The council chamber: the mayor's bench at the far end from the door, facing the room, and the councillors' desks
 * in rows facing it (each with its chair on the side away from the bench); chairs for the public along the walls.
 */
function chamber(A: Area, r: Rng): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD);
  const chair = (dv: number, dyaw: number, use: 'work' | 'sit', need: boolean): Kid => ({ kind: 'chair', du: 0, dv, dyaw, w: 0.5, d: 0.5, h: 1.0, color: [0.5, 0.1, 0.12], use, need });
  return [
    {
      kind: 'desk', at: 'free', widths: [3.6, 3.0, 2.4], w: 3.6, d: 0.8, h: 0.8, color: wood, tag: 'bench', front: 1.6,
      // The mayor in the middle, a clerk either side (behind it, facing the room).
      kids: [chair(-0.75, 0, 'work', true), { ...chair(-0.75, 0, 'sit', false), du: -1.0 }, { ...chair(-0.75, 0, 'sit', false), du: 1.0 }],
      score: atFarEnd(0.8, 1.3),
    },
    ...many(Math.min(area / 5, 15), {
      kind: 'desk', at: 'free', w: 1.2, d: 0.6, h: 0.76, color: wood,
      kids: [chair(0.7, Math.PI, 'sit', true)],
      // Its back to the bench: the councillor behind it looks at the bench.
      score: aimed('bench', -0.9, 0.05), min: -5,
    }),
    ...waiting(r, Math.min(8, area / 10)),
    wallPicture(r.pick(FABRIC), 1.4, 0.9),
    pottedPlant(1.4, 0.55, LEAF), pottedPlant(1.4, 0.55, LEAF),
  ];
}

/**
 * A church's nave: the altar at the far end from the door, the lectern beside it, pews in rows facing the altar (as
 * many as the congregation, as far as the floor allows), a few candle stands along the walls.
 */
function nave(A: Area, r: Rng, need: Need): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD), cloth: C3 = r.pick([[0.95, 0.94, 0.9], [0.55, 0.1, 0.12], [0.2, 0.3, 0.55]]);
  const pews = Math.min(area / 3.2, Math.max(8, (need.seats || 80) / 4));
  return [
    // Free of the end wall: the priest stands behind it.
    { kind: 'altar', at: 'free', w: 2.2, d: 0.9, h: 1.0, color: cloth, use: 'serve', front: 2.2, back: 0.9, tag: 'altar', score: atFarEnd(0.9, 1.2) },
    { kind: 'reception', at: 'free', w: 0.7, d: 0.5, h: 1.15, color: wood, front: 0.6, score: (c, f) => towards(c, f, 'altar') < -0.2 ? 0 : -10, min: -5 },
    ...many(pews, {
      kind: 'pew', at: 'free', widths: [3.6, 3.0, 2.4], w: 3.6, d: 0.55, h: 0.9, color: wood, use: 'sit', front: 0.45,
      score: (c, f) => aimed('altar', 0.97, 0.05)(c, f) - (f.streetDist(c.x, c.z) > altarFromDoor(f) ? 20 : 0),
      min: 0,
    }),
    ...many(Math.min(4, area / 40), { kind: 'floorLamp', at: 'wall', w: 0.35, d: 0.35, h: 1.4, color: [0.85, 0.7, 0.35], score: plainWall }),
    pottedPlant(1.2, 0.6, LEAF), pottedPlant(1.2, 0.6, LEAF),
  ];
}

/** A classroom: the board and the teacher's desk at one end, desks for two in rows facing them, shelves at the back (`small`: a playroom's low tables round the room). */
function classroom(A: Area, r: Rng, small: boolean): Item[] {
  const area = roomArea(A), wood = r.pick(WOOD), paint: C3 = r.pick(FABRIC);
  if (small) {
    return [
      { kind: 'rug', at: 'free', w: 3.0, d: 2.2, h: 0.01, color: r.pick(FABRIC), flat: true, score: (c, f) => Math.min(f.doorDist(c.x, c.z), 4) },
      ...many(Math.min(5, area / 9), cafeSet(r)),
      ...many(Math.min(5, area / 8), { kind: 'shelf', at: 'wall', w: 1.2, d: 0.4, h: 1.0, color: paint, front: 0.6, tall: false, score: plainWall }),
      { kind: 'chair', at: 'wall', w: 0.5, d: 0.5, h: 0.9, color: wood, use: 'work', score: (c, f) => Math.min(f.doorDist(c.x, c.z), 3) },
      pottedPlant(1.0, 0.5, LEAF),
    ];
  }
  const pupil: Item = {
    kind: 'desk', at: 'free', w: 1.2, d: 0.55, h: 0.7, color: wood,
    kids: [-0.3, 0.3].map((du, i): Kid => ({ kind: 'chair', du, dv: -0.55, w: 0.42, d: 0.42, h: 0.8, color: paint, use: 'sit', need: i === 0 })),
    score: aimed('board', 0.95, 0.05),
    min: 0,
  };
  return [
    { kind: 'screen', at: 'wall', hung: true, w: 2.6, d: 0.06, h: 1.1, color: [0.12, 0.2, 0.16], tag: 'board', score: (c, f) => plainWall(c) * 2 + centred(c) * 0.3 + Math.min(f.doorDist(c.x, c.z), 3) * 0.2 },
    {
      kind: 'desk', at: 'free', w: 1.4, d: 0.7, h: 0.74, color: wood, kids: [seat(-0.7, 0)],
      score: aimed('board', -0.9, 1), min: -8,
    },
    ...many(Math.min(14, area / 3.6), pupil),
    ...many(Math.min(3, area / 20), { kind: 'bookshelf', at: 'wall', w: 1.4, d: 0.4, h: 1.8, color: wood, front: 0.7, score: plainWall }),
    { kind: 'coatRack', at: 'wall', w: 1.2, d: 0.3, h: 1.6, color: METAL, score: (c, f) => -Math.abs(f.doorDist(c.x, c.z) - 1.2) },
  ];
}

/** A doctor's consulting room: the desk and chair, a chair for the patient, the couch. */
function consulting(r: Rng): Item[] {
  return [
    {
      kind: 'desk', at: 'wall', w: 1.4, d: 0.7, h: 0.74, color: r.pick(WOOD),
      kids: [{ kind: 'monitor', du: 0.3, dv: -0.1, w: 0.5, d: 0.05, h: 0.35, color: SCREEN, onTop: true }, seat(0.75, Math.PI), { kind: 'chair', du: -0.9, dv: 0.6, dyaw: -Math.PI / 2, w: 0.5, d: 0.5, h: 0.9, color: r.pick(FABRIC), use: 'sit' }],
      score: (c) => (c.edge?.kind === 'window' ? 1 : 0) + centred(c) * 0.1,
    },
    { kind: 'bunk', at: 'wall', w: 0.75, d: 1.9, h: 0.75, color: [0.85, 0.88, 0.9], front: 0.8, score: plainWall },
    { kind: 'washBasin', at: 'wall', w: 0.6, d: 0.45, h: 0.9, color: WHITE_WARE, front: 0.6, score: plainWall },
    { kind: 'shelf', at: 'wall', w: 0.9, d: 0.4, h: 1.8, color: [0.9, 0.9, 0.9], front: 0.6, score: plainWall },
  ];
}

/** A waiting room: the reception desk facing the way in, chairs round the walls, a low table, plants. */
function waitingRoom(A: Area, r: Rng): Item[] {
  return [
    serveCounter('reception', 2.0, [0.9, 0.9, 0.88], true, 0.8),
    ...waiting(r, Math.min(12, roomArea(A) / 3)),
    { kind: 'coffeeTable', at: 'free', sym: true, w: 1.0, d: 0.6, h: 0.42, color: WOOD[2], score: (c, f) => Math.min(f.doorDist(c.x, c.z), 3) * 0.2 },
    pottedPlant(1.4, 0.55, LEAF), wallPicture(r.pick(FABRIC), 1.0, 0.7),
  ];
}

/** A station's ticket hall: the ticket counter, benches to wait on, a timetable board. */
function ticketHall(A: Area, r: Rng, need: Need): Item[] {
  const wood = r.pick(WOOD);
  return [
    ...many(Math.max(1, Math.min(2, need.staff)), serveCounter('counter', 1.8, wood, true, 0.7)),
    ...many(Math.min(6, roomArea(A) / 10), { kind: 'pew', at: 'wall', widths: [2.4, 1.8], w: 2.4, d: 0.5, h: 0.9, color: wood, use: 'sit', front: 0.6, score: plainWall }),
    { kind: 'screen', at: 'wall', hung: true, w: 1.8, d: 0.06, h: 1.0, color: SCREEN, score: (c, f) => plainWall(c) + Math.min(f.doorDist(c.x, c.z), 4) * 0.2 },
    pottedPlant(1.4, 0.55, LEAF),
  ];
}

/** A care home's day room: armchairs and sofas round the walls, tables for cards and meals, the TV. */
function dayRoom(A: Area, r: Rng): Item[] {
  const fab = r.pick(FABRIC), area = roomArea(A);
  return [
    { kind: 'tvStand', at: 'wall', w: 1.4, d: 0.45, h: 0.5, color: WOOD[2], kids: [{ kind: 'tv', du: 0, dv: 0, w: 1.2, d: 0.08, h: 0.7, color: SCREEN, onTop: true }], score: plainWall },
    ...many(Math.min(8, area / 6), { kind: 'armchair', at: 'wall', w: 0.85, d: 0.85, h: 0.95, color: fab, use: 'sit', score: plainWall }),
    ...many(Math.min(4, area / 14), tableFor4(r, WOOD[1])),
    pottedPlant(1.4, 0.6, LEAF), pottedPlant(1.2, 0.6, LEAF), wallPicture(r.pick(FABRIC), 1.0, 0.7),
  ];
}

/** A resident's room in a care home: a bed, a wardrobe, an armchair by the window. */
function careRoom(r: Rng): Item[] {
  return [
    { kind: 'bed', at: 'wall', w: 1.0, d: 2.05, h: 0.6, color: r.pick(FABRIC), use: 'sleep', front: 0.8, score: (c, f) => plainWall(c) + Math.min(f.doorDist(c.x, c.z), 3) * 0.3 },
    { kind: 'nightstand', at: 'wall', w: 0.45, d: 0.4, h: 0.55, color: WOOD[1], score: (c, f) => -f.cornerGap(c) },
    { kind: 'wardrobe', at: 'wall', w: 1.0, d: 0.6, h: 2.0, color: WOOD[1], front: 0.7, score: plainWall },
    { kind: 'armchair', at: 'wall', w: 0.8, d: 0.8, h: 0.95, color: r.pick(FABRIC), use: 'sit', score: (c) => (c.edge?.kind === 'window' ? 2 : 0) },
  ];
}

/** A fire station's engine hall: the engines nose to the doors, lockers and racks along the walls. */
function engineHall(A: Area, r: Rng): Item[] {
  const along = alongRoom(A), red: C3 = r.chance(0.8) ? [0.75, 0.1, 0.08] : [0.9, 0.85, 0.2];
  return [
    ...many(Math.max(1, Math.min(3, roomArea(A) / 45)), { kind: 'car', at: 'free', w: 2.5, d: 7.5, h: 3.0, color: red, front: 1.2, score: (c, f) => (along(c) ? 0 : 1) - Math.abs(f.doorDist(c.x, c.z) - 5) * 0.2 }),
    ...many(Math.min(8, roomArea(A) / 20), { kind: 'shelf', at: 'wall', w: 1.0, d: 0.5, h: 1.9, color: [0.55, 0.57, 0.6], front: 0.8, score: plainWall }),
    { kind: 'palletRack', at: 'wall', w: 2.4, d: 0.8, h: 2.4, color: [0.3, 0.3, 0.32], front: 1.0, score: plainWall },
  ];
}

/** A supermarket's floor: the tills by the way in, aisles of shelves, the chiller cabinets along a wall. */
function supermarket(A: Area, r: Rng, need: Need): Item[] {
  const area = roomArea(A), fixture = fixtureColor(r);
  return [
    ...many(Math.max(2, Math.min(5, Math.ceil(need.staff / 2))), serveCounter('counter', 1.8, [0.3, 0.3, 0.32], true, 0.7)),
    ...many(Math.min(10, area / 25), { kind: 'fridge', at: 'wall', w: 1.2, d: 0.8, h: 2.0, color: [0.88, 0.9, 0.92], front: 1.2, score: plainWall }),
    ...many(Math.min(30, area / 9), aisleOf(A, fixture)),
  ];
}
