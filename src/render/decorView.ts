/**
 * The holiday decorations outside on the stage (src/build/decorProps.ts lists every spot): each model one
 * geometry-instanced mesh of the `FURNITURE` kind (no shader of its own), showing the instances that are up
 * today. `set` takes the households' choices per building (the lit windows' slot bytes, src/street/windows.ts
 * `decorShares`) and today's occasions, and repacks only when what is up changes.
 */
import { Group } from 'three/webgpu';
import type { WorkerPool } from '../workers/pool';
import type { FromTown, ToTown } from '../workers/townProtocol';
import { DECOR_STRIDE, DecorWhen } from '../build/decorProps';
import { DECOR_BUNTING, DECOR_HALLOWEEN, DECOR_XMAS_LIGHTS } from '../sim/decor';
import type { ViewOccasion } from '../sim/view';
import { FURNITURE } from './materials';
import { propModels } from './propsView';
import { instancedFromData, radiusOf, showInstances } from './meshes';
import type { Stage } from './stage';

export interface DecorShown {
  /** Today's decorations: `slots` two bytes per building (DECOR_* bits, share decorating 0 … 255), and today's occasions. */
  set(slots: Uint8Array, occasions: readonly ViewOccasion[]): void;
}

/** Ask the town workers for the decorations' spots and models, and put them into `root` (none shown until `set`). */
export async function showDecor(stage: Stage, pool: WorkerPool<ToTown, FromTown>, root: Group, priority = 60): Promise<DecorShown> {
  const r = await pool.run({ type: 'decor' }, priority);
  if (r.type !== 'decor') throw new Error(`town worker: decor answered ${r.type}`);
  const group = new Group();
  group.name = 'decor';
  const meshes = await propModels(pool, r.groups, priority + 1);
  const models = r.groups.map((g, i) => {
    const I = g.inst, n = I.length / DECOR_STRIDE;
    const pose = new Float32Array(n * 4), size = new Float32Array(n * 2), tint = new Float32Array(n * 4), gate = new Float32Array(n * 3);
    for (let k = 0, o = 0; k < n; k++, o += DECOR_STRIDE) {
      pose.set(I.subarray(o, o + 4), k * 4);
      size[k * 2] = size[k * 2 + 1] = I[o + 4];
      tint.set(I.subarray(o + 5, o + 9), k * 4);
      gate.set(I.subarray(o + 9, o + 12), k * 3);
    }
    const mesh = instancedFromData(meshes[i].mesh, FURNITURE, 0, n);
    mesh.name = `decor ${g.model}`;
    group.add(mesh);
    return { mesh, src: { iPose: pose, iSize: size, iTint: tint }, gate, n, radius: radiusOf(mesh), shown: '' };
  });
  await stage.prepare(group);
  root.add(group);

  let last = '';
  return {
    set(slots, occasions) {
      let town = 0, sum = 0;
      for (let s = 0; s < slots.length; s += 2) { town |= slots[s]; sum = (sum * 31 + slots[s] * 257 + slots[s + 1]) >>> 0; }
      const market = occasions.some((o) => o.kind === 'christmasMarket'), festival = occasions.some((o) => o.kind === 'festival');
      // (Called with every view: nothing to do unless the choices or the occasions changed.)
      const sig = `${sum}:${+market}${+festival}`;
      if (sig === last) return;
      last = sig;
      const up = (slot: number, when: DecorWhen, rank: number): boolean => {
        const mine = (bit: number) => slot >= 0 && (slots[slot * 2] & bit) !== 0 && rank * 255 < slots[slot * 2 + 1];
        switch (when) {
          case DecorWhen.Halloween: return mine(DECOR_HALLOWEEN);
          case DecorWhen.Lights: return slot >= 0 ? mine(DECOR_XMAS_LIGHTS) : (town & DECOR_XMAS_LIGHTS) !== 0;
          case DecorWhen.Market: return market;
          case DecorWhen.Bunting: return (town & DECOR_BUNTING) !== 0;
          case DecorWhen.Festival: return festival;
        }
        return false;
      };
      for (const p of models) {
        const picked: number[] = [];
        for (let k = 0; k < p.n; k++) if (up(p.gate[k * 3], p.gate[k * 3 + 1], p.gate[k * 3 + 2])) picked.push(k);
        const key = picked.join(',');
        if (key === p.shown) continue;
        p.shown = key;
        showInstances([p.mesh], p.src, picked, p.radius);
      }
    },
  };
}
