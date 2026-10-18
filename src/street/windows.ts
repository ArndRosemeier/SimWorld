/**
 * Lit windows from the sim (plan, "town realism": a visible detail that changes over time is caused by the
 * sim). Which share of a building's home and office windows are lit is how many of its people are in and
 * awake: a house whose family is asleep or out is dark, a block of flats lights up as people come home.
 *
 * `windowSlots` is made once in the sim worker from the town and its place graph: every town building gets a
 * slot, and a grid over the town says which building covers each square metre (the facade shader looks its
 * slot up there, just inside the wall). `litShares` turns each view snapshot into one byte per slot. How dark
 * it is outside (whether a lit room needs its lamp on) is the sky's part, applied in the shader
 * (src/render/windowLight.ts).
 *
 * Pure (no three, no DOM). New in SimWorld.
 */
import { pointInPoly, polyBounds } from '../geom/geom2';
import { eachBuilding } from '../plan/placeGraph';
import { PEOPLE_PER_HOME, type Town } from '../plan/town';
import type { PlaceGraph } from '../sim/places';
import type { SimView } from '../sim/view';
import type { TownLooks } from '../sim/economy';

/** The town's buildings as slots, and the grid that finds a building's slot from a point. */
export interface WindowSlots {
  /** Grid origin (m, world x and z) and its square size (m). */
  x0: number;
  z0: number;
  cell: number;
  /** Grid size in squares. */
  w: number;
  h: number;
  /** Per square (row-major, z rows): the slot of the building covering it plus 1, 0 for none. */
  map: Uint16Array;
  /** Number of slots (town buildings). */
  count: number;
  /** Per place: its building's slot, -1 for a place in no town building. */
  placeSlot: Int32Array;
  /** Per place: how many people it takes for all its windows to be lit (0: not counted). */
  placeFull: Float32Array;
}

/** Awake people per home window: not everyone in the flat has a room lit of their own. */
const HOME_SHARE = 0.6;
/** People at a workplace (an office floor, a workshop) for all its windows to be lit. */
const WORK_FULL = 6;

/** Slots and the grid for the buildings of `town`: 1 m squares, coarser when the town is wider than `maxSquares`. */
export function windowSlots(town: Town, graph: PlaceGraph, maxSquares = 2048): WindowSlots {
  const polys: number[][] = [], codes = new Map<number, number>();
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  eachBuilding(town.cells, (b, code) => {
    codes.set(code, polys.length);
    polys.push(b.poly);
    const [ax, az, bx, bz] = polyBounds(b.poly);
    x0 = Math.min(x0, ax); z0 = Math.min(z0, az); x1 = Math.max(x1, bx); z1 = Math.max(z1, bz);
  });
  if (!polys.length) { x0 = z0 = 0; x1 = z1 = 1; }
  const cell = Math.max(1, Math.ceil(Math.max(x1 - x0, z1 - z0) / (maxSquares - 4)));
  x0 = Math.floor(x0 / cell) * cell - cell; z0 = Math.floor(z0 / cell) * cell - cell;
  const w = Math.ceil((x1 - x0) / cell) + 2, h = Math.ceil((z1 - z0) / cell) + 2;
  const map = new Uint16Array(w * h);
  polys.forEach((p, slot) => {
    const [ax, az, bx, bz] = polyBounds(p);
    const i0 = Math.floor((ax - x0) / cell), i1 = Math.ceil((bx - x0) / cell);
    const j0 = Math.floor((az - z0) / cell), j1 = Math.ceil((bz - z0) / cell);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      if (pointInPoly(p, x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) map[j * w + i] = slot + 1;
    }
  });
  const n = graph.places.length, placeSlot = new Int32Array(n).fill(-1), placeFull = new Float32Array(n);
  graph.places.forEach((pl, i) => {
    const slot = codes.get(pl.building);
    if (slot === undefined) return;
    placeSlot[i] = slot;
    placeFull[i] = pl.homes ? pl.homes * PEOPLE_PER_HOME * HOME_SHARE : WORK_FULL;
  });
  return { x0, z0, cell, w, h, map, count: polys.length, placeSlot, placeFull };
}

/**
 * The lit share of each building's windows (0 … 255 per slot, into `out`, at least `slots.count` long): the
 * people in and awake at each of its places over what it takes to light them all, the brightest place of
 * the building wins. `sleep`: the sleep activity's index (src/sim/actors.ts `A.sleep`).
 */
export function litShares(view: SimView, slots: WindowSlots, sleep: number, out: Uint8Array): void {
  const awake = new Float32Array(slots.placeSlot.length);
  for (let a = 0; a < view.place.length; a++) {
    const p = view.place[a];
    if (p < 0 || p >= awake.length || view.dest[a] >= 0 || view.activity[a] === sleep) continue;
    awake[p]++;
  }
  out.fill(0, 0, slots.count);
  for (let p = 0; p < awake.length; p++) {
    const slot = slots.placeSlot[p];
    if (slot < 0 || !awake[p]) continue;
    const share = Math.round(Math.min(1, awake[p] / slots.placeFull[p]) * 255);
    if (share > out[slot]) out[slot] = share;
  }
}

/**
 * How each building looks (2 bytes per slot into `out`, at least `slots.count * 2` long): the mean upkeep and the
 * mean wealth (0 … 1 as 1 … 255; 0 is left for "not known yet") of its places, from the sim's town face
 * (`TownFace.looks`, once a game day). A building with no places reads as middling.
 */
export function buildingLooksOf(looks: Pick<TownLooks, 'upkeep' | 'wealth'>, slots: WindowSlots, out: Uint8Array): void {
  const n = slots.count, up = new Float32Array(n), rich = new Float32Array(n), count = new Uint16Array(n);
  for (let p = 0; p < slots.placeSlot.length && p < looks.upkeep.length; p++) {
    const slot = slots.placeSlot[p];
    if (slot < 0) continue;
    up[slot] += looks.upkeep[p]; rich[slot] += looks.wealth[p]; count[slot]++;
  }
  const byte = (v: number) => Math.max(1, Math.min(255, Math.round(v * 255)));
  for (let s = 0; s < n; s++) {
    out[s * 2] = byte(count[s] ? up[s] / count[s] : 0.6);
    out[s * 2 + 1] = byte(count[s] ? rich[s] / count[s] : 0.5);
  }
}
