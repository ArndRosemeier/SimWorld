/**
 * The material registry (docs/SHADERS.md): every material in the game is made here, from a closed
 * list of kinds, so the set of shaders is known up front and compiled during warm-up. Guarded:
 * nothing outside this file may construct a material.
 *
 * Every mesh of a kind uses the kind's one material, so a kind is one shader; variation goes in
 * vertex attributes or uniforms, never in a new material. Ported from Dunfinity.
 */
import { DoubleSide, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { groundLook, terrainLook, waterLook } from './tsl/ground';
import { facadeLook } from './tsl/facade';
import { furnitureLook } from './tsl/furniture';
import { vehicleLook } from './tsl/vehicles';
import { signAtlas } from './signAtlas';
import { FURNITURE_SPECS } from '../build/furniture';
import { VEHICLE_SPECS } from '../build/vehicles';
import type { MaterialArrays } from './textures';
import { facadeSpecs } from '../build/massing';
import type { AttrSpec } from '../build/meshBuilder';
import { TERRAIN_SPECS } from '../build/terrainMesh';
import { barkLook, farLook, leafLook, type VegetationTextures } from './tsl/vegetation';
import { BARK_SPECS, FAR_SPECS, LEAF_SPECS } from '../build/vegetation';

export interface MaterialKind {
  readonly name: string;
  /**
   * The geometry attributes meshes of this kind carry besides position and normal, with their
   * storage types (the build layer's `MeshBuilder` specs; warm-up builds a matching stand-in).
   * Meshes are always indexed.
   */
  readonly attributes: readonly AttrSpec[];
  /**
   * Per-instance attributes when the kind is drawn instanced (InstancedMesh; `instancedFromData`
   * in meshes.ts): instancing is part of the shader, so warm-up builds an instanced stand-in.
   */
  readonly instanced?: readonly AttrSpec[];
  /**
   * Drawn as one BatchedMesh of many models (`batchedFromData` in meshes.ts), with a colour per
   * instance (`batchColor`): batching is part of the shader, so warm-up builds a batched stand-in.
   */
  readonly batched?: boolean;
  /** Whether meshes of this kind cast and receive the sun's shadow (receiving is part of the shader's cache key). */
  readonly shadow: { readonly cast: boolean; readonly receive: boolean };
  /** The kind's material (one instance, made on first use). */
  make(): Material;
}

const kinds = new Map<string, MaterialKind>();

/** The generated texture arrays (src/render/textures.ts `loadTextures`); set before the warm-up makes the textured kinds. */
const textures: { facade?: MaterialArrays; vegetation?: VegetationTextures } = {};
export function useTextures(t: typeof textures): void {
  Object.assign(textures, t);
}
function needTextures<K extends keyof typeof textures>(k: K): NonNullable<(typeof textures)[K]> {
  const t = textures[k];
  if (!t) throw new Error(`the ${k} textures are not loaded yet (useTextures before the warm-up)`);
  return t as NonNullable<(typeof textures)[K]>;
}

function defineKind(name: string, attributes: MaterialKind['attributes'], build: () => Material, shadow = { cast: true, receive: true }, instanced?: MaterialKind['instanced'], batched = false): MaterialKind {
  if (kinds.has(name)) throw new Error(`material kind "${name}" defined twice`);
  let proto: Material | null = null;
  const kind: MaterialKind = {
    name,
    attributes,
    shadow,
    instanced,
    batched,
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

/**
 * Buildings, landmarks and bridge piers (src/build/massing.ts `facadeSpecs`): textured walls and
 * roofs with procedural windows, doors and shop fronts. Double-sided: the insides are plastered.
 */
export const FACADE = defineKind('facade', facadeSpecs(), () => {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: DoubleSide, shadowSide: DoubleSide });
  facadeLook(m, needTextures('facade'));
  return m;
});

/**
 * Street furniture (src/build/furniture.ts: uv into the sign atlas, aFurn material id / emissive
 * / sub-material, aColor), batched: the instance colour is the paint override (rgb, sRGB, 0 = the
 * model's) and a noise offset (a) (src/render/propsView.ts).
 */
export const FURNITURE = defineKind('furniture', FURNITURE_SPECS, () => {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  furnitureLook(m, signAtlas());
  return m;
}, { cast: true, receive: true }, undefined, true);

/**
 * Vehicles (src/build/vehicles.ts: uv, aPart), batched: the instance colour is the paint (rgb,
 * sRGB). Double-sided: the loft leaves open edges.
 */
export const VEHICLE = defineKind('vehicle', VEHICLE_SPECS, () => {
  const m = new MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, side: DoubleSide });
  vehicleLook(m);
  return m;
}, { cast: true, receive: true }, undefined, true);

/**
 * Tree and shrub wood (src/build/vegetation.ts `BARK_SPECS`: uv into the bark atlas, aWind,
 * aOcc), instanced (src/render/vegetationView.ts), swaying in the wind.
 */
export const BARK = defineKind('bark', BARK_SPECS, () => {
  const m = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  barkLook(m, needTextures('vegetation'));
  return m;
}, { cast: true, receive: true }, []);

/**
 * Leaf cards of every tree and shrub (`LEAF_SPECS`: uv into the leaf atlas, aWind, aLeafTint,
 * aOcc), alpha-tested and double-sided, instanced.
 */
export const LEAVES = defineKind('leaves', LEAF_SPECS, () => {
  const m = new MeshStandardNodeMaterial({ alphaTest: 0.45, side: DoubleSide, shadowSide: DoubleSide, roughness: 0.78, metalness: 0 });
  leafLook(m, needTextures('vegetation'));
  return m;
}, { cast: true, receive: true }, []);

/** Far tree hulls (`FAR_SPECS`: kind and deciduous in uv, colour, autumn colour, aWind), instanced. */
export const TREE_FAR = defineKind('treeFar', FAR_SPECS, () => {
  const m = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  farLook(m);
  return m;
}, { cast: true, receive: true }, []);
