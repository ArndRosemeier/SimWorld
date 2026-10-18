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
import { Rng } from '@futuremagic/core';
import type { Poly } from '../geom/geom2';
import type { Terrain } from '../world/terrain';
import type { Landmark } from './landmarks';
import { church, school, kindergarten, clinic, fireStation, supermarket, station, careHome, petrolStation } from './civicParts';
import {
  PK, Kit, mat, type LmPart, type PartMat, type PartObstacle, type RGB,
  type Opt, WHITE, WIN, CURTAIN, ARCH, ROOF, COPPER, GOLD, PAINT, STONES,
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
  // The main block is the walk-in body (src/interior/landmark.ts: its storeys planned and furnished as the town
  // hall, the door in the middle of the front where the steps and the gateway are); the modern one's is its
  // glazed ground floor under a solid slab, the council chamber a drum beside it.
  const doorW = TOWNHALL_DOOR.w, doorH = 3.4;
  if (st === 3) {
    k.box(0, vb, hw, hd, B, B + gh, mat(GLASS, WHITE, WIN | CURTAIN, 1.6, gh, gh), { foot: true, body: 1 });
    k.box(0, vb + 1.5, hw + 1, hd + 1.5, B + gh, B + H, mat(wallL, WHITE, WIN, 2.0, fh, fh), { top: mat(GRAVEL, WHITE, ROOF) });
  } else {
    k.box(0, vb, hw, hd, B, B + H, wall, { foot: true, top: roofM, body: P.floors });
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
      const f0 = tv - ts, dp = (fv - f0) / 2, dw = GATE_W / 2;
      for (const s of [-1, 1]) k.box(s * (dw + (ts - dw) / 2), f0 + dp, (ts - dw) / 2, dp, B, B + GATE_H, towerM, { foot: true });
      k.box(0, f0 + dp, ts, dp, B + GATE_H, th, towerM, { top: roofM });
      k.box(0, (fv + tv + ts) / 2, ts, (tv + ts - fv) / 2, B + H - 0.05, th, towerM, { top: roofM });
      k.box(0, f0 + dp, dw, dp, B - 0.3, B, mat(GRANITE, [0.85, 0.85, 0.85]), { map: 0, foot: true });
      stepV = f0;
    }
    // Clock faces near the top, one on each side (the signs show the time on them).
    for (const [ou, ov] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) k.clockFace(tu + ou * ts, tv + ov * ts, ou, ov, 1.9, th - 4);
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
  entranceSteps(k, stepV, P.w * 0.18 + 1, B, mat(GRANITE, [0.85, 0.85, 0.85]));
  if (st === 3) k.cyl(-hw + 10, fv - 12, 9, 9, B, B + 9, mat(GLASS, WHITE, WIN | CURTAIN, 1.8, 9, 9), { foot: true, top: mat(METAL_ROOF, WHITE, ROOF) });
  // Flagpoles in front.
  const flagC = r.pick(PAINT);
  for (const s of [-1, 0, 1]) {
    const u = s * P.w * 0.22, v = fv - 9;
    k.cyl(u, v, 0.12, 0.08, B - 0.1, B + 12, mat(METAL, [0.85, 0.85, 0.85]), { detail: true, solid: false, seg: 6 });
    k.box(u + 1.3, v, 1.2, 0.03, B + 10.2, B + 11.8, mat(PLASTER, s === 0 ? WHITE : flagC), { detail: true, solid: false });
  }
  // The doorway on the facade: a dark double door in a stone frame, a gilded plaque over it.
  const dark = mat(PLASTER, st === 3 ? [0.2, 0.2, 0.22] : [0.25, 0.14, 0.08]), stone = mat(st === 1 ? SAND : LIME, [1.12, 1.1, 1.04]);
  k.box(0, fv - 0.03, doorW / 2, 0.03, B, B + doorH, dark, D);
  for (const s of [-1, 1]) k.box(s * (doorW / 2 + 0.3), fv - 0.15, 0.3, 0.15, B, B + doorH + 0.3, stone, D);
  k.box(0, fv - 0.15, doorW / 2 + 0.6, 0.15, B + doorH, B + doorH + 0.5, stone, D);
  k.box(0, fv - 0.33, 1.2, 0.03, B + doorH + 0.6, B + doorH + 1.1, mat(METAL, GOLD), D);
}

/** The town hall's door, as the walk-in body plans it (src/interior/landmark.ts), and the gateway a front tower opens round it. */
export const TOWNHALL_DOOR = { w: 2.4 };
const GATE_W = 4.4, GATE_H = 4.4;

// ------------------------------------------------------------ steps

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

export const D: Opt = { detail: true };

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
    case 'carehome': careHome(k, lm, r); break;
    case 'petrol': petrolStation(k, lm); break;
  }
  parts = k.parts;
  cache.set(lm, parts);
  return parts;
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
