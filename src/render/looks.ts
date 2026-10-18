/**
 * The looks check's swatches (`looks.html`, `npm run looks`, docs/CI.md): every registered material kind
 * (materials.ts), each of its variants, drawn alone from real mesh data, so a shader that renders a finish pure black,
 * blown out, NaN or magenta shows up as one failing swatch with its name.
 *
 * The data is the game's own: the town workers' cells, terrain, water, landmarks, prop models with their first
 * placed instance's paint, tree models and an interior; vehicles from the build layer. A variant is what a kind's
 * shader switches on per vertex (`VARIANTS`: the furniture's material and sub-material, a ground or facade layer, a
 * vehicle part); each swatch is the triangles of one variant, cropped to a few metres round its first one.
 * Every kind needs a row in `VARIANTS` and a source in `collectSwatches`: a kind without one fails the check.
 */
import { InstancedBufferGeometry, Vector3, type InstancedBufferAttribute, type Mesh } from 'three/webgpu';
import { MeshBuilder, type MeshData } from '../build/meshBuilder';
import { FF } from '../build/massing';
import { buildVehicle, paintColor, VEHICLE_KINDS } from '../build/vehicles';
import { VEG_MODELS } from '../build/vegetation';
import { isVehicleModel, PROP_STRIDE } from '../build/streetProps';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown, TownSummary } from '../workers/townProtocol';
import { allKinds, BARK, FACADE, FURNITURE, GROUND, INTERIOR, LEAVES, TERRAIN, TREE_FAR, VEHICLE, VERTEX_COLOR_SOLID, WATER, type MaterialKind } from './materials';
import { instancedFromData, meshFromData } from './meshes';

/** One swatch: a mesh of one kind showing one variant, and where to look. */
export interface Swatch {
  kind: string;
  label: string;
  mesh: Mesh;
  center: Vector3;
  radius: number;
  /** Faint by design (rain, smoke): judged on NaN and magenta only. */
  seeThrough?: boolean;
  /** Look at it from inside (the sky dome): the camera stands at `center` and looks out. */
  inside?: boolean;
  /** The side to look from (unit, from the centre towards the camera). */
  view?: [number, number, number];
  /** The area (m²) its front faces show from that side, so the page knows how much it should cover. */
  frontArea?: number;
  /** A finish whose look is all reflection (glass, chrome): dark under even light by design (`DARK`). */
  dark?: boolean;
}

/** A vertex attribute's value as the shader reads it (normalised integer types to 0…1). */
function attr(d: MeshData, name: string, i: number, c = 0): number {
  const a = d.attrs[name];
  if (!a) return 0;
  const v = a.array[i * a.size + c];
  if (!a.normalized) return v;
  return a.array instanceof Uint8Array ? v / 255 : a.array instanceof Uint16Array ? v / 65535 : a.array instanceof Int8Array ? v / 127 : v;
}

/** What a kind's shader switches on per vertex: the variant key of vertex `i` (one key: the kind has no variants). */
export const VARIANTS: Readonly<Record<string, (d: MeshData, i: number) => string>> = {
  vertexColorSolid: () => 'all',
  terrain: (d, i) => {
    let best = 0;
    for (let c = 1; c < 4; c++) if (attr(d, 'aLand', i, c) > attr(d, 'aLand', i, best)) best = c;
    return `land ${best}${attr(d, 'aShore', i) > 0.5 ? ' shore' : ''}`;
  },
  ground: (d, i) => `layer ${Math.round(attr(d, 'aLayer', i))}`,
  water: (d, i) => `layer ${Math.round(attr(d, 'aLayer', i))}`,
  facade: (d, i) => {
    const f = attr(d, 'aFacade', i, 3);
    return `layer ${Math.round(attr(d, 'aLayer', i))}${f & FF.Roof ? ' roof' : ''}${f & FF.Shop ? ' shop' : ''}${f & FF.Glow ? ' glass' : ''}`;
  },
  furniture: (d, i) => `mat ${Math.round(attr(d, 'aFurn', i))} sub ${Math.round(attr(d, 'aFurn', i, 2))}`,
  vehicle: (d, i) => `part ${Math.round(attr(d, 'aPart', i))}`,
  bark: () => 'all',
  leaves: () => 'all',
  treeFar: () => 'all',
  interior: (d, i) => `layer ${Math.round(attr(d, 'aLayer', i))}`,
  sky: () => 'all',
  precip: () => 'all',
  smoke: () => 'all',
};

/**
 * Variants that are mirror metals (metalness 1): no diffuse colour at all, so black under even light by design and
 * not judged black. Keep this short; each entry is a finish that really is all reflection.
 */
export const DARK: Readonly<Record<string, (variant: string) => boolean>> = {
  // Chrome trim and alloy rims (src/render/tsl/vehicles.ts, aPart 2 and 15).
  vehicle: (v) => v === 'part 2' || v === 'part 15',
};

/** Swatches are cropped to this far (m) round the first triangle of their variant, or to a little more than that triangle. */
const CROP = 1.5;

/** One variant's piece of mesh data: the cropped triangles, their bounds' centre and radius, and the side to look from. */
export interface VariantPiece { data: MeshData; center: [number, number, number]; radius: number; view: [number, number, number]; frontArea: number }

/**
 * Split mesh data into one piece per variant (by each triangle's first vertex), each cropped round its first
 * triangle (CROP, or 1.2 times that triangle's longest edge for coarse meshes like terrain); the attribute arrays are
 * shared, only the index is new. `view`: the side to look from, the piece's area-weighted normal tipped up a little.
 */
export function splitByVariant(d: MeshData, key: (d: MeshData, i: number) => string): Map<string, VariantPiece> {
  const P = d.attrs.position, idx = d.index;
  const groups = new Map<string, { tris: number[]; at: [number, number, number]; crop: number; n: [number, number, number] }>();
  const pos = (v: number, c: number) => P.array[v * P.size + c];
  const edge = (a: number, b: number) => Math.hypot(pos(a, 0) - pos(b, 0), pos(a, 1) - pos(b, 1), pos(a, 2) - pos(b, 2));
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2], k = key(d, a);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { tris: [], at: [pos(a, 0), pos(a, 1), pos(a, 2)], crop: Math.max(CROP, 1.2 * Math.max(edge(a, b), edge(b, c), edge(c, a))), n: [0, 0, 0] }));
    if (Math.hypot(pos(a, 0) - g.at[0], pos(a, 1) - g.at[1], pos(a, 2) - g.at[2]) > g.crop) continue;
    g.tris.push(a, b, c);
    // The face normal times twice its area.
    const ux = pos(b, 0) - pos(a, 0), uy = pos(b, 1) - pos(a, 1), uz = pos(b, 2) - pos(a, 2);
    const vx = pos(c, 0) - pos(a, 0), vy = pos(c, 1) - pos(a, 1), vz = pos(c, 2) - pos(a, 2);
    g.n[0] += uy * vz - uz * vy; g.n[1] += uz * vx - ux * vz; g.n[2] += ux * vy - uy * vx;
  }
  const out = new Map<string, VariantPiece>();
  for (const [k, g] of groups) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of g.tris) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos(v, c)); hi[c] = Math.max(hi[c], pos(v, c)); }
    const center: [number, number, number] = [(lo[0] + hi[0]) / 2 + d.origin[0], (lo[1] + hi[1]) / 2 + d.origin[1], (lo[2] + hi[2]) / 2 + d.origin[2]];
    const radius = Math.max(0.05, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    const nl = Math.hypot(...g.n);
    // A closed piece (normals cancel) is seen from the default side: above and in front.
    const n = nl > 1e-9 ? g.n.map((x) => x / nl) : [0.55, 0.65, 0.75];
    const view = [n[0] + 0.25, n[1] + 0.35, n[2] + 0.2], vl = Math.hypot(...view);
    const v: [number, number, number] = [view[0] / vl, view[1] / vl, view[2] / vl];
    // The area its front faces show to that side (m²): what the swatch should cover.
    let frontArea = 0;
    for (let t = 0; t < g.tris.length; t += 3) {
      const a = g.tris[t], b = g.tris[t + 1], c = g.tris[t + 2];
      const ux = pos(b, 0) - pos(a, 0), uy = pos(b, 1) - pos(a, 1), uz = pos(b, 2) - pos(a, 2);
      const wx = pos(c, 0) - pos(a, 0), wy = pos(c, 1) - pos(a, 1), wz = pos(c, 2) - pos(a, 2);
      frontArea += Math.max(0, ((uy * wz - uz * wy) * v[0] + (uz * wx - ux * wz) * v[1] + (ux * wy - uy * wx) * v[2]) / 2);
    }
    const index = d.index instanceof Uint16Array ? Uint16Array.from(g.tris) : Uint32Array.from(g.tris);
    out.set(k, { data: { ...d, index, bounds: [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]] }, center, radius, view: v, frontArea });
  }
  return out;
}

/** One instance at the world origin, scale 1, with these extra per-instance values (zero otherwise). */
function oneInstance(d: MeshData, kind: MaterialKind, extra: Record<string, ArrayLike<number>> = {}): Mesh {
  const m = instancedFromData(d, kind, 1);
  const g = m.geometry as InstancedBufferGeometry;
  const set = (name: string, v: ArrayLike<number>) => { const a = g.getAttribute(name) as InstancedBufferAttribute | undefined; if (a) { (a.array as Float32Array).set(Array.from(v).slice(0, a.itemSize)); a.needsUpdate = true; } };
  set('iPose', [0, 0, 0, 0]);
  set('iSize', [1, 1]);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return m;
}

/** Every variant of `data` as swatches of `kind`, named after `what`. Instanced kinds get one instance (`extra` per-instance values). */
function swatchesOf(kind: MaterialKind, what: string, data: MeshData | null, extra?: Record<string, ArrayLike<number>>): Swatch[] {
  if (!data || !data.index.length) return [];
  const key = VARIANTS[kind.name];
  if (!key) throw new Error(`material kind "${kind.name}" has no row in VARIANTS (src/render/looks.ts)`);
  const out: Swatch[] = [];
  for (const [k, p] of splitByVariant(data, key)) {
    const mesh = kind.instanced ? oneInstance(p.data, kind, extra) : meshFromData(p.data, kind);
    out.push({ kind: kind.name, label: `${what} ${k}`.trim(), mesh, center: new Vector3(...p.center), radius: p.radius, view: p.view, frontArea: p.frontArea, dark: DARK[kind.name]?.(k) ?? false });
  }
  return out;
}

type Pool = WorkerPool<ToTown, FromTown>;
async function ask<T extends FromTown['type']>(pool: Pool, msg: ToTown, type: T): Promise<Extract<FromTown, { type: T }>> {
  const r = await pool.run(msg, 0);
  if (r.type !== type) throw new Error(`town worker: ${msg.type} answered ${r.type === 'error' ? r.message : r.type}`);
  return r as Extract<FromTown, { type: T }>;
}

/**
 * The swatches of every kind drawn from mesh data, from the town the workers planned (`town`). The sky, rain and
 * smoke are not mesh data: the page adds those (`looks.ts`).
 */
export async function collectSwatches(pool: Pool, town: TownSummary): Promise<Swatch[]> {
  const out: Swatch[] = [];
  // The town's ground and buildings, a few cells from the centre out, the landmarks and the countryside.
  for (let c = 0; c < Math.min(town.cells, 6); c++) {
    const r = await ask(pool, { type: 'cell', cell: c }, 'cell');
    out.push(...swatchesOf(GROUND, `cell ${c}`, r.ground), ...swatchesOf(FACADE, `cell ${c}`, r.buildings));
  }
  for (let l = 0; l < town.landmarks; l++) out.push(...swatchesOf(FACADE, `landmark ${l}`, (await ask(pool, { type: 'landmark', index: l }, 'landmark')).mesh));
  const country = await ask(pool, { type: 'country' }, 'country');
  out.push(...swatchesOf(GROUND, 'country', country.ground), ...swatchesOf(FACADE, 'country', country.buildings));
  // Terrain and water: the tiles nearest the centre (water from the first tile that has any).
  const tiles = [...town.tiles].sort((a, b) => Math.hypot(a.x0 + a.size / 2 - town.x, a.z0 + a.size / 2 - town.z) - Math.hypot(b.x0 + b.size / 2 - town.x, b.z0 + b.size / 2 - town.z));
  for (const t of tiles.slice(0, 3)) out.push(...swatchesOf(TERRAIN, 'terrain', (await ask(pool, { type: 'terrain', tile: t }, 'terrain')).mesh));
  for (const t of tiles) {
    const w = (await ask(pool, { type: 'water', tile: t }, 'water')).mesh;
    if (w) { out.push(...swatchesOf(WATER, 'water', w)); break; }
  }
  // Street furniture: every prop model the town places, with its first instance's paint (iTint). Parked cars are
  // the vehicle kinds below.
  const props = await ask(pool, { type: 'props', kerbCars: false }, 'props');
  for (const g of props.groups) {
    if (isVehicleModel(g.model) || g.inst.length < PROP_STRIDE) continue;
    const m = await ask(pool, { type: 'propModel', model: g.model }, 'propModel');
    const I = g.inst;
    out.push(...swatchesOf(FURNITURE, g.model, m.mesh, { iTint: [I[5], I[6], I[7], I[8]] }));
  }
  // Every vehicle kind (the traffic's), in its usual paint, lights off.
  for (const [i, k] of VEHICLE_KINDS.entries()) {
    const v = buildVehicle(k);
    out.push(...swatchesOf(VEHICLE, k, v.body, { iPaint: paintColor(k, 1) }));
    if (!i) out.push(...swatchesOf(VEHICLE, `${k} wheel`, v.wheel, { iPaint: paintColor(k, 1) }));
  }
  // Every tree and shrub model: wood, leaves, the far hull.
  for (let i = 0; i < VEG_MODELS.length; i++) {
    const t = (await ask(pool, { type: 'vegModel', index: i }, 'vegModel')).model;
    out.push(...swatchesOf(BARK, `tree ${i}`, t.wood), ...swatchesOf(LEAVES, `tree ${i}`, t.leaves), ...swatchesOf(TREE_FAR, `tree ${i}`, t.far));
  }
  // Small vertex-coloured things (what people carry, src/render/people/wardrobe.ts): a box in a held thing's colour.
  const box = new MeshBuilder([...VERTEX_COLOR_SOLID.attributes]);
  box.set('color', 0.55, 0.4, 0.3);
  box.box(0, 0.25, 0, 0.25, 0.25, 0.25);
  out.push(...swatchesOf(VERTEX_COLOR_SOLID, 'box', box.build()));
  // An interior: the first building that has one.
  for (let c = 0, found = false; c < town.cells && !found; c++) {
    for (let b = 0; b < 8 && !found; b++) {
      const r = await pool.run({ type: 'interior', cell: c, building: b, floor: 0 }, 0);
      if (r.type === 'interior' && r.mesh) { out.push(...swatchesOf(INTERIOR, `cell ${c} building ${b}`, r.mesh)); found = true; }
    }
  }
  return out;
}

/** The kinds no swatch shows (each must have at least one, or the check fails). */
export function kindsWithout(swatches: readonly Swatch[]): string[] {
  const shown = new Set(swatches.map((s) => s.kind));
  return allKinds().map((k) => k.name).filter((k) => !shown.has(k));
}
