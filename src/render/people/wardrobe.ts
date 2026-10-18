/**
 * SimWorld's wardrobe for the humanoid package (its `Wardrobe` hook): which clothes exist and how they sit,
 * as garment shells the package fits to any body, plus hats as small rigid parts on the head.
 *
 * Ported from Dunfinity (src/render/humans/wardrobe.ts, `everyday`: today's clothes, themselves Scale's city
 * wardrobe); the dungeon kit, rags and weapons stayed behind. Hats are built with the MeshBuilder in the
 * VERTEX_COLOR_SOLID kind, so they need no shader of their own.
 */
import type { BodyFit, ItemVisual, ShellLayer, ShellMaterial, WearableSpec } from '@futuremagic/humanoid';
import type { Wardrobe } from '@futuremagic/humanoid/three';
import { Group, type Mesh, type Object3D } from 'three/webgpu';
import { MeshBuilder } from '../../build/meshBuilder';
import { meshFromData } from '../meshes';
import { VERTEX_COLOR_SOLID } from '../materials';

type Rgb = [number, number, number];

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
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

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
    case 'jeans': return shell(LEGS(0.97), 0.006, 1, fab('plain', { roughness: 0.92 }));
    case 'chinos': return shell(LEGS(0.98), 0.007, 1, fab(pat, { roughness: 0.8 }));
    case 'shorts': return shell(LEGS(0.4), 0.006, 1, fab(pat));
    case 'skirt': return shell([{ region: 'pelvis', from: 0.5 }, { region: 'buttocks', from: 0.4 }], 0.008, 2, fab(pat, { roughness: 0.8 }), { skirt: { length: 0.45 + (v.seed % 3) * 0.12, flare: 0.3 } });
    case 'sneakers': return shell(FEET, 0.012, 1, fab('plain', { roughness: 0.7 }), { trim: { width: 0.02, color: [0.95, 0.95, 0.95] } });
    case 'shoes': return shell(FEET, 0.01, 1, fab('leather', { roughness: 0.4 }));
    case 'boots': return shell([...FEET, { region: 'shin.L', from: 0.65 }, { region: 'shin.R', from: 0.65 }], 0.012, 2, fab('leather', { roughness: 0.5 }));
    /** A knitted beanie: a dome over the crown, the hair tucked under. */
    case 'beanie': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => beanie(fit, c) }], hideHair: true };
    /** A baseball cap: a shallow dome and a stiff peak forward. */
    case 'cap': return { layers: [{ kind: 'rigid', socket: 'head', build: (fit: BodyFit) => cap(fit, c) }], hideHair: true };
    default: return null;
  }
}

/**
 * A beanie in head-socket space (+z forward, y up, from between the ears): a dome over the skull, whose
 * centre sits a little up and back from there.
 */
function beanie(fit: BodyFit, c: Rgb): Object3D {
  const r = fit.headRadius;
  return solid((mb) => dome(mb, 0, r * 0.3, -r * 0.08, r * 1.12, r * 1.25, r * 1.22, c, 18, 0.5));
}

/** A cap: a shallow dome over the skull and a flat peak over the brow. */
function cap(fit: BodyFit, c: Rgb): Object3D {
  const r = fit.headRadius;
  return solid((mb) => {
    dome(mb, 0, r * 0.35, -r * 0.06, r * 1.1, r * 1.12, r * 1.18, c, 18, 0.5);
    dome(mb, 0, r * 0.42, r * 1.1, r * 0.8, 0.006, r * 0.62, shade(c, 0.85), 16, 1);
  });
}

/**
 * The top `frac` of an ellipsoid (1: the whole of it) around (x, y, z) with radii (rx, ry, rz), `seg`
 * segments round, coloured `c`: hats and the like.
 */
function dome(mb: MeshBuilder, x: number, y: number, z: number, rx: number, ry: number, rz: number, c: Rgb, seg: number, frac: number): void {
  mb.set('color', c[0], c[1], c[2]);
  const rings = Math.max(2, Math.round(seg / 2)), base = 0;
  const first = mb.v(x, y + ry, z, 0, 1, 0) - base;
  let prev: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const th = (i / rings) * Math.PI * frac, sy = Math.cos(th), sr = Math.sin(th);
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, cx = Math.cos(a) * sr, cz = Math.sin(a) * sr;
      const nx = cx / rx, ny = sy / ry, nz = cz / rz, nl = Math.hypot(nx, ny, nz) || 1;
      ring.push(mb.v(x + cx * rx, y + sy * ry, z + cz * rz, nx / nl, ny / nl, nz / nl));
    }
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      if (i === 1) mb.tri(first, ring[k1], ring[k]);
      else mb.quad(prev[k], prev[k1], ring[k1], ring[k]);
    }
    prev = ring;
  }
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
