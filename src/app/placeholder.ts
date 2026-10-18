/**
 * Placeholder geometry until the town planner is ported: a ground plate and seeded blocks.
 * Pure data (plain arrays), so it goes through meshFromData like everything else.
 */
import { Rng, deriveSeed } from '@futuremagic/core';
import type { IndexedData } from '../render/meshes';

export function placeholderBlocks(seed: number): IndexedData {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: [number, number, number]): void => {
    const faces: [number[], number[][]][] = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
      [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    for (const [n, corners] of faces) {
      const base = pos.length / 3;
      for (const [cx, cy, cz] of corners) {
        pos.push(x + cx * w / 2, y + (cy + 1) * h / 2, z + cz * d / 2);
        nor.push(n[0], n[1], n[2]);
        col.push(c[0], c[1], c[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  box(0, -0.5, 0, 200, 0.5, 200, [0.42, 0.5, 0.36]);
  const rng = new Rng(deriveSeed(seed, 'placeholder'));
  for (let i = 0; i < 40; i++) {
    const g = 0.55 + rng.float() * 0.3;
    box((rng.float() - 0.5) * 160, 0, (rng.float() - 0.5) * 160, 6 + rng.float() * 10, 4 + rng.float() * 14, 6 + rng.float() * 10, [g, g * 0.92, g * 0.85]);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), indices: new Uint32Array(idx) };
}
