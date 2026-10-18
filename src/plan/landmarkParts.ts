/**
 * Landmark structures as lists of primitive parts (pure data): boxes, cylinders and cones,
 * domes, gable and pyramid roofs, sloped stands, beams, tubes, barrel vaults and flat surfaces,
 * each with a facade material (atlas layer, tint, window grammar).
 *
 * Ported from Scale (src/plan/landmarkParts.ts) with the town hall; the sports ground is new,
 * Scale's stadium, attractions, marvels and airport stay behind.
 *
 * One description serves everything: the mesh (two LODs: parts flagged
 * `detail` are left out far away), collision (`partObstacles`: the solid parts become the
 * walker's boxes and cylinders), the map (`partFootprints`) and the cell planner (ground holes,
 * props kept off the structure). It is a pure function of the landmark (and the terrain under
 * walls that follow the ground), so workers and the main thread agree.
 *
 * Local frame: u = (cos angle, sin angle), v = (-sin, cos), origin at the site centre, the
 * front (entrance, square) towards -v. Heights are absolute (y up); `lm.base` is the floor level.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { Poly } from '../geom/geom2';
import type { Terrain } from '../world/terrain';
import type { Landmark } from './landmarks';
import { church, school, kindergarten, clinic, fireStation, supermarket, station } from './civicParts';
import {
  PK, Kit, mat, type LmPart, type LmInterior, type PartMat, type PartObstacle, type RGB,
  type Opt, WHITE, WIN, CURTAIN, ARCH, ROOF, COPPER, GOLD, BRONZE, PAINT, STONES,
  BRICK, BRICK_BROWN, LIME, SAND, PLASTER, STUCCO, CONC, PANEL, GLASS, METAL, GRANITE,
  TAR, CLAY, SLATE, ZINC, METAL_ROOF, GRAVEL, GREEN_ROOF,
} from './kit';
export * from './kit';

// ---------------------------------------------------------------------- kinds

function townhall(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B;
  const st = lm.style;
  const wallL = st === 0 ? STONES[P.wall % 4] : st === 1 ? [BRICK, SAND, BRICK_BROWN, LIME][P.wall % 4] : st === 2 ? [PLASTER, STUCCO, PLASTER, SAND][P.wall % 4] : [CONC, PANEL, CONC, LIME][P.wall % 4];
  const pastel: RGB = st === 2 ? r.pick<RGB>([[0.96, 0.88, 0.7], [0.92, 0.8, 0.72], [0.95, 0.93, 0.86], [0.85, 0.88, 0.8]]) : WHITE;
  const fh = 4.6, gh = 5.4, H = gh + (P.floors - 1) * fh;
  const flags = WIN | (st === 1 ? ARCH : 0);
  const wall = mat(wallL, pastel, flags, st === 3 ? 2.2 : 3.2, fh, gh);
  const plain = mat(wallL, [pastel[0] * 0.92, pastel[1] * 0.92, pastel[2] * 0.92]);
  const roofM = st === 1 ? mat(r.pick([SLATE, CLAY]), WHITE, ROOF) : st === 2 ? mat(SLATE, WHITE, ROOF) : mat(st === 3 ? GRAVEL : ZINC, WHITE, ROOF);
  const vb = lm.hv - 4 - P.d / 2;
  const hw = P.w / 2, hd = P.d / 2;
  const fv = vb - hd; // front facade line
  // The main block is a shell one can walk into: walls with the doorway in the middle of the
  // front, floors and rooms inside (townhallInterior), solid above the public storeys. The map,
  // the ground and the props still see one solid block (a footprint-only part).
  const sh = townhallShell(k, lm, st === 3 ? gh - 0.3 : gh + fh);
  const foot = k.box(0, vb, hw, hd, B, B + H, plain, { solid: false, map: 1 });
  foot.hidden = true;
  foot.footprint = true;
  if (st === 3) {
    // Modern: a glazed ground floor under a solid slab, the council chamber a drum beside it.
    sh.walls(B, B + gh, mat(GLASS, WHITE, WIN | CURTAIN, 1.6, gh, gh), plain);
    k.box(0, vb + 1.5, hw + 1, hd + 1.5, B + gh, B + H, mat(wallL, WHITE, WIN, 2.0, fh, fh), { top: mat(GRAVEL, WHITE, ROOF) });
  } else {
    sh.walls(B, B + H, wall, roofM);
  }
  if (st === 1) k.gable(0, vb, hw, hd, B + H, B + H + P.d * 0.55, plain, roofM);
  if (st === 2) k.pyramid(0, vb, hw + 0.3, hd + 0.3, B + H, B + H + 5, 0.75, roofM);
  if (st === 0 || st === 3) {
    // Balustrade / parapet.
    k.box(0, vb - hd + 0.3, hw, 0.3, B + H, B + H + 1.1, plain, { detail: true });
    k.box(0, vb + hd - 0.3, hw, 0.3, B + H, B + H + 1.1, plain, { detail: true });
    for (const s of [-1, 1]) k.box(s * (hw - 0.3), vb, 0.3, hd, B + H, B + H + 1.1, plain, { detail: true });
  }
  // Wings reaching forward around the square (a U).
  if (P.wings) {
    const ww = Math.min(12, P.w * 0.2), wv = vb - hd - P.wingD / 2;
    for (const s of [-1, 1]) {
      k.box(s * (hw - ww / 2), wv, ww / 2, P.wingD / 2 + 0.5, B, B + H - fh, wall, { foot: true, top: roofM });
      if (st === 1) k.gable(s * (hw - ww / 2), wv, P.wingD / 2 + 0.5, ww / 2, B + H - fh, B + H - fh + ww * 0.5, plain, roofM, { rot: Math.PI / 2 });
    }
  }
  // Portico (classical): columns, entablature and pediment.
  if (st === 0) {
    const n = r.pick([6, 6, 8]), pw = Math.min(P.w * 0.45, n * 3.6), cv = fv - 3.2;
    const colM = mat(wallL, WHITE);
    for (let i = 0; i < n; i++) k.cyl(-pw / 2 + (i + 0.5) * (pw / n), cv, 0.75, 0.65, B, B + H - 2.2, colM, { seg: 12 });
    k.box(0, cv + 0.6, pw / 2 + 0.8, 2.6, B + H - 2.2, B + H, plain, { solid: false });
    k.gable(0, cv + 0.6, 2.6, pw / 2 + 0.8, B + H, B + H + pw * 0.16, plain, roofM, { rot: Math.PI / 2, detail: false });
  }
  /** Where the entrance steps start (with a gateway tower: in front of the tower). */
  let stepV = fv;
  // Tower: clock tower (belfry, spire or cupola) or a dome on a drum.
  if (P.tower === 2) {
    const dr = Math.min(P.w, P.d) * 0.24;
    k.cyl(0, vb, dr, dr, B + H, B + H + 7, mat(wallL, pastel, WIN | ARCH, 2.4, 7, 7), { solid: false });
    k.dome(0, vb, dr + 0.4, dr + 0.4, B + H + 7, B + H + 7 + dr * 1.15, mat(r.pick([ZINC, SLATE, METAL_ROOF]), r.chance(0.5) ? COPPER : r.chance(0.5) ? GOLD : WHITE, ROOF));
    k.cyl(0, vb, 1.4, 1.4, B + H + 7 + dr * 1.1, B + H + 11 + dr * 1.1, mat(wallL, pastel), { solid: false, detail: true });
    k.dome(0, vb, 1.7, 1.7, B + H + 11 + dr * 1.1, B + H + 13 + dr * 1.1, mat(ZINC, COPPER, ROOF), { detail: true });
  } else if (P.tower === 1) {
    // (Modern: a campanile on the square beside the slab's end.)
    const ts = st === 3 ? 4.5 : r.range(4, 5.2), tv = st === 3 ? fv - 8 : fv + ts * 0.6, tu = st === 3 ? hw - 5 : 0;
    const th = B + Math.max(P.towerH, H + 14);
    const towerM = mat(wallL, pastel, WIN | (st === 1 ? ARCH : 0), ts, 6, gh);
    if (st === 3) k.box(tu, tv, ts, ts, B, th, towerM, { foot: true, top: roofM });
    else {
      // In the middle of the front: its base is the gateway to the door (a passage between two
      // piers); the part inside the block only starts at the roof.
      const f0 = tv - ts, dp = (fv - f0) / 2, dw = sh.doorW / 2;
      for (const s of [-1, 1]) k.box(s * (dw + (ts - dw) / 2), f0 + dp, (ts - dw) / 2, dp, B, B + sh.doorH, towerM, { foot: true });
      k.box(0, f0 + dp, ts, dp, B + sh.doorH, th, towerM, { top: roofM });
      k.box(0, (fv + tv + ts) / 2, ts, (tv + ts - fv) / 2, B + H - 0.05, th, towerM, { top: roofM });
      k.box(0, f0 + dp, dw, dp, B - 0.3, B, mat(GRANITE, [0.85, 0.85, 0.85]), { map: 0, foot: true });
      stepV = f0;
    }
    // Clock faces near the top.
    const cy = th - 4;
    for (const [du, dv, rot] of [[0, -ts - 0.12, 0], [0, ts + 0.12, 0], [-ts - 0.12, 0, Math.PI / 2], [ts + 0.12, 0, Math.PI / 2]] as const) {
      k.box(tu + du, tv + dv, 1.9, 0.12, cy - 1.9, cy + 1.9, mat(PLASTER, [1.15, 1.12, 1.02]), { rot, detail: true, solid: false });
      k.box(tu + du * 1.03, tv + dv * 1.03, 0.12, 0.06, cy - 0.1, cy + 1.5, mat(METAL, [0.1, 0.1, 0.1]), { rot, detail: true, solid: false });
    }
    if (st === 1) k.pyramid(tu, tv, ts + 0.3, ts + 0.3, th, th + ts * 3.2, 0, mat(r.pick([SLATE, ZINC]), r.chance(0.4) ? COPPER : WHITE, ROOF));
    else if (st === 2) {
      k.cyl(tu, tv, ts * 0.8, ts * 0.8, th, th + 4, mat(wallL, pastel, WIN | ARCH, 2, 4, 4), { solid: false });
      k.dome(tu, tv, ts * 0.85, ts * 0.85, th + 4, th + 4 + ts * 1.4, mat(ZINC, r.chance(0.6) ? COPPER : WHITE, ROOF));
      k.cyl(tu, tv, 0.25, 0.05, th + 4 + ts * 1.3, th + 9 + ts * 1.3, mat(METAL, GOLD), { detail: true, solid: false });
    } else k.box(tu, tv, ts + 0.4, ts + 0.4, th, th + 0.8, plain, { solid: false });
  }
  // Entrance steps across the middle (in front of the gateway when the tower stands there),
  // solid and as many as it takes from the square up to the floor (the block may stand on a
  // terrace well above the ground).
  const stepsFoot = entranceSteps(k, stepV, P.w * 0.18 + 1, B, mat(GRANITE, [0.85, 0.85, 0.85]));
  if (st === 3) k.cyl(-hw + 10, fv - 12, 9, 9, B, B + 9, mat(GLASS, WHITE, WIN | CURTAIN, 1.8, 9, 9), { foot: true, top: mat(METAL_ROOF, WHITE, ROOF) });
  // Flagpoles in front.
  const flagC = r.pick(PAINT);
  for (const s of [-1, 0, 1]) {
    const u = s * P.w * 0.22, v = fv - 9;
    k.cyl(u, v, 0.12, 0.08, B - 0.1, B + 12, mat(METAL, [0.85, 0.85, 0.85]), { detail: true, solid: false, seg: 6 });
    k.box(u + 1.3, v, 1.2, 0.03, B + 10.2, B + 11.8, mat(PLASTER, s === 0 ? WHITE : flagC), { detail: true, solid: false });
  }
  const door = townhallInterior(k, lm, sh, flagC, pastel);
  k.exit(door, [[0, sh.iv0 - 0.7, B], [0, stepV, B]], 0, stepsFoot);
}

// ------------------------------------------------------------ town hall: shell and interior

/** A wall opening: centre along the wall, width, bottom and top. */
export interface Opening { a: number; w: number; y0: number; y1: number }

/**
 * A straight wall from a0 to a1 along u (axis 'u', at v = c) or along v (axis 'v', at u = c),
 * thickness th, between y0 and y1, with openings: full-height pieces between them, a sill
 * below and a lintel above each.
 */
/**
 * Solid entrance steps running out from v = stepV (towards -v) down from the floor at B to the
 * ground: 17 cm each, steeper (up to 30 cm) where the ground lies far below, at most 24.
 */
export function entranceSteps(k: Kit, stepV: number, hw: number, B: number, m: PartMat): number {
  const tread = 0.36, drop = (n: number) => B - k.ground(0, stepV - n * tread);
  let n = 3;
  while (n < 24 && drop(n) / n > 0.17) n++;
  const rise = Math.max(0.17, Math.min(0.3, drop(n) / n));
  for (let i = 0; i < n; i++) k.box(0, stepV - tread / 2 - i * tread, hw + i * 0.05, tread / 2, k.F, B - i * rise, m, { solid: true, map: 2 });
  // (Where the steps meet the square.)
  return stepV - n * tread - 0.6;
}

export function wallRun(k: Kit, axis: 'u' | 'v', c: number, a0: number, a1: number, y0: number, y1: number, th: number, m: PartMat, open: Opening[], o: Opt = {}): void {
  // (Lintels over openings stand on the wall beside them: no foundation filling the opening.)
  const lintel: Opt = { ...o, foot: undefined };
  const put = (s0: number, s1: number, b: number, t: number) => {
    if (s1 - s0 < 0.02 || t - b < 0.02) return;
    const mid = (s0 + s1) / 2, h = (s1 - s0) / 2, oo = b > y0 + 0.01 ? lintel : o;
    if (axis === 'u') k.box(mid, c, h, th / 2, b, t, m, oo);
    else k.box(c, mid, th / 2, h, b, t, m, oo);
  };
  // Openings may stack (a door under a rose): each strip between their edges is filled round
  // the ones that cover it, bottom to top.
  const edges = [...new Set([a0, a1, ...open.flatMap((op) => [op.a - op.w / 2, op.a + op.w / 2])])].filter((e) => e >= a0 && e <= a1).sort((p, q) => p - q);
  for (let i = 0; i + 1 < edges.length; i++) {
    const l = edges[i], r = edges[i + 1], m = (l + r) / 2;
    let b = y0;
    const over = open.filter((q) => Math.abs(m - q.a) < q.w / 2).sort((p, q) => p.y0 - q.y0);
    // (A doorway's threshold: the wall's foundation, up to the floor, so there is no pit under it.)
    if (o.foot !== undefined && over.length && over[0].y0 <= y0 + 0.01) put(l, r, y0 - 0.3, y0);
    for (const op of over) {
      put(l, r, b, op.y0);
      b = Math.max(b, op.y1);
    }
    put(l, r, b, y1);
  }
}

/**
 * A straight wall from a to b (local, its centre line) with openings along it (`a` measured from
 * a): wallRun turned to run between any two points.
 */
export function wallAB(k: Kit, a: [number, number], b: [number, number], y0: number, y1: number, th: number, m: PartMat, open: Opening[], o: Opt = {}): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.02) return;
  k.sub(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]), () => wallRun(k, 'u', 0, 0, L, y0, y1, th, m, open, o));
}

interface Shell {
  /** Inner extents (local): u in ±iu, v from iv0 (front) to iv1 (back). */
  iu: number; iv0: number; iv1: number;
  /** Ceiling of the public storeys (above it the block is solid). */
  ceil: number;
  doorW: number; doorH: number;
  /** The outer walls (and the solid block above the ceiling) from y0 to y1. */
  walls(y0: number, y1: number, m: PartMat, top: PartMat): void;
}

function townhallShell(k: Kit, lm: Landmark, ceilH: number): Shell {
  const P = lm.p, B = k.B, t = 0.6;
  const hw = P.w / 2, hd = P.d / 2, vb = lm.hv - 4 - P.d / 2, fv = vb - hd, bv = vb + hd;
  const doorW = 4.4, doorH = 4.4;
  const sh: Shell = {
    iu: hw - t, iv0: fv + t, iv1: bv - t, ceil: B + ceilH, doorW, doorH,
    walls(y0, y1, m, top) {
      const o: Opt = { foot: true, top, map: 0 };
      wallRun(k, 'u', fv + t / 2, -hw, hw, y0, y1, t, m, [{ a: 0, w: doorW, y0, y1: y0 + doorH }], o);
      wallRun(k, 'u', bv - t / 2, -hw, hw, y0, y1, t, m, [], o);
      for (const s of [-1, 1]) wallRun(k, 'v', s * (hw - t / 2), fv + t, bv - t, y0, y1, t, m, [], o);
      // Above the public storeys: solid up to the roof (its underside is the ceiling).
      if (y1 > sh.ceil + 0.05) k.box(0, (sh.iv0 + sh.iv1) / 2, sh.iu - 0.01, (sh.iv1 - sh.iv0) / 2 - 0.01, sh.ceil, y1, mat(PLASTER, [1.02, 1, 0.95]), { top, map: 0 });
    },
  };
  return sh;
}

/** Interior palette per style (0 classical, 1 gothic, 2 baroque, 3 modern). */
function hallPalette(st: number, pastel: RGB) {
  const warm: RGB = st === 2 ? [pastel[0] * 1.05, pastel[1] * 1.05, pastel[2] * 1.05] : st === 1 ? [0.96, 0.9, 0.8] : st === 3 ? [1.02, 1.02, 1.02] : [1.06, 1.0, 0.88];
  return {
    wall: mat(st === 1 ? LIME : st === 3 ? PLASTER : STUCCO, warm),
    stone: mat(st === 1 ? SAND : LIME, [1.12, 1.1, 1.04]),
    floorA: mat(st === 3 ? CONC : st === 1 ? SAND : LIME, st === 3 ? [1.05, 1.05, 1.05] : [1.18, 1.16, 1.1]),
    floorB: mat(st === 1 ? BRICK_BROWN : GRANITE, st === 1 ? [0.8, 0.6, 0.5] : st === 2 ? [0.78, 0.48, 0.45] : [0.42, 0.42, 0.46]),
    wood: mat(PLASTER, st === 3 ? [0.72, 0.55, 0.38] : [0.42, 0.26, 0.15]),
    dark: mat(PLASTER, st === 3 ? [0.2, 0.2, 0.22] : [0.25, 0.14, 0.08]),
    red: mat(PLASTER, st === 3 ? [0.15, 0.3, 0.5] : [0.52, 0.07, 0.08]),
    gold: mat(METAL, GOLD),
    ceil: mat(PLASTER, [1.02, 1, 0.95]),
    // (Daylight through the panes: glass reads black indoors, where the sky reflection is dimmed.)
    glass: mat(PLASTER, [1.2, 1.35, 1.55]),
    leaf: mat(PLASTER, [0.2, 0.42, 0.18]),
    pot: mat(BRICK, [0.8, 0.55, 0.4]),
    screen: mat(PLASTER, [0.25, 0.75, 1.6]),
    cloth: mat(PLASTER, [1.15, 1.13, 1.08]),
  };
}
type Palette = ReturnType<typeof hallPalette>;

export const D: Opt = { detail: true };
export const DS: Opt = { detail: true, solid: true };

/** Furnishes the town hall's inside; returns the nav point inside its door (sim/LandmarkCrowds). */
function townhallInterior(k: Kit, lm: Landmark, sh: Shell, flagC: RGB, pastel: RGB): number {
  const r = new Rng(deriveSeed(lm.seed, 'interior'));
  const st = lm.style, B = k.B;
  const C = hallPalette(st, pastel);
  const { iu, iv0, iv1, ceil } = sh;
  const dw = sh.doorW / 2;
  const grand = st !== 3 && iu >= 12.5 && iv1 - iv0 >= 15;

  // Floor over the whole inside, solid (with a foundation: the ground may fall away under the block).
  k.box(0, (iv0 + iv1) / 2, iu, (iv1 - iv0) / 2, B - 0.3, B, C.floorA, { map: 0, foot: true });
  k.room(-iu, iv0, iu, iv1, B - 0.5, ceil);

  // Lining in front of the outer walls (their inner faces carry the facade's windows), with
  // tall glazed windows on the sides and the back.
  const lin = 0.05;
  wallRun(k, 'u', iv0 + lin / 2, -iu, iu, B, ceil, lin, C.wall, [{ a: 0, w: sh.doorW, y0: B, y1: B + sh.doorH }], D);
  wallRun(k, 'u', iv1 - lin / 2, -iu, iu, B, ceil, lin, C.wall, [], D);
  for (const s of [-1, 1]) wallRun(k, 'v', s * (iu - lin / 2), iv0, iv1, B, ceil, lin, C.wall, [], D);
  const storeys = grand ? [B, B + 5.4] : [B];
  for (const y of storeys) {
    const top = Math.min(ceil, y + 5.4);
    for (let a = -iu + 2.2; a < iu - 1.6; a += 3.2) k.box(a, iv1 - lin - 0.03, 0.6, 0.03, y + 1.0, Math.min(top - 0.6, y + 3.4), C.glass, D);
    for (const s of [-1, 1]) for (let a = iv0 + 2.2; a < iv1 - 1.6; a += 3.2) k.box(s * (iu - lin - 0.03), a, 0.03, 0.6, y + 1.0, Math.min(top - 0.6, y + 3.4), C.glass, D);
  }

  // The doorway: open double doors swung inward, a stone frame and a gilded plaque outside.
  const fv = iv0 - 0.6;
  for (const s of [-1, 1]) {
    k.box(s * (dw - 0.06), iv0 + dw / 2 + 0.05, 0.05, dw / 2, B, B + sh.doorH - 0.05, C.dark, DS);
    k.box(s * (dw + 0.35), fv - 0.18, 0.35, 0.18, B, B + sh.doorH + 0.3, C.stone, D);
    k.cyl(s * (dw + 1.2), fv - 0.3, 0.18, 0.12, B + 2.6, B + 3.2, mat(PLASTER, [1.6, 1.4, 1.0]), { detail: true, seg: 8, solid: false });
  }
  k.box(0, fv - 0.2, dw + 0.8, 0.2, B + sh.doorH, B + sh.doorH + 0.6, C.stone, D);
  k.box(0, fv - 0.42, 1.6, 0.03, B + sh.doorH + 0.75, B + sh.doorH + 1.3, C.gold, D);
  k.flat(0, iv0 + 1.2, dw, 0.9, B + 0.012, C.dark, D);

  const door = k.node(0, iv0 + 1.4, B);
  if (grand) grandHall(k, sh, C, r, flagC, door);
  else compactHall(k, sh, C, r, flagC, door);
  return door;
}

// --------------------------------------------------------------- furniture (local frame)

/** A chair facing +v of its frame (rot turns it), the back towards -v. */
function chair(k: Kit, u: number, v: number, rot: number, y: number, m: PartMat, high = false): void {
  k.sub(u, v, rot, () => {
    k.box(0, 0, 0.24, 0.24, y + 0.42, y + 0.48, m, D);
    k.box(0, -0.22, 0.24, 0.03, y + 0.48, y + (high ? 1.55 : 1.0), m, D);
    for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) k.box(a, b, 0.025, 0.025, y, y + 0.42, m, D);
  });
}

export function bench(k: Kit, u: number, v: number, rot: number, y: number, len: number, m: PartMat): void {
  k.sub(u, v, rot, () => {
    k.box(0, 0, len / 2, 0.22, y + 0.4, y + 0.46, m, D);
    k.box(0, -0.2, len / 2, 0.03, y + 0.46, y + 0.95, m, D);
    for (const s of [-1, 1]) k.box(s * (len / 2 - 0.1), 0, 0.04, 0.2, y, y + 0.4, m, D);
  });
}

function plant(k: Kit, u: number, v: number, y: number, C: Palette, s = 1, leaf = C.leaf): void {
  k.cyl(u, v, 0.3 * s, 0.22 * s, y, y + 0.55 * s, C.pot, { ...D, seg: 10 });
  k.dome(u, v, 0.55 * s, 0.55 * s, y + 0.5 * s, y + 1.5 * s, leaf, { ...D, seg: 10 });
}

/** A chandelier hanging from the ceiling at (u, v); registers a room light under it. */
function chandelier(k: Kit, u: number, v: number, ceil: number, rad: number, C: Palette, floor: number): void {
  const y = ceil - Math.min(2.2, (ceil - floor) * 0.3);
  k.cyl(u, v, 0.03, 0.03, y, ceil, C.gold, { ...D, seg: 6 });
  k.cyl(u, v, rad, rad * 0.8, y - 0.12, y, C.gold, { ...D, seg: 14 });
  const n = Math.max(6, Math.round(rad * 8));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.dome(u + Math.cos(a) * rad * 0.9, v + Math.sin(a) * rad * 0.9, 0.09, 0.09, y, y + 0.22, mat(PLASTER, [2.2, 1.9, 1.4]), { ...D, seg: 6 });
  }
  k.dome(u, v, rad * 0.35, rad * 0.35, y - 0.12, y - 0.7, C.gold, { ...D, seg: 10 });
  k.light(u, v, Math.min(y - 0.5, floor + 4.5));
}

/** A framed portrait on a wall, facing +v of its frame. */
function portrait(k: Kit, u: number, v: number, rot: number, y: number, C: Palette, r: Rng): void {
  const col = r.pick<RGB>([[0.35, 0.25, 0.18], [0.22, 0.25, 0.32], [0.4, 0.3, 0.22], [0.25, 0.3, 0.22]]);
  k.sub(u, v, rot, () => {
    k.box(0, 0, 0.62, 0.04, y, y + 1.5, C.gold, D);
    k.box(0, 0.03, 0.52, 0.03, y + 0.1, y + 1.4, mat(PLASTER, col), D);
  });
}

function flagStand(k: Kit, u: number, v: number, y: number, col: RGB, C: Palette): void {
  k.cyl(u, v, 0.25, 0.25, y, y + 0.06, C.gold, { ...D, seg: 8 });
  k.cyl(u, v, 0.03, 0.03, y, y + 2.6, C.gold, { ...D, seg: 6 });
  k.box(u + 0.5, v, 0.48, 0.02, y + 1.3, y + 2.5, mat(PLASTER, col), D);
}

/** Council chamber: rows of desks on circles round a dais at the back (v1), facing it. */
function chamber(k: Kit, u0: number, u1: number, v0: number, v1: number, y: number, ceil: number, C: Palette, r: Rng, flagC: RGB, entry: number): void {
  const cu = (u0 + u1) / 2, half = (u1 - u0) / 2;
  const dh = Math.min(half - 0.8, 4.5);
  // (Reaching down into the slab: tall enough to be stood on.)
  k.box(cu, v1 - 1.5, dh, 1.4, y - 0.5, y + 0.4, C.dark, { ...DS, top: C.red });
  k.box(cu, v1 - 2.1, Math.min(2.4, dh - 0.4), 0.4, y + 0.4, y + 1.2, C.wood, DS);
  for (const s of [-1, 0, 1]) chair(k, cu + s * 1.1, v1 - 1.2, Math.PI, y + 0.4, C.red, s === 0);
  // Coat of arms between two flags.
  k.box(cu, v1 - 0.09, 0.8, 0.04, y + 2.3, y + 3.5, C.gold, D);
  k.box(cu, v1 - 0.12, 0.6, 0.03, y + 2.45, y + 3.35, mat(PLASTER, flagC), D);
  for (const s of [-1, 1]) flagStand(k, cu + s * Math.min(3.2, dh), v1 - 0.6, y + 0.4, s < 0 ? flagC : WHITE, C);
  const vc = v1 - 2.1;
  k.flat(cu, (v0 + vc) / 2, half - 0.5, Math.max(0.3, (vc - v0) / 2 - 0.3), y + 0.012, C.red, D);
  for (let R = 3.2; vc - R - 1.2 > v0 + 0.6; R += 1.9) {
    const m = Math.max(2, Math.floor((R * 2.4) / 1.75));
    for (let i = 0; i < m; i++) {
      const th = -1.2 + (2.4 * (i + 0.5)) / m;
      const u = cu + R * Math.sin(th), v = vc - R * Math.cos(th);
      if (Math.abs(u - cu) > half - 1) continue;
      // (In the desk's frame +v points at the dais.)
      k.sub(u, v, th, () => {
        k.box(0, 0, 0.72, 0.28, y, y + 0.76, C.wood, { ...DS, top: C.dark });
        k.beam(0.3, 0.1, y + 0.76, 0.3, 0.2, y + 1.1, 0.012, C.dark, D);
        chair(k, 0, -0.62, 0, y, C.red);
        // (Out between the rows, then to the front: the desks are in the way here and there.)
        k.spot(0, -0.6, y, 0, true, 'councillor', entry, [[0, -1.2]]);
      });
    }
  }
  chandelier(k, cu, (v0 + v1) / 2, ceil, Math.min(1.4, half * 0.2), C, y);
  for (const s of [-1, 1]) portrait(k, cu + s * (half - 0.09), (v0 + v1) / 2, s * Math.PI / 2, y + 1.4, C, r);
}

/**
 * The grand layout: a two-storey hall with side galleries and a twin staircase, the service
 * hall behind it, and upstairs the council chamber between the mayor's office and the wedding room.
 */
function grandHall(k: Kit, sh: Shell, C: Palette, r: Rng, flagC: RGB, door: number): void {
  // (Walkable parts are at least ~0.75 m tall: world/Collision only stands on obstacle tops
  // taller than 1.4 × the step height, and walks into lower ones. Slabs are thick, steps and
  // the dais reach down into the floor.)
  const B = k.B, gh = 5.4, L1 = B + gh, slab = 0.8;
  const { iu, iv0, iv1, ceil } = sh;
  const pt = 0.3, vP = iv0 + (iv1 - iv0) * 0.6;
  const gW = Math.min(4.2, Math.max(3, iu * 0.22));
  const uTop = iu - gW;
  const n = Math.round(gh / 0.18), rise = gh / n;
  const tread = Math.min(0.32, (uTop - 2.0) / n);
  const uBot = uTop - n * tread;
  const sw = 2.2, vS = vP - pt / 2 - sw / 2;
  const hallV1 = vP - pt / 2;

  // Hall floor: a chequer of two stones, the emblem in the middle, a runner from the door.
  const tile = 2;
  for (let u = -iu, i = 0; u < iu - 0.01; u += tile, i++)
    for (let v = iv0, j = 0; v < hallV1 - 0.01; v += tile, j++) {
      if (!((i + j) % 2)) continue;
      const hu = Math.min(tile, iu - u) / 2, hv = Math.min(tile, hallV1 - v) / 2;
      k.flat(u + hu, v + hv, hu, hv, B + 0.006, C.floorB, D);
    }
  const ev = (iv0 + vS - sw / 2) / 2;
  k.cyl(0, ev, 2.6, 2.6, B, B + 0.015, C.floorB, { ...D, seg: 24 });
  k.cyl(0, ev, 2.2, 2.2, B, B + 0.02, C.gold, { ...D, seg: 24 });
  k.cyl(0, ev, 1.4, 1.4, B, B + 0.025, mat(PLASTER, flagC), { ...D, seg: 24 });
  if (ev - 2.6 > iv0 + 2.4) k.flat(0, (iv0 + 2.2 + ev - 2.6) / 2, 1.1, (ev - 2.6 - iv0 - 2.2) / 2, B + 0.014, C.red, D);

  for (const s of [-1, 1]) {
    // Gallery along the side wall, carried by columns that run up to the ceiling.
    k.box(s * (iu - gW / 2), (iv0 + hallV1) / 2, gW / 2, (hallV1 - iv0) / 2, L1 - slab, L1, C.ceil, { ...DS, top: C.wood });
    const cu = s * (uTop + 0.35);
    for (let v = iv0 + 2.5; v < vS - sw / 2 - 0.8; v += 4.2) {
      k.cyl(cu, v, 0.42, 0.42, B, ceil, C.stone, { ...DS, seg: 14 });
      k.box(cu, v, 0.55, 0.55, ceil - 0.4, ceil, C.stone, D);
      k.box(cu, v, 0.52, 0.52, B, B + 0.35, C.stone, D);
      plant(k, cu - s * 1.2, v, B, C, 0.9);
    }
    // Balustrade (open where the stairs arrive) and banners in the city's colours under it.
    const b0 = iv0 + 0.2, b1 = vS - sw / 2 - 0.1;
    k.box(s * (uTop + 0.08), (b0 + b1) / 2, 0.07, (b1 - b0) / 2, L1, L1 + 1.0, C.stone, DS);
    k.box(s * (uTop + 0.08), (b0 + b1) / 2, 0.12, (b1 - b0) / 2 + 0.05, L1 + 1.0, L1 + 1.08, C.stone, D);
    for (let v = b0 + 3, i = 0; v < b1 - 2; v += 6, i++) k.box(s * (uTop - 0.02), v, 0.02, 0.7, L1 - 2.8, L1 - slab - 0.1, mat(PLASTER, i % 2 ? WHITE : flagC), D);
    // Benches and portraits under the gallery.
    for (let v = iv0 + 5.1; v < vS - sw / 2 - 2; v += 4.2) {
      bench(k, s * (iu - 0.5), v, s * Math.PI / 2, B, 2.2, C.wood);
      portrait(k, s * (iu - 0.12), v, s * Math.PI / 2, B + 1.8, C, r);
    }
    // The staircase: a flight along the back of the hall, rising outwards to the gallery.
    for (let i = 0; i < n; i++) k.box(s * (uBot + (i + 0.5) * tread), vS, tread / 2, sw / 2, B - 1, B + (i + 1) * rise, C.stone, DS);
    const vr = vS - sw / 2 + 0.06;
    k.beam(s * uBot, vr, B + 1.0, s * uTop, vr, L1 + 1.0, 0.05, C.gold, D);
    for (const [u, y] of [[uBot, B], [uTop, L1]] as const) k.cyl(s * u, vr, 0.09, 0.09, y, y + 1.1, C.gold, { ...D, seg: 8 });
  }
  // Information desk and a bust of the founder.
  const du = -Math.min(uTop - 3, 8);
  k.box(du, iv0 + 5, 2, 0.5, B, B + 0.95, C.wood, { ...DS, top: C.stone });
  // (A plate on its front, not a sign on top: from the hall the clerk behind it is seen.)
  k.box(du, iv0 + 4.47, 0.5, 0.03, B + 0.45, B + 0.85, C.gold, D);
  k.box(-du, iv0 + 5, 0.55, 0.55, B, B + 1.3, C.stone, DS);
  figure(k, -du, iv0 + 5, B + 1.3, 1.1, mat(METAL, BRONZE), false);
  for (const f of [0.3, 0.75]) chandelier(k, 0, iv0 + (hallV1 - iv0) * f, ceil, 1.6, C, B);

  // The wall between the hall and the rooms behind: a door to the service hall below, doors
  // from the galleries into the mayor's office and the wedding room above.
  wallRun(k, 'u', vP, -iu, iu, B, ceil, pt, C.wall, [
    { a: 0, w: 3, y0: B, y1: B + 3.4 },
    { a: -(iu - gW / 2), w: 1.6, y0: L1, y1: L1 + 2.5 },
    { a: iu - gW / 2, w: 1.6, y0: L1, y1: L1 + 2.5 },
  ], DS);
  k.box(0, vP - pt / 2 - 0.05, 1.9, 0.05, B + 3.4, B + 3.9, C.gold, D);

  // Service hall (ground floor behind): counters, waiting benches, a number display.
  const sv0 = vP + pt / 2, sTop = L1 - slab;
  k.box(0, (sv0 + iv1) / 2, iu - 0.01, (iv1 - sv0) / 2, L1 - slab, L1, C.ceil, { top: C.wood, map: 0 });
  const cv = iv1 - 2.4;
  k.box(0, cv, iu - 1.5, 0.35, B, B + 1.1, C.wood, { ...DS, top: C.stone });
  for (let u = -iu + 2.5; u < iu - 2; u += 2.8) {
    k.box(u, cv - 0.05, 0.25, 0.03, B + 1.1, B + 1.45, C.dark, D);
  }
  for (let row = 0, v = sv0 + 1.8; v < cv - 2 && row < 3; v += 1.5, row++)
    for (const s of [-1, 1]) bench(k, s * Math.min(iu * 0.45, 5), v, 0, B, Math.min(iu * 0.6, 5.5), C.wood);
  k.box(0, sv0 + 0.06, 1.3, 0.04, B + 2.4, B + 3.1, C.screen, D);
  for (const f of [-0.5, 0.5]) k.light(f * iu, (sv0 + iv1) / 2, sTop - 0.8);
  plant(k, -iu + 1, sv0 + 1, B, C);
  plant(k, iu - 1, sv0 + 1, B, C);

  // Upstairs: the mayor's office | the council chamber | the wedding room.
  const cw = iu - gW - 1.6;
  for (const s of [-1, 1]) wallRun(k, 'v', s * cw, sv0, iv1, L1, ceil, 0.25, C.wall, [{ a: sv0 + 1.4, w: 1.3, y0: L1, y1: L1 + 2.4 }], DS);
  const cM = k.node(0, sv0 + 0.8, L1);
  chamber(k, -cw + 0.125, cw - 0.125, sv0, iv1, L1, ceil, C, r, flagC, cM);
  {
    // The mayor's office (left): desk, chairs, bookcase, flag, rug, plant.
    const u0 = -iu, u1 = -cw - 0.125, um = (u0 + u1) / 2, vm = (sv0 + iv1) / 2;
    k.flat(um, vm + 0.6, (u1 - u0) / 2 - 0.5, Math.max(0.4, (iv1 - sv0) / 2 - 1.1), L1 + 0.012, C.red, D);
    k.box(um, iv1 - 1.8, 1.0, 0.35, L1, L1 + 0.76, C.wood, { ...DS, top: C.dark });
    chair(k, um, iv1 - 0.85, Math.PI, L1, C.red, true);
    for (const s of [-1, 1]) chair(k, um + s * 0.6, iv1 - 3.0, 0, L1, C.dark);
    const bu = u0 + 0.3, bh = Math.min(1.6, (iv1 - sv0) / 2 - 0.8);
    k.box(bu, vm, 0.25, bh, L1, L1 + 2.3, C.wood, D);
    for (let y = L1 + 0.4; y < L1 + 2.2; y += 0.45)
      for (let v = vm - bh + 0.25; v < vm + bh - 0.2; v += 0.35) k.box(bu + 0.06, v, 0.18, 0.13, y, y + r.range(0.25, 0.36), mat(PLASTER, r.pick<RGB>([[0.5, 0.1, 0.1], [0.15, 0.2, 0.4], [0.2, 0.35, 0.2], [0.55, 0.45, 0.3], [0.2, 0.15, 0.1]])), D);
    flagStand(k, u1 - 0.8, iv1 - 0.6, L1, flagC, C);
    portrait(k, um, iv1 - 0.12, Math.PI, L1 + 1.5, C, r);
    plant(k, u0 + 0.7, iv1 - 0.7, L1, C);
    k.light(um, vm, ceil - 0.8);
  }
  {
    // The wedding room (right): a table with flowers, the couple's chairs, rows for the guests.
    const u0 = cw + 0.125, u1 = iu, um = (u0 + u1) / 2, vm = (sv0 + iv1) / 2;
    k.box(um, iv1 - 1.6, 1.1, 0.45, L1, L1 + 0.78, C.cloth, DS);
    for (const s of [-1, 1]) {
      plant(k, um + s * 0.8, iv1 - 1.6, L1 + 0.78, C, 0.35, mat(PLASTER, s < 0 ? [1.3, 1.1, 1.15] : [1.2, 0.5, 0.6]));
      chair(k, um + s * 0.5, iv1 - 2.75, 0, L1, C.cloth, true);
    }
    for (let v = iv1 - 3.8; v > sv0 + 2.2; v -= 1.0)
      for (const s of [-1, 1]) for (const d of [0.55, 1.15]) chair(k, um + s * d, v, 0, L1, C.wood);
    k.flat(um, vm, 0.35, (iv1 - sv0) / 2 - 0.4, L1 + 0.012, C.red, D);
    k.light(um, vm, ceil - 0.8);
  }
  grandWays(k, sh, door, cM, { L1, gW, uTop, uBot, tread, rise, vS, sw, vP, pt, du, cv, cw });
}

/**
 * Where people walk and stay in the grand town hall (sim/LandmarkCrowds). The hall: in at the
 * door, up the middle, along under the galleries (benches), round the information desk and the
 * founder's bust; up the twin stairs to the galleries (looking down into the hall) and on into
 * the mayor's office and the wedding room, both opening into the council chamber between them.
 * Behind the hall the service hall: waiting benches, a counter with its clerks.
 */
function grandWays(k: Kit, sh: Shell, door: number, cM: number, g: { L1: number; gW: number; uTop: number; uBot: number; tread: number; rise: number; vS: number; sw: number; vP: number; pt: number; du: number; cv: number; cw: number }): void {
  const B = k.B, { iu, iv0, iv1, ceil } = sh, { L1, gW, uTop, uBot, vS, sw, vP, du, cv, cw } = g;
  const sv0 = vP + g.pt / 2, ug = iu - gW / 2, lane = iu - 1.6;
  // The hall's middle line, the desk (a clerk behind it, someone asking) and the bust.
  const c1 = k.node(0, iv0 + 3.4, B), c2 = k.node(0, iv0 + 7, B), cB = k.node(0, vP - 1.0, B);
  k.path(door, c1, c2, cB);
  k.spot(du, iv0 + 5.85, B, Math.PI, false, 'clerk', c2, [[du, iv0 + 7]]);
  k.spot(du + 0.6, iv0 + 3.9, B, 0, false, 'client', c1);
  k.spot(-du, iv0 + 3.75, B, 0, false, 'visitor', c1, [], [-du, iv0 + 5, B + 2.1]);
  k.spot(1.5, (iv0 + vS - sw / 2) / 2 + 1, B, 2.6, false, 'visitor', c2, [], [0, (iv0 + vP) / 2, ceil - 1]);
  k.spot(-1.2, (iv0 + vS - sw / 2) / 2 - 0.5, B, 0.4, false, 'visitor', c2, [], [-uTop, (iv0 + vP) / 2, L1 + 1.5]);
  for (const s of [-1, 1]) {
    // Under the gallery: a lane past the benches (people resting, looking up at the portraits).
    let prev = k.node(s * lane, iv0 + 3.4, B);
    k.path(c1, prev);
    for (let v = iv0 + 5.1; v < vS - sw / 2 - 2; v += 4.2) {
      const n = k.node(s * lane, v, B);
      k.path(prev, n);
      prev = n;
      for (const dv of [-0.5, 0.5]) k.spot(s * (iu - 0.52), v + dv, B, s * Math.PI / 2, true, 'visitor', n, [[s * (iu - 1.2), v + dv]]);
    }
    // The stairs: from the foot by the middle, outwards up the flight to the gallery.
    const f0 = k.node(s * (uBot - 0.6), vS, B), f1 = k.node(s * uBot, vS, B + g.rise * 0.5), f2 = k.node(s * (uTop - g.tread / 2), vS, L1);
    const t = k.node(s * (uTop + 0.7), vS, L1), q = k.node(s * ug, vS, L1);
    k.path(cB, f0, f1, f2, t, q);
    // Along the gallery to its front, looking down into the hall between the columns.
    const gaps: number[] = [];
    for (let v = iv0 + 4.6; v < vS - sw / 2 - 1.2; v += 4.2) gaps.unshift(v);
    let gp = q;
    for (const v of gaps) {
      const n = k.node(s * ug, v, L1);
      k.path(gp, n);
      gp = n;
      k.spot(s * (uTop + 0.75), v, L1, s * Math.PI / 2, false, 'visitor', n, [], [0, v, B + 0.5]);
    }
    // Through the gallery's door into the room behind.
    const gd = k.node(s * ug, vP - 0.7, L1), gi = k.node(s * ug, sv0 + 0.9, L1);
    k.path(q, gd, gi);
    // The door from the room into the chamber.
    const rd = k.node(s * (cw + 0.75), sv0 + 1.4, L1), cd = k.node(s * (cw - 0.75), sv0 + 1.4, L1);
    k.path(gi, rd, cd, cM);
    if (s < 0) {
      // The mayor's office: the mayor at the desk, an aide or a visitor in front of it.
      const um = (-iu - cw - 0.125) / 2, oA = k.node(um, iv1 - 3.8, L1);
      k.path(gi, oA, rd);
      k.spot(um, iv1 - 0.85, L1, Math.PI, true, 'mayor', oA, [[um + 1.45, iv1 - 3.0], [um + 1.45, iv1 - 0.85]]);
      for (const d of [-0.6, 0.6]) k.spot(um + d, iv1 - 3.0, L1, 0, true, 'aide', oA, [[um + d, iv1 - 3.5]]);
    } else {
      // The wedding room: the couple at the table, the registrar behind it, guests in rows.
      const um = (cw + 0.125 + iu) / 2, wE = k.node(um, sv0 + 1.0, L1);
      k.path(gi, wE, rd);
      let prev = wE;
      const rows: number[] = [];
      for (let v = iv1 - 3.8; v > sv0 + 2.2; v -= 1.0) rows.unshift(v);
      for (const v of rows) {
        const n = k.node(um, v - 0.5, L1);
        k.path(prev, n);
        prev = n;
        for (const s2 of [-1, 1]) for (const d of [0.55, 1.15]) k.spot(um + s2 * d, v, L1, 0, true, 'guest', n, [[um + s2 * d, v - 0.5]]);
      }
      const wF = k.node(um, iv1 - 3.2, L1);
      k.path(prev, wF);
      for (const d of [-0.5, 0.5]) k.spot(um + d, iv1 - 2.75, L1, 0, true, 'couple', wF, [[um + d, iv1 - 3.2]]);
      k.spot(um, iv1 - 0.6, L1, Math.PI, false, 'registrar', wF, [[um + 1.55, iv1 - 3.2], [um + 1.55, iv1 - 0.6]]);
    }
  }
  // The service hall: through the door behind the hall, rows of waiting benches facing the counter.
  const sD = k.node(0, sv0 + 0.9, B);
  k.path(cB, sD);
  let prev = sD;
  const bx = Math.min(iu * 0.45, 5), bl = Math.min(iu * 0.6, 5.5);
  for (let row = 0, v = sv0 + 1.8; v < cv - 2 && row < 3; v += 1.5, row++) {
    const n = k.node(0, v + 0.6, B);
    k.path(prev, n);
    prev = n;
    for (const s of [-1, 1]) for (let u = bx - bl / 2 + 0.35; u < bx + bl / 2 - 0.3; u += 0.62) k.spot(s * u, v + 0.03, B, 0, true, 'client', n, [[s * u, v + 0.6]]);
  }
  // The counter: clients in front of it, clerks standing behind it (seated, a 1.1 m counter hid them), in round its ends.
  const front: number[] = [], back: number[] = [];
  const us: number[] = [];
  for (let u = -iu + 2.5; u < iu - 2; u += 2.8) us.push(u);
  const fe = [k.node(-(iu - 0.75), cv - 1.2, B)], be = [k.node(-(iu - 0.75), cv + 1.75, B)];
  for (const u of us) {
    const f = k.node(u, cv - 1.2, B), b = k.node(u, cv + 1.75, B);
    front.push(f); back.push(b);
    k.spot(u, cv - 0.75, B, 0, false, 'client', f);
    k.spot(u, cv + 0.75, B, Math.PI, false, 'clerk', b);
  }
  fe.push(k.node(iu - 0.75, cv - 1.2, B));
  be.push(k.node(iu - 0.75, cv + 1.75, B));
  k.path(fe[0], ...front, fe[1]);
  k.path(be[0], ...back, be[1]);
  k.path(fe[0], be[0]);
  k.path(fe[1], be[1]);
  // (The middle line meets the counter's lane at the slot nearest the middle.)
  let mid = 0;
  for (let i = 1; i < us.length; i++) if (Math.abs(us[i]) < Math.abs(us[mid])) mid = i;
  if (front.length) k.path(prev, front[mid]);
}

/** The compact layout (smaller and modern town halls): the hall in front, the council chamber behind it, one storey. */
function compactHall(k: Kit, sh: Shell, C: Palette, r: Rng, flagC: RGB, door: number): void {
  const B = k.B;
  const { iu, iv0, iv1, ceil } = sh;
  const pt = 0.25, vP = iv0 + (iv1 - iv0) * 0.5;
  wallRun(k, 'u', vP, -iu, iu, B, ceil, pt, C.wall, [{ a: 0, w: 2.4, y0: B, y1: B + 3 }], DS);
  k.box(0, vP - pt / 2 - 0.05, 1.5, 0.05, B + 3, B + 3.4, C.gold, D);
  // Hall: the emblem, an information desk, benches, plants, a chandelier.
  const ev = (iv0 + vP) / 2, er = Math.min(2.2, (vP - iv0) * 0.3);
  k.cyl(0, ev, er, er, B, B + 0.02, C.gold, { ...D, seg: 24 });
  k.cyl(0, ev, er * 0.65, er * 0.65, B, B + 0.025, mat(PLASTER, flagC), { ...D, seg: 24 });
  const du = -Math.min(iu - 2, 5);
  // (Low enough to see the clerk standing behind it.)
  k.box(du, ev, 1.4, 0.45, B, B + 0.95, C.wood, { ...DS, top: C.stone });
  for (const s of [-1, 1]) {
    bench(k, s * (iu - 0.5), ev, s * Math.PI / 2, B, Math.max(1.2, Math.min(2.4, vP - iv0 - 2)), C.wood);
    plant(k, s * (iu - 0.8), iv0 + 0.9, B, C);
    portrait(k, s * (iu - 0.12), ev, s * Math.PI / 2, B + 1.8, C, r);
  }
  chandelier(k, 0, ev, ceil, 1.2, C, B);
  const cM = k.node(0, vP + pt / 2 + 0.9, B);
  chamber(k, -iu, iu, vP + pt / 2, iv1, B, ceil, C, r, flagC, cM);

  // Where people walk and stay (sim/LandmarkCrowds): in at the door, across the hall, through
  // into the chamber; the clerk at the desk, someone asking there, people waiting on the benches.
  const hC = k.node(0, ev, B), hB = k.node(0, vP - 0.9, B);
  k.path(door, hC, hB, cM);
  for (const s of [-1, 1]) {
    const cs = k.node(s * (iu - 1.2), vP + pt / 2 + 0.9, B);
    k.path(cM, cs);
  }
  k.spot(du, ev + 0.8, B, Math.PI, false, 'clerk', hC, [[du, ev + 1.6]]);
  k.spot(du, ev - 0.95, B, 0, false, 'client', hC);
  const bl = Math.max(1.2, Math.min(2.4, vP - iv0 - 2));
  // (The right bench: the desk stands in front of the left one.)
  for (const dv of bl > 1.6 ? [-0.45, 0.45] : [0]) k.spot(iu - 0.52, ev + dv, B, Math.PI / 2, true, 'visitor', hC, [[iu - 1.2, ev + dv]]);
  k.spot(1.6, ev - er - 0.6, B, -0.3, false, 'visitor', hC, [], [0, ev, ceil - 0.8]);
  k.spot(-0.9, iv0 + 2.4, B, 0.2, false, 'visitor', door, [], [0, vP, B + 3.2]);
}

/** Point on a superellipse |x/a|^n + |z/b|^n = 1 at angle t. */
export function superE(a: number, b: number, n: number, t: number): [number, number] {
  const c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)];
}

/**
 * The sports ground (plan/landmarks 'sports'): a grass pitch with its markings and goals, a
 * running track round it now and then, a clubhouse (changing rooms, a small bar) and a short
 * covered stand on the front touchline, floodlight masts at the corners. Site frame: the pitch
 * lies along u, the clubhouse and the stand on the -v (street) side; a car park at -u (the
 * site's paved zone, plan/landmarks siteZones).
 */
function sportsGround(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B, gy = B + 0.02;
  const pa = P.pa, pb = P.pb, run = P.run;
  // The pitch (and its run-off) at the +v side, clear of the car park.
  const uC = P.park ? 16 : 0, vC = lm.hv - (pb + run) - 2;
  const grass = (t: number): PartMat => mat(GREEN_ROOF, [0.5 * t, 0.85 * t, 0.42 * t]);
  k.flat(uC, vC, pa + run, pb + run, gy, grass(0.86), { foot: true, map: 3 });
  const stripes = 10, sw = pa / (stripes / 2);
  for (let s = 0; s < stripes; s++) k.flat(uC - pa + (s + 0.5) * sw, vC, sw / 2, pb, gy + 0.015, grass(s % 2 ? 0.92 : 1.04), { detail: true });
  // Markings, scaled from the full-size pitch (105 × 68 m) to this one.
  const line = mat(PLASTER, [1.3, 1.3, 1.3]);
  const fu = pa / 52.5, fv = pb / 34;
  const L = (u0: number, v0: number, u1: number, v1: number) => k.flat(uC + ((u0 + u1) / 2) * fu, vC + ((v0 + v1) / 2) * fv, Math.max(0.06, (Math.abs(u1 - u0) / 2) * fu), Math.max(0.06, (Math.abs(v1 - v0) / 2) * fv), gy + 0.03, line, { detail: true });
  L(-52.5, -34, 52.5, -34); L(-52.5, 34, 52.5, 34); L(-52.5, -34, -52.5, 34); L(52.5, -34, 52.5, 34); L(0, -34, 0, 34);
  for (const s of [-1, 1]) { L(s * 52.5, -20, s * 36, -20); L(s * 52.5, 20, s * 36, 20); L(s * 36, -20, s * 36, 20); }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.flat(uC + Math.cos(a) * 9.15 * fu, vC + Math.sin(a) * 9.15 * fv, 1.2, 0.06, gy + 0.03, line, { rot: a + Math.PI / 2, detail: true });
  }
  const post = mat(PLASTER, [1.2, 1.2, 1.2]);
  for (const s of [-1, 1]) {
    const gu = uC + s * (pa + 0.1);
    k.box(gu, vC - 3.66, 0.06, 0.06, gy, gy + 2.44, post, { detail: true });
    k.box(gu, vC + 3.66, 0.06, 0.06, gy, gy + 2.44, post, { detail: true });
    k.box(gu, vC, 0.06, 3.72, gy + 2.38, gy + 2.5, post, { detail: true });
  }
  // The running track: a rounded ring between the pitch and the run-off's edge.
  if (P.track) {
    const tr = mat(TAR, [0.78, 0.36, 0.26]), N = 40, y = gy + 0.025;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      const [a0, b0] = superE(pa + run - 0.5, pb + run - 0.5, 4, t0), [a1, b1] = superE(pa + run - 0.5, pb + run - 0.5, 4, t1);
      const [c0, d0] = superE(pa + 1.5, pb + 1.5, 4, t0), [c1, d1] = superE(pa + 1.5, pb + 1.5, 4, t1);
      const q = [...k.W(uC + a0, vC + b0), ...k.W(uC + a1, vC + b1), ...k.W(uC + c1, vC + d1), ...k.W(uC + c0, vC + d0)];
      k.quad([q[0], y, q[1], q[2], y, q[3], q[4], y, q[5], q[6], y, q[7]], tr, { map: 4 });
    }
  }
  // Clubhouse: one storey under a gable roof, on the street side of the pitch, left of the middle.
  const wallL = [BRICK, PLASTER, CONC][P.wall % 3];
  const wall = mat(wallL, wallL === PLASTER ? r.pick<RGB>([[1, 0.97, 0.9], [0.95, 0.92, 0.86], [0.9, 0.93, 0.95]]) : WHITE, WIN, 3, 3.4, 3.4);
  const roof = mat(r.pick([CLAY, SLATE, METAL_ROOF]), WHITE, ROOF);
  const cu = uC - pa * 0.45, cv = -lm.hv + 5 + P.clubD / 2, ch = 3.6;
  k.box(cu, cv, P.club / 2, P.clubD / 2, B, B + ch, wall, { foot: true });
  k.gable(cu, cv, P.club / 2 + 0.4, P.clubD / 2 + 0.5, B + ch, B + ch + P.clubD * 0.32, wall, roof);
  // A covered veranda towards the pitch.
  k.box(cu, cv + P.clubD / 2 + 1.5, P.club / 2 - 1, 1.5, B + ch - 0.4, B + ch - 0.2, mat(PANEL, [0.85, 0.85, 0.85]), { solid: false });
  for (const s of [-1, 1]) k.cyl(cu + s * (P.club / 2 - 1.5), cv + P.clubD / 2 + 2.8, 0.12, 0.12, B, B + ch - 0.4, mat(METAL, [0.7, 0.7, 0.72]), { detail: true, solid: false, seg: 6 });
  // The stand: a few rows along the front touchline, right of the middle, under a light canopy.
  const su = uC + pa * 0.35, rows = 5, sd = 4.5, sv0 = vC - pb - run - 0.5;
  const seat = mat(PANEL, PAINT[P.seats % PAINT.length]);
  k.ramp(su, sv0 - sd / 2, P.stand / 2, P.stand / 2, sd / 2, B, B + 0.5, B + 2.6, rows, mat(CONC, [0.8, 0.8, 0.8]), { top: seat, foot: true, rot: Math.PI });
  const canopy = mat(METAL_ROOF, [0.85, 0.86, 0.88]);
  k.box(su, sv0 - sd / 2, P.stand / 2 + 0.5, sd / 2 + 0.6, B + 5.2, B + 5.4, canopy, { solid: false });
  for (const s of [-1, 0, 1]) k.cyl(su + s * (P.stand / 2), sv0 - sd + 0.3, 0.15, 0.15, B, B + 5.2, mat(METAL, [0.7, 0.7, 0.72]), { detail: true, solid: false, seg: 6 });
  // Floodlight masts at the corners of the run-off.
  if (P.lights) {
    for (const [s, t] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const mu = uC + s * (pa + run - 1), mv = vC + t * (pb + run - 1), mh = 18;
      k.cyl(mu, mv, 0.35, 0.22, B, B + mh, mat(METAL, [0.75, 0.76, 0.78]), { seg: 8 });
      k.box(mu, mv, 1.4, 0.35, B + mh, B + mh + 1.6, mat(GLASS, [1.3, 1.3, 1.25], WIN | CURTAIN, 1.1, 1.4, 1.4), { rot: Math.atan2(vC - mv, uC - mu) + Math.PI / 2, solid: false });
    }
  }
}

/** A stylised standing figure (robe, torso, head, a raised arm with a torch or wreath) of height h. */
function figure(k: Kit, u: number, v: number, y: number, h: number, m: PartMat, torch: boolean): void {
  k.cyl(u, v, h * 0.17, h * 0.1, y, y + h * 0.55, m, { seg: 12 });
  k.cyl(u, v, h * 0.1, h * 0.09, y + h * 0.55, y + h * 0.8, m, { seg: 10, solid: false });
  k.dome(u, v, h * 0.075, h * 0.075, y + h * 0.8, y + h * 0.92, m, { seg: 10 });
  k.dome(u, v, h * 0.075, h * 0.075, y + h * 0.82, y + h * 0.8, m, { seg: 10 });
  k.beam(u + h * 0.08, v, y + h * 0.75, u + h * 0.15, v, y + h * 1.02, h * 0.035, m);
  if (torch) {
    k.cyl(u + h * 0.16, v, h * 0.03, h * 0.05, y + h * 1.0, y + h * 1.08, m, { detail: true, solid: false, seg: 8 });
    k.dome(u + h * 0.16, v, h * 0.05, h * 0.05, y + h * 1.08, y + h * 1.16, mat(METAL, GOLD), { detail: true, seg: 8 });
  }
}

// ------------------------------------------------------------------------ API

const cache = new WeakMap<Landmark, LmPart[]>();

/** The parts of a landmark (cached per landmark object). */
export function landmarkParts(lm: Landmark, terrain: Terrain): LmPart[] {
  let parts = cache.get(lm);
  if (parts) return parts;
  const k = new Kit(lm, terrain);
  const r = new Rng(lm.seed);
  switch (lm.kind) {
    case 'townhall': townhall(k, lm, r); break;
    case 'sports': sportsGround(k, lm, r); break;
    case 'church': church(k, lm, r); break;
    case 'school': school(k, lm, r); break;
    case 'kindergarten': kindergarten(k, lm, r); break;
    case 'clinic': clinic(k, lm, r); break;
    case 'fire': fireStation(k, lm); break;
    case 'supermarket': supermarket(k, lm); break;
    case 'station': station(k, lm); break;
  }
  parts = k.parts;
  cache.set(lm, parts);
  if (k.inside.rooms.length) insideCache.set(lm, k.inside);
  return parts;
}

const insideCache = new WeakMap<Landmark, LmInterior>();

/** The landmark's walkable inside (the town hall), or null. */
export function landmarkInterior(lm: Landmark, terrain: Terrain): LmInterior | null {
  landmarkParts(lm, terrain);
  return insideCache.get(lm) ?? null;
}

/** Collision solids of the parts (boxes and cylinders, with their bottom and top). */
export function partObstacles(parts: LmPart[]): PartObstacle[] {
  const out: PartObstacle[] = [];
  for (const p of parts) {
    if (!p.solid) continue;
    const first = out.length;
    obstaclesOf(p, out);
    if (p.deck) for (let i = first; i < out.length; i++) out[i].deck = true;
  }
  return out;
}

function obstaclesOf(p: LmPart, out: PartObstacle[]): void {
  const y0 = Math.min(p.y0, p.foot ?? p.y0);
    const ux = Math.cos(p.a), uz = Math.sin(p.a);
    switch (p.k) {
      case PK.Cyl: case PK.Dome: {
        const r = p.k === PK.Cyl ? Math.max(p.r ?? 0, p.r2 ?? 0) : Math.max(p.hx, p.hz) * 0.9;
        out.push({ cyl: true, x: p.x, z: p.z, r, hx: r, hz: r, ux, uz, y0, y1: Math.max(p.y0, p.y1) });
        break;
      }
      case PK.Beam: case PK.Strut: {
        const dx = p.bx! - p.x, dz = p.bz! - p.z, L = Math.hypot(dx, dz) || 1;
        out.push({ cyl: false, x: (p.x + p.bx!) / 2, z: (p.z + p.bz!) / 2, r: 0, hx: L / 2, hz: p.w!, ux: dx / L, uz: dz / L, y0: Math.min(p.y0, p.by!) - p.w!, y1: Math.max(p.y0, p.by!) + p.w! });
        break;
      }
      case PK.Quad: case PK.Flat: case PK.Helix: break; // (the helix: world/LandmarkSolids, analytically)
      case PK.Lathe: latheObstacles(p, out); break;
      case PK.Prism: prismObstacles(p, out); break;
      case PK.Perf: perfObstacles(p, out); break;
      default:
        if (p.k === PK.Ramp && (p.rows ?? 0) >= 2 && p.q) { rampRowObstacles(p, y0, out); break; }
        out.push({ cyl: false, x: p.x, z: p.z, r: 0, hx: Math.max(p.hx, p.hx2 ?? 0), hz: p.hz, ux, uz, y0, y1: p.y1, ...(p.pane ? { pane: true } : {}) });
    }
}

/** A stand's seat rows (a ramp on a quadrilateral): one box per row up to its tread, climbable row by row. */
function rampRowObstacles(p: LmPart, y0: number, out: PartObstacle[]): void {
  const q = p.q!, rows = p.rows!, yLo = p.yLo ?? p.y1, dy = (p.y1 - yLo) / rows;
  // Corners: front left, front right, back right, back left.
  const at = (s: number, t: number): [number, number] => {
    const fx = q[0] + (q[2] - q[0]) * s, fz = q[1] + (q[3] - q[1]) * s, kx = q[6] + (q[4] - q[6]) * s, kz = q[7] + (q[5] - q[7]) * s;
    return [fx + (kx - fx) * t, fz + (kz - fz) * t];
  };
  const wF = Math.hypot(q[2] - q[0], q[3] - q[1]) || 1, ux = (q[2] - q[0]) / wF, uz = (q[3] - q[1]) / wF;
  const [fx, fz] = at(0.5, 0), [bx, bz] = at(0.5, 1), dl = Math.hypot(bx - fx, bz - fz);
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows, [cx, cz] = at(0.5, (t0 + t1) / 2);
    const w = Math.max(Math.hypot(at(1, t1)[0] - at(0, t1)[0], at(1, t1)[1] - at(0, t1)[1]), Math.hypot(at(1, t0)[0] - at(0, t0)[0], at(1, t0)[1] - at(0, t0)[1]));
    out.push({ cyl: false, x: cx, z: cz, r: 0, hx: w / 2, hz: dl / rows / 2 + 0.02, ux, uz, y0, y1: yLo + (i + 1) * dy });
  }
}

/** Is a lathe profile closed (a ring)? */
export function latheClosed(P: number[]): boolean {
  const n = P.length;
  return n >= 6 && Math.abs(P[0] - P[n - 2]) < 1e-6 && Math.abs(P[1] - P[n - 1]) < 1e-6;
}

/**
 * A lathe as solids: a ring (closed profile) as boxes around it, anything else as a stack of
 * cylinders (boxes when clearly elliptical), one per profile step, of the step's mean radius.
 */
function latheObstacles(p: LmPart, out: PartObstacle[]): void {
  const P = p.pts!, ux = Math.cos(p.a), uz = Math.sin(p.a), sx = p.hx, sz = p.hz;
  const ell = Math.max(sx, sz) / Math.max(1e-6, Math.min(sx, sz)) > 1.25;
  if (latheClosed(P)) {
    let r0 = Infinity, r1 = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < P.length; i += 2) { r0 = Math.min(r0, P[i]); r1 = Math.max(r1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
    const rm = (r0 + r1) / 2, n = 28;
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      // Tangent of the (possibly elliptical) ring at t, in the part frame, then in the world.
      const lu = c * rm * sx, lv = s * rm * sz, tu = -s * sx, tv = c * sz, tl = Math.hypot(tu, tv);
      const wx = p.x + lu * ux - lv * uz, wz = p.z + lu * uz + lv * ux;
      const dx = (tu * ux - tv * uz) / tl, dz = (tu * uz + tv * ux) / tl;
      const chord = (Math.PI * 2 * rm * Math.max(sx, sz)) / n;
      out.push({ cyl: false, x: wx, z: wz, r: 0, hx: chord / 2 + 0.3, hz: ((r1 - r0) / 2) * Math.min(sx, sz), ux: dx, uz: dz, y0, y1 });
    }
    return;
  }
  for (let i = 0; i + 3 < P.length; i += 2) {
    const ya = Math.min(P[i + 1], P[i + 3]), yb = Math.max(P[i + 1], P[i + 3]);
    const r = (P[i] + P[i + 2]) / 2;
    if (yb - ya < 0.05 || r < 0.4) continue;
    if (ell) out.push({ cyl: false, x: p.x, z: p.z, r: 0, hx: r * sx * 0.85, hz: r * sz * 0.85, ux, uz, y0: ya, y1: yb });
    else out.push({ cyl: true, x: p.x, z: p.z, r: r * Math.min(sx, sz), hx: 0, hz: 0, ux, uz, y0: ya, y1: yb });
  }
}

/** Extent along u of a closed (u, y) outline between heights ya and yb, or null. */
function bandExtent(P: number[], ya: number, yb: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  const n = P.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, au = P[i * 2], ay = P[i * 2 + 1], bu = P[j * 2], by = P[j * 2 + 1];
    if (ay >= ya && ay <= yb) { lo = Math.min(lo, au); hi = Math.max(hi, au); }
    for (const y of [ya, yb]) if ((ay - y) * (by - y) < 0) { const u = au + ((bu - au) * (y - ay)) / (by - ay); lo = Math.min(lo, u); hi = Math.max(hi, u); }
  }
  return hi - lo > 0.05 ? [lo, hi] : null;
}

/** A prism as a stack of boxes, each spanning the outline's width in its height band. */
function prismObstacles(p: LmPart, out: PartObstacle[]): void {
  const P = p.pts!, ux = Math.cos(p.a), uz = Math.sin(p.a);
  const n = Math.max(1, Math.min(24, Math.ceil((p.y1 - p.y0) / 6)));
  for (let b = 0; b < n; b++) {
    const ya = p.y0 + ((p.y1 - p.y0) * b) / n, yb = p.y0 + ((p.y1 - p.y0) * (b + 1)) / n;
    const e = bandExtent(P, ya, yb);
    if (!e) continue;
    const um = (e[0] + e[1]) / 2;
    out.push({ cyl: false, x: p.x + um * ux, z: p.z + um * uz, r: 0, hx: (e[1] - e[0]) / 2, hz: p.hz, ux, uz, y0: ya, y1: yb });
  }
}

/** Share of a hole's radius kept open in the collision (the square inside the circle, a little more). */
const HOLE_OPEN = 0.74;

/** A pierced slab as boxes around its holes (one can fly or walk through them). */
function perfObstacles(p: LmPart, out: PartObstacle[]): void {
  const H = p.pts!, ux = Math.cos(p.a), uz = Math.sin(p.a);
  const y0 = Math.min(p.y0, p.foot ?? p.y0);
  const ys = [y0, p.y1];
  for (let i = 0; i < H.length; i += 3) ys.push(H[i + 1] - H[i + 2] * HOLE_OPEN, H[i + 1] + H[i + 2] * HOLE_OPEN);
  ys.sort((a, b) => a - b);
  for (let k = 0; k + 1 < ys.length; k++) {
    const ya = ys[k], yb = ys[k + 1], ym = (ya + yb) / 2;
    if (yb - ya < 0.05) continue;
    const cut: [number, number][] = [];
    for (let i = 0; i < H.length; i += 3) if (Math.abs(ym - H[i + 1]) < H[i + 2] * HOLE_OPEN) cut.push([H[i] - H[i + 2] * HOLE_OPEN, H[i] + H[i + 2] * HOLE_OPEN]);
    cut.sort((a, b) => a[0] - b[0]);
    let u = -p.hx;
    const put = (a: number, b: number) => { if (b - a > 0.05) out.push({ cyl: false, x: p.x + ((a + b) / 2) * ux, z: p.z + ((a + b) / 2) * uz, r: 0, hx: (b - a) / 2, hz: p.hz, ux, uz, y0: ya, y1: yb }); };
    for (const [a, b] of cut) { put(u, a); u = Math.max(u, b); }
    put(u, p.hx);
  }
}

/** Walkway slab thickness of a helix (the mesh; the solid is a little thicker). */
export const HELIX_SLAB = 0.5;

/** Floor height of a helix at turn angle φ from its start (0 … 2π·|turns|). */
export function helixFloorAt(p: LmPart, phi: number): number {
  const full = Math.abs(p.turns!) * Math.PI * 2;
  return p.y0 + ((p.y1 - p.y0) * phi) / full;
}

/**
 * Floor heights of a helix over the world point (x, z) (one per turn passing over it, lowest
 * first), or none when the point is off the walkway's annulus (grown by m).
 */
export function helixFloorsAt(p: LmPart, x: number, z: number, m = 0, out: number[] = []): number[] {
  out.length = 0;
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d < p.r! - m || d > p.r2! + m) return out;
  const sg = p.turns! < 0 ? -1 : 1, full = Math.abs(p.turns!) * Math.PI * 2, T = Math.PI * 2;
  let phi = (sg * (Math.atan2(dz, dx) - p.a)) % T;
  if (phi < 0) phi += T;
  for (; phi <= full; phi += T) out.push(helixFloorAt(p, phi));
  return out;
}

/** Outline of a part on the ground (CCW), grown by m; null for parts without one. */
export function partOutline(p: LmPart, m = 0): Poly | null {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  const P = (u: number, v: number) => [p.x + u * c - v * s, p.z + u * s + v * c];
  switch (p.k) {
    case PK.Cyl: case PK.Dome: {
      // (A dome may be elliptical: radii hx along u, hz along v.)
      const rx = (p.k === PK.Cyl ? Math.max(p.r ?? 0, p.r2 ?? 0) : p.hx) + m, rz = (p.k === PK.Cyl ? rx - m : p.hz) + m;
      const out: number[] = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; out.push(...P(Math.cos(a) * rx, Math.sin(a) * rz)); }
      return out;
    }
    case PK.Ramp: {
      if (p.q && p.q.length === 8) {
        if (m === 0) return p.q.slice();
        const cx = (p.q[0] + p.q[2] + p.q[4] + p.q[6]) / 4, cz = (p.q[1] + p.q[3] + p.q[5] + p.q[7]) / 4;
        return p.q.map((v, i) => { const c0 = i % 2 ? cz : cx, d = Math.hypot(p.q![i - (i % 2)] - cx, p.q![i - (i % 2) + 1] - cz) || 1; return v + ((v - c0) / d) * m; });
      }
      const a = p.hx + m, b = (p.hx2 ?? p.hx) + m, h = p.hz + m;
      return [...P(-a, -h), ...P(a, -h), ...P(b, h), ...P(-b, h)];
    }
    case PK.Quad: return [p.q![0], p.q![2], p.q![3], p.q![5], p.q![6], p.q![8], p.q![9], p.q![11]];
    case PK.Beam: case PK.Strut: return null;
    case PK.Lathe: case PK.Helix: {
      let rm = 0;
      if (p.k === PK.Helix) rm = p.r2!;
      else for (let i = 0; i < p.pts!.length; i += 2) rm = Math.max(rm, p.pts![i]);
      const sx = p.k === PK.Lathe ? p.hx : 1, sz = p.k === PK.Lathe ? p.hz : 1;
      const out: number[] = [];
      for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; out.push(...P(Math.cos(a) * (rm * sx + m), Math.sin(a) * (rm * sz + m))); }
      return out;
    }
    case PK.Prism: {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.pts!.length; i += 2) { lo = Math.min(lo, p.pts![i]); hi = Math.max(hi, p.pts![i]); }
      return [...P(lo - m, -p.hz - m), ...P(hi + m, -p.hz - m), ...P(hi + m, p.hz + m), ...P(lo - m, p.hz + m)];
    }
    default: return [...P(-p.hx - m, -p.hz - m), ...P(p.hx + m, -p.hz - m), ...P(p.hx + m, p.hz + m), ...P(-p.hx - m, p.hz + m)];
  }
}

/** Ground footprints of the solid parts standing on the site (for the cell planner), grown by m. */
export function solidFootprints(lm: Landmark, parts: LmPart[], m = 0.8): Poly[] {
  const out: Poly[] = [];
  for (const p of parts) {
    if ((!p.solid && !p.footprint) || p.k === PK.Beam || p.k === PK.Strut) continue;
    if (Math.min(p.y0, p.foot ?? p.y0) > lm.base + 2.5) continue; // up in the air
    const o = partOutline(p, m);
    if (o) out.push(o);
  }
  return out;
}

/** Map footprints: [category, outline] for every part with a map category (largest first). */
export function partFootprints(parts: LmPart[]): { cat: number; poly: Poly }[] {
  const out: { cat: number; poly: Poly; area: number }[] = [];
  for (const p of parts) {
    if (!p.map || (p.detail && !p.hidden)) continue;
    const o = partOutline(p);
    if (!o) continue;
    let a = 0;
    for (let i = 0, n = o.length >> 1, j = n - 1; i < n; j = i++) a += o[j * 2] * o[i * 2 + 1] - o[i * 2] * o[j * 2 + 1];
    out.push({ cat: p.map, poly: o, area: Math.abs(a) });
  }
  // Paving under buildings: draw the big flat areas first.
  out.sort((a, b) => (a.cat === 1 ? 1 : 0) - (b.cat === 1 ? 1 : 0) || b.area - a.area);
  return out;
}
