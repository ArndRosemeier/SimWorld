/**
 * Lit windows as the sim says (src/street/windows.ts): small data textures the facade shader reads. The map
 * finds the building behind a fragment (its slot), the shares texture says what share of that building's home
 * and office windows are lit, the looks texture how kept-up and well-off it is (wear on the walls). The sky sets `WINDOW_LIGHT.gloom` (how much a room needs its lamp in daylight
 * under heavy cloud); at night every room someone is awake in is lit.
 *
 * Both textures have a fixed size from the start, so the shaders compiled at the warm-up keep them; the town's
 * grid is copied in when the sim is ready. Until then, and outside the town's buildings, windows keep the
 * clock's guess (`LIGHT.litFrac`).
 *
 * New in SimWorld.
 */
import { DataTexture, NearestFilter, RedFormat, RGFormat, UnsignedByteType, Vector2 } from 'three/webgpu';
import { dot, float, floor, max, select, texture, uniform, vec2 } from 'three/tsl';
import type { WindowSlots } from '../street/windows';
import { LIGHT } from './tsl/common';

/** Map size in squares (each square `slots.cell` metres; the worker picks the cell to fit). */
export const WINDOW_MAP = 2048;
/** Building slots the shares texture holds (more are dark). */
const SHARE_W = 256, SHARE_H = 16;
export const WINDOW_SLOTS = SHARE_W * SHARE_H;

function dataTex(data: Uint8Array, w: number, h: number, format: typeof RGFormat | typeof RedFormat): DataTexture {
  const t = new DataTexture(data, w, h, format, UnsignedByteType);
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const mapTex = dataTex(new Uint8Array(WINDOW_MAP * WINDOW_MAP * 2), WINDOW_MAP, WINDOW_MAP, RGFormat);
const shareTex = dataTex(new Uint8Array(WINDOW_SLOTS), SHARE_W, SHARE_H, RedFormat);
/** Per slot: upkeep and wealth (0 … 255), src/street/windows.ts `buildingLooksOf`. */
const looksTex = dataTex(new Uint8Array(WINDOW_SLOTS * 2), SHARE_W, SHARE_H, RGFormat);
const uOrigin = uniform(new Vector2(0, 0));
/** 1 / (map size in metres). */
const uInvSize = uniform(1);

export const WINDOW_LIGHT = {
  /** Share of an occupied room lit in daylight (0.15 on a normal day, 1 under storm clouds); set by the sky. */
  gloom: uniform(0.15),
};

/** Copy the town's building grid in (once, when the sim is ready). */
export function setWindowMap(s: WindowSlots): void {
  const data = mapTex.image.data as Uint8Array;
  data.fill(0);
  const w = Math.min(s.w, WINDOW_MAP), h = Math.min(s.h, WINDOW_MAP);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = s.map[j * s.w + i];
    if (v > WINDOW_SLOTS) continue;
    const o = (j * WINDOW_MAP + i) * 2;
    data[o] = v & 255;
    data[o + 1] = v >> 8;
  }
  uOrigin.value.set(s.x0, s.z0);
  uInvSize.value = 1 / (WINDOW_MAP * s.cell);
  mapTex.needsUpdate = true;
}

/** The lit share per slot (src/street/windows.ts `litShares`), with every new view snapshot. */
export function setLitShares(shares: Uint8Array): void {
  (shareTex.image.data as Uint8Array).set(shares.subarray(0, WINDOW_SLOTS));
  shareTex.needsUpdate = true;
}

/** How the town's buildings look today (upkeep, wealth per slot), once a game day from the sim's town face. */
export function setBuildingLooks(looks: Uint8Array): void {
  (looksTex.image.data as Uint8Array).set(looks.subarray(0, WINDOW_SLOTS * 2));
  looksTex.needsUpdate = true;
}

/** TSL: the slot of the building at a world point (-1 for none) and its texel in the per-slot textures. */
function slotAt(xz: ReturnType<typeof vec2>) {
  const m = texture(mapTex, xz.sub(uOrigin).mul(uInvSize));
  // The slot + 1 as two bytes (low, high); 0 is no building.
  const slot = floor(dot(m.rg, vec2(255, 65280)).add(0.5)).sub(1).toVar();
  return { slot, uv: vec2(slot.mod(SHARE_W).add(0.5).div(SHARE_W), floor(slot.div(SHARE_W)).add(0.5).div(SHARE_H)) };
}

/**
 * TSL: the share of a building's people in and awake (0 … 1) at a world point inside it, or -1 outside the town's
 * buildings (or before the sim is ready). Also read by the chimney smoke (src/render/tsl/smoke.ts).
 */
export function buildingAwake(xz: ReturnType<typeof vec2>) {
  const { slot, uv } = slotAt(xz);
  return select(slot.lessThan(0), float(-1), texture(shareTex, uv).r);
}

/**
 * TSL: how the building at a world point looks (upkeep, wealth, 0 … 1), or (-1, -1) outside the town's buildings.
 * Before the sim's first town face both read 0, which `buildingLooksOf` never writes (its least is 1/255):
 * callers treat an upkeep of 0 as unknown.
 */
export function buildingLooks(xz: ReturnType<typeof vec2>) {
  const { slot, uv } = slotAt(xz);
  return select(slot.lessThan(0), vec2(-1, -1), texture(looksTex, uv).rg);
}

/**
 * TSL: whether a home or office window is lit. `xz`: a world point just inside the wall, `pick`: the window's
 * own random number in [0, 1). Outside the town's buildings the clock's `fallback` share decides.
 */
export function windowLit(xz: ReturnType<typeof vec2>, pick: ReturnType<typeof float>, fallback: ReturnType<typeof float>) {
  const awake = buildingAwake(xz).toVar();
  return pick.lessThan(select(awake.lessThan(0), fallback, awake.mul(max(LIGHT.night, WINDOW_LIGHT.gloom))));
}
