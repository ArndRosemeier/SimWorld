/**
 * The places a piece of furniture gives the people in a building (src/interior/types.ts Spot): where they sleep,
 * sit, work or serve. Pure.
 *
 * New in SimWorld.
 */
import type { Furn, FurnUse, Spot } from './types';

/**
 * Where a piece puts its person: on a seat or a bed; in front of a bench, a machine, an oven or a
 * car lift; behind a counter (its staff side). A salon chair has its client in it and the
 * hairdresser behind; a bar has stools along its front.
 */
export function spotsOfPiece(f: Furn, floor: number, out: Spot[]): void {
  if (!f.use) return;
  const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
  const unit = f.unit ?? -1;
  const seat = (use: FurnUse) => (use === 'sleep' ? f.h : use !== 'sit' ? 0 : f.kind === 'barCounter' ? 0.75 : Math.min(0.48, f.h * 0.5));
  const at = (use: FurnUse, along: number, ahead: number, yaw: number) => out.push({ use, floor, x: f.x + rx * along + fx * ahead, z: f.z + rz * along + fz * ahead, yaw, seat: seat(use), unit });
  const SEATS = new Set(['chair', 'officeChair', 'sofa', 'armchair', 'bunk']);
  if (f.use === 'sleep') { const k = f.kind === 'bedDouble' ? 2 : 1; for (let i = 0; i < k; i++) at('sleep', k === 2 ? (i - 0.5) * f.w / 2 : 0, 0, f.yaw); return; }
  if (f.kind === 'salonChair') { at('sit', 0, 0, f.yaw); at('work', 0, -(f.d / 2 + 0.35), f.yaw); return; }
  if (f.use === 'serve') {
    const k = Math.max(1, Math.floor(f.w / 1.2));
    for (let i = 0; i < k; i++) at('serve', (i - (k - 1) / 2) * (f.w / k), -(f.d / 2 + 0.45), f.yaw);
    if (f.kind === 'barCounter') for (let x = -f.w / 2 + 0.4; x < f.w / 2 - 0.2; x += 0.65) at('sit', x, f.d / 2 + 0.45, f.yaw + Math.PI);
    return;
  }
  if (f.use === 'sit' || SEATS.has(f.kind)) {
    const k = f.kind === 'sofa' ? Math.max(2, Math.round(f.w / 0.75)) : f.kind === 'pew' ? Math.max(2, Math.floor(f.w / 0.6)) : 1;
    for (let i = 0; i < k; i++) at(f.use, (i - (k - 1) / 2) * (f.w / k), 0, f.yaw);
    return;
  }
  // Work at the front of it, facing it.
  at('work', 0, f.d / 2 + 0.4, f.yaw + Math.PI);
}

