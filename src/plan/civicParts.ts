/**
 * The town's public buildings as landmark parts (plan/landmarkParts Kit): the parish church, the
 * primary school, the kindergarten, the health centre, the fire station, the supermarket, the
 * care home and the petrol station.
 * New in SimWorld (Scale's landmarks were a city's). Massing with windows, roofs and a few
 * details; interiors come later. Site frame as everywhere: the front (entrance, street) at -v.
 */
import type { Rng } from '@futuremagic/core';
import type { Landmark } from './landmarks';
import {
  Kit, mat, type PartMat, type RGB, WHITE, WIN, ARCH, CURTAIN, ROOF, PAINT,
  BRICK, BRICK_BROWN, LIME, SAND, PLASTER, STUCCO, CONC, PANEL, GLASS, METAL, GRANITE, BRICK_WHITE,
  CLAY, SLATE, ZINC, GRAVEL, METAL_ROOF, TAR,
} from './kit';

const ROOFS = [CLAY, SLATE, ZINC];
const roofOf = (i: number): PartMat => mat(ROOFS[i % ROOFS.length], WHITE, ROOF);
const flatTop = (): PartMat => mat(GRAVEL, WHITE, ROOF);

/** A pitched (gable) roof over a box of half sizes hu × hv, the ridge along u (rot π/2: along v). */
function pitched(k: Kit, u: number, v: number, hu: number, hv: number, y: number, pitch: number, wall: PartMat, roof: PartMat, rot = 0): void {
  const across = rot ? hu : hv;
  k.gable(u, v, (rot ? hv : hu) + 0.35, across + 0.45, y, y + across * pitch, wall, roof, { rot });
}

export function church(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B, st = lm.style;
  const wallL = st === 0 ? [LIME, SAND, GRANITE, LIME][P.wall % 4] : st === 1 ? [BRICK, BRICK_BROWN, BRICK, BRICK_WHITE][P.wall % 4] : [PLASTER, STUCCO, PLASTER, PLASTER][P.wall % 4];
  const tint: RGB = st === 2 ? [1.05, 1.05, 1.03] : WHITE;
  const wall = mat(wallL, tint, WIN | ARCH, 4.2, P.H * 0.7, P.H * 0.7);
  const plain = mat(wallL, tint);
  const roof = mat(st === 2 ? r.pick([SLATE, METAL_ROOF]) : [SLATE, CLAY, ZINC][P.roof % 3], WHITE, ROOF);
  const half = (P.L + P.tw) / 2;
  const tv0 = -half, tv1 = -half + P.tw, nv0 = tv1 - 1, nv1 = half;
  const nc = (nv0 + nv1) / 2, nhv = (nv1 - nv0) / 2;
  // Nave, its roof along v, and a lower apse or vestry at the back.
  k.box(0, nc, P.W / 2, nhv, B, B + P.H, wall, { foot: true });
  pitched(k, 0, nc, P.W / 2, nhv, B + P.H, 1.05, plain, roof, Math.PI / 2);
  if (P.apse) {
    const aw = P.W * 0.32;
    k.box(0, nv1 + 2.2, aw, 2.2, B, B + P.H * 0.7, plain, { foot: true });
    k.pyramid(0, nv1 + 2.2, aw + 0.3, 2.5, B + P.H * 0.7, B + P.H * 0.7 + 2.5, 0.2, plain, { top: roof });
  }
  // The tower at the front: the door at its foot, the belfry openings, a spire or a low cap.
  const th = P.towerH * (P.spire ? 0.6 : 0.85), tw = P.tw / 2;
  k.box(0, (tv0 + tv1) / 2, tw, tw, B, B + th, mat(wallL, tint, WIN | ARCH, tw * 1.6, th / 3, th / 3), { foot: true });
  k.box(0, (tv0 + tv1) / 2, tw + 0.25, tw + 0.25, B + th, B + th + 0.5, plain, { solid: false, detail: true });
  if (P.spire) k.pyramid(0, (tv0 + tv1) / 2, tw, tw, B + th + 0.5, B + P.towerH, 0, roof, { solid: true });
  else k.pyramid(0, (tv0 + tv1) / 2, tw + 0.2, tw + 0.2, B + th + 0.5, B + th + 3.5, 0, roof);
  // A clock on the tower's front, under the belfry.
  k.clockFace(0, tv0, 0, -1, Math.min(1.3, tw * 0.55), B + th - 2.4);
  // The cross (or a weathercock) on top.
  k.box(0, (tv0 + tv1) / 2, 0.08, 0.08, B + (P.spire ? P.towerH : th + 3.5), B + (P.spire ? P.towerH : th + 3.5) + 2, mat(METAL, [1.2, 1.0, 0.45]), { detail: true, solid: false });
  // Steps up to the door.
  k.box(0, tv0 - 1.2, 2.2, 1.2, k.F, B, mat(GRANITE, [0.85, 0.85, 0.85]), { foot: true });
}

export function school(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B, st = lm.style;
  const fh = 3.6, H = 0.6 + P.floors * fh;
  const wallL = st === 0 ? [BRICK, BRICK_BROWN, SAND, BRICK][P.wall % 4] : [PLASTER, CONC, PANEL, BRICK_WHITE][P.wall % 4];
  const tint: RGB = st === 1 && wallL === PLASTER ? r.pick<RGB>([[1, 0.95, 0.82], [0.9, 0.95, 1], [0.95, 1, 0.9]]) : WHITE;
  const wall = mat(wallL, tint, WIN, st === 0 ? 2.8 : 2.4, fh, fh + 0.6);
  const plain = mat(wallL, tint);
  const roof = roofOf(P.roof);
  const fieldW = P.field ? P.field + 2 : 0;
  const mu = -fieldW / 2, mv = -lm.hv + 6 + P.bd / 2;
  // The main block along the street, the entrance in its middle under a canopy.
  k.box(mu, mv, P.bw / 2, P.bd / 2, B, B + H, wall, st === 1 ? { foot: true, top: flatTop() } : { foot: true });
  if (st === 0) pitched(k, mu, mv, P.bw / 2, P.bd / 2, B + H, 0.6, plain, roof);
  k.box(mu, mv - P.bd / 2 - 1.4, 3.5, 1.4, B + 3.1, B + 3.35, mat(PANEL, [0.9, 0.9, 0.9]), { solid: false });
  // A wing back into the yard.
  if (P.wing) {
    const wu = mu + P.bw / 2 - 6, wv = mv + P.bd / 2 + P.wingL / 2 - 0.5;
    k.box(wu, wv, 6, P.wingL / 2, B, B + H - fh, wall, st === 1 ? { foot: true, top: flatTop() } : { foot: true });
    if (st === 0) pitched(k, wu, wv, 6, P.wingL / 2, B + H - fh, 0.6, plain, roof, Math.PI / 2);
  }
  // Goals on the playing field.
  if (P.field) {
    const fu = lm.hu - 2 - P.field / 2;
    const post = mat(PLASTER, [1.2, 1.2, 1.2]);
    for (const s of [-1, 1]) k.box(fu, s * (lm.hv - 4), 1.6, 0.06, B, B + 2, post, { detail: true });
  }
}

export function kindergarten(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B;
  const tints: RGB[] = [[1, 0.9, 0.7], [0.85, 0.95, 1], [1, 0.85, 0.8], [0.9, 1, 0.85], [1, 1, 0.95]];
  const wall = mat(r.chance(0.5) ? PLASTER : BRICK_WHITE, tints[P.wall % tints.length], WIN, 2.6, 3.4, 3.4);
  const v = -lm.hv + 5 + P.bd / 2, h = 3.4;
  k.box(0, v, P.bw / 2, P.bd / 2, B, B + h, wall, lm.style ? { foot: true, top: mat(GRAVEL, [0.9, 1, 0.9], ROOF) } : { foot: true });
  if (!lm.style) pitched(k, 0, v, P.bw / 2, P.bd / 2, B + h, 0.5, wall, roofOf(P.roof));
  // A coloured canopy over the door.
  k.box(-P.bw / 4, v - P.bd / 2 - 1, 2, 1, B + 2.6, B + 2.8, mat(PANEL, PAINT[(P.wall + 2) % PAINT.length]), { solid: false });
}

export function clinic(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B;
  const fh = 3.4, H = 0.4 + P.floors * fh;
  const wallL = [PLASTER, BRICK_WHITE, CONC, BRICK][P.wall % 4];
  const wall = mat(wallL, wallL === PLASTER ? r.pick<RGB>([[1, 1, 0.97], [0.95, 0.97, 1]]) : WHITE, WIN, 2.4, fh, fh + 0.4);
  const v = lm.hv - 1 - P.bd / 2;
  k.box(0, v, P.bw / 2, P.bd / 2, B, B + H, wall, lm.style ? { foot: true, top: flatTop() } : { foot: true });
  if (!lm.style) pitched(k, 0, v, P.bw / 2, P.bd / 2, B + H, 0.45, wall, roofOf(P.wall));
  // The entrance: a glazed porch with a canopy.
  k.box(0, v - P.bd / 2 - 1.2, 2.4, 1.2, B, B + 3, mat(GLASS, [0.85, 0.92, 0.95], WIN | CURTAIN, 1.2, 3, 3), { top: mat(METAL_ROOF, WHITE, ROOF) });
}

export function fireStation(k: Kit, lm: Landmark): void {
  const P = lm.p, B = k.B;
  const wallL = [BRICK, BRICK_BROWN][P.wall % 2];
  const wall = mat(wallL, WHITE, WIN, 2.6, 3.4, 3.6);
  const v = -lm.hv + 10 + P.hd / 2;
  const hu0 = -lm.hu + 4, hallU = hu0 + P.hall / 2, offU = hu0 + P.hall + P.office / 2;
  // The engine hall with the crew rooms over it, and the office wing beside it.
  k.box(hallU, v, P.hall / 2, P.hd / 2, B, B + 8.5, mat(wallL, WHITE, WIN, 4.6, 4, 5), { foot: true, top: flatTop() });
  k.box(offU, v, P.office / 2, P.hd / 2, B, B + 7, wall, { foot: true });
  pitched(k, offU, v, P.office / 2, P.hd / 2, B + 7, 0.5, wall, roofOf(P.wall + 1), Math.PI / 2);
  // The bay doors (red or white), the hose-drying tower at the back corner.
  const door = mat(PANEL, lm.style ? [0.75, 0.12, 0.1] : [0.92, 0.92, 0.9]);
  for (let i = 0; i < P.bays; i++) {
    const du = hu0 + 1 + (i + 0.5) * P.bayW;
    k.box(du, v - P.hd / 2 - 0.05, P.bayW / 2 - 0.35, 0.08, B, B + 4.2, door, { solid: false, detail: true });
  }
  k.box(hu0 + 1.6, v + P.hd / 2 - 1.6, 1.6, 1.6, B, B + P.towerH, mat(wallL, WHITE, WIN, 3.2, 4, 4), { foot: true });
  k.pyramid(hu0 + 1.6, v + P.hd / 2 - 1.6, 1.8, 1.8, B + P.towerH, B + P.towerH + 1.8, 0, roofOf(P.wall + 1));
}

export function supermarket(k: Kit, lm: Landmark): void {
  const P = lm.p, B = k.B, H = 6.5;
  const wall = mat(lm.style === 0 ? PANEL : lm.style === 1 ? BRICK : CONC, lm.style === 0 ? [0.85, 0.86, 0.88] : WHITE, 0, 6, 6.5, 6.5);
  const v = lm.hv - 4 - P.bd / 2;
  k.box(0, v, P.bw / 2, P.bd / 2, B, B + H, wall, { foot: true, top: mat(TAR, WHITE, ROOF) });
  // Shop windows and the entrance at the front, a coloured fascia band and the canopy.
  const front = v - P.bd / 2;
  k.box(-P.bw / 4, front - 0.1, P.bw / 4 - 1, 0.1, B, B + 3.2, mat(GLASS, [0.8, 0.88, 0.92], WIN | CURTAIN, 1.5, 3.2, 3.2), { solid: false });
  k.box(0, front - 0.15, P.bw / 2, 0.15, B + 4.6, B + 6.1, mat(PANEL, PAINT[P.colour % PAINT.length]), { solid: false });
  k.box(-P.bw / 4, front - 2, P.bw / 4, 2, B + 3.4, B + 3.7, mat(METAL_ROOF, [0.9, 0.9, 0.92]), { solid: false });
  // Trolley shelter in the car park.
  k.box(P.bw / 2 - 6, front - P.park * 0.5, 3, 1.2, B + 2.2, B + 2.35, mat(METAL_ROOF, [0.85, 0.85, 0.88]), { solid: false, detail: true });
}

export function careHome(k: Kit, lm: Landmark, r: Rng): void {
  const P = lm.p, B = k.B;
  const fh = 3.1, H = 0.4 + P.floors * fh;
  const wallL = [PLASTER, BRICK, BRICK_WHITE, STUCCO][P.wall % 4];
  const tint: RGB = wallL === PLASTER || wallL === STUCCO ? r.pick<RGB>([[1, 0.97, 0.9], [0.97, 0.95, 0.92], [0.95, 0.97, 1]]) : WHITE;
  const wall = mat(wallL, tint, WIN, 2.6, fh, fh + 0.4);
  const plain = mat(wallL, tint);
  const v = -lm.hv + 6 + P.bd / 2;
  // The main block along the street, a pitched roof or a flat one.
  k.box(0, v, P.bw / 2, P.bd / 2, B, B + H, wall, lm.style ? { foot: true, top: flatTop() } : { foot: true });
  if (!lm.style) pitched(k, 0, v, P.bw / 2, P.bd / 2, B + H, 0.5, plain, roofOf(P.roof));
  // The wing back into the garden, one storey lower.
  if (P.wing) {
    const wu = P.bw / 2 - 6, wv = v + P.bd / 2 + P.wingL / 2 - 0.5, wh = H - (P.floors > 2 ? fh : 0);
    k.box(wu, wv, 6, P.wingL / 2, B, B + wh, wall, lm.style ? { foot: true, top: flatTop() } : { foot: true });
    if (!lm.style) pitched(k, wu, wv, 6, P.wingL / 2, B + wh, 0.5, plain, roofOf(P.roof), Math.PI / 2);
  }
  // A glazed entrance porch with a canopy where the cars drop visitors off.
  k.box(0, v - P.bd / 2 - 1.3, 3, 1.3, B, B + 3, mat(GLASS, [0.85, 0.92, 0.95], WIN | CURTAIN, 1.2, 3, 3), { top: mat(METAL_ROOF, WHITE, ROOF) });
  // A conservatory (the day room) on the garden side.
  k.box(-P.bw / 4, v + P.bd / 2 + 2, 4, 2, B, B + 3, mat(GLASS, [0.9, 0.95, 0.95], WIN | CURTAIN, 1.2, 3, 3), { top: mat(METAL_ROOF, WHITE, ROOF), solid: false });
}

export function petrolStation(k: Kit, lm: Landmark): void {
  const P = lm.p, B = k.B;
  const brand = PAINT[P.colour % PAINT.length];
  // The kiosk at the back: glazed towards the pumps, the brand's band along the top.
  const kv = lm.hv - 2 - P.kd / 2;
  k.box(0, kv, P.kw / 2, P.kd / 2, B, B + 3.6, mat(PANEL, [0.92, 0.92, 0.9], 0, 3, 3.6, 3.6), { foot: true, top: mat(TAR, WHITE, ROOF) });
  k.box(0, kv - P.kd / 2 - 0.1, P.kw / 2 - 1, 0.1, B, B + 2.8, mat(GLASS, [0.8, 0.88, 0.92], WIN | CURTAIN, 1.5, 2.8, 2.8), { solid: false });
  k.box(0, kv - P.kd / 2 - 0.15, P.kw / 2, 0.15, B + 2.9, B + 3.6, mat(PANEL, brand), { solid: false });
  // The canopy over the forecourt on four posts, its fascia in the brand's colour. (Posts, pumps
  // and the sign are not solid: the forecourt's asphalt runs under them without holes.)
  const cv = -lm.hv + 5 + P.cd / 2, ch = B + 5;
  k.box(0, cv, P.cw / 2, P.cd / 2, ch, ch + 0.8, mat(PANEL, brand), { solid: false, top: mat(METAL_ROOF, [0.92, 0.92, 0.94], ROOF) });
  k.box(0, cv, P.cw / 2 - 0.3, P.cd / 2 - 0.3, ch - 0.05, ch, mat(PANEL, [0.95, 0.95, 0.95]), { solid: false, detail: true });
  const post = mat(METAL, [0.85, 0.85, 0.87]);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) k.box(su * (P.cw / 2 - 1.5), cv + sv * (P.cd / 2 - 1.5), 0.2, 0.2, B, ch, post, { solid: false });
  // The pump islands (a kerb with two pumps each) under the canopy, along v.
  const kerb = mat(CONC, [0.95, 0.95, 0.93]), pump = mat(PANEL, [0.9, 0.9, 0.9]);
  for (let i = 0; i < P.islands; i++) {
    const u = (i - (P.islands - 1) / 2) * (P.cw / P.islands);
    k.box(u, cv, 0.6, P.cd / 2 - 1.2, B, B + 0.15, kerb, { detail: true, solid: false });
    for (const sv of [-1, 1]) {
      k.box(u, cv + sv * (P.cd / 4), 0.35, 0.5, B + 0.15, B + 1.8, pump, { detail: true, solid: false });
      k.box(u, cv + sv * (P.cd / 4), 0.37, 0.52, B + 1.5, B + 1.8, mat(PANEL, brand), { detail: true, solid: false });
    }
  }
  // The price sign by the road.
  k.box(lm.hu - 2, -lm.hv + 1.5, 0.6, 0.2, B, B + 5.5, mat(PANEL, brand), { detail: true, solid: false });
}

export function station(k: Kit, lm: Landmark): void {
  const P = lm.p, B = k.B;
  // The track side is +v, the forecourt (and the town) -v: the platform runs the site's whole
  // length along the track, the station building stands behind it.
  const pv0 = lm.hv - 4.5, pv1 = lm.hv - 0.3, ph = 0.76;
  const edge = mat(CONC, [0.95, 0.95, 0.93]);
  k.box(0, (pv0 + pv1) / 2, lm.hu, (pv1 - pv0) / 2, k.F, B + ph, edge, { foot: true });
  // A white safety line along the edge.
  k.box(0, pv1 - 0.6, lm.hu, 0.08, B + ph, B + ph + 0.02, mat(PLASTER, [1.3, 1.3, 1.25]), { solid: false, detail: true });
  const old = lm.style === 0;
  const wallL = old ? [BRICK, BRICK_BROWN, SAND][P.wall % 3] : [CONC, PANEL, BRICK_WHITE][P.wall % 3];
  const fh = old ? 4.2 : 3.6, H = old ? 2 * fh : fh + 0.4;
  const wall = mat(wallL, WHITE, old ? WIN | ARCH : WIN | CURTAIN, old ? 3 : 2, fh, fh);
  const bv = pv0 - P.bd / 2;
  k.box(0, bv, P.bw / 2, P.bd / 2, B, B + H, wall, old ? { foot: true } : { foot: true, top: flatTop() });
  if (old) {
    pitched(k, 0, bv, P.bw / 2, P.bd / 2, B + H, 0.55, mat(wallL, WHITE), roofOf(P.roof));
    // The clock gable over the entrance.
    k.box(0, bv - P.bd / 2 - 0.3, 3, 0.3, B + H, B + H + 2.4, mat(wallL, WHITE), { solid: false });
    k.clockFace(0, bv - P.bd / 2 - 0.6, 0, -1, 0.85, B + H + 1.2);
  } else {
    // A glazed entrance hall at the front.
    k.box(0, bv - P.bd / 2 - 1.5, 4, 1.5, B, B + 3.6, mat(GLASS, [0.82, 0.9, 0.94], WIN | CURTAIN, 1.2, 3.6, 3.6), { top: mat(METAL_ROOF, WHITE, ROOF) });
  }
  // The platform canopy on posts.
  const ch = B + ph + 3.4, cu = P.canopy / 2, cv = (pv0 + pv1) / 2;
  k.box(0, cv, cu, (pv1 - pv0) / 2 + 0.2, ch, ch + 0.25, mat(METAL_ROOF, [0.82, 0.84, 0.86], ROOF), { solid: false });
  const post = mat(METAL, old ? [0.35, 0.45, 0.4] : [0.8, 0.8, 0.82]);
  for (let u = -cu + 1; u <= cu - 1; u += 6) k.box(u, cv - 0.6, 0.12, 0.12, B + ph, ch, post, { detail: true });
  // Benches under the canopy, a shelter-less bike stand on the forecourt.
  for (let u = -cu + 4; u < cu - 3; u += 9) k.box(u, pv0 + 1, 0.9, 0.25, B + ph, B + ph + 0.45, mat(PANEL, [0.55, 0.38, 0.25]), { detail: true });
  k.box(P.bw / 2 + 4, bv - P.bd / 2 - 3, 3, 0.4, B, B + 0.9, mat(METAL, [0.7, 0.7, 0.72]), { detail: true, solid: false });
}
