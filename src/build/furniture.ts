/**
 * Procedural street furniture: ported from Scale (src/props/furniture.ts; the metro entrance and
 * the near-future robot lights stay behind). Every kind is one mesh (origin at the ground contact
 * point, front facing -Z) for the one `FURNITURE` material kind, which resolves the per-vertex
 * material id in the shader (src/render/tsl/furniture.ts) — instancing-ready. Pure: built in the
 * town workers as `MeshData`; the solids come from src/build/prims.ts.
 *
 * Vertex attributes (FURNITURE_SPECS) besides position and normal:
 *  - uv     text atlas coordinates (src/build/textAtlasLayout.ts pictures) where a panel shows one
 *  - aFurn  vec3: x FMat id, y 0..1 emissive mask (lamp lenses, signal lenses, back-lit signs),
 *           z sub-material code: 0 plain, 1 red / 2 amber / 3 green signal lens, 4 pedestrian
 *           "don't walk" / 5 "walk" lens, 6 lettering from the instance's own atlas slot (iSign;
 *           uv 0..1 over the face), 7 back-lit sign, 8 foliage, 9 fixed paint (ignores the
 *           instance tint), 10 status LED (EV chargers)
 *  - aColor vec3 default paint / plastic colour (linear). The instance tint (iTint.rgb, sRGB)
 *           replaces it for PaintedMetal / Plastic vertices when non-zero.
 *
 * Conventions: lampModern / lampDouble arms reach over the street (-Z). trafficLight: mast arm over
 * the street (-Z); vehicle heads face +X (traffic approaching from +X); pedestrian head faces -Z.
 * Pedestrian "walk" is shown while the vehicle phase is red.
 */
import { Noise, srgbToLinear as lin } from '@futuremagic/core';
import { MeshBuilder, type AttrSpec, type MeshData } from './meshBuilder';
import { pictureRect } from './textAtlasLayout';
import {
  CatmullRom, M, box as boxPrim, compose, computeNormals, cylinder, flipped, icosphere, identity, lathe as lathePrim, move, plane, quatFromUnit,
  rotX, rotY, rotZ, sphere as spherePrim, torus, tube as tubePrim, xform, type Mat4, type Prim,
} from './prims';

export type FurnitureKind = 'lampModern' | 'lampClassic' | 'lampDouble' | 'trafficLight' | 'bench' | 'bin' | 'hydrant' | 'mailbox' | 'bollard' | 'planter' | 'busStop' | 'fountain' | 'statue' | 'kiosk' | 'stopSign' | 'playground' | 'manhole' | 'newsStand' | 'bikeRack' | 'phoneBooth' | 'evCharger'
  | 'cafeTable' | 'cafeChair' | 'parasol' | 'awning' | 'menuBoard' | 'terraceRail' | 'parklet'
  | 'cemWall' | 'gravestone' | 'grave' | 'tomb'
  | 'signBoard' | 'signPost' | 'signFrame' | 'signBracket';

export const FURNITURE_KINDS: FurnitureKind[] = ['lampModern', 'lampClassic', 'lampDouble', 'trafficLight', 'bench', 'bin', 'hydrant', 'mailbox', 'bollard', 'planter', 'busStop', 'fountain', 'statue', 'kiosk', 'stopSign', 'playground', 'manhole', 'newsStand', 'bikeRack', 'phoneBooth', 'evCharger', 'cafeTable', 'cafeChair', 'parasol', 'awning', 'menuBoard', 'terraceRail', 'parklet', 'cemWall', 'gravestone', 'grave', 'tomb', 'signBoard', 'signPost', 'signFrame', 'signBracket'];

/** The vertex attributes of furniture meshes besides position and normal (the `FURNITURE` kind's). */
export const FURNITURE_SPECS: AttrSpec[] = [{ name: 'uv', size: 2 }, { name: 'aFurn', size: 3 }, { name: 'aColor', size: 3 }];

export interface FurnitureModel {
  kind: FurnitureKind;
  mesh: MeshData;
  height: number;
  radius: number;
  /** Where the model's lamps are (model space), for a pool of real lights at night (planned). */
  lights: { pos: [number, number, number]; color: [number, number, number]; intensity: number }[];
  breakable: 'bend' | 'topple' | 'shatter' | 'solid';
}

export const enum FMat { Metal = 0, PaintedMetal = 1, Wood = 2, Concrete = 3, Stone = 4, Glass = 5, Plastic = 6, Light = 7, Water = 8, Bronze = 9, Rubber = 10, Signage = 11 }

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

export type V = [number, number, number];
export interface PO { m: FMat; c?: V; e?: number; s?: number }


export class FB {
  readonly mb = new MeshBuilder(FURNITURE_SPECS);

  add(geo: Prim, mtx: Mat4, po: PO, uvMap?: (u: number, v: number) => [number, number], doubleSided = false) {
    if (doubleSided) this.add(flipped(geo), mtx, po, uvMap);
    xform(geo, mtx);
    const c = po.c ?? [0.5, 0.5, 0.5];
    const mb = this.mb;
    mb.set('aFurn', po.m, po.e ?? 0, po.s ?? 0);
    mb.set('aColor', lin(c[0]), lin(c[1]), lin(c[2]));
    const base = mb.vcount, P = geo.pos, N = geo.nrm, T = geo.uv;
    for (let i = 0; i < P.length / 3; i++) {
      let uu = T[i * 2] ?? 0, vv = T[i * 2 + 1] ?? 0;
      if (uvMap) [uu, vv] = uvMap(uu, vv);
      mb.v(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], uu, vv);
    }
    const I = geo.idx;
    for (let i = 0; i < I.length; i += 3) mb.tri(base + I[i], base + I[i + 1], base + I[i + 2]);
  }

  box(po: PO, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    this.add(boxPrim(sx, sy, sz), M(x, y, z, rx, ry, rz), po);
  }
  /** Cylinder with its base at (x,y,z) (before rotation about that base). */
  cyl(po: PO, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 12, open = false, rx = 0, ry = 0, rz = 0) {
    const g = xform(cylinder(rTop, rBot, h, seg, open), move(0, h / 2, 0));
    this.add(g, M(x, y, z, rx, ry, rz), po);
  }
  rod(po: PO, a: V, b: V, r: number, seg = 8, rb = r) {
    const d: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) || 1;
    const g = xform(cylinder(r, rb, len, seg, true), move(0, len / 2, 0));
    this.add(g, compose(a, quatFromUnit([0, 1, 0], [d[0] / len, d[1] / len, d[2] / len])), po);
  }
  lathe(po: PO, prof: [number, number][], seg: number, x = 0, y = 0, z = 0, ry = 0, sx = 1, sz = 1, phiLen = Math.PI * 2) {
    this.add(lathePrim(prof.map(([r, yy]) => [Math.max(0, r), yy]), seg, 0, phiLen), M(x, y, z, 0, ry, 0, sx, 1, sz), po);
  }
  tube(po: PO, pts: V[], r: number, radial = 8, segs = 16, rEnd = r) {
    this.add(tubePrim(new CatmullRom(pts), segs, r, radial, rEnd), identity(), po);
  }
  sphere(po: PO, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ws = 12, hs = 8, thetaLen = Math.PI) {
    this.add(spherePrim(r, ws, hs, 0, Math.PI * 2, 0, thetaLen), M(x, y, z, 0, 0, 0, sx, sy, sz), po);
  }
  capsule(po: PO, a: V, b: V, r: number, rb = r, radial = 10) {
    this.rod(po, a, b, rb, radial, r); // (rod's radii run b to a: Scale's)
    this.sphere(po, r, ...a, 1, 1, 1, radial, 6);
    this.sphere(po, rb, ...b, 1, 1, 1, radial, 6);
  }
  /** Flat sign panel (front faces -Z after rotation ry) with uv into a signage cell. */
  panel(po: PO, w: number, h: number, x: number, y: number, z: number, ry: number, cell: number, rx = 0) {
    const g = xform(plane(w, h), rotY(Math.PI));
    const [u0, v0, u1, v1] = pictureRect(cell);
    this.add(g, M(x, y, z, rx, ry, 0), po, (u, v) => [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v]);
  }
  /** Regular polygon plate in the XY plane facing -Z (front signage, back metal). */
  polyPlate(front: PO, back: PO, n: number, r: number, thick: number, x: number, y: number, z: number, ry: number, cell: number, rot = Math.PI / n) {
    const [u0, v0, u1, v1] = pictureRect(cell);
    const shapePts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      shapePts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    // One face of the plate, wound counter-clockwise seen from its facing side.
    const mk = (zz: number, facing: number): Prim => {
      const pos: number[] = [0, 0, zz], nrm: number[] = [0, 0, facing], uv: number[] = [(u0 + u1) / 2, (v0 + v1) / 2];
      const idx: number[] = [];
      shapePts.forEach(([px, py], i) => {
        pos.push(px, py, zz); nrm.push(0, 0, facing);
        // front (facing -Z) is viewed from -Z: mirror u so text reads correctly from either side
        uv.push(u0 + (u1 - u0) * (0.5 + facing * (px / r) * 0.5), v0 + (v1 - v0) * (0.5 + (py / r) * 0.5));
        const a = i + 1, b = ((i + 1) % n) + 1;
        if (facing > 0) idx.push(0, a, b); else idx.push(0, b, a);
      });
      return { pos, nrm, uv, idx };
    };
    const m = M(x, y, z, 0, ry, 0);
    this.add(mk(-thick / 2, -1), m, front);
    this.add(mk(thick / 2, 1), m, back);
    // rim
    const rim = xform(xform(cylinder(r, r, thick, n, true), rotX(Math.PI / 2)), rotZ(rot + Math.PI / 2));
    this.add(rim, m, back);
  }
}

// ---------------------------------------------------------------------------------------------
// Common parts / palette
// ---------------------------------------------------------------------------------------------

export const METAL: PO = { m: FMat.Metal };
export const RUBBER: PO = { m: FMat.Rubber, c: [0.05, 0.05, 0.05] };
const CONCRETE: PO = { m: FMat.Concrete, c: [0.6, 0.59, 0.56] };
const STONE: PO = { m: FMat.Stone };
export const GLASS: PO = { m: FMat.Glass };
const WOOD: PO = { m: FMat.Wood, c: [0.55, 0.36, 0.2] };
const BRONZE: PO = { m: FMat.Bronze };
const WATER: PO = { m: FMat.Water };
export const paint = (c: V, fixed = false): PO => ({ m: FMat.PaintedMetal, c, s: fixed ? 9 : 0 });
export const plastic = (c: V, fixed = false): PO => ({ m: FMat.Plastic, c, s: fixed ? 9 : 0 });
const sign = (emit = 0): PO => ({ m: FMat.Signage, e: emit, s: emit > 0 ? 7 : 0, c: [1, 1, 1] });
const LAMP = (e = 1): PO => ({ m: FMat.Light, e, s: 0, c: [1, 0.97, 0.9] });

const WARM: [number, number, number] = [1.0, 0.8, 0.55];
const LED: [number, number, number] = [0.95, 0.93, 1.0];

const fNoise = new Noise(0xf00d);

/** Fluted (grooved) column: cylinder with radial modulation. */
function fluted(fb: FB, po: PO, rBot: number, rTop: number, h: number, flutes: number, x: number, y: number, z: number) {
  const seg = flutes * 4;
  const g = cylinder(rTop, rBot, h, seg, true);
  const p = g.pos;
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i], pz = p[i + 2];
    const a = Math.atan2(pz, px);
    const k = 1 - 0.09 * Math.pow(Math.abs(Math.sin((a * flutes) / 2)), 3);
    p[i] = px * k;
    p[i + 2] = pz * k;
  }
  computeNormals(g);
  xform(g, move(0, h / 2, 0));
  fb.add(g, M(x, y, z), po);
}

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

type Lights = FurnitureModel['lights'];

function lampModern(fb: FB, v: number, lights: Lights): number {
  const H = 8.8;
  fb.cyl(CONCRETE, 0.32, 0.36, 0.12, 0, -0.02, 0, 16);
  fb.cyl(METAL, 0.22, 0.22, 0.03, 0, 0.1, 0, 16);
  fb.cyl(METAL, 0.15, 0.17, 0.55, 0, 0.12, 0, 8);
  fb.cyl(METAL, 0.065, 0.12, H - 0.6, 0, 0.6, 0, 14);
  fb.cyl(METAL, 0.072, 0.072, 0.05, 0, H - 0.35, 0, 14);
  if (v % 2 === 0) {
    // classic cobra head on a curved davit arm
    fb.tube(METAL, [[0, H - 0.6, 0], [0, H - 0.05, -0.15], [0, H + 0.25, -0.8], [0, H + 0.35, -1.7], [0, H + 0.38, -2.0]], 0.055, 8, 18, 0.042);
    const hz = -2.45, hy = H + 0.36;
    fb.sphere(METAL, 1, 0, hy, hz, 0.3, 0.14, 0.62, 16, 8, Math.PI / 2);
    fb.sphere(paint([0.42, 0.44, 0.45], true), 1, 0, hy, hz, 0.3, 0.05, 0.62, 16, 4);
    fb.sphere(LAMP(1), 1, 0, hy - 0.04, hz - 0.06, 0.22, 0.06, 0.45, 14, 6);
    lights.push({ pos: [0, hy - 0.12, hz], color: WARM, intensity: 1 });
  } else {
    // slim LED luminaire on a straight, slightly raised arm
    fb.rod(METAL, [0, H - 0.4, 0], [0, H + 0.1, -1.9], 0.045, 8, 0.035);
    fb.rod(METAL, [0, H - 1.0, 0], [0, H - 0.25, -1.0], 0.02, 6);
    const hz = -2.35, hy = H + 0.14;
    fb.box(paint([0.25, 0.27, 0.28], true), 0.34, 0.07, 0.9, 0, hy, hz, 0, -0.06);
    fb.box(LAMP(1), 0.26, 0.012, 0.72, 0, hy - 0.04, hz - 0.02, 0, -0.06);
    lights.push({ pos: [0, hy - 0.1, hz], color: LED, intensity: 1 });
  }
  return H + 0.5;
}

function lantern(fb: FB, x: number, y: number, z: number, body: PO, s = 1, lights: Lights) {
  // classic hexagonal lantern; y = bottom of lantern
  fb.lathe(body, [[0, 0], [0.05 * s, 0], [0.07 * s, 0.04 * s], [0.12 * s, 0.08 * s], [0.17 * s, 0.1 * s], [0.17 * s, 0.13 * s], [0, 0.13 * s]], 6, x, y, z, Math.PI / 6);
  fb.lathe(LAMP(1), [[0, 0.12 * s], [0.155 * s, 0.12 * s], [0.225 * s, 0.62 * s], [0, 0.62 * s]], 6, x, y, z, Math.PI / 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6 + Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    fb.rod(body, [x + ca * 0.165 * s, y + 0.12 * s, z + sa * 0.165 * s], [x + ca * 0.238 * s, y + 0.63 * s, z + sa * 0.238 * s], 0.012 * s, 4);
  }
  fb.lathe(body, [[0, 0.6 * s], [0.25 * s, 0.6 * s], [0.31 * s, 0.66 * s], [0.29 * s, 0.7 * s], [0.12 * s, 0.86 * s], [0.06 * s, 0.9 * s], [0.04 * s, 0.98 * s], [0, 0.98 * s]], 6, x, y, z, Math.PI / 6);
  fb.sphere(body, 0.045 * s, x, y + 1.0 * s, z, 1, 1, 1, 8, 6);
  lights.push({ pos: [x, y + 0.4 * s, z], color: WARM, intensity: 0.6 });
}

function lampClassic(fb: FB, v: number, lights: Lights): number {
  const body = paint([0.07, 0.11, 0.09]);
  // moulded base
  fb.lathe(body, [[0, 0], [0.26, 0], [0.26, 0.08], [0.22, 0.12], [0.2, 0.35], [0.24, 0.4], [0.24, 0.45], [0.16, 0.52], [0.13, 0.8], [0.15, 0.85], [0.15, 0.9], [0.11, 0.95], [0, 0.95]], 16);
  fluted(fb, body, 0.1, 0.075, 2.5, 12, 0, 0.95, 0);
  fb.lathe(body, [[0, 0], [0.11, 0], [0.12, 0.04], [0.09, 0.08], [0.09, 0.14], [0.11, 0.18], [0.07, 0.24], [0.06, 0.6], [0, 0.6]], 12, 0, 3.45, 0);
  if (v % 2 === 0) {
    // capital + single lantern
    fb.lathe(body, [[0, 0], [0.07, 0], [0.16, 0.08], [0.17, 0.12], [0, 0.12]], 12, 0, 4.05, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      fb.tube(body, [[0, 3.85, 0], [Math.cos(a) * 0.12, 3.95, Math.sin(a) * 0.12], [Math.cos(a) * 0.16, 4.1, Math.sin(a) * 0.16]], 0.012, 4, 6);
    }
    lantern(fb, 0, 4.17, 0, body, 1, lights);
    return 5.15;
  }
  // two-arm candelabra with lanterns
  fb.lathe(body, [[0, 0], [0.07, 0], [0.09, 0.08], [0, 0.1]], 10, 0, 4.05, 0);
  for (const sd of [-1, 1]) {
    fb.tube(body, [[0, 4.0, 0], [sd * 0.25, 4.12, 0], [sd * 0.5, 4.08, 0], [sd * 0.62, 3.95, 0], [sd * 0.62, 3.88, 0]], 0.03, 6, 14);
    fb.tube(body, [[0, 3.8, 0], [sd * 0.2, 3.85, 0], [sd * 0.38, 3.97, 0], [sd * 0.4, 4.08, 0]], 0.012, 4, 8);
    lantern(fb, sd * 0.62, 3.88, 0, body, 0.85, lights);
  }
  fb.sphere(body, 0.06, 0, 4.2, 0, 1, 1.4, 1, 8, 6);
  return 4.8;
}

function lampDouble(fb: FB, v: number, lights: Lights): number {
  if (v % 2 === 1) {
    // classic double lantern for boulevards
    const body = paint([0.07, 0.11, 0.09]);
    fb.lathe(body, [[0, 0], [0.3, 0], [0.3, 0.1], [0.24, 0.16], [0.22, 0.45], [0.27, 0.5], [0.27, 0.56], [0.17, 0.62], [0.14, 1.0], [0, 1.0]], 16);
    fluted(fb, body, 0.11, 0.08, 3.0, 12, 0, 1.0, 0);
    fb.lathe(body, [[0, 0], [0.1, 0], [0.12, 0.06], [0.08, 0.14], [0.08, 0.3], [0, 0.3]], 12, 0, 4.0, 0);
    for (const sd of [-1, 1]) {
      fb.tube(body, [[0, 4.2, 0], [0, 4.35, sd * 0.3], [0, 4.4, sd * 0.65], [0, 4.3, sd * 0.85], [0, 4.2, sd * 0.86]], 0.035, 6, 14);
      fb.tube(body, [[0, 3.95, 0], [0, 4.05, sd * 0.3], [0, 4.25, sd * 0.5]], 0.014, 4, 8);
      lantern(fb, 0, 4.2, sd * 0.86, body, 0.95, lights);
    }
    fb.sphere(body, 0.07, 0, 4.42, 0, 1, 1.5, 1, 8, 6);
    return 5.2;
  }
  const H = 10;
  fb.cyl(CONCRETE, 0.34, 0.38, 0.12, 0, -0.02, 0, 16);
  fb.cyl(METAL, 0.17, 0.19, 0.6, 0, 0.1, 0, 8);
  fb.cyl(METAL, 0.07, 0.13, H - 0.6, 0, 0.6, 0, 14);
  fb.sphere(METAL, 0.075, 0, H, 0, 1, 0.6, 1, 10, 4, Math.PI / 2);
  for (const sd of [-1, 1]) {
    fb.tube(METAL, [[0, H - 0.5, 0], [0, H - 0.1, sd * 0.4], [0, H + 0.15, sd * 1.4], [0, H + 0.2, sd * 2.0]], 0.05, 8, 14, 0.038);
    const hz = sd * 2.4, hy = H + 0.2;
    fb.box(paint([0.25, 0.27, 0.28], true), 0.34, 0.08, 0.9, 0, hy, hz, 0, sd * 0.05);
    fb.box(LAMP(1), 0.26, 0.012, 0.72, 0, hy - 0.045, hz, 0, sd * 0.05);
    lights.push({ pos: [0, hy - 0.12, hz], color: LED, intensity: 1 });
  }
  return H + 0.3;
}

function signalHead(fb: FB, x: number, y: number, z: number, housing: PO, backplate: boolean) {
  // head faces +X; y = centre of the middle lens
  const w = 0.32, h = 1.0, d = 0.26;
  fb.box(housing, d, h, w, x, y, z);
  if (backplate) {
    fb.box(paint([0.05, 0.05, 0.05], true), 0.025, h + 0.28, w + 0.28, x - d / 2 - 0.01, y, z);
    // retro-reflective border
    fb.box(paint([0.95, 0.85, 0.1], true), 0.026, h + 0.28, 0.035, x - d / 2 - 0.01, y, z - (w + 0.28) / 2 + 0.02);
    fb.box(paint([0.95, 0.85, 0.1], true), 0.026, h + 0.28, 0.035, x - d / 2 - 0.01, y, z + (w + 0.28) / 2 - 0.02);
    fb.box(paint([0.95, 0.85, 0.1], true), 0.026, 0.035, w + 0.28, x - d / 2 - 0.01, y + (h + 0.28) / 2 - 0.02, z);
    fb.box(paint([0.95, 0.85, 0.1], true), 0.026, 0.035, w + 0.28, x - d / 2 - 0.01, y - (h + 0.28) / 2 + 0.02, z);
  }
  const codes: [number, V][] = [[1, [1.0, 0.1, 0.05]], [2, [1.0, 0.55, 0.0]], [3, [0.0, 0.95, 0.6]]];
  codes.forEach(([code, col], i) => {
    const ly = y + 0.32 - i * 0.32;
    fb.cyl({ m: FMat.Light, e: 1, s: code, c: col }, 0.105, 0.105, 0.02, x + d / 2, ly, z, 16, false, 0, 0, -Math.PI / 2);
    // visor: open half cylinder over the lens
    const g = cylinder(0.125, 0.135, 0.24, 12, true, -Math.PI * 1.1, Math.PI * 1.2);
    xform(g, rotZ(-Math.PI / 2));
    xform(g, move(x + d / 2 + 0.12, ly, z));
    fb.add(g, identity(), housing, undefined, true);
  });
}

function trafficLight(fb: FB, v: number): number {
  const housing = v % 2 === 0 ? paint([0.06, 0.06, 0.06], true) : paint([0.92, 0.72, 0.08], true);
  const H = 6.6, reach = 5.6;
  fb.cyl(CONCRETE, 0.4, 0.45, 0.1, 0, -0.02, 0, 12);
  fb.cyl(METAL, 0.28, 0.28, 0.04, 0, 0.08, 0, 12);
  fb.cyl(METAL, 0.17, 0.2, 0.5, 0, 0.1, 0, 8);
  fb.cyl(METAL, 0.11, 0.15, H, 0, 0.1, 0, 14);
  fb.sphere(METAL, 0.112, 0, H + 0.1, 0, 1, 0.7, 1, 10, 4, Math.PI / 2);
  // mast arm with flange and tie rod
  fb.box(METAL, 0.3, 0.45, 0.06, 0, 5.6, -0.13);
  fb.tube(METAL, [[0, 5.6, -0.1], [0, 5.68, -2], [0, 5.82, -4], [0, 5.92, -reach]], 0.1, 10, 16, 0.055);
  fb.rod(METAL, [0, 6.4, -0.12], [0, 5.78, -3.2], 0.02, 5);
  fb.sphere(METAL, 0.06, 0, 5.92, -reach, 1, 1, 1, 8, 6);
  // heads on the arm
  for (const z of [-2.9, -5.0]) {
    fb.rod(METAL, [0, 5.78, z], [0, 5.35, z], 0.025, 6);
    signalHead(fb, 0.0, 4.8, z, housing, true);
  }
  // street name blade on the arm
  fb.panel(sign(), 1.5, 0.3, 0, 6.15, -1.6, -Math.PI / 2, 15);
  fb.panel(sign(), 1.5, 0.3, 0, 6.15, -1.6, Math.PI / 2, 15);
  fb.rod(METAL, [0, 5.75, -1.6], [0, 6.0, -1.6], 0.015, 4);
  // near-side head on the pole
  fb.box(METAL, 0.18, 0.08, 0.08, 0.2, 3.25, 0);
  signalHead(fb, 0.38, 3.0, 0, housing, false);
  // pedestrian head (faces -Z): upper "don't walk" hand, lower "walk" figure
  const ph = paint([0.06, 0.06, 0.06], true);
  fb.box(METAL, 0.06, 0.1, 0.2, 0, 2.55, -0.18);
  fb.box(ph, 0.36, 0.64, 0.22, 0, 2.55, -0.36);
  fb.panel({ m: FMat.Light, e: 1, s: 4, c: [1, 0.45, 0.1] }, 0.28, 0.26, 0, 2.7, -0.475, 0, 7);
  fb.panel({ m: FMat.Light, e: 1, s: 5, c: [0.95, 0.95, 1] }, 0.28, 0.26, 0, 2.4, -0.475, 0, 8);
  for (const yy of [2.7, 2.4]) fb.box(ph, 0.34, 0.025, 0.12, 0, yy + 0.14, -0.52);
  // push button
  fb.box(paint([0.9, 0.75, 0.1], true), 0.12, 0.2, 0.08, 0, 1.15, -0.15);
  fb.cyl(METAL, 0.03, 0.03, 0.02, 0, 1.12, -0.19, 10, false, Math.PI / 2);
  return H + 0.2;
}

function bench(fb: FB, v: number): number {
  const iron = paint([0.08, 0.1, 0.09]);
  const L = 1.9;
  if (v % 2 === 1) {
    // backless modern bench: concrete blocks + timber top
    for (const x of [-0.7, 0.7]) fb.box(CONCRETE, 0.25, 0.4, 0.55, x, 0.2, 0);
    for (let i = 0; i < 6; i++) fb.box(WOOD, L + 0.1, 0.05, 0.075, 0, 0.425, -0.22 + i * 0.088);
    return 0.45;
  }
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.12);
    // cast iron end frame: front leg, rear leg, seat bearer, back post, armrest with scroll
    fb.box(iron, 0.05, 0.45, 0.06, x, 0.225, -0.24, 0, 0.12);
    fb.box(iron, 0.05, 0.47, 0.06, x, 0.23, 0.24, 0, -0.18);
    fb.box(iron, 0.05, 0.06, 0.58, x, 0.42, 0.0);
    fb.box(iron, 0.05, 0.55, 0.06, x, 0.7, 0.29, 0, -0.26);
    fb.tube(iron, [[x, 0.42, -0.24], [x, 0.58, -0.28], [x, 0.66, -0.2], [x, 0.66, 0.1], [x, 0.62, 0.25]], 0.022, 6, 12);
    fb.add(torus(0.04, 0.012, 5, 12), M(x, 0.62, -0.28, 0, Math.PI / 2), iron);
    fb.box(RUBBER, 0.07, 0.02, 0.08, x, 0.01, -0.27);
    fb.box(RUBBER, 0.07, 0.02, 0.08, x, 0.01, 0.29);
  }
  for (let i = 0; i < 5; i++) fb.box(WOOD, L, 0.035, 0.085, 0, 0.465, -0.22 + i * 0.1);
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    fb.box(WOOD, L, 0.09, 0.03, 0, 0.6 + t * 0.26, 0.26 + t * 0.075, 0, -0.27);
  }
  return 0.9;
}

function bin(fb: FB, v: number): number {
  const green = paint([0.1, 0.24, 0.17]);
  if (v % 2 === 1) {
    // post-mounted hoop with a bag
    fb.cyl(green, 0.04, 0.04, 1.05, 0, 0, 0.3, 10);
    fb.add(torus(0.22, 0.015, 6, 20), M(0, 0.95, 0.06, Math.PI / 2), green);
    fb.add(torus(0.22, 0.012, 6, 20), M(0, 0.55, 0.06, Math.PI / 2), green);
    fb.rod(green, [0, 0.95, 0.28], [0, 0.95, 0.27], 0.03);
    fb.box(green, 0.05, 0.45, 0.04, 0, 0.75, 0.27);
    fb.lathe(plastic([0.3, 0.55, 0.3], true), [[0.0, 0.3], [0.12, 0.31], [0.19, 0.45], [0.21, 0.75], [0.215, 0.96], [0.2, 0.97], [0.0, 0.97]], 14, 0, 0, 0.06);
    return 1.05;
  }
  const r = 0.27, H = 0.92;
  fb.cyl(paint([0.06, 0.06, 0.06], true), r - 0.03, r - 0.03, 0.05, 0, 0, 0, 16);
  fb.cyl({ m: FMat.Metal }, r - 0.04, r - 0.05, H - 0.1, 0, 0.04, 0, 16, true);
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    fb.box(green, 0.06, H - 0.12, 0.018, Math.cos(a) * r, 0.06 + (H - 0.12) / 2, Math.sin(a) * r, -a + Math.PI / 2);
  }
  for (const y of [0.08, H - 0.07]) fb.add(torus(r + 0.005, 0.018, 6, 24), M(0, y, 0, Math.PI / 2), green);
  // domed lid with front opening
  fb.lathe(green, [[0, 0.16], [0.1, 0.15], [0.22, 0.09], [r + 0.02, 0.02], [r + 0.02, 0], [0, 0]].reverse() as [number, number][], 18, 0, H - 0.04, 0);
  fb.box(paint([0.03, 0.03, 0.03], true), 0.22, 0.09, 0.02, 0, H + 0.02, -r + 0.02, 0, 0.5);
  fb.panel(sign(), 0.12, 0.12, 0, 0.6, -r - 0.012, 0, 13);
  return H + 0.16;
}

function hydrant(fb: FB, v: number): number {
  const body = paint(v % 2 === 0 ? [0.72, 0.08, 0.06] : [0.92, 0.7, 0.08]);
  const caps = paint(v % 2 === 0 ? [0.72, 0.08, 0.06] : [0.15, 0.3, 0.6], true);
  fb.lathe(body, [[0, 0], [0.17, 0], [0.17, 0.04], [0.13, 0.07], [0.12, 0.09], [0.12, 0.5], [0.135, 0.52], [0.135, 0.56], [0.12, 0.58], [0.115, 0.62], [0.1, 0.7], [0.05, 0.74], [0, 0.745]], 16);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    fb.cyl(METAL, 0.012, 0.012, 0.02, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15, 6);
  }
  fb.cyl(caps, 0.03, 0.035, 0.05, 0, 0.73, 0, 5);
  // side hose nozzles (±X) and pumper nozzle (-Z)
  for (const sx of [-1, 1]) {
    fb.cyl(body, 0.045, 0.05, 0.08, sx * 0.1, 0.42, 0, 12, false, 0, 0, -sx * Math.PI / 2);
    fb.cyl(caps, 0.05, 0.05, 0.04, sx * 0.18, 0.42, 0, 12, false, 0, 0, -sx * Math.PI / 2);
    fb.cyl(caps, 0.018, 0.018, 0.03, sx * 0.22, 0.42, 0, 5, false, 0, 0, -sx * Math.PI / 2);
  }
  fb.cyl(body, 0.07, 0.075, 0.09, 0, 0.36, -0.09, 14, false, -Math.PI / 2);
  fb.cyl(caps, 0.075, 0.075, 0.05, 0, 0.36, -0.18, 14, false, -Math.PI / 2);
  fb.cyl(caps, 0.025, 0.025, 0.03, 0, 0.36, -0.23, 5, false, -Math.PI / 2);
  return 0.76;
}

function mailbox(fb: FB, v: number): number {
  if (v % 2 === 1) {
    // pillar box
    const red = paint([0.72, 0.05, 0.04], true);
    fb.lathe(paint([0.05, 0.05, 0.05], true), [[0, 0], [0.3, 0], [0.3, 0.12], [0, 0.12]], 20);
    fb.lathe(red, [[0, 0.12], [0.27, 0.12], [0.27, 0.18], [0.25, 0.2], [0.25, 1.1], [0.29, 1.14], [0.29, 1.2], [0.26, 1.23], [0.2, 1.36], [0.1, 1.42], [0, 1.44]], 20);
    fb.box(paint([0.03, 0.03, 0.03], true), 0.26, 0.035, 0.04, 0, 1.0, -0.245);
    fb.box(red, 0.3, 0.03, 0.06, 0, 1.03, -0.25);
    fb.panel(sign(), 0.2, 0.26, 0, 0.75, -0.252, 0, 12);
    fb.panel(sign(), 0.24, 0.07, 0, 1.17, -0.292, 0, 11);
    return 1.44;
  }
  const blue = paint([0.1, 0.2, 0.48]);
  const W = 0.46, D = 0.52, bodyH = 0.75, y0 = 0.32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb.box(blue, 0.05, y0 + 0.02, 0.05, sx * (W / 2 - 0.04), (y0 + 0.02) / 2, sz * (D / 2 - 0.04));
  fb.box(blue, W, bodyH, D, 0, y0 + bodyH / 2, 0);
  // rounded top (half cylinder along Z)
  const g = cylinder(W / 2, W / 2, D, 18, false, Math.PI / 2, Math.PI);
  xform(g, rotX(Math.PI / 2));
  fb.add(g, M(0, y0 + bodyH, 0), blue);
  // pull-down chute handle
  fb.box(blue, 0.32, 0.14, 0.04, 0, y0 + bodyH + 0.06, -D / 2 - 0.02, 0, 0.35);
  fb.box(METAL, 0.16, 0.025, 0.03, 0, y0 + bodyH + 0.14, -D / 2 - 0.05);
  fb.panel(sign(), 0.34, 0.3, 0, y0 + bodyH * 0.5, -D / 2 - 0.002, 0, 11);
  fb.panel(sign(), 0.36, 0.3, -W / 2 - 0.002, y0 + bodyH * 0.55, 0, -Math.PI / 2, 11);
  fb.panel(sign(), 0.36, 0.3, W / 2 + 0.002, y0 + bodyH * 0.55, 0, Math.PI / 2, 11);
  return y0 + bodyH + W / 2;
}

function bollard(fb: FB, v: number): number {
  if (v % 2 === 1) {
    fb.cyl(METAL, 0.065, 0.065, 0.9, 0, 0, 0, 14);
    fb.sphere(METAL, 0.065, 0, 0.9, 0, 1, 0.5, 1, 14, 4, Math.PI / 2);
    fb.cyl({ m: FMat.Light, e: 0.15, s: 9, c: [0.95, 0.95, 0.95] }, 0.067, 0.067, 0.05, 0, 0.72, 0, 14, true);
    fb.cyl({ m: FMat.Light, e: 0.15, s: 9, c: [0.95, 0.95, 0.95] }, 0.067, 0.067, 0.05, 0, 0.62, 0, 14, true);
    return 0.93;
  }
  const iron = paint([0.06, 0.07, 0.07]);
  fb.lathe(iron, [[0, 0], [0.12, 0], [0.12, 0.05], [0.1, 0.08], [0.095, 0.62], [0.11, 0.65], [0.11, 0.69], [0.09, 0.71], [0.085, 0.8], [0.1, 0.82], [0.1, 0.86], [0.07, 0.92], [0.03, 0.96], [0, 0.97]], 14);
  return 0.97;
}

/** A lumpy ball of foliage (planters, parklets): an icosphere bumped by noise, `fine` for a second, finer bumping. */
function foliageBall(fb: FB, r: number, x: number, y: number, z: number, col: V, seed: number, detail = 2, bump = 0.18, fine = 0.08) {
  const g = icosphere(r, detail);
  const p = g.pos;
  for (let i = 0; i < p.length; i += 3) {
    const vx = p[i], vy = p[i + 1], vz = p[i + 2];
    const k = 1 + bump * fNoise.n3(vx * 4 + seed, vy * 4, vz * 4) + (fine ? fine * fNoise.n3(vx * 11, vy * 11 + seed, vz * 11) : 0);
    p[i] = vx * k; p[i + 1] = vy * k * 0.85; p[i + 2] = vz * k;
  }
  fb.add(computeNormals(g), M(x, y, z), { m: FMat.Plastic, c: col, s: 8 });
}

function planter(fb: FB, v: number): number {
  const leaf: V = [0.22, 0.38, 0.14];
  if (v % 2 === 1) {
    // round timber planter
    const n = 20, r = 0.45;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      fb.box(WOOD, 0.14, 0.55, 0.04, Math.cos(a) * r, 0.275, Math.sin(a) * r, -a + Math.PI / 2);
    }
    for (const y of [0.1, 0.45]) fb.add(torus(r + 0.025, 0.012, 5, 24), M(0, y, 0, Math.PI / 2), METAL);
    fb.cyl({ m: FMat.Concrete, c: [0.2, 0.15, 0.1] }, r - 0.02, r - 0.02, 0.5, 0, 0.02, 0, 16);
    foliageBall(fb, 0.45, 0, 0.85, 0, leaf, 3);
    foliageBall(fb, 0.3, 0.2, 0.7, -0.15, [0.25, 0.42, 0.16], 7);
    return 1.25;
  }
  const W = 1.3, H = 0.55;
  fb.box(CONCRETE, W, 0.08, W, 0, 0.04, 0);
  for (const [x, z, w, d] of [[0, -W / 2 + 0.06, W, 0.12], [0, W / 2 - 0.06, W, 0.12], [-W / 2 + 0.06, 0, 0.12, W - 0.24], [W / 2 - 0.06, 0, 0.12, W - 0.24]] as [number, number, number, number][]) {
    fb.box(CONCRETE, w, H, d, x, H / 2, z);
  }
  fb.box({ m: FMat.Concrete, c: [0.2, 0.15, 0.1], s: 9 }, W - 0.24, 0.02, W - 0.24, 0, H - 0.06, 0);
  foliageBall(fb, 0.42, -0.15, H + 0.25, 0.1, leaf, 1);
  foliageBall(fb, 0.36, 0.22, H + 0.2, -0.15, [0.2, 0.34, 0.12], 2);
  foliageBall(fb, 0.3, 0.1, H + 0.45, 0.2, [0.26, 0.42, 0.15], 5);
  return H + 0.85;
}

function busStop(fb: FB, v: number, lights: Lights): number {
  const frame = v % 2 === 0 ? { m: FMat.Metal } as PO : paint([0.12, 0.13, 0.14], true);
  const L = 4.2, D = 1.5, H = 2.5;
  const zb = D / 2 - 0.05;
  // posts
  for (const x of [-L / 2, -L / 6, L / 6, L / 2]) {
    fb.box(frame, 0.08, H, 0.08, x, H / 2, zb);
    if (Math.abs(x) > L / 3) fb.box(frame, 0.08, H, 0.08, x, H / 2, -D / 2 + 0.25);
  }
  // roof: sloped canopy with fascia
  fb.box(frame, L + 0.4, 0.12, D + 0.3, 0, H + 0.08, 0.0, 0, 0.04);
  fb.box(GLASS, L + 0.2, 0.02, D + 0.1, 0, H + 0.15, 0.0, 0, 0.04);
  fb.box(frame, L + 0.42, 0.22, 0.05, 0, H + 0.03, -D / 2 - 0.15);
  fb.box(LAMP(1), L - 0.4, 0.02, 0.08, 0, H + 0.01, 0.1);
  // back glass wall (3 panes) and side glass
  for (let i = 0; i < 3; i++) {
    const x = -L / 3 + i * (L / 3);
    fb.box(GLASS, L / 3 - 0.1, H - 0.4, 0.015, x, (H - 0.4) / 2 + 0.2, zb);
    fb.box(frame, L / 3 - 0.08, 0.05, 0.05, x, 0.18, zb);
    fb.box(frame, L / 3 - 0.08, 0.05, 0.05, x, H - 0.2, zb);
  }
  fb.box(GLASS, 0.015, H - 0.4, D - 0.35, -L / 2, (H - 0.4) / 2 + 0.2, 0.08);
  // ad panel at +X end (back-lit)
  const ax = L / 2;
  fb.box(frame, 0.16, 1.95, 1.32, ax, 0.2 + 1.95 / 2, 0.08);
  fb.panel(sign(1), 1.18, 1.75, ax - 0.082, 0.2 + 1.95 / 2, 0.08, Math.PI / 2, v % 2 === 0 ? 3 : 4);
  fb.panel(sign(1), 1.18, 1.75, ax + 0.082, 0.2 + 1.95 / 2, 0.08, -Math.PI / 2, v % 2 === 0 ? 4 : 3);
  // bench
  for (const x of [-1.2, 0, 1.2]) fb.box(frame, 0.05, 0.45, 0.05, x, 0.225, zb - 0.25);
  fb.box(WOOD, 2.8, 0.04, 0.38, 0, 0.47, zb - 0.25);
  // timetable inside
  fb.panel(sign(1), 0.6, 0.8, -1.2, 1.5, zb - 0.012, 0, 13);
  // bus stop sign pole at -X front
  fb.cyl(METAL, 0.035, 0.035, 2.9, -L / 2 - 0.5, 0, -D / 2 - 0.1, 10);
  fb.polyPlate(sign(), sign(), 24, 0.34, 0.03, -L / 2 - 0.5, 2.55, -D / 2 - 0.1, 0, 2);
  fb.box(METAL, 0.32, 0.45, 0.05, -L / 2 - 0.5, 1.6, -D / 2 - 0.1);
  fb.panel(sign(), 0.28, 0.4, -L / 2 - 0.5, 1.6, -D / 2 - 0.1 - 0.027, 0, 13);
  lights.push({ pos: [0, H - 0.05, 0.1], color: LED, intensity: 0.35 });
  return H + 0.25;
}

function fountain(fb: FB, v: number): number {
  const R = v % 2 === 0 ? 3.0 : 2.4;
  const st = STONE;
  fb.lathe(st, [[R - 0.35, 0.12], [R - 0.35, 0.5], [R - 0.3, 0.55], [R + 0.12, 0.55], [R + 0.16, 0.5], [R + 0.12, 0.45], [R + 0.08, 0.1], [R + 0.18, 0.04], [R + 0.18, -0.05]].reverse() as [number, number][], 48);
  fb.lathe(st, [[0, 0.05], [R - 0.3, 0.05], [R - 0.3, 0.12]].reverse() as [number, number][], 48);
  fb.lathe(WATER, [[0, 0.4], [R - 0.34, 0.4]].reverse() as [number, number][], 48);
  // central column + tiers
  fb.lathe(st, [[0, 0.05], [0.55, 0.05], [0.55, 0.25], [0.45, 0.3], [0.32, 0.4], [0.25, 0.7], [0.22, 1.1], [0.3, 1.18], [0, 1.18]], 20);
  fb.lathe(st, [[0, 1.12], [0.3, 1.12], [0.7, 1.22], [1.1, 1.35], [1.18, 1.45], [1.12, 1.47], [1.05, 1.42], [0.3, 1.36], [0, 1.36]], 32);
  fb.lathe(WATER, [[0, 1.41], [1.06, 1.41]].reverse() as [number, number][], 32);
  fb.lathe(st, [[0, 1.36], [0.17, 1.36], [0.14, 1.7], [0.12, 2.0], [0.18, 2.06], [0, 2.06]], 16);
  fb.lathe(st, [[0, 2.02], [0.15, 2.02], [0.4, 2.1], [0.6, 2.2], [0.64, 2.27], [0.58, 2.28], [0.15, 2.2], [0, 2.2]], 24);
  fb.lathe(WATER, [[0, 2.25], [0.58, 2.25]].reverse() as [number, number][], 24);
  fb.lathe(st, [[0, 2.2], [0.08, 2.2], [0.1, 2.35], [0.05, 2.45], [0.06, 2.5], [0, 2.52]], 12);
  // falling water sheets from bowl rims and the jet
  fb.lathe({ m: FMat.Water, e: 0, s: 1 }, [[1.17, 1.44], [1.22, 1.3], [1.28, 0.9], [1.32, 0.42]].reverse() as [number, number][], 32);
  fb.lathe({ m: FMat.Water, e: 0, s: 1 }, [[0.63, 2.26], [0.68, 2.1], [0.72, 1.7], [0.74, 1.42]].reverse() as [number, number][], 24);
  fb.lathe({ m: FMat.Water, e: 0, s: 1 }, [[0.0, 3.25], [0.05, 3.2], [0.04, 2.9], [0.03, 2.5]].reverse() as [number, number][], 10);
  fb.lathe({ m: FMat.Water, e: 0, s: 1 }, [[0.03, 3.22], [0.18, 3.15], [0.35, 2.85], [0.45, 2.4], [0.5, 2.26]].reverse() as [number, number][], 16);
  return 3.3;
}

function human(fb: FB, x: number, y: number, z: number, s: number, pose: number, po: PO) {
  // a stylised standing figure facing -Z; y = feet
  const body = (px: number, py: number, pz: number): V => [x + px * s, y + py * s, z + pz * s];
  // legs and shoes
  for (const sx of [-1, 1]) {
    fb.capsule(po, body(sx * 0.11, 0.08, -0.02), body(sx * 0.1, 0.5, 0), 0.06 * s, 0.07 * s, 8);
    fb.capsule(po, body(sx * 0.1, 0.5, 0), body(sx * 0.1, 0.92, 0.01), 0.07 * s, 0.085 * s, 8);
    fb.sphere(po, 0.07 * s, ...body(sx * 0.11, 0.05, -0.07), 1, 0.6, 1.7, 8, 5);
  }
  // long coat
  fb.lathe(po, [[0.0, 0.62], [0.27, 0.62], [0.24, 0.9], [0.2, 1.1], [0.0, 1.1]].map(([r, yy]) => [r * s, yy * s]) as [number, number][], 14, x, y, z, 0, 1.1, 0.85);
  // torso
  fb.lathe(po, [[0, 1.05], [0.19, 1.08], [0.21, 1.3], [0.23, 1.45], [0.2, 1.52], [0.08, 1.56], [0, 1.56]].map(([r, yy]) => [r * s, yy * s]) as [number, number][], 14, x, y, z, 0, 1.15, 0.75);
  // neck + head
  fb.capsule(po, body(0, 1.52, 0), body(0, 1.6, 0), 0.055 * s, 0.05 * s, 8);
  fb.sphere(po, 0.11 * s, ...body(0, 1.71, -0.01), 0.9, 1.1, 1.0, 12, 9);
  fb.sphere(po, 0.03 * s, ...body(0, 1.69, -0.11), 1, 1.3, 1, 6, 4);
  // arms
  fb.capsule(po, body(-0.25, 1.46, 0), body(-0.3, 1.15, 0.02), 0.055 * s, 0.05 * s, 8);
  fb.capsule(po, body(-0.3, 1.15, 0.02), body(-0.3, 0.9, -0.04), 0.05 * s, 0.04 * s, 8);
  if (pose === 0) {
    fb.capsule(po, body(0.25, 1.46, 0), body(0.4, 1.62, -0.25), 0.055 * s, 0.05 * s, 8);
    fb.capsule(po, body(0.4, 1.62, -0.25), body(0.5, 1.82, -0.5), 0.05 * s, 0.04 * s, 8);
  } else {
    fb.capsule(po, body(0.25, 1.46, 0), body(0.3, 1.2, -0.12), 0.055 * s, 0.05 * s, 8);
    fb.capsule(po, body(0.3, 1.2, -0.12), body(0.12, 1.25, -0.22), 0.05 * s, 0.04 * s, 8);
  }
}

function statue(fb: FB, v: number): number {
  const equestrian = v % 2 === 1;
  const pw = equestrian ? 1.8 : 1.5, pd = equestrian ? 3.2 : 1.5, ph = equestrian ? 2.2 : 2.0;
  // pedestal: steps, base moulding, die, cornice
  fb.box(STONE, pw + 0.8, 0.2, pd + 0.8, 0, 0.1, 0);
  fb.box(STONE, pw + 0.45, 0.2, pd + 0.45, 0, 0.3, 0);
  fb.box(STONE, pw + 0.2, 0.15, pd + 0.2, 0, 0.475, 0);
  fb.box(STONE, pw, ph - 0.85, pd, 0, 0.55 + (ph - 0.85) / 2, 0);
  fb.box(STONE, pw + 0.22, 0.12, pd + 0.22, 0, ph - 0.24, 0);
  fb.box(STONE, pw + 0.1, 0.1, pd + 0.1, 0, ph - 0.13, 0);
  fb.box(STONE, pw - 0.1, 0.08, pd - 0.1, 0, ph - 0.04, 0);
  fb.box(BRONZE, pw * 0.55, 0.35, 0.03, 0, 1.15, -pd / 2 - 0.01);
  const top = ph;
  if (!equestrian) {
    fb.box(BRONZE, 0.9, 0.06, 0.9, 0, top + 0.03, 0);
    human(fb, 0, top + 0.06, 0, 1.45, 0, BRONZE);
    return top + 2.9;
  }
  // horse (facing -Z), rider on top
  const y0 = top + 0.06;
  fb.box(BRONZE, 1.0, 0.06, 2.6, 0, top + 0.03, 0);
  const H = (px: number, py: number, pz: number): V => [px, y0 + py, pz];
  fb.capsule(BRONZE, H(0, 1.45, 0.55), H(0, 1.5, -0.6), 0.36, 0.38, 14);
  fb.sphere(BRONZE, 0.42, ...H(0, 1.45, 0.62), 1, 0.95, 1.05, 12, 8);
  fb.capsule(BRONZE, H(0, 1.6, -0.75), H(0, 2.2, -1.05), 0.26, 0.17, 12);
  fb.capsule(BRONZE, H(0, 2.25, -1.05), H(0, 2.0, -1.45), 0.14, 0.08, 10);
  fb.sphere(BRONZE, 0.06, ...H(-0.08, 2.38, -1.0), 1, 2, 1, 6, 4);
  fb.sphere(BRONZE, 0.06, ...H(0.08, 2.38, -1.0), 1, 2, 1, 6, 4);
  fb.box(BRONZE, 0.08, 0.5, 0.25, 0, 2.05, -0.95);
  // legs: hind legs planted, one front leg raised
  for (const sx of [-1, 1]) {
    fb.capsule(BRONZE, H(sx * 0.2, 1.3, 0.7), H(sx * 0.2, 0.75, 0.82), 0.14, 0.08, 8);
    fb.capsule(BRONZE, H(sx * 0.2, 0.75, 0.82), H(sx * 0.2, 0.06, 0.72), 0.07, 0.065, 8);
  }
  fb.capsule(BRONZE, H(-0.2, 1.25, -0.65), H(-0.2, 0.7, -0.7), 0.11, 0.07, 8);
  fb.capsule(BRONZE, H(-0.2, 0.7, -0.7), H(-0.2, 0.06, -0.72), 0.065, 0.065, 8);
  fb.capsule(BRONZE, H(0.2, 1.25, -0.65), H(0.2, 1.0, -1.1), 0.11, 0.07, 8);
  fb.capsule(BRONZE, H(0.2, 1.0, -1.1), H(0.2, 0.62, -1.0), 0.065, 0.06, 8);
  fb.tube(BRONZE, [H(0, 1.6, 1.0), H(0, 1.4, 1.2), H(0, 0.9, 1.25), H(0, 0.55, 1.18)], 0.09, 8, 10, 0.04);
  // rider
  const R = (px: number, py: number, pz: number): V => [px, y0 + py, pz];
  for (const sx of [-1, 1]) {
    fb.capsule(BRONZE, R(sx * 0.2, 1.95, -0.05), R(sx * 0.42, 1.55, -0.25), 0.09, 0.075, 8);
    fb.capsule(BRONZE, R(sx * 0.42, 1.55, -0.25), R(sx * 0.42, 1.1, -0.1), 0.07, 0.06, 8);
  }
  fb.lathe(BRONZE, [[0, 1.85], [0.22, 1.9], [0.24, 2.2], [0.25, 2.45], [0.2, 2.52], [0.07, 2.56], [0, 2.56]], 12, 0, y0, 0, 0, 1.15, 0.75);
  fb.capsule(BRONZE, R(0, 2.52, 0), R(0, 2.6, 0), 0.055, 0.05, 8);
  fb.sphere(BRONZE, 0.12, ...R(0, 2.72, -0.01), 0.9, 1.1, 1, 12, 8);
  fb.lathe(BRONZE, [[0, 0], [0.2, 0], [0.2, 0.02], [0.1, 0.05], [0.09, 0.15], [0, 0.16]], 12, 0, y0 + 2.8, 0);
  fb.capsule(BRONZE, R(-0.27, 2.45, 0), R(-0.25, 2.1, -0.3), 0.055, 0.05, 8);
  fb.capsule(BRONZE, R(-0.25, 2.1, -0.3), R(-0.1, 2.05, -0.55), 0.05, 0.04, 8);
  fb.capsule(BRONZE, R(0.27, 2.45, 0), R(0.45, 2.7, -0.3), 0.055, 0.05, 8);
  fb.capsule(BRONZE, R(0.45, 2.7, -0.3), R(0.55, 3.05, -0.55), 0.05, 0.04, 8);
  fb.rod(BRONZE, R(0.55, 2.9, -0.4), R(0.62, 3.6, -0.75), 0.02, 6);
  return y0 + 3.6;
}

function kiosk(fb: FB, v: number): number {
  const green = paint([0.08, 0.22, 0.16]);
  if (v % 2 === 0) {
    // Parisian-style octagonal kiosk
    const R = 1.25;
    fb.lathe(green, [[0, 0], [R + 0.05, 0], [R + 0.05, 0.12], [R, 0.15], [R, 1.0], [R + 0.04, 1.05], [R + 0.04, 1.1], [0, 1.1]], 8, 0, 0, 0, Math.PI / 8);
    fb.lathe(GLASS, [[R - 0.05, 1.1], [R - 0.05, 2.1], [0, 2.1]], 8, 0, 0, 0, Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fb.box(green, 0.07, 1.0, 0.07, Math.cos(a) * (R - 0.02), 1.6, Math.sin(a) * (R - 0.02));
    }
    // sign band (8 panels)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rr = R * Math.cos(Math.PI / 8) + 0.06;
      const w = 2 * R * Math.sin(Math.PI / 8) + 0.06;
      fb.box(green, w, 0.4, 0.04, Math.cos(a) * (rr - 0.03), 2.3, Math.sin(a) * (rr - 0.03), -a + Math.PI / 2);
      fb.panel(sign(1), w * 0.9, 0.32, Math.cos(a) * (rr - 0.005), 2.3, Math.sin(a) * (rr - 0.005), -a - Math.PI / 2, 10);
    }
    // flared roof / onion dome and finial
    fb.lathe(green, [[0, 2.5], [R + 0.35, 2.5], [R + 0.38, 2.56], [R + 0.1, 2.75], [0.8, 2.95], [0.5, 3.25], [0.35, 3.5], [0.25, 3.6], [0, 3.62]], 8, 0, 0, 0, Math.PI / 8);
    fb.lathe(green, [[0, 3.6], [0.08, 3.6], [0.12, 3.75], [0.04, 3.95], [0, 4.1]], 8);
    // counter + magazines on the front
    fb.box(green, 1.0, 0.06, 0.3, 0, 1.12, -R - 0.12);
    fb.panel(sign(), 0.95, 0.75, 0, 1.55, -R + 0.01, 0, 5, -0.12);
    return 4.1;
  }
  // modern box kiosk with awning
  const W = 3.0, D = 2.0, H = 2.6;
  fb.box(green, W, 1.0, D, 0, 0.5, 0);
  fb.box(GLASS, W - 0.1, H - 1.0, D - 0.1, 0, 1.0 + (H - 1.0) / 2, 0);
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) fb.box(green, 0.08, H, 0.08, x, H / 2, z);
  fb.box(green, W + 0.2, 0.18, D + 0.2, 0, H + 0.09, 0);
  fb.panel(sign(1), W - 0.3, 0.32, 0, H + 0.4, -D / 2 - 0.06, 0, 10);
  fb.box(green, W, 0.4, 0.1, 0, H + 0.4, -D / 2);
  // striped awning
  for (let i = 0; i < 8; i++) {
    const x = -W / 2 + (i + 0.5) * (W / 8);
    fb.box(paint(i % 2 === 0 ? [0.85, 0.82, 0.75] : [0.1, 0.3, 0.2], true), W / 8, 0.02, 0.9, x, H - 0.1, -D / 2 - 0.4, 0, -0.35);
  }
  fb.box(green, W + 0.04, 0.06, 0.12, 0, 1.05, -D / 2 - 0.15);
  fb.panel(sign(), W - 0.4, 0.7, 0, 1.5, -D / 2 - 0.06, 0, 5);
  return H + 0.6;
}

function stopSign(fb: FB, v: number): number {
  const post = v % 2 === 0;
  if (post) fb.box(METAL, 0.05, 2.6, 0.05, 0, 1.3, 0.03);
  else fb.cyl(METAL, 0.03, 0.03, 2.6, 0, 0, 0.03, 10);
  fb.polyPlate(sign(), METAL, 8, 0.4, 0.012, 0, 2.2, -0.0, 0, 0, Math.PI / 8);
  fb.box(METAL, 0.06, 0.08, 0.04, 0, 2.38, 0.02);
  fb.box(METAL, 0.06, 0.08, 0.04, 0, 2.02, 0.02);
  return 2.65;
}

function playground(fb: FB, v: number): number {
  const c1: V = v % 2 === 0 ? [0.85, 0.15, 0.1] : [0.1, 0.45, 0.8];
  const c2: V = v % 2 === 0 ? [0.95, 0.75, 0.1] : [0.2, 0.7, 0.3];
  const post = paint([0.15, 0.4, 0.2], true);
  const ox = -2.2;
  // tower: 4 posts, platform, roof
  for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) fb.box(WOOD, 0.1, 3.0, 0.1, ox + x, 1.5, z);
  fb.box(WOOD, 1.3, 0.06, 1.3, ox, 1.5, 0);
  fb.lathe(plastic(c1, true), [[0, 3.6], [0.95, 2.95], [0.95, 2.9], [0, 2.9]].reverse() as [number, number][], 4, ox, 0, 0, Math.PI / 4);
  // railings / panels
  fb.box(plastic(c2, true), 1.2, 0.6, 0.03, ox, 1.85, 0.62);
  fb.box(plastic(c2, true), 0.03, 0.6, 1.2, ox - 0.62, 1.85, 0);
  for (let i = 0; i < 5; i++) fb.rod(post, [ox + 0.62, 1.53, -0.5 + i * 0.25], [ox + 0.62, 2.15, -0.5 + i * 0.25], 0.02, 6);
  fb.rod(post, [ox + 0.62, 2.15, -0.6], [ox + 0.62, 2.15, 0.6], 0.025, 6);
  // ladder on -Z side
  for (const x of [-0.25, 0.25]) fb.rod(post, [ox + x, 0, -1.5], [ox + x, 1.55, -0.62], 0.03, 6);
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    fb.rod(METAL, [ox - 0.25, t * 1.55, -1.5 + t * 0.88], [ox + 0.25, t * 1.55, -1.5 + t * 0.88], 0.018, 6);
  }
  // slide chute on +Z side: U profile swept along a curve
  {
    const path = new CatmullRom([[ox, 1.52, 0.62], [ox, 1.3, 1.1], [ox, 0.7, 2.2], [ox, 0.35, 3.0], [ox, 0.3, 3.5]]);
    const prof: [number, number][] = [[-0.3, 0.25], [-0.3, 0.02], [-0.22, 0], [0.22, 0], [0.3, 0.02], [0.3, 0.25]];
    const segs = 16;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = path.at(t);
      for (const [px, py] of prof) {
        pos.push(p[0] + px, p[1] + py, p[2]);
        uv.push(px, t);
      }
    }
    const n = prof.length;
    for (let i = 0; i < segs; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = computeNormals({ pos, nrm: [], uv, idx });
    fb.add(g, identity(), plastic(c2, true), undefined, true);
    fb.rod(post, [ox - 0.2, 0, 3.3], [ox - 0.2, 0.3, 3.3], 0.03, 6);
    fb.rod(post, [ox + 0.2, 0, 3.3], [ox + 0.2, 0.3, 3.3], 0.03, 6);
  }
  // swing frame (A-frames) on +X
  const sx0 = 1.8, beamY = 2.35, half = 1.4;
  for (const z of [-half, half]) {
    fb.rod(post, [sx0 - 0.8, 0, z], [sx0, beamY, z], 0.05, 8);
    fb.rod(post, [sx0 + 0.8, 0, z], [sx0, beamY, z], 0.05, 8);
  }
  fb.rod(post, [sx0, beamY, -half - 0.1], [sx0, beamY, half + 0.1], 0.055, 10);
  for (const z of [-0.6, 0.6]) {
    for (const dz of [-0.2, 0.2]) fb.rod(METAL, [sx0 - 0.05, beamY, z + dz], [sx0, 0.48, z + dz], 0.008, 4);
    fb.box(RUBBER, 0.2, 0.03, 0.46, sx0, 0.46, z);
  }
  // rubber safety surface tiles
  fb.box({ m: FMat.Rubber, c: [0.25, 0.1, 0.08] }, 2.4, 0.03, 3.4, sx0, 0.015, 0);
  return 3.6;
}

function manhole(fb: FB, v: number): number {
  const r = 0.33;
  // cover: textured disc
  const seg = 24;
  const [u0, v0, u1, v1] = pictureRect(9);
  const pos: number[] = [0, 0.02, 0], nrm: number[] = [0, 1, 0], uv: number[] = [(u0 + u1) / 2, (v0 + v1) / 2], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    nrm.push(0, 1, 0);
    uv.push(u0 + (u1 - u0) * (0.5 + Math.cos(a) * 0.5), v0 + (v1 - v0) * (0.5 - Math.sin(a) * 0.5));
    if (i < seg) idx.push(0, i + 2, i + 1);
  }
  fb.add({ pos, nrm, uv, idx }, identity(), { m: FMat.Signage, c: [1, 1, 1] });
  // frame ring
  fb.lathe(METAL, [[r, 0.02], [r + 0.01, 0.025], [r + 0.07, 0.022], [r + 0.09, 0.0]].reverse() as [number, number][], seg);
  if (v % 2 === 1) fb.lathe(CONCRETE, [[r + 0.09, 0.0], [r + 0.1, 0.012], [r + 0.3, 0.008], [r + 0.32, -0.01]].reverse() as [number, number][], seg);
  return 0.03;
}

function newsStand(fb: FB, v: number): number {
  const cols: V[] = v % 2 === 0 ? [[0.1, 0.25, 0.6], [0.75, 0.1, 0.08], [0.95, 0.75, 0.1]] : [[0.1, 0.4, 0.2], [0.9, 0.9, 0.88], [0.2, 0.2, 0.22]];
  cols.forEach((c, i) => {
    const x = (i - 1) * 0.56;
    const po = plastic(c, true);
    fb.box(METAL, 0.05, 0.4, 0.05, x - 0.18, 0.2, 0);
    fb.box(METAL, 0.05, 0.4, 0.05, x + 0.18, 0.2, 0);
    fb.box(METAL, 0.45, 0.04, 0.4, x, 0.02, 0);
    fb.box(po, 0.5, 0.65, 0.44, x, 0.4 + 0.325, 0);
    fb.box(po, 0.5, 0.06, 0.48, x, 1.08, 0.0, 0, -0.1);
    // window with newspaper
    fb.box(paint([0.05, 0.05, 0.05], true), 0.42, 0.38, 0.02, x, 0.86, -0.225);
    fb.panel(sign(), 0.36, 0.32, x, 0.86, -0.237, 0, 5);
    fb.box(METAL, 0.12, 0.1, 0.04, x + 0.13, 0.55, -0.235);
  });
  return 1.12;
}

function bikeRack(fb: FB, v: number): number {
  const n = v % 2 === 0 ? 5 : 3;
  const po = { m: FMat.Metal } as PO;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.8;
    const pts: V[] = [[x, 0, -0.3], [x, 0.6, -0.3]];
    for (let k = 1; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      pts.push([x, 0.6 + Math.sin(a) * 0.25, -Math.cos(a) * 0.3]);
    }
    pts.push([x, 0.6, 0.3], [x, 0, 0.3]);
    fb.tube(po, pts, 0.026, 8, 28);
  }
  return 0.85;
}

function phoneBooth(fb: FB, v: number): number {
  if (v % 2 === 0) {
    // classic red kiosk
    const red = paint([0.72, 0.05, 0.04]);
    const W = 0.95, H = 2.45;
    fb.box(CONCRETE, W + 0.15, 0.12, W + 0.15, 0, 0.06, 0);
    fb.box(red, W, 0.18, W, 0, 0.21, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) fb.box(red, 0.1, H - 0.3, 0.1, x * (W / 2 - 0.05), 0.3 + (H - 0.3) / 2, z * (W / 2 - 0.05));
    // glazed sides with glazing bars (3 x 8 panes)
    for (let s = 0; s < 4; s++) {
      const ry = (s * Math.PI) / 2;
      const nx = Math.sin(ry), nz = -Math.cos(ry);
      const cx = nx * (W / 2 - 0.04), cz = nz * (W / 2 - 0.04);
      fb.box(GLASS, W - 0.2, 1.65, 0.01, cx, 1.18, cz, ry);
      for (let i = 0; i <= 3; i++) {
        const o = -0.375 + i * 0.25;
        fb.box(red, 0.03, 1.65, 0.035, cx + Math.cos(ry) * o, 1.18, cz + Math.sin(ry) * o, ry);
      }
      for (let j = 0; j <= 8; j++) fb.box(red, W - 0.2, 0.03, 0.035, cx, 0.36 + j * (1.65 / 8), cz, ry);
      // header sign
      fb.box(red, W - 0.1, 0.22, 0.04, nx * (W / 2 - 0.02), 2.15, nz * (W / 2 - 0.02), ry);
      fb.panel(sign(1), W - 0.25, 0.14, nx * (W / 2 + 0.002), 2.15, nz * (W / 2 + 0.002), ry, 6);
    }
    // stepped domed roof
    fb.box(red, W + 0.06, 0.08, W + 0.06, 0, 2.3, 0);
    const g = cylinder(W / 2 + 0.02, W / 2 + 0.02, W + 0.04, 12, false, 0, Math.PI);
    xform(g, rotZ(Math.PI / 2));
    fb.add(g, M(0, 2.34, 0, 0, 0, 0, 1, 0.4, 1), red);
    const g2 = cylinder(W / 2 + 0.02, W / 2 + 0.02, W + 0.04, 12, false, 0, Math.PI);
    xform(g2, rotZ(Math.PI / 2));
    fb.add(g2, M(0, 2.34, 0, 0, Math.PI / 2, 0, 1, 0.4, 1), red);
    fb.box(red, 0.18, 0.08, 0.18, 0, 2.55, 0);
    fb.box({ m: FMat.Light, e: 0.6, c: [1, 0.95, 0.85] }, 0.25, 0.04, 0.25, 0, 2.27, 0);
    // phone inside
    fb.box(METAL, 0.3, 0.4, 0.15, 0, 1.4, W / 2 - 0.15);
    return 2.6;
  }
  // modern open phone stand
  fb.box(METAL, 0.12, 2.2, 0.12, 0, 1.1, 0.25);
  fb.box(paint([0.15, 0.17, 0.2], true), 0.9, 0.08, 0.7, 0, 2.2, 0.0);
  fb.box(GLASS, 0.02, 1.4, 0.6, -0.44, 1.45, 0.0);
  fb.box(GLASS, 0.02, 1.4, 0.6, 0.44, 1.45, 0.0);
  fb.box(paint([0.15, 0.17, 0.2], true), 0.5, 0.6, 0.18, 0, 1.35, 0.15);
  fb.box(METAL, 0.3, 0.35, 0.02, 0, 1.4, 0.055);
  fb.panel(sign(1), 0.8, 0.12, 0, 2.2, -0.352, 0, 6);
  fb.box({ m: FMat.Light, e: 0.6, c: [0.95, 0.95, 1] }, 0.6, 0.02, 0.4, 0, 2.155, 0.0);
  return 2.25;
}

/**
 * Kerbside EV charging post (front -Z faces the parking bay): a slim rounded column with a
 * screen, a status light ring and the charging cable coiled on its holster. v1: a lower
 * twin-socket bollard type.
 */
function evCharger(fb: FB, v: number): number {
  const body = paint([0.9, 0.91, 0.9], true);
  const dark = plastic([0.12, 0.13, 0.14], true);
  const led: PO = { m: FMat.Light, e: 1, s: 10, c: [0.2, 0.9, 1] };
  fb.box(CONCRETE, 0.5, 0.06, 0.4, 0, 0.03, 0);
  if (v % 2 === 0) {
    const H = 1.55;
    fb.lathe(body, [[0, 0.06], [0.16, 0.06], [0.17, 0.1], [0.17, H - 0.12], [0.15, H - 0.03], [0.1, H], [0, H]], 20, 0, 0, 0, 0, 1, 0.72);
    // Dark face with the screen and the status light band.
    fb.box(dark, 0.22, 0.62, 0.03, 0, 1.08, -0.115);
    fb.box(plastic([0.04, 0.1, 0.18], true), 0.16, 0.12, 0.01, 0, 1.25, -0.132);
    fb.box(led, 0.1, 0.012, 0.012, 0, 1.22, -0.136);
    fb.box(led, 0.17, 0.025, 0.012, 0, 1.43, -0.122);
    fb.box(led, 0.022, 0.4, 0.012, -0.135, 0.75, -0.06, 0.55);
    // Socket, holster and the cable hanging in a loop.
    fb.box(dark, 0.09, 0.12, 0.06, 0, 0.88, -0.14);
    fb.box(dark, 0.07, 0.16, 0.07, 0.15, 0.95, -0.02);
    fb.tube(RUBBER, [[0.17, 0.9, -0.03], [0.24, 0.6, -0.08], [0.2, 0.32, -0.12], [0.06, 0.38, -0.16], [0.0, 0.82, -0.15]], 0.016, 6, 24);
    return H;
  }
  const H = 1.05;
  fb.box(body, 0.3, H - 0.06, 0.26, 0, 0.06 + (H - 0.06) / 2, 0);
  fb.box(dark, 0.31, 0.06, 0.27, 0, H - 0.03, 0);
  for (const z of [-1, 1]) {
    fb.box(dark, 0.18, 0.2, 0.02, 0, 0.72, z * 0.135);
    fb.box(led, 0.16, 0.02, 0.012, 0, 0.9, z * 0.14);
  }
  fb.box(led, 0.31, 0.015, 0.27, 0, H - 0.07, 0);
  return H;
}

// ---------------------------------------------------------------------------------------------
// Café and restaurant terraces (plan/terrace.ts). Kept low-poly: there are many of them.
// Fabric and chair paint take the café's colours through iColor.
// ---------------------------------------------------------------------------------------------

/** Low-detail foliage clump (planters on parklets). */
const smallFoliage = (fb: FB, r: number, x: number, y: number, z: number, col: V, seed: number) => foliageBall(fb, r, x, y, z, col, seed, 1, 0.16, 0);

/** Round bistro table (cast-iron foot, marble top) or square timber table. Top at 0.74 m. */
function cafeTable(fb: FB, v: number): number {
  const iron = paint([0.07, 0.07, 0.07], true);
  if (v % 2 === 0) {
    fb.cyl(iron, 0.2, 0.24, 0.04, 0, 0, 0, 10);
    fb.cyl(iron, 0.028, 0.034, 0.68, 0, 0.04, 0, 6);
    fb.cyl({ m: FMat.Concrete, c: [0.9, 0.89, 0.86] }, 0.33, 0.33, 0.03, 0, 0.71, 0, 14);
    fb.cyl(METAL, 0.335, 0.335, 0.012, 0, 0.705, 0, 14, true);
    return 0.74;
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb.box(WOOD, 0.045, 0.7, 0.045, sx * 0.31, 0.35, sz * 0.31);
  fb.box(WOOD, 0.72, 0.04, 0.72, 0, 0.72, 0);
  fb.box(WOOD, 0.6, 0.06, 0.03, 0, 0.67, 0.31);
  fb.box(WOOD, 0.6, 0.06, 0.03, 0, 0.67, -0.31);
  return 0.74;
}

/** Bistro chair (painted frame, woven seat) or timber chair. The sitter faces -Z. */
function cafeChair(fb: FB, v: number): number {
  if (v % 2 === 0) {
    const frame = paint([0.1, 0.1, 0.1]);
    const weave: PO = { m: FMat.Wood, c: [0.62, 0.48, 0.3] };
    for (const sx of [-1, 1]) {
      fb.rod(frame, [sx * 0.18, 0, -0.19], [sx * 0.16, 0.45, -0.16], 0.012, 5);
      fb.rod(frame, [sx * 0.18, 0, 0.21], [sx * 0.16, 0.45, 0.17], 0.012, 5);
      fb.rod(frame, [sx * 0.16, 0.45, 0.17], [sx * 0.15, 0.86, 0.22], 0.012, 5);
    }
    fb.cyl(weave, 0.2, 0.2, 0.035, 0, 0.44, 0, 10);
    fb.box(weave, 0.32, 0.12, 0.02, 0, 0.76, 0.21, 0, -0.12);
    fb.box(weave, 0.32, 0.07, 0.02, 0, 0.6, 0.195, 0, -0.12);
    return 0.86;
  }
  const wood: PO = { m: FMat.Wood, c: [0.42, 0.27, 0.15] };
  for (const sx of [-1, 1]) {
    fb.box(wood, 0.035, 0.45, 0.035, sx * 0.18, 0.225, -0.18);
    fb.box(wood, 0.035, 0.9, 0.035, sx * 0.18, 0.45, 0.19);
  }
  fb.box(wood, 0.42, 0.035, 0.42, 0, 0.46, 0);
  for (const y of [0.6, 0.72, 0.84]) fb.box(wood, 0.36, 0.06, 0.02, 0, y, 0.19);
  return 0.9;
}

/** Market parasol: square (v0, 2.6 m) or round (v1, 2.3 m); LED strip under the canopy at night. */
function parasol(fb: FB, v: number): number {
  const fabric = plastic([0.92, 0.9, 0.84]);
  const pole: PO = { m: FMat.Wood, c: [0.5, 0.36, 0.22] };
  const led: PO = { m: FMat.Light, e: 0.4, c: [1, 0.8, 0.55] };
  const H = 2.45, sq = v % 2 === 0;
  fb.cyl(paint([0.08, 0.08, 0.08], true), 0.2, 0.22, 0.05, 0, 0, 0, 8);
  fb.cyl(pole, 0.026, 0.026, H - 0.02, 0, 0.05, 0, 6);
  const R = sq ? 1.84 : 1.15, segs = sq ? 4 : 8, h = sq ? 0.5 : 0.42;
  const cone = cylinder(0.04, R, h, segs, true);
  xform(cone, move(0, h / 2, 0));
  fb.add(cone, M(0, H - h - 0.03, 0, 0, sq ? Math.PI / 4 : Math.PI / 8), fabric, undefined, true);
  if (sq) {
    for (const [x, z, w, d] of [[0, -1.3, 2.6, 0.01], [0, 1.3, 2.6, 0.01], [-1.3, 0, 0.01, 2.6], [1.3, 0, 0.01, 2.6]] as [number, number, number, number][]) fb.box(fabric, w, 0.16, d, x, H - h - 0.1, z);
  } else {
    const val = cylinder(R * 0.995, R * 0.995, 0.13, 8, true);
    xform(val, move(0, -0.065, 0));
    fb.add(val, M(0, H - h - 0.03, 0, 0, Math.PI / 8), fabric, undefined, true);
  }
  fb.cyl(pole, 0.04, 0.03, 0.12, 0, H - 0.06, 0, 6);
  fb.add(torus(R * 0.42, 0.022, 3, sq ? 4 : 8), M(0, H - h + 0.04, 0, Math.PI / 2, 0, sq ? Math.PI / 4 : 0), led);
  return H + 0.06;
}

/** Striped folding-arm awning over a shop window, 2.4 m (v0) or 3.2 m (v1) wide; top at 3 m, on the wall (z = 0). */
function awning(fb: FB, v: number): number {
  const W = v % 2 === 0 ? 2.4 : 3.2, top = 3.0, drop = 0.45, proj = 1.3;
  const colour = plastic([0.9, 0.88, 0.82]);
  const white = plastic([0.93, 0.92, 0.88], true);
  const slope = Math.hypot(proj, drop), pitch = Math.atan2(drop, proj);
  const n = Math.round(W / 0.3);
  const sw = W / n;
  for (let k = 0; k < n; k++) {
    const x = -W / 2 + sw * (k + 0.5);
    const po = k % 2 === 0 ? colour : white;
    fb.box(po, sw, 0.012, slope, x, top - drop / 2, -proj / 2, 0, -pitch);
    fb.box(po, sw, 0.24, 0.01, x, top - drop - 0.13, -proj - 0.005);
  }
  fb.box(METAL, W + 0.06, 0.06, 0.06, 0, top - drop - 0.01, -proj);
  fb.box(paint([0.18, 0.18, 0.18], true), W + 0.1, 0.1, 0.08, 0, top + 0.03, -0.04);
  for (const sx of [-1, 1]) {
    fb.rod(METAL, [sx * (W / 2 - 0.25), top - 0.55, 0], [sx * (W / 2 - 0.45), top - 0.25, -proj * 0.55], 0.014, 5);
    fb.rod(METAL, [sx * (W / 2 - 0.45), top - 0.25, -proj * 0.55], [sx * (W / 2 - 0.25), top - drop, -proj], 0.014, 5);
  }
  return top + 0.08;
}

/** A-board with a chalk menu (v0) or a lit menu lectern (v1). Faces ±Z. */
function menuBoard(fb: FB, v: number): number {
  if (v % 2 === 0) {
    const frame: PO = { m: FMat.Wood, c: [0.45, 0.3, 0.17] };
    const slate = paint([0.06, 0.08, 0.07], true);
    const chalk = plastic([0.86, 0.86, 0.82], true);
    for (const s of [-1, 1]) {
      const a = s * 0.2, z = s * 0.11;
      fb.box(frame, 0.62, 0.95, 0.025, 0, 0.47, z, 0, a);
      fb.box(slate, 0.52, 0.72, 0.01, 0, 0.5, z + s * 0.016, 0, a);
      for (let k = 0; k < 6; k++) {
        const y = 0.76 - k * 0.1, w = k === 0 ? 0.34 : 0.22 + ((k * 37) % 13) / 60;
        fb.box(chalk, w, 0.018, 0.004, (k === 0 ? 0 : -0.05), y, z + s * 0.024 - Math.sin(a) * (y - 0.5) * s * 0, 0, a);
      }
    }
    return 0.97;
  }
  const dark = paint([0.1, 0.09, 0.08], true);
  fb.cyl(dark, 0.18, 0.2, 0.03, 0, 0, 0, 8);
  fb.box(dark, 0.05, 1.05, 0.05, 0, 0.53, 0);
  fb.box(dark, 0.42, 0.56, 0.08, 0, 1.18, 0, 0, -0.25);
  fb.box({ m: FMat.Light, e: 0.3, c: [1, 0.95, 0.85] }, 0.36, 0.48, 0.01, 0, 1.18, -0.045, 0, -0.25);
  return 1.45;
}

// ---------------------------------------------------------------------------------------------
// Signs that say something of their own (src/build/signs.ts): the lettering is the instance's
// atlas slot (iSign), so one model serves every shop, street and notice.
// ---------------------------------------------------------------------------------------------

/** The lettered face of a sign board: uv 0..1 over the face, read from the instance's slot. */
const LETTERING: PO = { m: FMat.Signage, e: 1, s: 6, c: [1, 1, 1] };

/**
 * A sign board 1 m × 1 m centred on its origin in x and y, scaled per instance (iSize: width,
 * height; the depth scales with the width). v0: one lettered face (-Z) on a body 2 cm deep behind
 * it (z 0 … -0.02: the origin is its back, against a wall); v1: lettered on both faces, 2 cm thick
 * centred (blades, hanging signs, estate boards). The body takes the instance's paint.
 */
function signBoard(fb: FB, v: number): number {
  const body = paint([0.12, 0.13, 0.14]);
  if (v % 2 === 0) {
    fb.box(body, 1, 1, 0.018, 0, 0, -0.009);
    fb.add(xform(plane(0.985, 0.97), rotY(Math.PI)), M(0, 0, -0.0185), LETTERING);
  } else {
    fb.box(body, 1, 1, 0.016, 0, 0, 0);
    fb.add(xform(plane(0.985, 0.97), rotY(Math.PI)), M(0, 0, -0.0085), LETTERING);
    fb.add(plane(0.985, 0.97), M(0, 0, 0.0085), LETTERING);
  }
  return 1;
}

/** v0: a street-name post, galvanised, 3 m (blades at 2.55 and 2.8 m); v1: an estate agent's timber post, 1.9 m, with an arm the board hangs from (at 1.45 m, 0.35 m out). */
function signPost(fb: FB, v: number): number {
  if (v % 2 === 0) {
    fb.cyl(METAL, 0.032, 0.035, 3.0, 0, 0, 0, 10);
    fb.sphere(METAL, 0.04, 0, 3.0, 0, 1, 0.6, 1, 10, 6, Math.PI / 2);
    return 3.04;
  }
  const timber: PO = { m: FMat.Wood, c: [0.92, 0.9, 0.86] };
  fb.box(timber, 0.075, 1.9, 0.075, 0, 0.95, 0);
  fb.box(timber, 0.7, 0.06, 0.06, 0.35, 1.84, 0);
  for (const x of [0.12, 0.58]) fb.rod(METAL, [x, 1.81, 0], [x, 1.72, 0], 0.004, 4);
  return 1.9;
}

/** The legs of a free-standing board: v0 the town sign (two posts 2.1 m apart, 2.3 m tall), v1 a public building's name board (two low posts 1.4 m apart, 1.3 m tall). */
function signFrame(fb: FB, v: number): number {
  const leg = paint([0.2, 0.22, 0.24]);
  const [half, h] = v % 2 === 0 ? [1.05, 2.3] : [0.7, 1.3];
  for (const x of [-half, half]) {
    fb.cyl(leg, 0.045, 0.05, h, x, 0, 0.06, 10);
    fb.cyl(CONCRETE, 0.12, 0.13, 0.06, x, 0, 0.06, 10);
  }
  return h;
}

/** A wrought-iron bracket for a hanging sign: a wall plate at the origin, the arm out along +X (0.95 m), two hooks at 0.3 and 0.8 m. */
function signBracket(fb: FB): number {
  const iron = paint([0.05, 0.05, 0.05], true);
  fb.box(iron, 0.02, 0.22, 0.08, 0.01, -0.05, 0);
  fb.box(iron, 0.95, 0.03, 0.025, 0.475, 0, 0);
  fb.rod(iron, [0.02, -0.15, 0], [0.45, -0.01, 0], 0.01, 5);
  fb.tube(iron, [[0.6, 0.015, 0], [0.75, 0.09, 0], [0.9, 0.04, 0]], 0.008, 5, 8);
  for (const x of [0.3, 0.8]) fb.rod(iron, [x, -0.015, 0], [x, -0.08, 0], 0.005, 4);
  return 0.2;
}

/** Low glass windscreen with a fabric band in the café's colour, 2 m long (along X). */
function terraceRail(fb: FB, _v: number): number {
  const post = paint([0.12, 0.12, 0.12], true);
  for (const x of [-0.97, 0.97]) fb.box(post, 0.05, 0.95, 0.05, x, 0.475, 0);
  fb.box({ m: FMat.Wood, c: [0.5, 0.35, 0.2] }, 2.0, 0.04, 0.07, 0, 0.95, 0);
  fb.box(plastic([0.85, 0.85, 0.8]), 1.9, 0.28, 0.02, 0, 0.26, 0);
  fb.box(GLASS, 1.9, 0.52, 0.012, 0, 0.66, 0);
  return 0.97;
}

/** Timber parklet deck module in a parking bay: 2.0 × 1.8 m (v0), or a 1.0 m end with a planter (v1). Top at 0 (sidewalk level). */
function parklet(fb: FB, v: number): number {
  const L = v % 2 === 0 ? 2.0 : 1.0, D = 1.8;
  const deck: PO = { m: FMat.Wood, c: [0.58, 0.42, 0.27] };
  fb.box(paint([0.16, 0.15, 0.14], true), L, 0.13, D - 0.04, 0, -0.085, 0);
  const n = 9;
  for (let k = 0; k < n; k++) fb.box(deck, L - 0.01, 0.035, D / n - 0.012, 0, -0.018, -D / 2 + (k + 0.5) * (D / n));
  if (v % 2 === 1) {
    fb.box({ m: FMat.Wood, c: [0.4, 0.28, 0.17] }, 0.8, 0.55, D - 0.1, 0, 0.275, 0);
    fb.box({ m: FMat.Concrete, c: [0.2, 0.15, 0.1], s: 9 }, 0.72, 0.02, D - 0.2, 0, 0.53, 0);
    smallFoliage(fb, 0.38, 0, 0.75, -0.42, [0.22, 0.38, 0.14], 4);
    smallFoliage(fb, 0.33, 0.05, 0.72, 0.4, [0.26, 0.42, 0.15], 9);
    smallFoliage(fb, 0.28, -0.1, 0.9, 0.02, [0.2, 0.34, 0.12], 2);
    return 1.1;
  }
  return 0.02;
}

// ---------------------------------------------------------------------------------------------
// Cemetery: wall and gate pillars, headstones and crosses, ledger graves and obelisks, a
// mausoleum and a stone figure on a pedestal. Fronts face −Z, walls run along x.
// ---------------------------------------------------------------------------------------------

const WALLSTONE: PO = { m: FMat.Stone, c: [0.56, 0.52, 0.45] };
// pale limestone, dark granite, sandstone
const GRAVE_STONES: V[] = [[0.6, 0.59, 0.56], [0.3, 0.3, 0.33], [0.6, 0.5, 0.38]];

function cemWall(fb: FB, v: number): number {
  if (v === 0) {
    // A 2.5 m stretch of old stone wall with a sloped coping.
    fb.box(WALLSTONE, 2.55, 0.25, 0.55, 0, 0.125, 0);
    fb.box(WALLSTONE, 2.55, 1.35, 0.42, 0, 0.8, 0);
    fb.box({ m: FMat.Stone, c: [0.48, 0.45, 0.4] }, 2.6, 0.12, 0.56, 0, 1.53, 0);
    fb.box({ m: FMat.Stone, c: [0.48, 0.45, 0.4] }, 2.6, 0.08, 0.3, 0, 1.62, 0);
    return 1.66;
  }
  // Pillar: plinth, shaft, cornice, a stone ball on top.
  fb.box(WALLSTONE, 0.78, 0.3, 0.78, 0, 0.15, 0);
  fb.box(WALLSTONE, 0.64, 1.9, 0.64, 0, 1.25, 0);
  fb.box({ m: FMat.Stone, c: [0.48, 0.45, 0.4] }, 0.8, 0.14, 0.8, 0, 2.27, 0);
  fb.box({ m: FMat.Stone, c: [0.48, 0.45, 0.4] }, 0.5, 0.12, 0.5, 0, 2.4, 0);
  fb.sphere(WALLSTONE, 0.2, 0, 2.62, 0, 1, 1, 1, 12, 8);
  return 2.82;
}

function gravestone(fb: FB, v: number): number {
  const st: PO = { m: FMat.Stone, c: GRAVE_STONES[v === 0 ? 1 : 0] };
  // the mound in front (−Z) of the stone
  fb.box({ m: FMat.Wood, c: [0.24, 0.19, 0.13] }, 0.75, 0.1, 1.7, 0, 0.03, -0.95);
  if (v === 0) {
    // Headstone with a rounded top on a low base.
    fb.box(st, 0.8, 0.14, 0.32, 0, 0.07, 0);
    fb.box(st, 0.62, 0.72, 0.13, 0, 0.5, 0);
    fb.cyl(st, 0.31, 0.31, 0.13, 0, 0.86, 0, 16, false, Math.PI / 2);
    fb.box({ m: FMat.Bronze }, 0.36, 0.05, 0.01, 0, 0.75, -0.07);
    fb.box({ m: FMat.Bronze }, 0.28, 0.04, 0.01, 0, 0.62, -0.07);
    return 1.17;
  }
  // Stone cross on a stepped base.
  fb.box(st, 0.62, 0.16, 0.42, 0, 0.08, 0);
  fb.box(st, 0.44, 0.16, 0.3, 0, 0.24, 0);
  fb.box(st, 0.14, 1.05, 0.12, 0, 0.84, 0);
  fb.box(st, 0.62, 0.13, 0.12, 0, 1.06, 0);
  return 1.36;
}

function grave(fb: FB, v: number): number {
  const st: PO = { m: FMat.Stone, c: GRAVE_STONES[v === 0 ? 2 : 0] };
  if (v === 0) {
    // Ledger grave: a stone kerb round a flat slab, a small upright at the head.
    const W = 0.95, L = 2.0;
    fb.box(st, W, 0.18, 0.12, 0, 0.09, -L / 2);
    fb.box(st, W, 0.18, 0.12, 0, 0.09, L / 2);
    fb.box(st, 0.12, 0.18, L, -W / 2 + 0.06, 0.09, 0);
    fb.box(st, 0.12, 0.18, L, W / 2 - 0.06, 0.09, 0);
    fb.box({ m: FMat.Stone, c: [0.32, 0.32, 0.35] }, W - 0.24, 0.1, L - 0.26, 0, 0.12, 0);
    fb.box(st, W, 0.55, 0.16, 0, 0.36, L / 2 + 0.08);
    return 0.64;
  }
  // Obelisk: base, die, a tapering four-sided needle with a point.
  fb.box(st, 0.95, 0.22, 0.95, 0, 0.11, 0);
  fb.box(st, 0.7, 0.2, 0.7, 0, 0.32, 0);
  fb.box(st, 0.56, 0.8, 0.56, 0, 0.82, 0);
  fb.box(st, 0.64, 0.08, 0.64, 0, 1.26, 0);
  fb.cyl(st, 0.17, 0.27, 2.1, 0, 2.35, 0, 4, false, 0, Math.PI / 4);
  fb.cyl(st, 0.0, 0.17, 0.32, 0, 3.56, 0, 4, false, 0, Math.PI / 4);
  return 3.72;
}

function tomb(fb: FB, v: number): number {
  const st: PO = { m: FMat.Stone, c: [0.6, 0.58, 0.54] };
  const dark: PO = { m: FMat.Stone, c: [0.45, 0.43, 0.4] };
  if (v === 0) {
    // Mausoleum: steps, a block with corner pilasters, two columns either side of a bronze door,
    // a cornice and a stepped roof with a cross.
    const W = 3.2, L = 4.0, H = 3.0;
    fb.box(dark, W + 1.0, 0.18, L + 1.2, 0, 0.09, 0.1);
    fb.box(dark, W + 0.6, 0.18, L + 0.8, 0, 0.27, 0.1);
    fb.box(st, W, H, L, 0, 0.36 + H / 2, 0.3);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb.box(dark, 0.3, H, 0.3, sx * (W / 2 - 0.05), 0.36 + H / 2, 0.3 + sz * (L / 2 - 0.05));
    // portico in front
    fb.box(dark, W + 0.2, 0.15, 1.1, 0, 0.43, -L / 2 - 0.25);
    for (const sx of [-1, 1]) {
      fb.cyl(st, 0.15, 0.17, H - 0.25, sx * 1.05, 0.5 + (H - 0.25) / 2, -L / 2 - 0.5, 14);
      fb.box(dark, 0.42, 0.14, 0.42, sx * 1.05, 0.52 + H - 0.25, -L / 2 - 0.5);
    }
    fb.box(st, W + 0.3, 0.4, 1.3, 0, 0.36 + H + 0.05, -L / 2 - 0.3);
    fb.box(BRONZE, 1.1, 2.1, 0.06, 0, 1.45, -L / 2 + 0.28);
    fb.box({ m: FMat.Bronze, c: [0.25, 0.2, 0.12] }, 0.03, 2.0, 0.07, 0, 1.45, -L / 2 + 0.26);
    // cornice and stepped roof
    fb.box(dark, W + 0.5, 0.22, L + 0.5, 0, 0.36 + H + 0.11, 0.3);
    fb.box(st, W + 0.1, 0.3, L + 0.1, 0, 0.36 + H + 0.37, 0.3);
    fb.box(dark, W - 0.5, 0.3, L - 0.5, 0, 0.36 + H + 0.67, 0.3);
    fb.box(st, W - 1.3, 0.3, L - 1.3, 0, 0.36 + H + 0.97, 0.3);
    const top = 0.36 + H + 1.12;
    fb.box(dark, 0.16, 1.0, 0.16, 0, top + 0.5, 0.3);
    fb.box(dark, 0.62, 0.16, 0.16, 0, top + 0.7, 0.3);
    return top + 1.0;
  }
  // A mourning figure on a tall pedestal.
  fb.box(dark, 1.6, 0.25, 1.6, 0, 0.125, 0);
  fb.box(st, 1.2, 0.25, 1.2, 0, 0.375, 0);
  fb.box(st, 0.95, 1.4, 0.95, 0, 1.2, 0);
  fb.box(dark, 1.15, 0.15, 1.15, 0, 1.97, 0);
  human(fb, 0, 2.05, 0, 1.25, 1, st);
  // folded wings
  for (const sx of [-1, 1]) {
    fb.box(st, 0.08, 1.35, 0.5, sx * 0.24, 2.05 + 1.3, 0.24, 0, -0.25, sx * 0.18);
  }
  return 2.05 + 2.3;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

const furnCache = new Map<string, FurnitureModel>();

/** A furniture model (`variant` 0 or 1), built once and cached. */
export function furnitureModel(kind: FurnitureKind, variant = 0): FurnitureModel {
  const key = kind + ':' + (Math.abs(variant | 0) % 2);
  let m = furnCache.get(key);
  if (!m) furnCache.set(key, (m = buildFurniture(kind, variant)));
  return m;
}

/** A furniture model built afresh (`furnitureModel` caches). */
export function buildFurniture(kind: FurnitureKind, variant = 0): FurnitureModel {
  const v = Math.abs(variant | 0) % 2;
  const fb = new FB();
  const lights: Lights = [];
  let height = 1;
  let radius = 0.3;
  let breakable: FurnitureModel['breakable'] = 'topple';
  switch (kind) {
    case 'lampModern': height = lampModern(fb, v, lights); radius = 0.15; breakable = 'bend'; break;
    case 'lampClassic': height = lampClassic(fb, v, lights); radius = 0.2; breakable = 'bend'; break;
    case 'lampDouble': height = lampDouble(fb, v, lights); radius = 0.2; breakable = 'bend'; break;
    case 'trafficLight': height = trafficLight(fb, v); radius = 0.2; breakable = 'bend'; break;
    case 'bench': height = bench(fb, v); radius = 0.95; breakable = 'topple'; break;
    case 'bin': height = bin(fb, v); radius = 0.3; breakable = 'topple'; break;
    case 'hydrant': height = hydrant(fb, v); radius = 0.2; breakable = 'solid'; break;
    case 'mailbox': height = mailbox(fb, v); radius = 0.32; breakable = v === 1 ? 'solid' : 'topple'; break;
    case 'bollard': height = bollard(fb, v); radius = 0.12; breakable = 'solid'; break;
    case 'planter': height = planter(fb, v); radius = 0.7; breakable = 'shatter'; break;
    case 'busStop': height = busStop(fb, v, lights); radius = 2.3; breakable = 'shatter'; break;
    case 'fountain': height = fountain(fb, v); radius = v === 0 ? 3.2 : 2.6; breakable = 'solid'; break;
    case 'statue': height = statue(fb, v); radius = v === 0 ? 1.2 : 2.0; breakable = 'solid'; break;
    case 'kiosk': height = kiosk(fb, v); radius = v === 0 ? 1.6 : 1.8; breakable = 'shatter'; break;
    case 'stopSign': height = stopSign(fb, v); radius = 0.06; breakable = 'bend'; break;
    case 'playground': height = playground(fb, v); radius = 4.0; breakable = 'solid'; break;
    case 'manhole': height = manhole(fb, v); radius = 0.4; breakable = 'solid'; break;
    case 'newsStand': height = newsStand(fb, v); radius = 0.9; breakable = 'topple'; break;
    case 'bikeRack': height = bikeRack(fb, v); radius = v === 0 ? 1.9 : 1.1; breakable = 'bend'; break;
    case 'phoneBooth': height = phoneBooth(fb, v); radius = 0.6; breakable = 'shatter'; break;
    case 'evCharger': height = evCharger(fb, v); radius = 0.22; breakable = 'topple'; break;
    case 'cafeTable': height = cafeTable(fb, v); radius = 0.36; breakable = 'topple'; break;
    case 'cafeChair': height = cafeChair(fb, v); radius = 0.22; breakable = 'topple'; break;
    case 'parasol': height = parasol(fb, v); radius = 0.06; breakable = 'topple'; break;
    case 'awning': height = awning(fb, v); radius = 0.1; breakable = 'shatter'; break;
    case 'menuBoard': height = menuBoard(fb, v); radius = 0.25; breakable = 'topple'; break;
    case 'terraceRail': height = terraceRail(fb, v); radius = 0.1; breakable = 'topple'; break;
    case 'parklet': height = parklet(fb, v); radius = v === 0 ? 1.0 : 0.5; breakable = 'solid'; break;
    case 'cemWall': height = cemWall(fb, v); radius = v === 0 ? 1.25 : 0.35; breakable = v === 0 ? 'shatter' : 'solid'; break;
    case 'gravestone': height = gravestone(fb, v); radius = 0.35; breakable = 'topple'; break;
    case 'grave': height = grave(fb, v); radius = v === 0 ? 0.6 : 0.4; breakable = v === 0 ? 'solid' : 'topple'; break;
    case 'tomb': height = tomb(fb, v); radius = v === 0 ? 2.0 : 1.0; breakable = 'solid'; break;
    case 'signBoard': height = signBoard(fb, v); radius = 0.5; breakable = 'solid'; break;
    case 'signPost': height = signPost(fb, v); radius = 0.06; breakable = 'bend'; break;
    case 'signFrame': height = signFrame(fb, v); radius = v === 0 ? 1.3 : 0.9; breakable = 'solid'; break;
    case 'signBracket': height = signBracket(fb); radius = 0.5; breakable = 'solid'; break;
  }
  return { kind, mesh: fb.mb.build(), height, radius, lights, breakable };
}
