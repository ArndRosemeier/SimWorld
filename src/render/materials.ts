/**
 * The material registry (docs/SHADERS.md): every material in the game is made here, from a closed
 * list of kinds, so the set of shaders is known up front and compiled during warm-up. Guarded:
 * nothing outside this file may construct a material.
 *
 * Every mesh of a kind uses the kind's one material, so a kind is one shader; variation goes in
 * vertex attributes or uniforms, never in a new material. Ported from Dunfinity.
 */
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { groundLook, terrainLook, waterLook } from './tsl/ground';
import type { AttrSpec } from '../build/meshBuilder';
import { TERRAIN_SPECS } from '../build/terrainMesh';

export interface MaterialKind {
  readonly name: string;
  /**
   * The geometry attributes meshes of this kind carry besides position and normal, with their
   * storage types (the build layer's `MeshBuilder` specs; warm-up builds a matching stand-in).
   * Meshes are always indexed.
   */
  readonly attributes: readonly AttrSpec[];
  /** Whether meshes of this kind cast and receive the sun's shadow (receiving is part of the shader's cache key). */
  readonly shadow: { readonly cast: boolean; readonly receive: boolean };
  /** The kind's material (one instance, made on first use). */
  make(): Material;
}

const kinds = new Map<string, MaterialKind>();

function defineKind(name: string, attributes: MaterialKind['attributes'], build: () => Material, shadow = { cast: true, receive: true }): MaterialKind {
  if (kinds.has(name)) throw new Error(`material kind "${name}" defined twice`);
  let proto: Material | null = null;
  const kind: MaterialKind = {
    name,
    attributes,
    shadow,
    make() {
      proto ??= Object.assign(build(), { name });
      return proto;
    },
  };
  kinds.set(name, kind);
  return kind;
}

/** Every kind, for the warm-up. */
export function allKinds(): readonly MaterialKind[] {
  return [...kinds.values()];
}

/** Lit, vertex-coloured solid: placeholder geometry, simple props, massing. */
export const VERTEX_COLOR_SOLID = defineKind('vertexColorSolid', [{ name: 'color', size: 3, type: 'u8n' }], () =>
  new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));

/** Natural terrain with the countryside's land use and beaches (src/build/terrainMesh.ts tiles: world-xz uv, aLand, aShore). */
export const TERRAIN = defineKind('terrain', TERRAIN_SPECS, () => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  terrainLook(m);
  return m;
}, { cast: false, receive: true });

/** The town's ground surfaces by layer (src/build/ground.ts: world-xz uv, aLayer), country roads and farmyards too. */
export const GROUND = defineKind('ground', [{ name: 'uv', size: 2 }, { name: 'aLayer', size: 1 }], () => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  groundLook(m);
  return m;
}, { cast: false, receive: true });

/** Rivers, lakes and the sea (src/build/terrainMesh.ts water tiles: world-xz uv, aLayer). */
export const WATER = defineKind('water', [{ name: 'uv', size: 2 }, { name: 'aLayer', size: 1 }], () => {
  const m = new MeshPhysicalNodeMaterial({ color: 0x1d3b44, roughness: 0.06, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  waterLook(m);
  return m;
}, { cast: false, receive: false });
