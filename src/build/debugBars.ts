/**
 * Line segments as thin square bars (the debug menu's overlays: colliders, door boxes, walk lines), mesh data for
 * the VERTEX_COLOR_SOLID kind, so the overlays need no shader of their own (docs/SHADERS.md). Each bar is drawn from
 * both sides: whichever way round its faces come out, it shows.
 */
import { MeshBuilder, type MeshData } from './meshBuilder';
import { EDGES } from '../physics/solids';

/** `segs`: x0, y0, z0, x1, y1, z1 per segment; `rgb`: one colour (0…1) per segment, three numbers each; `r`: half the bar's width (m). */
export function barsData(segs: ArrayLike<number>, rgb: ArrayLike<number>, r = 0.025): MeshData {
  const mb = new MeshBuilder([{ name: 'color', size: 3, type: 'u8n' }]);
  for (let i = 0; i + 5 < segs.length; i += 6) {
    const ax = segs[i], ay = segs[i + 1], az = segs[i + 2], bx = segs[i + 3], by = segs[i + 4], bz = segs[i + 5];
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) continue;
    dx /= len; dy /= len; dz /= len;
    // u ⟂ d (from up, or from x when d is upright), v = d × u.
    let ux = Math.abs(dy) > 0.9 ? 0 : -dz, uy = Math.abs(dy) > 0.9 ? dz : 0, uz = Math.abs(dy) > 0.9 ? -dy : dx;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const k = (i / 6) * 3;
    mb.set('color', rgb[k] ?? 1, rgb[k + 1] ?? 0, rgb[k + 2] ?? 1);
    for (let s = 0; s < 4; s++) {
      const a0 = (s * Math.PI) / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2, am = a0 + Math.PI / 4;
      const c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r, c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
      const nx = ux * Math.cos(am) + vx * Math.sin(am), ny = uy * Math.cos(am) + vy * Math.sin(am), nz = uz * Math.cos(am) + vz * Math.sin(am);
      const o0x = ux * c0 + vx * s0, o0y = uy * c0 + vy * s0, o0z = uz * c0 + vz * s0;
      const o1x = ux * c1 + vx * s1, o1y = uy * c1 + vy * s1, o1z = uz * c1 + vz * s1;
      const p = mb.v(ax + o0x, ay + o0y, az + o0z, nx, ny, nz), q = mb.v(ax + o1x, ay + o1y, az + o1z, nx, ny, nz);
      const w = mb.v(bx + o1x, by + o1y, bz + o1z, nx, ny, nz), e = mb.v(bx + o0x, by + o0y, bz + o0z, nx, ny, nz);
      mb.quad(p, q, w, e);
      mb.quad(p, e, w, q);
    }
  }
  return mb.build();
}

/** A box (centre, half extents, turned `yaw` about the vertical as three's rotation.y) as its 12 edges, onto `out`. */
export function boxEdges(b: { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number }, out: number[]): void {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const p = (i: number): number[] => {
    const lx = i & 1 ? b.hx : -b.hx, ly = i & 2 ? b.hy : -b.hy, lz = i & 4 ? b.hz : -b.hz;
    return [b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c];
  };
  for (const [a, e] of EDGES) out.push(...p(a), ...p(e));
}
