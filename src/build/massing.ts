/**
 * Building shells in the facade format: every building of a cell (or a farm) and every public
 * building, with the attributes the facade shader reads to draw windows, doors, shop fronts,
 * curtain walls, shutters, balconies and the roof and wall textures (`facadeSpecs`). Plinths on
 * slopes, walls per setback tier, a cornice and a string course on classical styles, and the
 * roofs (flat with parapet and rooftop equipment, gable, hip, shed, sawtooth, mansard).
 *
 * Ported from Scale (src/build/buildingShell.ts, src/build/buildingLayout.ts buildingBase and
 * buildingTiers, src/build/landmarks.ts) without slabs, element ids / destruction (aElem),
 * interiors, stoops, LOD1, clear glass, inner parts, dicing and the close-range detail of
 * buildingDetail.ts. The walls are one quad per edge and tier (Scale: one per bay group and
 * storey, for destruction): the shader finds the storey from uv.y and the bay from uv.x.
 *
 * Pure: runs in workers. Positions are world coordinates (`mb.setOrigin` for a local origin).
 */
import earcut from 'earcut';
import { Rng, deriveSeed, lerp, v3norm, v3cross } from '@futuremagic/core';
import { type Poly, frameToWorld, minAreaRect, polyArea, ensureCCW, polyCentroid, pointInPoly, distPointPolyEdge, splitPolyByLine, segIntersect } from '../geom/geom2';
import { offset, shapesToPolys } from '../geom/clip';
import type { Terrain } from '../world/terrain';
import { CURB_H } from '../world/ground';
import { doorBayOf, type BuildingDesc } from '../plan/building';
import type { Landmark } from '../plan/landmarks';
import { landmarkParts, latheClosed, helixFloorAt, HELIX_SLAB, PK, type LmPart, type PartMat } from '../plan/landmarkParts';
import type { MeshBuilder, AttrSpec } from './meshBuilder';

/**
 * Facade flags (bit field in aFacade.w; the landmark kit's WIN, CURTAIN, ARCH, ROOF and GLOW in
 * src/plan/kit.ts are the same bits).
 */
export const enum FF {
  Windows = 1,
  Shop = 2,
  Curtain = 4,
  Arched = 8,
  Balcony = 16,
  Shutters = 32,
  Blind = 64,      // attached side wall, no openings
  Roof = 128,      // roof surface (no windows; roof material)
  Front = 256,     // main street facade (entrance door)
  // 512, 1024: door bay index (0..3) on the front facade
  DoorBay = 512,
  Eatery = 2048,   // café / restaurant shop front: warm light while open, no generic sign band
  Glow = 4096,     // stained glass (landmarks): the day shines through it
}

/**
 * The facade mesh's attributes besides position and normal (Scale's facadeSpecs without aElem):
 * uv in metres (walls: u along the edge from its start, v = height above the ground floor level;
 * flat surfaces: world x, z), aLayer the facade texture layer (walls 0–15 as WallMat, roofs 16–23
 * as 16 + RoofMat), aTint the colour the layer is multiplied by, aFacade (bay width, storey
 * height, ground floor height, flags FF), aSeed the building's variation in [0, 1).
 */
export function facadeSpecs(): AttrSpec[] {
  return [
    { name: 'uv', size: 2 },
    { name: 'aLayer', size: 1 },
    { name: 'aTint', size: 3, type: 'u8n' },
    { name: 'aFacade', size: 4 },
    { name: 'aSeed', size: 1 },
  ];
}

type RGB = [number, number, number];
type V3 = [number, number, number];

/** Set the current surface: layer, tint and facade parameters (bay width, storey and ground floor heights, flags). */
export function paint(mb: MeshBuilder, layer: number, tint: readonly number[], flags = 0, bay = 1, fh = 1, gh = 1): void {
  mb.set('aLayer', layer).set('aTint', tint[0], tint[1], tint[2]).set('aFacade', bay, fh, gh, flags);
}

/** A seed's variation attribute (Scale: seed mod 10007). */
function seedVar(seed: number): number {
  return (seed % 10007) / 10007;
}

/** Palettes for tintable walls (plaster, stucco, siding). */
const PASTELS: RGB[] = [
  [0.93, 0.89, 0.80], [0.95, 0.86, 0.66], [0.90, 0.78, 0.62], [0.93, 0.80, 0.74], [0.82, 0.86, 0.80],
  [0.80, 0.85, 0.90], [0.96, 0.95, 0.92], [0.88, 0.70, 0.55], [0.97, 0.92, 0.82], [0.75, 0.80, 0.74],
  [0.92, 0.83, 0.85], [0.85, 0.75, 0.60],
];
const SIDING: RGB[] = [
  [0.95, 0.95, 0.93], [0.78, 0.84, 0.88], [0.80, 0.82, 0.72], [0.62, 0.68, 0.72], [0.92, 0.88, 0.76], [0.72, 0.52, 0.45], [0.55, 0.62, 0.55],
];

const CLASSICAL = new Set(['rowhouse', 'tenement', 'haussmann', 'artdeco', 'oldstone', 'mediterranean', 'church']);

// ------------------------------------------------------------------------------- layout

/** Terrain sample spacing under footprints (m). */
const BASE_SAMPLE = 2.5;

/**
 * Ground floor level (above the highest ground anywhere under the footprint, so the terrain
 * never pokes through the floor) and plinth bottom (below the lowest). Samples the corners,
 * the edges and a grid over the inside: a hump or valley between the corners counts too.
 */
export function buildingBase(b: BuildingDesc, terrain: Terrain): { base: number; low: number } {
  let hi = -Infinity, lo = Infinity;
  const p = b.poly, n = p.length >> 1;
  const probe = (x: number, z: number) => {
    const h = terrain.height(x, z);
    if (h > hi) hi = h;
    if (h < lo) lo = h;
  };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[((i + 1) % n) * 2], bz = p[((i + 1) % n) * 2 + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / BASE_SAMPLE));
    for (let t = 0; t < k; t++) probe(ax + ((bx - ax) * t) / k, az + ((bz - az) * t) / k);
    x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
  }
  const nu = Math.min(24, Math.ceil((x1 - x0) / BASE_SAMPLE)), nv = Math.min(24, Math.ceil((z1 - z0) / BASE_SAMPLE));
  for (let i = 1; i < nu; i++) for (let j = 1; j < nv; j++) {
    const x = x0 + ((x1 - x0) * i) / nu, z = z0 + ((z1 - z0) * j) / nv;
    if (pointInPoly(p, x, z)) probe(x, z);
  }
  const c = polyCentroid(p);
  if (pointInPoly(p, c[0], c[1])) probe(c[0], c[1]);
  return { base: hi + CURB_H, low: lo - 0.4 };
}

/** Height of the walls above the ground floor level (to the top of the top storey). */
export function buildingHeight(b: BuildingDesc): number {
  return b.groundH + (b.floors - 1) * b.floorH;
}

/** Height of storey f's floor above the ground floor level. */
function storeyBottom(b: BuildingDesc, f: number): number {
  return f <= 0 ? 0 : b.groundH + (f - 1) * b.floorH;
}

/** Setback tiers: the footprint, then each inset outline from its storey up (too small ones end the tower). */
export function buildingTiers(b: BuildingDesc): { fromFloor: number; poly: Poly }[] {
  const tiers: { fromFloor: number; poly: Poly }[] = [{ fromFloor: 0, poly: b.poly }];
  for (const [f, inset] of b.setbacks) {
    if (f <= 0 || f >= b.floors) continue;
    const sh = offset([b.poly], -inset, 'miter');
    if (!sh.length) break;
    const q = shapesToPolys(sh).sort((x, y) => Math.abs(polyArea(y)) - Math.abs(polyArea(x)))[0];
    if (Math.abs(polyArea(q)) < 60) break;
    tiers.push({ fromFloor: f, poly: ensureCCW(q) });
  }
  return tiers;
}

// ------------------------------------------------------------------------------- buildings

/** Every building of a cell (or a farm's buildings). */
export function buildBuildings(mb: MeshBuilder, buildings: readonly BuildingDesc[], terrain: Terrain): void {
  for (const b of buildings) buildShell(mb, b, terrain);
}

/** The building's tint (Scale's: a pastel or siding colour for tintable walls, else a slight grey variation). */
function buildingTint(b: BuildingDesc, r: Rng): RGB {
  if (b.wall === 6 || b.wall === 7) return PASTELS[b.seed % PASTELS.length];
  if (b.wall === 14) return SIDING[b.seed % SIDING.length];
  const v = 0.88 + r.float() * 0.2;
  return [v * (0.97 + r.float() * 0.06), v, v * (0.97 + r.float() * 0.06)];
}

/** Facade flags of a style (Scale's draws, in Scale's order). */
function styleFlags(b: BuildingDesc, r: Rng): number {
  let flags: number = FF.Windows;
  if (b.style === 'glass') flags |= FF.Curtain;
  if (b.style === 'church') flags |= FF.Arched;
  if (b.style === 'haussmann') flags |= FF.Balcony;
  if ((b.style === 'oldstone' || b.style === 'mediterranean') && r.chance(0.6)) flags |= FF.Shutters;
  if (b.style === 'oldstone' && r.chance(0.25)) flags |= FF.Arched;
  if (b.style === 'modern' && r.chance(0.6)) flags |= FF.Balcony;
  if (b.style === 'garage') flags &= ~FF.Windows;
  return flags;
}

function buildShell(mb: MeshBuilder, b: BuildingDesc, terrain: Terrain): void {
  if (b.floors <= 0) return;
  const r = new Rng(b.seed);
  const { base, low } = buildingBase(b, terrain);
  const H = buildingHeight(b);
  const tint = buildingTint(b, r);
  const trimTint: RGB = b.style === 'haussmann' || b.style === 'artdeco' ? [tint[0] * 1.02, tint[1] * 1.02, tint[2] * 1.02] : [0.92, 0.9, 0.86];
  const flags = styleFlags(b, r);
  mb.set('aSeed', seedVar(b.seed));

  // ---- plinth (foundation on slopes)
  if (base - low > 0.25) {
    paint(mb, 13, [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8], 0, 2, 3, 3);
    wallLoop(mb, b.poly, low, base, low);
  }

  // ---- walls per tier
  const tiers = buildingTiers(b);
  for (let t = 0; t < tiers.length; t++) {
    const f0 = tiers[t].fromFloor, f1 = t + 1 < tiers.length ? tiers[t + 1].fromFloor : b.floors;
    tierWalls(mb, b, tiers[t].poly, t === 0, base + storeyBottom(b, f0), base + storeyBottom(b, f1), base, tint, flags);
  }
  // Terrace caps and parapets where a tier steps in.
  for (let t = 0; t + 1 < tiers.length; t++) {
    const y = base + storeyBottom(b, tiers[t + 1].fromFloor);
    paint(mb, 16, tint, FF.Roof);
    capHoled(mb, tiers[t].poly, tiers[t + 1].poly, y);
    paint(mb, b.wall, tint);
    parapetRing(mb, tiers[t].poly, y, 1.1);
  }
  const top = tiers[tiers.length - 1].poly;
  const topY = base + H;

  // ---- cornices and string courses (classical styles)
  if (CLASSICAL.has(b.style) && b.floors >= 2) {
    paint(mb, b.style === 'tenement' || b.style === 'rowhouse' ? 4 : b.wall, trimTint);
    bandAround(mb, top, topY - 0.05, 0.55, b.style === 'artdeco' ? 0.15 : 0.45);
    if (b.floors > 2) bandAround(mb, b.poly, base + b.groundH - 0.1, 0.3, 0.12);
  }

  // ---- roof
  roofOf(mb, b, top, topY, r, tint);
}

/** Facade flags for one edge of a tier polygon (the footprint's: party walls, shop front, front door). */
function edgeFlags(flags: number, b: BuildingDesc, footprint: boolean, poly: Poly, i: number, bays: number): number {
  let f = flags;
  if (!footprint) return f;
  if (b.attached && i !== b.front && isSideEdge(poly, i, b.front)) f = (f & ~(FF.Windows | FF.Shop | FF.Balcony)) | FF.Blind;
  if (i === b.front) {
    if (b.shopfront) f |= FF.Shop;
    if (b.eatery) f |= FF.Eatery;
    f |= FF.Front + doorBayOf(b.seed, bays) * FF.DoorBay;
  }
  return f;
}

/**
 * The walls of one tier between y0 and y1, one quad per edge with that edge's exact bay width
 * (the bays fit the edge). Party walls of attached buildings are blind and set in slightly, so
 * neighbours never share a plane.
 */
function tierWalls(mb: MeshBuilder, b: BuildingDesc, poly: Poly, footprint: boolean, y0: number, y1: number, base: number, tint: RGB, flags: number): void {
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    if (footprint && b.attached && i !== b.front && isSideEdge(poly, i, b.front)) {
      ax -= nx * 0.12; az -= nz * 0.12; bx -= nx * 0.12; bz -= nz * 0.12;
    }
    const bays = Math.max(1, Math.round(L / b.bay));
    paint(mb, b.wall, tint, edgeFlags(flags, b, footprint, poly, i, bays), L / bays, b.floorH, b.groundH);
    wallQuad(mb, ax, az, bx, bz, y0, y1, nx, nz, L, base);
  }
}

/** One vertical wall quad from (ax, az) to (bx, bz), outward normal (nx, 0, nz); uv: u 0..L along it, v = y - vBase. */
function wallQuad(mb: MeshBuilder, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, L: number, vBase: number): void {
  if (y1 - y0 < 1e-3) return;
  const v0 = y0 - vBase, v1 = y1 - vBase;
  const i0 = mb.v(ax, y0, az, nx, 0, nz, 0, v0);
  mb.v(bx, y0, bz, nx, 0, nz, L, v0);
  mb.v(bx, y1, bz, nx, 0, nz, L, v1);
  mb.v(ax, y1, az, nx, 0, nz, 0, v1);
  mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
}

/** Walls of a CCW polygon between y0 and y1 (outward normals; v from vBase, default y0). */
function wallLoop(mb: MeshBuilder, poly: Poly, y0: number, y1: number, vBase = y0): void {
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    wallQuad(mb, ax, az, bx, bz, y0, y1, (bz - az) / L, -(bx - ax) / L, L, vBase);
  }
}

/** Edges adjacent (by index) to the front edge whose direction is roughly perpendicular count as side walls. */
function isSideEdge(poly: Poly, i: number, front: number): boolean {
  const n = poly.length >> 1;
  const j = (i + 1) % n, fj = (front + 1) % n;
  const ex = poly[j * 2] - poly[i * 2], ez = poly[j * 2 + 1] - poly[i * 2 + 1];
  const fx = poly[fj * 2] - poly[front * 2], fz = poly[fj * 2 + 1] - poly[front * 2 + 1];
  const l = (Math.hypot(ex, ez) || 1) * (Math.hypot(fx, fz) || 1);
  return Math.abs(ex * fx + ez * fz) / l < 0.5;
}

/** Horizontal protruding band around a polygon (cornice / string course). */
function bandAround(mb: MeshBuilder, poly: Poly, y: number, h: number, out: number): void {
  const sh = offset([poly], out, 'miter', 3);
  if (!sh.length) return;
  const outer = ensureCCW(sh[0].outer);
  wallLoop(mb, outer, y, y + h);
  capHoled(mb, outer, poly, y + h);
  capHoled(mb, outer, poly, y, true);
}

/** Flat cap of (outer minus inner) at height y. */
function capHoled(mb: MeshBuilder, outer: Poly, inner: Poly | Poly[], y: number, down = false): void {
  const flat = outer.slice();
  const holes: number[] = [];
  for (const h of (typeof inner[0] === 'number' ? [inner as Poly] : (inner as Poly[]))) {
    holes.push(flat.length / 2);
    for (const v of ensureCCW(h)) flat.push(v);
  }
  flatTris(mb, flat, earcut(flat, holes, 2), y, down);
}

/** Flat cap of a polygon at height y (facing up, or down). */
function capFlat(mb: MeshBuilder, poly: Poly, y: number, down = false): void {
  flatTris(mb, poly, earcut(poly, undefined, 2), y, down);
}

/** Horizontal triangles, uv = world x, z. */
function flatTris(mb: MeshBuilder, flat: number[], tris: number[], y: number, down: boolean): void {
  const base = mb.vcount;
  const ny = down ? -1 : 1;
  for (let i = 0; i < flat.length; i += 2) mb.v(flat[i], y, flat[i + 1], 0, ny, 0, flat[i], flat[i + 1]);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
    if ((cr < 0) !== down) mb.tri(base + a, base + b, base + c);
    else mb.tri(base + a, base + c, base + b);
  }
}

/** A parapet on a polygon's edge: outer and inner faces and the coping (current layer and tint, no openings). */
function parapetRing(mb: MeshBuilder, poly: Poly, y: number, h: number): void {
  // A narrow neck can split the inset outline into several pieces.
  const inner = offset([poly], -0.3, 'miter').map((s) => ensureCCW(s.outer));
  if (!inner.length) return;
  mb.set('aFacade', 1, 1, 1, 0);
  wallLoop(mb, poly, y, y + h);
  // Inner faces (reversed rings so the normals face inward).
  for (const ip of inner) {
    const rev: number[] = [];
    for (let i = (ip.length >> 1) - 1; i >= 0; i--) rev.push(ip[i * 2], ip[i * 2 + 1]);
    wallLoop(mb, rev, y, y + h);
  }
  capHoled(mb, poly, inner, y + h);
}

// ------------------------------------------------------------------------------- roofs

function roofOf(mb: MeshBuilder, b: BuildingDesc, top: Poly, y: number, r: Rng, tint: RGB): void {
  const roofLayer = 16 + b.roofMat;
  top = ensureCCW(top);
  const F = roofFrameOf(b, top, y);
  const { kind, obb } = F;
  if (kind === 'flat') {
    paint(mb, roofLayer, tint, FF.Roof);
    // Inset under the parapet; a narrow neck can split it into several pieces.
    const inner = offset([top], -0.3, 'miter').map((s) => ensureCCW(s.outer));
    for (const p of inner.length ? inner : [top]) capFlat(mb, p, y + 0.05);
    if (b.style !== 'house') {
      paint(mb, b.wall, tint);
      parapetRing(mb, top, y, b.style === 'glass' ? 1.4 : 0.9);
    }
    roofGear(mb, b, top, y);
    return;
  }
  if (kind === 'mansard') {
    // Steep lower slope (with dormers drawn by the shader) then a flat top. The inset ring keeps
    // one vertex per outline vertex, so every wall edge gets its own slope; outlines too tight for
    // that inset try a smaller one, else stay flat.
    const ring = mansardInset(top, obb);
    if (!ring) { paint(mb, roofLayer, tint, FF.Roof); capFlat(mb, top, y + 0.05); roofGear(mb, b, top, y); return; }
    paint(mb, roofLayer, tint, FF.Roof | FF.Windows, b.bay, ring.mh, ring.mh);
    mansardSlope(mb, top, ring.inner, y, y + ring.mh);
    paint(mb, roofLayer, tint, FF.Roof);
    capFlat(mb, ring.inner, y + ring.mh);
    roofGear(mb, b, ring.inner, y + ring.mh);
    return;
  }
  // Gable / hip / shed / sawtooth: planar facets (see roofFrameOf), cut to the real outline.
  const { ux, uz, hu, hv, vx, vz, rise, fdx, fdz } = F;
  const ov = 0.35; // eave overhang
  // Eaves: every edge overhangs, except the party walls of attached houses (edges across the street front).
  const eaveOf = (k: number): number => {
    if (!b.attached) return ov;
    const n = top.length >> 1, j = (k + 1) % n;
    const ex = top[j * 2] - top[k * 2], ez = top[j * 2 + 1] - top[k * 2 + 1], el = Math.hypot(ex, ez) || 1;
    return Math.abs((ex / el) * fdx + (ez / el) * fdz) < 0.5 ? 0 : ov;
  };
  const eaves = offsetEach(top, Array.from({ length: top.length >> 1 }, (_, k) => (kind === 'sawtooth' ? 0 : eaveOf(k))));
  const facets = F.facets;
  if (kind === 'sawtooth') {
    const { teeth, tw, th } = F;
    paint(mb, roofLayer, tint, FF.Roof);
    for (const f of facets) facetMesh(mb, eaves, f);
    // Glazing (vertical) where one tooth ends high and the next starts low, cut to the outline.
    paint(mb, 10, tint, FF.Windows | FF.Curtain, 1.5, th, th);
    for (let k = 1; k < teeth; k++) {
      const o = framePoint(F, -hu + k * tw, 0);
      for (const ch of splitPolyByLine(top, o[0], o[1], vx, vz).chords) {
        // Outward (+u, the low side of the next tooth) normal: wind the quad accordingly.
        const sx = ch[2] - ch[0], sz = ch[3] - ch[1];
        const fw = sz * ux - sx * uz > 0;
        const [ax, az, bx, bz] = fw ? ch : [ch[2], ch[3], ch[0], ch[1]];
        wallQuad(mb, ax, az, bx, bz, y, y + th, ux, uz, Math.hypot(bx - ax, bz - az), y);
      }
    }
    // End walls under the teeth; outline edges facing +u close the last tooth with glazing.
    gableWalls(mb, top, y, facets, (nx, nz) => {
      if (nx * ux + nz * uz > 0.7) paint(mb, 10, tint, FF.Windows | FF.Curtain, 1.5, th, th);
      else paint(mb, b.wall, tint);
    });
    return;
  }
  paint(mb, roofLayer, tint, FF.Roof);
  for (const f of facets) facetMesh(mb, eaves, f);
  // Gable walls wherever the roof stands above the wall top (gable ends, notches, slanted edges).
  gableWalls(mb, top, y, facets, () => paint(mb, b.wall, tint));
  // Chimneys for houses / old town, on the roof (not over an empty corner of the bounding box).
  const chimney: RGB = [0.9, 0.85, 0.8];
  if ((b.style === 'house' || b.style === 'oldstone' || b.style === 'timber' || b.style === 'rowhouse') && kind !== 'hip') {
    paint(mb, 0, chimney);
    for (let t = 0; t < 6; t++) {
      const p = framePoint(F, r.range(-hu * 0.6, hu * 0.6), r.range(-hv * 0.4, hv * 0.4));
      if (!pointInPoly(top, p[0], p[1]) || distPointPolyEdge(top, p[0], p[1]) < 0.8) continue;
      mb.box(p[0], y + rise * 0.6 + 0.8, p[1], 0.35, rise * 0.6 + 1.0, 0.45, Math.atan2(ux, uz));
      break;
    }
  }
  if (kind === 'hip' && b.style === 'house' && r.chance(0.6)) {
    paint(mb, 0, chimney);
    const ridge = Math.max(0, hu - hv);
    const p = framePoint(F, r.range(-ridge, ridge), 0);
    if (pointInPoly(top, p[0], p[1]) && distPointPolyEdge(top, p[0], p[1]) > 0.8) mb.box(p[0], facetHeight(facets, p[0], p[1]) + 0.4, p[1], 0.35, 1.0, 0.45, Math.atan2(ux, uz));
  }
}

/**
 * Planar roof facet: height h0 + gx·x + gz·z over the part of the roof outline where every
 * cut [nx, nz, d] (unit normal) holds: nx·x + nz·z <= d. The facets of a roof tile the plane.
 */
interface Facet { gx: number; gz: number; h0: number; cuts: number[][] }

interface RoofFrame {
  kind: BuildingDesc['roof'];
  obb: { hu: number; hv: number };
  cx: number; cz: number;
  ux: number; uz: number; hu: number; hv: number; vx: number; vz: number;
  rise: number; fdx: number; fdz: number;
  facets: Facet[];
  teeth: number; tw: number; th: number;
}

/** World point of roof frame coordinates (u along the ridge, v across). */
function framePoint(F: RoofFrame, u: number, v: number): [number, number] {
  return [F.cx + F.ux * u + F.vx * v, F.cz + F.uz * u + F.vz * v];
}

/** Kind, frame and facets of a building's roof. */
function roofFrameOf(b: BuildingDesc, top: Poly, y: number): RoofFrame {
  const obb = minAreaRect(top);
  const rect = Math.abs(polyArea(top)) / Math.max(1e-6, 4 * obb.hu * obb.hv);
  let kind = b.roof;
  if ((kind === 'gable' || kind === 'hip' || kind === 'sawtooth' || kind === 'shed') && rect < 0.8) kind = 'flat';
  // Facets are laid out in the frame of the footprint's OBB.
  // Ridge direction: along the long axis, except attached houses: parallel to the street.
  let ux = obb.ux, uz = obb.uz, hu = obb.hu, hv = obb.hv;
  if (hv > hu) { ux = -obb.uz; uz = obb.ux; const t = hu; hu = hv; hv = t; }
  let fdx = 1, fdz = 0; // street direction (attached houses)
  if (b.attached) {
    const n = b.poly.length >> 1;
    const j = (b.front + 1) % n;
    const fx = b.poly[j * 2] - b.poly[b.front * 2], fz = b.poly[j * 2 + 1] - b.poly[b.front * 2 + 1];
    const fl = Math.hypot(fx, fz) || 1;
    fdx = fx / fl; fdz = fz / fl;
    if (Math.abs((fx / fl) * ux + (fz / fl) * uz) < 0.7) { const t = hu; hu = hv; hv = t; const ox = ux; ux = -uz; uz = ox; }
  }
  const vx = -uz, vz = ux;
  const cx = obb.cx, cz = obb.cz;
  // Facet plane h = y + a + bu·u + bv·v and cut "cu·u + cv·v <= q", both given in the (u, v) frame.
  const facetUV = (a: number, bu: number, bv: number, cuts: number[][] = []): Facet => {
    const gx = bu * ux + bv * vx, gz = bu * uz + bv * vz;
    return { gx, gz, h0: y + a - gx * cx - gz * cz, cuts: cuts.map(([cu, cv, q]) => halfPlaneAt(cu * ux + cv * vx, cu * uz + cv * vz, q, cx, cz)) };
  };
  const rise = hv * b.pitch;
  let facets: Facet[] = [];
  let teeth = 0, tw = 0, th = 0;
  if (kind === 'gable') facets = [facetUV(rise, 0, b.pitch, [[0, 1, 0]]), facetUV(rise, 0, -b.pitch, [[0, -1, 0]])];
  else if (kind === 'shed') facets = [facetUV(rise * 0.5, 0, b.pitch * 0.5)];
  else if (kind === 'hip') facets = hipPlanes(top, y, b.pitch);
  else if (kind === 'sawtooth') {
    // Sawtooth (industrial): teeth across the long axis with glazed north faces.
    teeth = Math.max(2, Math.round((hu * 2) / 8));
    tw = (hu * 2) / teeth;
    th = Math.min(3.5, tw * 0.45);
    for (let k = 0; k < teeth; k++) {
      const u0 = -hu + k * tw, cuts: number[][] = [];
      if (k > 0) cuts.push([-1, 0, -u0]);
      if (k < teeth - 1) cuts.push([1, 0, u0 + tw]);
      facets.push(facetUV(-th * u0 / tw, th / tw, 0, cuts));
    }
  }
  return { kind, obb, cx, cz, ux, uz, hu, hv, vx, vz, rise, fdx, fdz, facets, teeth, tw, th };
}

/** Mansard geometry (steep ring, then a flat top), or null when the outline is too tight. */
function mansardInset(top: Poly, obb: { hu: number; hv: number }): { inner: Poly; inset: number; mh: number } | null {
  let inset = Math.min(2.2, Math.min(obb.hu, obb.hv) * 0.4);
  for (let k = 0; k < 3; k++, inset *= 0.55) {
    const q = offsetEach(top, new Array(top.length >> 1).fill(-inset));
    if (ringSimple(top, q)) return { inner: q, inset, mh: 3.4 };
  }
  return null;
}

/** Half-plane "n·(p - c) <= q" in world coordinates, with a unit normal. */
function halfPlaneAt(nx: number, nz: number, q: number, cx: number, cz: number): number[] {
  const l = Math.hypot(nx, nz) || 1;
  return [nx / l, nz / l, (q + nx * cx + nz * cz) / l];
}

/** The facet whose cuts hold at (x, z) (the least violated one on boundaries). */
function facetAt(facets: Facet[], x: number, z: number): Facet {
  let best = facets[0], bv = Infinity;
  for (const f of facets) {
    let v = 0;
    for (const c of f.cuts) v = Math.max(v, c[0] * x + c[1] * z - c[2]);
    if (v < bv) { bv = v; best = f; }
  }
  return best;
}

/** Roof height at (x, z). */
function facetHeight(facets: Facet[], x: number, z: number): number {
  const f = facetAt(facets, x, z);
  return f.h0 + f.gx * x + f.gz * z;
}

/**
 * Hip roof over any footprint: every edge of the convex hull carries a plane rising inwards at
 * the pitch, the roof is their minimum (for a convex footprint that is its straight skeleton:
 * ridge plus hips). Notches of a concave footprint get gable walls up to that surface.
 */
function hipPlanes(poly: Poly, y: number, pitch: number): Facet[] {
  const H = hullCCW(poly);
  const n = H.length >> 1;
  // Inward unit normal m and offset c per hull edge: distance inside = m·p - c.
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = H[j * 2] - H[i * 2], ez = H[j * 2 + 1] - H[i * 2 + 1], l = Math.hypot(ex, ez);
    if (l < 1e-3) continue;
    const mx = -ez / l, mz = ex / l;
    m.push([mx, mz, mx * H[i * 2] + mz * H[i * 2 + 1]]);
  }
  return m.map((a, i) => ({
    gx: a[0] * pitch, gz: a[1] * pitch, h0: y - a[2] * pitch,
    // This plane is the lowest where (m_i - m_j)·p <= c_i - c_j for every other edge j.
    cuts: m.filter((_, j) => j !== i && Math.hypot(a[0] - m[j][0], a[1] - m[j][1]) > 1e-4).map((o) => halfPlaneAt(a[0] - o[0], a[1] - o[1], a[2] - o[2], 0, 0)),
  }));
}

/** Convex hull (CCW) of a polygon's vertices, monotone chain. */
function hullCCW(p: Poly): Poly {
  const pts: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of pts) { while (lo.length >= 2 && turn(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (hi.length >= 2 && turn(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-9) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1)).flat();
}

/** The parts of a polygon where all of a facet's cuts hold. */
function facetClip(poly: Poly, cuts: number[][]): Poly[] {
  let pieces = [poly];
  for (const [nx, nz, d] of cuts) {
    const next: Poly[] = [];
    for (const p of pieces) {
      for (const q of splitPolyByLine(p, nx * d, nz * d, -nz, nx).pieces) {
        // Pieces lie on one side of the line: judge by the vertex farthest from it.
        let s = 0;
        for (let k = 0; k < q.length; k += 2) { const e = nx * q[k] + nz * q[k + 1] - d; if (Math.abs(e) > Math.abs(s)) s = e; }
        if (s <= 0) next.push(q);
      }
    }
    pieces = next;
  }
  return pieces;
}

/** Roof surface of one facet over the roof outline: triangulated, uv in metres (v up the slope). */
function facetMesh(mb: MeshBuilder, outline: Poly, f: Facet): void {
  const g = Math.hypot(f.gx, f.gz);
  const l = Math.hypot(f.gx, f.gz, 1);
  const nx = -f.gx / l, ny = 1 / l, nz = -f.gz / l;
  const sx = g > 1e-6 ? f.gx / g : 1, sz = g > 1e-6 ? f.gz / g : 0, sl = Math.sqrt(1 + g * g);
  for (const piece of facetClip(outline, f.cuts)) {
    const tris = earcut(piece, undefined, 2);
    const base = mb.vcount;
    for (let i = 0; i < piece.length; i += 2) {
      const x = piece[i], z = piece[i + 1];
      mb.v(x, f.h0 + f.gx * x + f.gz * z, z, nx, ny, nz, -x * sz + z * sx, (x * sx + z * sz) * sl);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2];
      const cr = (piece[b * 2] - piece[a * 2]) * (piece[c * 2 + 1] - piece[a * 2 + 1]) - (piece[b * 2 + 1] - piece[a * 2 + 1]) * (piece[c * 2] - piece[a * 2]);
      if (cr < 0) mb.tri(base + a, base + b, base + c);
      else mb.tri(base + a, base + c, base + b);
    }
  }
}

/**
 * Vertical walls on the edges of the wall-top polygon (at y) up to the roof surface where it
 * stands above them: gable ends, sawtooth ends, notches and slanted edges under a pitched roof.
 * `surface` sets the material per edge from its outward normal.
 */
function gableWalls(mb: MeshBuilder, poly: Poly, y: number, facets: Facet[], surface: (nx: number, nz: number) => void): void {
  const n = poly.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2], az = poly[i * 2 + 1], dx = poly[j * 2] - ax, dz = poly[j * 2 + 1] - az;
    const L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const nx = dz / L, nz = -dx / L;
    // Breakpoints: where the edge crosses a facet boundary.
    const ts = [0, 1];
    for (const f of facets) for (const c of f.cuts) {
      const den = c[0] * dx + c[1] * dz;
      if (Math.abs(den) < 1e-9) continue;
      const t = (c[2] - c[0] * ax - c[1] * az) / den;
      if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    let surfaced = false;
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-6) continue;
      const tm = (t0 + t1) / 2;
      // Facet under this stretch (by its midpoint), evaluated at both ends (sawtooth steps are discontinuous).
      const f = facetAt(facets, ax + dx * tm, az + dz * tm);
      const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
      const h0 = Math.max(0, f.h0 + f.gx * x0 + f.gz * z0 - y), h1 = Math.max(0, f.h0 + f.gx * x1 + f.gz * z1 - y);
      if (h0 < 0.01 && h1 < 0.01) continue;
      if (!surfaced) { surface(nx, nz); surfaced = true; }
      const i0 = mb.v(x0, y, z0, nx, 0, nz, t0 * L, 0);
      mb.v(x1, y, z1, nx, 0, nz, t1 * L, 0);
      mb.v(x1, y + h1, z1, nx, 0, nz, t1 * L, h1);
      mb.v(x0, y + h0, z0, nx, 0, nz, t0 * L, h0);
      mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
    }
  }
}

/**
 * Offset each edge of a CCW polygon outwards by its own distance (mitred; negative = inwards).
 * Vertex k of the result belongs to vertex k of the input. Outward mitres are capped.
 */
function offsetEach(p: Poly, d: number[]): Poly {
  const n = p.length >> 1;
  const out: Poly = [];
  let dmax = 0;
  for (const v of d) dmax = Math.max(dmax, Math.abs(v));
  for (let k = 0; k < n; k++) {
    const i = (k + n - 1) % n, j = (k + 1) % n;
    const px = p[k * 2], pz = p[k * 2 + 1];
    const ax = px - p[i * 2], az = pz - p[i * 2 + 1], la = Math.hypot(ax, az) || 1;
    const bx = p[j * 2] - px, bz = p[j * 2 + 1] - pz, lb = Math.hypot(bx, bz) || 1;
    const n1x = az / la, n1z = -ax / la, n2x = bz / lb, n2z = -bx / lb;
    const det = n1x * n2z - n1z * n2x;
    let wx: number, wz: number;
    if (Math.abs(det) < 1e-3) { const m = (d[i] + d[k]) / 2; wx = n2x * m; wz = n2z * m; }
    else {
      wx = (d[i] * n2z - n1z * d[k]) / det;
      wz = (n1x * d[k] - d[i] * n2x) / det;
      const wl = Math.hypot(wx, wz), lim = 3 * dmax;
      if (d[i] >= 0 && d[k] >= 0 && wl > lim) { wx *= lim / wl; wz *= lim / wl; }
    }
    out.push(px + wx, pz + wz);
  }
  return out;
}

/** Is a ring simple (no two non-adjacent edges intersect), CCW, and has every edge kept its direction? */
function ringSimple(src: Poly, p: Poly): boolean {
  const n = p.length >> 1;
  if (polyArea(p) <= 0) return false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1];
    if (dx * (src[j * 2] - src[i * 2]) + dz * (src[j * 2 + 1] - src[i * 2 + 1]) <= 0.01) return false;
    for (let k = i + 2; k < n; k++) {
      if ((k + 1) % n === i) continue;
      const l = (k + 1) % n;
      if (segIntersect(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], p[k * 2], p[k * 2 + 1], p[l * 2], p[l * 2 + 1])) return false;
    }
  }
  return true;
}

/**
 * Sloped ring from an outer polygon at y0 to an inset polygon at y1 (mansard). Vertex k of inner
 * belongs to vertex k of outer. uv: u along the edge, v up the slope (the shader's dormers).
 */
function mansardSlope(mb: MeshBuilder, outer: Poly, inner: Poly, y0: number, y1: number): void {
  const n = outer.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = outer[i * 2], az = outer[i * 2 + 1], bx = outer[j * 2], bz = outer[j * 2 + 1];
    const cx = inner[j * 2], cz = inner[j * 2 + 1], dx = inner[i * 2], dz = inner[i * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const ex = bx - ax, ez = bz - az;
    // Normal: outward edge normal tilted up by the slope.
    const ox = ez / L, oz = -ex / L;
    const run = Math.max(1e-3, ((ax + bx - cx - dx) * ox + (az + bz - cz - dz) * oz) / 2);
    const nl = Math.hypot(y1 - y0, run);
    const nx = (ox * (y1 - y0)) / nl, ny = run / nl, nz = (oz * (y1 - y0)) / nl;
    // u of the inner corners: their position along the edge, so the shader's bays stay vertical.
    const uc = ((cx - ax) * ex + (cz - az) * ez) / L, ud = ((dx - ax) * ex + (dz - az) * ez) / L;
    const i0 = mb.v(ax, y0, az, nx, ny, nz, 0, 0);
    mb.v(bx, y0, bz, nx, ny, nz, L, 0);
    mb.v(cx, y1, cz, nx, ny, nz, uc, y1 - y0);
    mb.v(dx, y1, dz, nx, ny, nz, ud, y1 - y0);
    // Outward/up-facing winding (same as the walls: a, d, c, b).
    mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
  }
}

/** One piece of rooftop equipment: a box or a raised tank. */
interface RoofItem {
  kind: 'unit' | 'housing' | 'tank';
  x: number; z: number; yaw: number;
  /** Box half extents (unit, housing) or the tank's radius in hx. */
  hx: number; hz: number;
  /** Bottom and top height (a tank stands on legs: its bottom is the roof). */
  y0: number; y1: number;
  /** Tank: body height and leg height. */
  th?: number; legs?: number;
}

/**
 * Rooftop equipment of a flat roof (top polygon at height y): HVAC units, an elevator / stair
 * housing on tall buildings, a wooden water tank on legs. Seeded per building.
 */
function roofItems(b: BuildingDesc, top: Poly, y: number): RoofItem[] {
  const out: RoofItem[] = [];
  const area = Math.abs(polyArea(top));
  if (area < 40) return out;
  const r = new Rng(deriveSeed(b.seed >>> 0, 'rooftop'));
  const obb = minAreaRect(top);
  const yaw = Math.atan2(obb.ux, obb.uz);
  const obbAt = (fu: number, fv: number): [number, number] => {
    const u = fu * obb.hu * 0.7, v = fv * obb.hv * 0.7;
    return [obb.cx + obb.ux * u - obb.uz * v, obb.cz + obb.uz * u + obb.ux * v];
  };
  // Equipment must stand on the roof: L/U-shaped and courtyard roofs leave much of the
  // bounding box empty (a water tank there would float in the air).
  const fitsRoof = (x: number, z: number, rad: number) => {
    if (!pointInPoly(top, x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!pointInPoly(top, x + Math.cos(a) * (rad + 0.4), z + Math.sin(a) * (rad + 0.4))) return false;
    }
    return true;
  };
  const placeOnRoof = (fu: number, fv: number, rad = 1.5): [number, number] | null => {
    for (let t = 0; t < 10; t++) {
      const s = 1 - t * 0.09; // shrink towards the centre on retries
      const p = obbAt(fu * s + (t ? r.range(-0.2, 0.2) : 0), fv * s + (t ? r.range(-0.2, 0.2) : 0));
      if (fitsRoof(p[0], p[1], rad)) return p;
    }
    return null;
  };
  const units = Math.min(8, Math.floor(area / 120));
  for (let k = 0; k < units; k++) {
    const w = r.range(0.8, 2.2), d = r.range(0.8, 1.8), h = r.range(0.6, 1.4);
    const pu = placeOnRoof(r.range(-1, 1), r.range(-1, 1), Math.hypot(w, d) / 2);
    if (pu) out.push({ kind: 'unit', x: pu[0], z: pu[1], yaw, hx: w / 2, hz: d / 2, y0: y, y1: y + h });
  }
  if (b.floors >= 8 && area > 300) {
    // Elevator / stair housing.
    const hw = r.range(2.5, 4), hd = r.range(2.5, 4);
    const ph = placeOnRoof(r.range(-0.3, 0.3), r.range(-0.3, 0.3), Math.hypot(hw, hd));
    if (ph) out.push({ kind: 'housing', x: ph[0], z: ph[1], yaw, hx: hw, hz: hd, y0: y, y1: y + 3.6 });
  }
  if (b.style === 'tenement' || (b.style === 'artdeco' && r.chance(0.3)) || (b.style === 'rowhouse' && r.chance(0.05))) {
    // Wooden water tank on steel legs (New York style).
    const tr = r.range(1.4, 2.0), th = r.range(2.8, 3.6), legs = 2.6;
    const pt = placeOnRoof(r.range(-0.6, 0.6), r.range(-0.6, 0.6), tr * 1.05);
    if (pt) out.push({ kind: 'tank', x: pt[0], z: pt[1], yaw, hx: tr, hz: tr, y0: y, y1: y + legs + th + 1.1, th, legs });
  }
  return out;
}

/** Rooftop equipment: HVAC units, water tanks, elevator housings (see roofItems). */
function roofGear(mb: MeshBuilder, b: BuildingDesc, top: Poly, y: number): void {
  for (const it of roofItems(b, top, y)) {
    if (it.kind === 'unit') {
      paint(mb, 11, [0.85, 0.85, 0.85]);
      mb.box(it.x, (it.y0 + it.y1) / 2, it.z, it.hx, (it.y1 - it.y0) / 2, it.hz, it.yaw);
    } else if (it.kind === 'housing') {
      paint(mb, b.wall === 10 ? 9 : b.wall, [0.9, 0.9, 0.9]);
      mb.box(it.x, (it.y0 + it.y1) / 2, it.z, it.hx, (it.y1 - it.y0) / 2, it.hz, it.yaw);
    } else {
      const tr = it.hx, legs = it.legs!, th = it.th!;
      paint(mb, 21, [0.5, 0.5, 0.5]);
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.box(it.x + dx * tr * 0.6, it.y0 + legs / 2, it.z + dz * tr * 0.6, 0.08, legs / 2, 0.08);
      paint(mb, 12, [0.55, 0.42, 0.32]);
      tankBody(mb, it.x, it.y0 + legs, it.z, tr, th, 12);
      paint(mb, 18, [0.6, 0.6, 0.6]);
      tankCap(mb, it.x, it.y0 + legs + th, it.z, tr * 1.05, 1.1, 12);
    }
  }
}

/** An open vertical cylinder (a tank's staves); u around in metres, v up. */
function tankBody(mb: MeshBuilder, x: number, y: number, z: number, rad: number, h: number, seg: number): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const u0 = (i / seg) * rad * Math.PI * 2, u1 = ((i + 1) / seg) * rad * Math.PI * 2;
    const i0 = mb.v(x + c0 * rad, y, z + s0 * rad, c0, 0, s0, u0, 0);
    mb.v(x + c1 * rad, y, z + s1 * rad, c1, 0, s1, u1, 0);
    mb.v(x + c1 * rad, y + h, z + s1 * rad, c1, 0, s1, u1, h);
    mb.v(x + c0 * rad, y + h, z + s0 * rad, c0, 0, s0, u0, h);
    mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
  }
}

/** A cone (a tank's roof). */
function tankCap(mb: MeshBuilder, x: number, y: number, z: number, rad: number, h: number, seg: number): void {
  const ny = rad / Math.hypot(rad, h), nr = h / Math.hypot(rad, h);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const i0 = mb.v(x + c0 * rad, y, z + s0 * rad, c0 * nr, ny, s0 * nr, 0, 0);
    mb.v(x + c1 * rad, y, z + s1 * rad, c1 * nr, ny, s1 * nr, 1, 0);
    mb.v(x, y + h, z, Math.cos(am) * nr, ny, Math.sin(am) * nr, 0.5, 1);
    mb.tri(i0, i0 + 2, i0 + 1);
  }
}

// ------------------------------------------------------------------------------- landmarks

/** A public building from its kit parts (clear glass, inside and collision-only parts left out). */
export function buildLandmark(mb: MeshBuilder, lm: Landmark, terrain: Terrain): void {
  mb.set('aSeed', seedVar(lm.seed));
  const E = new PartShell(mb);
  for (const p of landmarkParts(lm, terrain)) {
    if (p.hidden || p.clear || p.inner) continue;
    E.part(p);
  }
}

type UV = [number, number];

/** Emits landmark parts in the facade format (Scale's build/landmarks Emitter, LOD0, without dicing and panes). */
class PartShell {
  constructor(readonly mb: MeshBuilder) {}

  private use(m: PartMat): void {
    paint(this.mb, m.layer, m.tint, m.flags, m.bay, m.fh, m.gh);
  }

  /** Top surfaces: the part's top material, else its own without openings. */
  private useTop(p: LmPart): void {
    if (p.top) this.use(p.top);
    else this.use({ ...p.m, flags: p.m.flags & FF.Roof });
  }

  /** Plain foundation material (no windows), a little darker. */
  private usePlinth(p: LmPart): void {
    const t = p.m.tint;
    paint(this.mb, p.m.layer === 10 ? 13 : p.m.layer, [t[0] * 0.8, t[1] * 0.8, t[2] * 0.8], 0, 3, 4, 4);
  }

  /**
   * Convex polygon with per-vertex uv and normals (one normal for all, or one each). The winding
   * is made counter-clockwise around the normal, so the front face is the outside.
   */
  poly(P: V3[], uv: UV[], n: V3 | V3[]): void {
    const mb = this.mb, k = P.length;
    let gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < k; i++) {
      const a = P[i], b = P[(i + 1) % k];
      gx += (a[1] - b[1]) * (a[2] + b[2]);
      gy += (a[2] - b[2]) * (a[0] + b[0]);
      gz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const one = typeof n[0] === 'number';
    let ax = 0, ay = 0, az = 0;
    if (one) { const q = n as V3; ax = q[0]; ay = q[1]; az = q[2]; }
    else for (const q of n as V3[]) { ax += q[0]; ay += q[1]; az += q[2]; }
    if (gx * gx + gy * gy + gz * gz < 1e-10) return;
    const flip = gx * ax + gy * ay + gz * az < 0;
    const i0 = mb.vcount;
    for (let i = 0; i < k; i++) {
      const q = one ? (n as V3) : (n as V3[])[i];
      mb.v(P[i][0], P[i][1], P[i][2], q[0], q[1], q[2], uv[i][0], uv[i][1]);
    }
    for (let i = 1; i + 1 < k; i++) {
      if (flip) mb.tri(i0, i0 + i + 1, i0 + i);
      else mb.tri(i0, i0 + i, i0 + i + 1);
    }
  }

  /** Vertical wall quad from (ax, az) to (bx, bz) between y0 and y1; u from u0 along it, v from vBase. */
  private wallAt(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, u0 = 0, vBase = y0): void {
    if (y1 - y0 < 1e-3) return;
    const L = Math.hypot(bx - ax, bz - az);
    this.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [[u0, y0 - vBase], [u0 + L, y0 - vBase], [u0 + L, y1 - vBase], [u0, y1 - vBase]], [nx, 0, nz]);
  }

  /** Horizontal polygon (world xz as uv). */
  private flatAt(pts: [number, number][], y: number, up: boolean): void {
    this.poly(pts.map(([x, z]) => [x, y, z] as V3), pts.map(([x, z]) => [x, z] as UV), [0, up ? 1 : -1, 0]);
  }

  part(p: LmPart): void {
    switch (p.k) {
      case PK.Box: return this.partBox(p);
      case PK.Cyl: return this.partCyl(p);
      case PK.Dome: return this.partDome(p);
      case PK.Gable: return this.partGable(p);
      case PK.Pyramid: return this.partPyramid(p);
      case PK.Ramp: return this.partRamp(p);
      case PK.Beam: return this.partBeam(p);
      case PK.Tube: return this.partTube(p);
      case PK.Vault: return this.partVault(p);
      case PK.Flat: return this.partFlat(p);
      case PK.Quad: return this.partQuad(p);
      case PK.Lathe: return this.partLathe(p);
      case PK.Prism: return this.partPrism(p);
      case PK.Perf: return this.partPerf(p);
      case PK.Helix: return this.partHelix(p);
      case PK.Strut: return this.partStrut(p);
    }
  }

  /** A cylinder between two points (any direction). */
  private partStrut(p: LmPart): void {
    const n = p.seg ?? 10, rad = p.w ?? 0.3;
    const a: V3 = [p.x, p.y0, p.z], b: V3 = [p.bx!, p.by!, p.bz!];
    const d = v3norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // Two axes across the strut.
    const h: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = v3norm(v3cross(d, h));
    const e2 = v3cross(d, e1);
    const strutDir = (t: number): V3 => [e1[0] * Math.cos(t) + e2[0] * Math.sin(t), e1[1] * Math.cos(t) + e2[1] * Math.sin(t), e1[2] * Math.cos(t) + e2[2] * Math.sin(t)];
    const rim = (q: V3, e: V3): V3 => [e[0] + q[0] * rad, e[1] + q[1] * rad, e[2] + q[2] * rad];
    this.use(p.m);
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2, q0 = strutDir(t0), q1 = strutDir(t1);
      this.poly([rim(q0, a), rim(q1, a), rim(q1, b), rim(q0, b)], [[t0 * rad, 0], [t1 * rad, 0], [t1 * rad, L], [t0 * rad, L]], [q0, q1, q1, q0]);
    }
  }

  /** Triangles (index triples into P) with their winding turned to face the normal. */
  private trisFacing(P: V3[], uv: UV[], n: V3, idx: ArrayLike<number>): void {
    const mb = this.mb;
    const i0 = mb.vcount;
    for (let i = 0; i < P.length; i++) mb.v(P[i][0], P[i][1], P[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1]);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const A = P[a], B = P[b], C = P[c];
      const ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2], fx = C[0] - A[0], fy = C[1] - A[1], fz = C[2] - A[2];
      const gx = ey * fz - ez * fy, gy = ez * fx - ex * fz, gz = ex * fy - ey * fx;
      if (gx * n[0] + gy * n[1] + gz * n[2] < 0) mb.tri(i0 + a, i0 + c, i0 + b);
      else mb.tri(i0 + a, i0 + b, i0 + c);
    }
  }

  /** Surface of revolution (elliptical by hx, hz): bands between the profile's rings, caps at open ends. */
  private partLathe(p: LmPart): void {
    const P = p.pts!, n = p.seg ?? 32, K = P.length >> 1;
    const c = Math.cos(p.a), s = Math.sin(p.a), sx = p.hx, sz = p.hz;
    const closed = latheClosed(P);
    const latheAt = (t: number, r: number, y: number): V3 => {
      const u = Math.cos(t) * r * sx, v = Math.sin(t) * r * sz;
      return [p.x + u * c - v * s, y, p.z + u * s + v * c];
    };
    // Profile step normals (radial, y) and per-ring normals: smooth across gentle bends, sharp at corners.
    const segN: [number, number][] = [];
    for (let i = 0; i + 1 < K; i++) {
      const dr = P[i * 2 + 2] - P[i * 2], dy = P[i * 2 + 3] - P[i * 2 + 1], l = Math.hypot(dr, dy) || 1;
      segN.push([dy / l, -dr / l]);
    }
    const ringN = (i: number, side: 0 | 1): [number, number] => {
      // Normal at ring i for the step i (side 0: its start) or i-1 (side 1: its end).
      const own = segN[side ? i - 1 : i];
      const otherIdx = side ? i : i - 1;
      const other = otherIdx >= 0 && otherIdx < segN.length ? segN[otherIdx] : closed ? segN[(otherIdx + segN.length) % segN.length] : null;
      if (!other || own[0] * other[0] + own[1] * other[1] < 0.7) return own;
      const l = Math.hypot(own[0] + other[0], own[1] + other[1]) || 1;
      return [(own[0] + other[0]) / l, (own[1] + other[1]) / l];
    };
    const latheN = (t: number, q: [number, number]): V3 => {
      const u = (Math.cos(t) / sx) * q[0], v = (Math.sin(t) / sz) * q[0];
      return v3norm([u * c - v * s, q[1], u * s + v * c]);
    };
    this.use(p.m);
    let len = 0;
    const rs = (sx + sz) / 2;
    for (let i = 0; i + 1 < K; i++) {
      const r0 = P[i * 2], y0 = P[i * 2 + 1], r1 = P[i * 2 + 2], y1 = P[i * 2 + 3];
      const L = Math.hypot(r1 - r0, y1 - y0);
      if (L < 1e-4) continue;
      const q0 = ringN(i, 0), q1 = ringN(i + 1, 1);
      for (let j = 0; j < n; j++) {
        const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
        const pts: V3[] = [latheAt(t0, r0, y0), latheAt(t1, r0, y0), latheAt(t1, r1, y1), latheAt(t0, r1, y1)];
        const uv: UV[] = [[t0 * r0 * rs, len], [t1 * r0 * rs, len], [t1 * r1 * rs, len + L], [t0 * r1 * rs, len + L]];
        const nn: V3[] = [latheN(t0, q0), latheN(t1, q0), latheN(t1, q1), latheN(t0, q1)];
        if (r0 < 1e-3) this.poly([pts[0], pts[2], pts[3]], [uv[0], uv[2], uv[3]], [nn[0], nn[2], nn[3]]);
        else if (r1 < 1e-3) this.poly([pts[0], pts[1], pts[2]], [uv[0], uv[1], uv[2]], [nn[0], nn[1], nn[2]]);
        else this.poly(pts, uv, nn);
      }
      len += L;
    }
    if (closed || p.noSides) return;
    const latheCap = (r: number, y: number, up: boolean) => {
      if (r < 1e-3) return;
      const ring: [number, number][] = [];
      for (let j = 0; j < n; j++) { const q = latheAt((j / n) * Math.PI * 2, r, y); ring.push([q[0], q[2]]); }
      this.flatAt(ring, y, up);
    };
    this.useTop(p);
    latheCap(P[K * 2 - 2], P[K * 2 - 1], true);
    if (p.foot === undefined) { this.use(p.m); latheCap(P[0], P[1], false); }
  }

  /** World point of a part's local (u along its axis, v across) at height y. */
  private partPoint(p: LmPart, u: number, v: number, y: number): V3 {
    const [x, z] = frameToWorld({ x: p.x, z: p.z, angle: p.a }, u, v);
    return [x, y, z];
  }

  /** A slab in a vertical plane: the outline on both faces, its edges between them. */
  private partPrism(p: LmPart): void {
    const P = p.pts!, k = P.length >> 1, c = Math.cos(p.a), s = Math.sin(p.a);
    const flat: number[] = [];
    for (let i = 0; i < k; i++) flat.push(P[i * 2], P[i * 2 + 1]);
    const idx = earcut(flat);
    this.use(p.m);
    for (const sv of [-1, 1]) {
      const pts: V3[] = [], uv: UV[] = [];
      for (let i = 0; i < k; i++) { pts.push(this.partPoint(p, P[i * 2], sv * p.hz, P[i * 2 + 1])); uv.push([sv * P[i * 2], P[i * 2 + 1] - p.y0]); }
      this.trisFacing(pts, uv, [-s * sv, 0, c * sv], idx);
    }
    // Edges: outward in the plane is (dy, -du) for a CCW outline (u right, y up).
    let area = 0;
    for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += P[i * 2] * P[j * 2 + 1] - P[j * 2] * P[i * 2 + 1]; }
    const sg = area >= 0 ? 1 : -1;
    let run = 0;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k, du = P[j * 2] - P[i * 2], dy = P[j * 2 + 1] - P[i * 2 + 1], L = Math.hypot(du, dy);
      if (L < 1e-4) continue;
      const nu = (sg * dy) / L, ny = (-sg * du) / L;
      if (ny > 0.5) this.useTop(p); else this.use(p.m);
      this.poly([this.partPoint(p, P[i * 2], -p.hz, P[i * 2 + 1]), this.partPoint(p, P[j * 2], -p.hz, P[j * 2 + 1]), this.partPoint(p, P[j * 2], p.hz, P[j * 2 + 1]), this.partPoint(p, P[i * 2], p.hz, P[i * 2 + 1])],
        [[run, 0], [run + L, 0], [run + L, 2 * p.hz], [run, 2 * p.hz]], [nu * c, ny, nu * s]);
      run += L;
    }
  }

  /** A slab pierced by round holes along v: both faces with the holes cut out, the holes lined. */
  private partPerf(p: LmPart): void {
    const H = p.pts!, n = p.seg ?? 24, c = Math.cos(p.a), s = Math.sin(p.a);
    const R = this.partRect(p, p.hx, p.hz);
    this.partFoot(p, R);
    // Face outline (u, y) with the holes (any winding works for earcut's holes).
    const flat = [-p.hx, p.y0, p.hx, p.y0, p.hx, p.y1, -p.hx, p.y1];
    const holes: number[] = [];
    for (let i = 0; i < H.length; i += 3) {
      holes.push(flat.length >> 1);
      for (let j = 0; j < n; j++) { const t = (-j / n) * Math.PI * 2; flat.push(H[i] + Math.cos(t) * H[i + 2], H[i + 1] + Math.sin(t) * H[i + 2]); }
    }
    const idx = earcut(flat, holes);
    this.use(p.m);
    for (const sv of [-1, 1]) {
      const pts: V3[] = [], uv: UV[] = [];
      for (let i = 0; i < flat.length; i += 2) { pts.push(this.partPoint(p, flat[i], sv * p.hz, flat[i + 1])); uv.push([sv * flat[i] + p.hx, flat[i + 1] - p.y0]); }
      this.trisFacing(pts, uv, [-s * sv, 0, c * sv], idx);
    }
    // Ends (u = ±hx), roof, underside.
    for (const su of [-1, 1]) this.poly([this.partPoint(p, su * p.hx, -p.hz, p.y0), this.partPoint(p, su * p.hx, p.hz, p.y0), this.partPoint(p, su * p.hx, p.hz, p.y1), this.partPoint(p, su * p.hx, -p.hz, p.y1)],
      [[0, 0], [2 * p.hz, 0], [2 * p.hz, p.y1 - p.y0], [0, p.y1 - p.y0]], [su * c, 0, su * s]);
    this.useTop(p);
    this.flatAt(R, p.y1, true);
    if (p.foot === undefined) { this.use(p.m); this.flatAt(R, p.y0, false); }
    // Hole linings (facing the hole's axis), in the lining material.
    this.use(p.back ?? { ...p.m, flags: 0 });
    for (let i = 0; i < H.length; i += 3) {
      const hu = H[i], hy = H[i + 1], hr = H[i + 2];
      const holeAt = (t: number, v: number) => this.partPoint(p, hu + Math.cos(t) * hr, v, hy + Math.sin(t) * hr);
      const holeN = (t: number): V3 => v3norm([-Math.cos(t) * c, -Math.sin(t), -Math.cos(t) * s]);
      for (let j = 0; j < n; j++) {
        const t0 = (j / n) * Math.PI * 2, t1 = ((j + 1) / n) * Math.PI * 2;
        this.poly([holeAt(t0, -p.hz), holeAt(t1, -p.hz), holeAt(t1, p.hz), holeAt(t0, p.hz)], [[t0 * hr, 0], [t1 * hr, 0], [t1 * hr, 2 * p.hz], [t0 * hr, 2 * p.hz]], [holeN(t0), holeN(t1), holeN(t1), holeN(t0)]);
      }
    }
  }

  /** Helix walkway (the opaque part): the floor slab (top, underside, outer edge) and a roof edge. */
  private partHelix(p: LmPart): void {
    const turns = Math.abs(p.turns!), sg = p.turns! < 0 ? -1 : 1, r0 = p.r!, r1 = p.r2!, hh = p.hh!;
    const N = Math.max(4, Math.ceil(turns * (p.seg ?? 48))), full = turns * Math.PI * 2;
    const helixAt = (phi: number, r: number, y: number): V3 => { const t = p.a + sg * phi; return [p.x + Math.cos(t) * r, y, p.z + Math.sin(t) * r]; };
    const helixOut = (phi: number): V3 => { const t = p.a + sg * phi; return [Math.cos(t), 0, Math.sin(t)]; };
    const w = r1 - r0;
    for (let i = 0; i < N; i++) {
      const fa = (i / N) * full, fb = ((i + 1) / N) * full;
      const ya = helixFloorAt(p, fa), yb = helixFloorAt(p, fb);
      const na = helixOut(fa), nb = helixOut(fb);
      // Floor (walking surface), underside, outer edge and the roof rim (a band of the frame along the top of the glass).
      const flatUV: UV[] = [[0, fa * r0], [w, fa * r0], [w, fb * r0], [0, fb * r0]];
      const edgeUV = (h: number): UV[] => [[fa * r1, 0], [fb * r1, 0], [fb * r1, h], [fa * r1, h]];
      this.useTop(p);
      this.poly([helixAt(fa, r0, ya), helixAt(fa, r1, ya), helixAt(fb, r1, yb), helixAt(fb, r0, yb)], flatUV, [0, 1, 0]);
      this.use(p.m);
      this.poly([helixAt(fa, r0, ya - HELIX_SLAB), helixAt(fa, r1, ya - HELIX_SLAB), helixAt(fb, r1, yb - HELIX_SLAB), helixAt(fb, r0, yb - HELIX_SLAB)], flatUV, [0, -1, 0]);
      this.poly([helixAt(fa, r1, ya - HELIX_SLAB), helixAt(fb, r1, yb - HELIX_SLAB), helixAt(fb, r1, yb), helixAt(fa, r1, ya)], edgeUV(HELIX_SLAB), [na, nb, nb, na]);
      this.poly([helixAt(fa, r1 + 0.05, ya + hh - 0.35), helixAt(fb, r1 + 0.05, yb + hh - 0.35), helixAt(fb, r1 + 0.05, yb + hh), helixAt(fa, r1 + 0.05, ya + hh)], edgeUV(0.35), [na, nb, nb, na]);
    }
    // Mullions every few metres along the outside.
    const step = Math.max(1, Math.round(N / Math.max(1, (full * r1) / 3.2)));
    for (let i = 0; i <= N; i += step) {
      const f = (i / N) * full, y = helixFloorAt(p, f), q = helixAt(f, r1 + 0.05, y);
      this.mb.beam(q[0], y, q[2], q[0], y + hh, q[2], 0.06, 0.06);
    }
  }

  /** Corners of the part's rectangle (half sizes a along u, b along v), CCW from above. */
  private partRect(p: LmPart, a: number, b: number): [number, number][] {
    return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, v]) => { const q = this.partPoint(p, u, v, 0); return [q[0], q[2]] as [number, number]; });
  }

  /** Walls around a CCW ring of points between y0 and y1 (each wall's u from 0 at its start). */
  private ringWallsAt(R: [number, number][], y0: number, y1: number, vBase = y0): void {
    for (let i = 0; i < R.length; i++) {
      const [ax, az] = R[i], [bx, bz] = R[(i + 1) % R.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4) continue;
      this.wallAt(ax, az, bx, bz, y0, y1, (bz - az) / L, -(bx - ax) / L, 0, vBase);
    }
  }

  /** Foundation walls from p.foot up to the part's bottom (or `to`). */
  private partFoot(p: LmPart, R: [number, number][], to = p.y0): void {
    if (p.foot === undefined || p.foot > to - 0.05) return;
    this.usePlinth(p);
    this.ringWallsAt(R, p.foot, to);
  }

  private partBox(p: LmPart): void {
    const R = this.partRect(p, p.hx, p.hz);
    this.partFoot(p, R);
    this.use(p.m);
    this.ringWallsAt(R, p.y0, p.y1);
    this.useTop(p);
    this.flatAt(R, p.y1, true);
    // Underside of parts that do not stand on a foundation (attics, platforms, pods).
    if (p.foot === undefined) { this.use(p.m); this.flatAt(R, p.y0, false); }
  }

  private partCyl(p: LmPart): void {
    const n = p.seg ?? 20, r0 = p.r ?? p.hx, r1 = p.r2 ?? r0, h = p.y1 - p.y0;
    // (A half one sweeps the part's +v side only, like a half dome.)
    const half = !!p.half, m = half ? Math.max(3, n >> 1) : n, a0f = half ? p.a : 0, step = (half ? Math.PI : Math.PI * 2) / m;
    const cylRing = (r: number): [number, number][] => Array.from({ length: half ? m + 1 : m }, (_, i) => [p.x + Math.cos(a0f + i * step) * r, p.z + Math.sin(a0f + i * step) * r]);
    const R0 = cylRing(r0), R1 = cylRing(r1);
    this.partFoot(p, R0);
    this.use(p.m);
    const ny = r0 - r1;
    const sg = p.inward ? -1 : 1;
    for (let i = 0; i < m; i++) {
      const j = half ? i + 1 : (i + 1) % m;
      const a0 = a0f + i * step, a1 = a0f + (i + 1) * step;
      const n0: V3 = v3norm([Math.cos(a0) * h * sg, ny * sg, Math.sin(a0) * h * sg]), n1: V3 = v3norm([Math.cos(a1) * h * sg, ny * sg, Math.sin(a1) * h * sg]);
      const u0 = a0 * r0, u1 = a1 * r0;
      if (r1 > 1e-3) this.poly([[R0[i][0], p.y0, R0[i][1]], [R0[j][0], p.y0, R0[j][1]], [R1[j][0], p.y1, R1[j][1]], [R1[i][0], p.y1, R1[i][1]]], [[u0, 0], [u1, 0], [u1, h], [u0, h]], [n0, n1, n1, n0]);
      else this.poly([[R0[i][0], p.y0, R0[i][1]], [R0[j][0], p.y0, R0[j][1]], [p.x, p.y1, p.z]], [[u0, 0], [u1, 0], [(u0 + u1) / 2, h]], [n0, n1, v3norm([n0[0] + n1[0], n0[1] + n1[1], n0[2] + n1[2]])]);
    }
    if (half || p.inward) return;
    if (r1 > 1e-3) { this.useTop(p); this.flatAt(R1, p.y1, true); }
    if (p.foot === undefined && p.y0 > 0) { this.use(p.m); this.flatAt(R0, p.y0, false); }
  }

  private partDome(p: LmPart): void {
    if (p.pend) return this.partPendentives(p);
    const n = p.seg ?? 20, K = 7;
    const h = p.y1 - p.y0;
    const domePt = (t: number, f: number): V3 => this.partPoint(p, Math.cos(t) * p.hx * Math.cos(f), Math.sin(t) * p.hz * Math.cos(f), p.y0 + h * Math.sin(f));
    const c = Math.cos(p.a), s = Math.sin(p.a);
    const sg = p.inward ? -1 : 1, sweep = p.half ? Math.PI : Math.PI * 2, m = p.half ? Math.max(3, n >> 1) : n;
    const domeN = (t: number, f: number): V3 => {
      const u = Math.cos(t) * Math.cos(f) / p.hx, v = Math.sin(t) * Math.cos(f) / p.hz;
      return v3norm([(u * c - v * s) * sg, (Math.sin(f) / h) * sg, (u * s + v * c) * sg]);
    };
    const domeUV = (t: number, f: number): UV => [t * p.hx, f * Math.abs(h)];
    this.use(p.m);
    for (let k = 0; k < K; k++) {
      const f0 = (k / K) * Math.PI / 2, f1 = ((k + 1) / K) * Math.PI / 2;
      for (let i = 0; i < m; i++) {
        const t0 = (i / m) * sweep, t1 = ((i + 1) / m) * sweep;
        if (k === K - 1) this.poly([domePt(t0, f0), domePt(t1, f0), domePt(t0, f1)], [domeUV(t0, f0), domeUV(t1, f0), domeUV(t0, f1)], [domeN(t0, f0), domeN(t1, f0), domeN(t0, f1)]);
        else this.poly([domePt(t0, f0), domePt(t1, f0), domePt(t1, f1), domePt(t0, f1)], [domeUV(t0, f0), domeUV(t1, f0), domeUV(t1, f1), domeUV(t0, f1)], [domeN(t0, f0), domeN(t1, f0), domeN(t1, f1), domeN(t0, f1)]);
      }
    }
  }

  /** Pendentives (see LmPart.pend): rings from the square's sides in to the circle, seen from below. */
  private partPendentives(p: LmPart): void {
    const a = p.hx, b = p.hz, r = p.r!, Rd = Math.hypot(a, b), c = Math.cos(p.a), s = Math.sin(p.a);
    const q = (p.y1 - p.y0) / Math.sqrt(Math.max(1e-6, Rd * Rd - r * r));
    const n = 32, K = 5;
    const pendAt = (t: number, f: number): { p: V3; n: V3; uv: UV } => {
      const ct = Math.cos(t), st = Math.sin(t);
      const ds = Math.min(a / Math.max(1e-6, Math.abs(ct)), b / Math.max(1e-6, Math.abs(st)));
      const d = ds + (r - ds) * f, u = ct * d, v = st * d, h = q * Math.sqrt(Math.max(0, Rd * Rd - d * d));
      return {
        p: [p.x + u * c - v * s, p.y0 + h, p.z + u * s + v * c],
        n: v3norm([-(u * c - v * s), -h / (q * q), -(u * s + v * c)]),
        uv: [t * r, d],
      };
    };
    this.use(p.m);
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
        const P = [pendAt(t0, k / K), pendAt(t1, k / K), pendAt(t1, (k + 1) / K), pendAt(t0, (k + 1) / K)];
        this.poly(P.map((e) => e.p), P.map((e) => e.uv), P.map((e) => e.n));
      }
    }
  }

  private partGable(p: LmPart): void {
    const o = 0.35, rise = p.y1 - p.y0, slope = rise / p.hz;
    const c = Math.cos(p.a), s = Math.sin(p.a);
    const ye = p.y0 - o * slope, hu = p.hx + o;
    this.useTop(p);
    for (const sv of [-1, 1]) {
      // Slope y = y1 - sv·slope·v: normal (0, sv·slope, 1) in (u, v, y), v = (-sin, cos) in world.
      const wn = v3norm([-s * sv * slope, 1, c * sv * slope]);
      const L = Math.hypot(p.hz + o, rise + o * slope);
      this.poly([this.partPoint(p, -hu, sv * (p.hz + o), ye), this.partPoint(p, hu, sv * (p.hz + o), ye), this.partPoint(p, hu, 0, p.y1), this.partPoint(p, -hu, 0, p.y1)], [[0, 0], [hu * 2, 0], [hu * 2, L], [0, L]], wn);
    }
    this.use({ ...p.m, flags: 0 });
    for (const su of [-1, 1]) this.poly([this.partPoint(p, su * p.hx, -p.hz, p.y0), this.partPoint(p, su * p.hx, p.hz, p.y0), this.partPoint(p, su * p.hx, 0, p.y1)], [[0, 0], [p.hz * 2, 0], [p.hz, rise]], [su * c, 0, su * s]);
  }

  private partPyramid(p: LmPart): void {
    const t = p.r2 ?? 0, B = this.partRect(p, p.hx, p.hz), T = this.partRect(p, p.hx * t, p.hz * t);
    this.partFoot(p, B);
    this.use(p.m);
    const h = p.y1 - p.y0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ex = B[j][0] - B[i][0], ez = B[j][1] - B[i][1], L = Math.hypot(ex, ez);
      const inset = (i % 2 === 0 ? p.hz : p.hx) * (1 - t);
      const n = v3norm([(ez / L) * h, inset, -(ex / L) * h]);
      const sl = Math.hypot(h, inset);
      if (t > 1e-3) this.poly([[B[i][0], p.y0, B[i][1]], [B[j][0], p.y0, B[j][1]], [T[j][0], p.y1, T[j][1]], [T[i][0], p.y1, T[i][1]]], [[0, 0], [L, 0], [L * (0.5 + t / 2), sl], [L * (0.5 - t / 2), sl]], n);
      else this.poly([[B[i][0], p.y0, B[i][1]], [B[j][0], p.y0, B[j][1]], [p.x, p.y1, p.z]], [[0, 0], [L, 0], [L / 2, sl]], n);
    }
    if (t > 1e-3) { this.useTop(p); this.flatAt(T, p.y1, true); }
  }

  /** Corners of a stand on the ground: front left, front right, back right, back left (x, z). */
  private rampCorners(p: LmPart): [number, number][] {
    if (p.q && p.q.length === 8) return [[p.q[0], p.q[1]], [p.q[2], p.q[3]], [p.q[4], p.q[5]], [p.q[6], p.q[7]]];
    const a = p.hx, b = p.hx2 ?? p.hx, hz = p.hz;
    return [[-a, -hz], [a, -hz], [b, hz], [-b, hz]].map(([u, v]) => { const q = this.partPoint(p, u, v, 0); return [q[0], q[2]] as [number, number]; });
  }

  /** Sloped stand (a quadrilateral prism) with stepped seat rows. */
  private partRamp(p: LmPart): void {
    const [F0, F1, K1, K0] = this.rampCorners(p), yLo = p.yLo ?? p.y1;
    // Bilinear over the corners: s across the front, t from the front to the back.
    const rampAt = (s: number, t: number, y: number): V3 =>
      [lerp(lerp(F0[0], F1[0], s), lerp(K0[0], K1[0], s), t), y, lerp(lerp(F0[1], F1[1], s), lerp(K0[1], K1[1], s), t)];
    // Outward hints: front (towards the field) and back.
    const fm = [(F0[0] + F1[0]) / 2, (F0[1] + F1[1]) / 2], km = [(K0[0] + K1[0]) / 2, (K0[1] + K1[1]) / 2];
    const dl = Math.hypot(km[0] - fm[0], km[1] - fm[1]) || 1;
    const nf: V3 = [(fm[0] - km[0]) / dl, 0, (fm[1] - km[1]) / dl], nb: V3 = [-nf[0], 0, -nf[2]];
    const wF = Math.hypot(F1[0] - F0[0], F1[1] - F0[1]), wK = Math.hypot(K1[0] - K0[0], K1[1] - K0[1]);
    const footed = p.foot !== undefined && p.foot < p.y0 - 0.05;
    const fy = p.foot ?? p.y0;
    if (footed) {
      this.usePlinth(p);
      this.poly([rampAt(0, 0, fy), rampAt(1, 0, fy), rampAt(1, 0, p.y0), rampAt(0, 0, p.y0)], [[0, 0], [wF, 0], [wF, p.y0 - fy], [0, p.y0 - fy]], nf);
      this.poly([rampAt(0, 1, fy), rampAt(1, 1, fy), rampAt(1, 1, p.y0), rampAt(0, 1, p.y0)], [[0, 0], [wK, 0], [wK, p.y0 - fy], [0, p.y0 - fy]], nb);
    }
    this.use(p.m);
    if (yLo > p.y0 + 0.01) this.poly([rampAt(0, 0, p.y0), rampAt(1, 0, p.y0), rampAt(1, 0, yLo), rampAt(0, 0, yLo)], [[0, 0], [wF, 0], [wF, yLo - p.y0], [0, yLo - p.y0]], nf);
    this.use(p.back ?? p.m);
    this.poly([rampAt(0, 1, p.y0), rampAt(1, 1, p.y0), rampAt(1, 1, p.y1), rampAt(0, 1, p.y1)], [[0, 0], [wK, 0], [wK, p.y1 - p.y0], [0, p.y1 - p.y0]], nb);
    const rows = p.rows ?? 0;
    if (!p.noSides) {
      for (const s of [0, 1]) {
        const ex = (s ? F1[0] - F0[0] : F0[0] - F1[0]) / (wF || 1), ez = (s ? F1[1] - F0[1] : F0[1] - F1[1]) / (wF || 1);
        if (footed) {
          this.usePlinth(p);
          this.poly([rampAt(s, 0, fy), rampAt(s, 1, fy), rampAt(s, 1, p.y0), rampAt(s, 0, p.y0)], [[0, 0], [dl, 0], [dl, p.y0 - fy], [0, p.y0 - fy]], [ex, 0, ez]);
        }
        this.use(p.m);
        this.poly([rampAt(s, 0, p.y0), rampAt(s, 1, p.y0), rampAt(s, 1, p.y1), rampAt(s, 0, yLo)], [[0, 0], [dl, 0], [dl, p.y1 - p.y0], [0, yLo - p.y0]], [ex, 0, ez]);
        // The seat rows' steps over the slope.
        for (let i = 0; i < (rows < 2 ? 0 : rows); i++) {
          const t0 = i / rows, t1 = (i + 1) / rows, y = yLo + ((p.y1 - yLo) * i) / rows, y2 = yLo + ((p.y1 - yLo) * (i + 1)) / rows;
          this.poly([rampAt(s, t0, y), rampAt(s, t1, y2), rampAt(s, t0, y2)], [[dl * t0, y - p.y0], [dl * t1, y2 - p.y0], [dl * t0, y2 - p.y0]], [ex, 0, ez]);
        }
      }
    }
    if (p.foot === undefined) { this.use(p.m); this.poly([rampAt(0, 0, p.y0), rampAt(1, 0, p.y0), rampAt(1, 1, p.y0), rampAt(0, 1, p.y0)], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]); }
    this.useTop(p);
    if (rows < 2) {
      const L = Math.hypot(dl, p.y1 - yLo);
      this.poly([rampAt(0, 0, yLo), rampAt(1, 0, yLo), rampAt(1, 1, p.y1), rampAt(0, 1, p.y1)], [[0, 0], [wF, 0], [wK, L], [0, L]], v3norm([nf[0] * (p.y1 - yLo), dl, nf[2] * (p.y1 - yLo)]));
      return;
    }
    // Seat rows: a riser and a tread per row.
    const dy = (p.y1 - yLo) / rows;
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows, t1 = (i + 1) / rows, y = yLo + i * dy, y2 = y + dy;
      const w0 = wF + (wK - wF) * t0, w1 = wF + (wK - wF) * t1;
      this.poly([rampAt(0, t0, y), rampAt(1, t0, y), rampAt(1, t0, y2), rampAt(0, t0, y2)], [[0, 0], [w0, 0], [w0, dy], [0, dy]], nf);
      this.poly([rampAt(0, t0, y2), rampAt(1, t0, y2), rampAt(1, t1, y2), rampAt(0, t1, y2)], [[0, 0], [w0, 0], [w1, dl / rows], [0, dl / rows]], [0, 1, 0]);
    }
  }

  private partBeam(p: LmPart): void {
    this.use(p.m);
    const w = p.w ?? 0.2;
    this.mb.beam(p.x, p.y0, p.z, p.bx!, p.by!, p.bz!, w, w);
  }

  private partTube(p: LmPart): void {
    const n = p.seg ?? 14, r0 = p.r ?? p.hz, r1 = p.r2 ?? r0, yc = (p.y0 + p.y1) / 2;
    const c = Math.cos(p.a), s = Math.sin(p.a);
    // Frame: u along the axis, w across horizontally, y up.
    const tubeAt = (u: number, t: number, r: number): V3 => this.partPoint(p, u, Math.cos(t) * r, yc + Math.sin(t) * r);
    const tubeN = (t: number): V3 => v3norm([-Math.cos(t) * s, Math.sin(t), Math.cos(t) * c]);
    this.use(p.m);
    const L = 2 * p.hx;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      this.poly([tubeAt(-p.hx, t0, r0), tubeAt(-p.hx, t1, r0), tubeAt(p.hx, t1, r1), tubeAt(p.hx, t0, r1)], [[t0 * r0, 0], [t1 * r0, 0], [t1 * r0, L], [t0 * r0, L]], [tubeN(t0), tubeN(t1), tubeN(t1), tubeN(t0)]);
    }
    for (const [u, r, sg] of [[-p.hx, r0, -1], [p.hx, r1, 1]] as const) {
      if (r < 1e-3) continue;
      const pts: V3[] = [], uv: UV[] = [];
      for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push(tubeAt(u, t, r)); uv.push([Math.cos(t) * r, Math.sin(t) * r]); }
      this.poly(pts, uv, [sg * c, 0, sg * s]);
    }
  }

  private partVault(p: LmPart): void {
    const n = p.seg ?? 14, h = p.y1 - p.y0;
    const c = Math.cos(p.a), s = Math.sin(p.a);
    const vaultAt = (u: number, f: number): V3 => this.partPoint(p, u, -Math.cos(f) * p.hz, p.y0 + Math.sin(f) * h);
    const sg = p.inward ? -1 : 1;
    const vaultN = (f: number): V3 => { const v = -Math.cos(f) / p.hz; return v3norm([-v * s * sg, (Math.sin(f) / h) * sg, v * c * sg]); };
    const arc = (f: number) => f * (p.hz + h) / 2;
    this.use(p.m);
    for (let i = 0; i < n; i++) {
      const f0 = (i / n) * Math.PI, f1 = ((i + 1) / n) * Math.PI;
      this.poly([vaultAt(-p.hx, f0), vaultAt(p.hx, f0), vaultAt(p.hx, f1), vaultAt(-p.hx, f1)], [[0, arc(f0)], [2 * p.hx, arc(f0)], [2 * p.hx, arc(f1)], [0, arc(f1)]], [vaultN(f0), vaultN(f0), vaultN(f1), vaultN(f1)]);
    }
    if (p.inward) return;
    for (const su of [-1, 1]) {
      const pts: V3[] = [], uv: UV[] = [];
      for (let i = 0; i <= n; i++) { const f = (i / n) * Math.PI; pts.push(vaultAt(su * p.hx, f)); uv.push([-Math.cos(f) * p.hz + p.hz, Math.sin(f) * h]); }
      this.poly(pts, uv, [su * c, 0, su * s]);
    }
  }

  private partFlat(p: LmPart): void {
    const R = this.partRect(p, p.hx, p.hz);
    this.partFoot(p, R, p.y1);
    this.use(p.m);
    this.flatAt(R, p.y1, true);
  }

  private partQuad(p: LmPart): void {
    const q = p.q!;
    this.use(p.m);
    const pts: V3[] = [[q[0], q[1], q[2]], [q[3], q[4], q[5]], [q[6], q[7], q[8]], [q[9], q[10], q[11]]];
    this.poly(pts, pts.map((v) => [v[0], v[2]] as UV), [0, 1, 0]);
  }
}
