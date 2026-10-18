/**
 * SimWorld's wardrobe for the humanoid package (its `Wardrobe` hook): which clothes exist and how they sit,
 * as garment shells the package fits to any body, plus hats as rigid parts on the head, built to fit it (hats.ts).
 *
 * Ported from Dunfinity (src/render/humans/wardrobe.ts, `everyday`: today's clothes, themselves Scale's city
 * wardrobe); the dungeon kit, rags and weapons stayed behind. Hats are built with the MeshBuilder in the
 * VERTEX_COLOR_SOLID kind, so they need no shader of their own.
 */
import { HEAD_AZ, HEAD_EL, type BodyFit, type HeadShape, type ItemVisual, type ShellLayer, type ShellMaterial, type WearableSpec } from '@futuremagic/humanoid';
import type { Wardrobe } from '@futuremagic/humanoid/three';
import { Group, type Mesh, type Object3D } from 'three/webgpu';
import { MeshBuilder } from '../../build/meshBuilder';
import { meshFromData } from '../meshes';
import { VERTEX_COLOR_SOLID } from '../materials';
import { HAIR_BANDS, beanieMesh, capMesh, earsMesh, shade, witchHatMesh } from './hats';


const cloth = (v: ItemVisual, pattern: ShellMaterial['pattern'], o: Partial<ShellMaterial> = {}): ShellMaterial => ({
  color: v.primary,
  color2: v.secondary,
  pattern,
  patternScale: o.patternScale ?? 6,
  roughness: o.roughness ?? 0.85,
  metalness: 0,
  sheen: o.sheen ?? 0.3,
  glow: 0,
  glowColor: [0, 0, 0],
  wear: v.wear ?? 0.15,
});

const TORSO: ShellLayer['regions'] = [{ region: 'chest' }, { region: 'belly' }, { region: 'back' }];
const shell = (regions: ShellLayer['regions'], offset: number, layer: number, material: ShellMaterial, more: Partial<ShellLayer> = {}): WearableSpec =>
  ({ layers: [{ kind: 'shell', regions, offset, layer, material, ...more } as ShellLayer] });

/** Both sleeves or trouser legs covering `to` of the limb (0..1: the upper part first, then the lower). */
const limbs = (upper: 'upperarm' | 'thigh', lower: 'forearm' | 'shin', to: number): ShellLayer['regions'] => [
  { region: `${upper}.L`, to: Math.min(1, to * 2) }, { region: `${upper}.R`, to: Math.min(1, to * 2) },
  ...(to > 0.5 ? [{ region: `${lower}.L` as const, to: (to - 0.5) * 2 }, { region: `${lower}.R` as const, to: (to - 0.5) * 2 }] : []),
];
const ARMS = (to: number): ShellLayer['regions'] => limbs('upperarm', 'forearm', to);
const LEGS = (to: number): ShellLayer['regions'] => [{ region: 'pelvis' }, { region: 'buttocks' }, ...limbs('thigh', 'shin', to)];
const FEET: ShellLayer['regions'] = [{ region: 'foot.L' }, { region: 'foot.R' }];

/** Today's clothes: the item's pattern in `visual.material` ('plain', 'stripes', 'checks', 'leather'), the fine cut from its seed. */
function resolve(defId: string, v: ItemVisual): WearableSpec | null {
  const c = v.primary, c2 = v.secondary;
  const pat = (v.material === 'cloth' ? 'plain' : v.material) as ShellMaterial['pattern'];
  const fab = (pattern: ShellMaterial['pattern'], o: Partial<ShellMaterial> = {}): ShellMaterial => cloth(v, pattern, o);
  switch (defId) {
    case 'tshirt': return shell([...TORSO, ...ARMS(0.22)], 0.004, 1, fab(pat, { roughness: 0.9 }), { trim: { width: 0.006, color: c2 } });
    case 'shirt': return shell([...TORSO, ...ARMS(0.97)], 0.004, 1, fab(pat, { roughness: 0.75, sheen: 0.2 }), { trim: { width: 0.01, color: shade(c, 0.9) } });
    case 'sweater': return shell([...TORSO, { region: 'neck', to: 0.3 }, ...ARMS(0.95)], 0.008, 2, fab(pat === 'plain' ? 'quilted' : pat, { roughness: 0.95, patternScale: 14, sheen: 0.5 }), { trim: { width: 0.015, color: c2 } });
    /** A hoodie: thick plain fleece to the wrists, a ribbed band at the hem and cuffs. */
    case 'hoodie': return shell([...TORSO, { region: 'neck', to: 0.45 }, ...ARMS(0.97)], 0.01, 2, fab(pat, { roughness: 0.97, sheen: 0.45 }), { trim: { width: 0.022, color: shade(c, 0.8) } });
    case 'dress': return shell([...TORSO, { region: 'pelvis' }, { region: 'buttocks' }, ...ARMS(v.seed % 2 ? 0.2 : 0)], 0.006, 2, fab(pat, { roughness: 0.75, sheen: 0.5 }), { skirt: { length: 0.55 + (v.seed % 3) * 0.1, flare: 0.35 } });
    case 'jacket': return shell([...TORSO, ...ARMS(0.95)], 0.014, 3, fab(pat, { roughness: pat === 'leather' ? 0.55 : 0.8 }), { trim: { width: 0.02, color: c2 } });
    /** A rain jacket: shiny, to the waist. */
    case 'raincoat': return shell([...TORSO, ...ARMS(0.97)], 0.016, 3, fab('plain', { roughness: 0.3, sheen: 0.1 }), { trim: { width: 0.02, color: shade(c, 0.75) } });
    case 'blazer': return shell([...TORSO, ...ARMS(0.97)], 0.012, 3, fab('plain', { roughness: 0.7, sheen: 0.35 }), { skirt: { length: 0.22, flare: 0.05, slits: 1 }, trim: { width: 0.02, color: shade(c, 0.7) } });
    case 'coat': return shell([...TORSO, ...ARMS(0.97)], 0.02, 4, fab(pat, { roughness: 0.9, sheen: 0.4 }), { skirt: { length: 0.72, flare: 0.25, slits: 1 }, trim: { width: 0.03, color: c2 } });
    /** A long robe to the ankles (Halloween: a ghost's sheet, a witch's gown). */
    case 'robe': return shell([...TORSO, { region: 'neck', to: 0.4 }, ...ARMS(1)], 0.012, 3, fab('plain', { roughness: 0.92, sheen: 0.3 }), { skirt: { length: 0.98, flare: 0.3 } });
    case 'jeans': return shell(LEGS(0.97), 0.006, 1, fab('plain', { roughness: 0.92 }));
    case 'chinos': return shell(LEGS(0.98), 0.007, 1, fab(pat, { roughness: 0.8 }));
    case 'shorts': return shell(LEGS(0.4), 0.006, 1, fab(pat));
    case 'skirt': return shell([{ region: 'pelvis', from: 0.5 }, { region: 'buttocks', from: 0.4 }], 0.008, 2, fab(pat, { roughness: 0.8 }), { skirt: { length: 0.45 + (v.seed % 3) * 0.12, flare: 0.3 } });
    case 'sneakers': return shell(FEET, 0.012, 1, fab('plain', { roughness: 0.7 }), { trim: { width: 0.02, color: [0.95, 0.95, 0.95] } });
    case 'shoes': return shell(FEET, 0.01, 1, fab('leather', { roughness: 0.4 }));
    case 'boots': return shell([...FEET, { region: 'shin.L', from: 0.65 }, { region: 'shin.R', from: 0.65 }], 0.012, 2, fab('leather', { roughness: 0.5 }));
    // Hats fit the head (hats.ts); the hair above their band is under them, the rest shows.
    /** A knitted beanie with a folded cuff (some with a bobble). */
    case 'beanie': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => hat(fit, (mb, h) => beanieMesh(mb, h, c, c2, v.seed % 5 < 2)) }], hairBand: HAIR_BANDS.beanie };
    /** A baseball cap: six panels and a stiff peak over the brow. */
    case 'cap': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => hat(fit, (mb, h) => capMesh(mb, h, c, shade(c, 0.6))) }], hairBand: HAIR_BANDS.cap };
    /** A witch's hat: a tall bent crown, a wide brim and a band. */
    case 'witchHat': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => hat(fit, (mb, h) => witchHatMesh(mb, h, c, c2, v.seed)) }], hairBand: HAIR_BANDS.witchHat };
    /** Cat's ears on a hair band. */
    case 'ears': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => hat(fit, (mb, h) => earsMesh(mb, h, c, [0.85, 0.55, 0.6])) }] };
    default: return null;
  }
}

/** A hat built over the head's shape (hats.ts); a round head of `fit.headRadius` when the body has no shape. */
function hat(fit: BodyFit, build: (mb: MeshBuilder, h: HeadShape) => void): Object3D {
  return solid((mb) => build(mb, fit.head ?? roundHead(fit.headRadius)));
}

/** A plain round head (a body built before heads were measured). */
function roundHead(r: number): HeadShape {
  return { c: [0, r * 0.12, r * 0.08], r: new Array(HEAD_AZ * HEAD_EL).fill(r), radius: r, brow: r * 0.35, earTop: r * 0.3, earZ: 0, top: r * 1.12 };
}

/** A small solid object from MeshBuilder parts, in the vertex-coloured kind. */
function solid(build: (mb: MeshBuilder) => void): Object3D {
  const mb = new MeshBuilder([...VERTEX_COLOR_SOLID.attributes]);
  build(mb);
  const g = new Group();
  const m: Mesh = meshFromData(mb.build(), VERTEX_COLOR_SOLID);
  m.matrixAutoUpdate = true;
  g.add(m);
  return g;
}

export const WARDROBE: Wardrobe = {
  resolve,
  itemDef: (defId) => ({ visual: { shape: defId } }),
  buildItem: (defId) => { throw new Error(`no held item "${defId}"`); },
  disposeItem: (o) => o.traverse((m) => (m as Mesh).geometry?.dispose()),
};
