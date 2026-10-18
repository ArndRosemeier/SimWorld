/**
 * Top-down floor plans of a town's buildings as SVG, to check interior layouts and furnishing
 * without a GPU: rooms tinted by type (homes numbered), walls with their doors, the facade in
 * blue, furniture boxes with a tick on their front and their name, the people's spots as dots
 * (green seats, blue beds, red workplaces). Prints the time per building.
 *
 *   npx tsx tools/interior/plans.ts [seed=1] [size=0] [filter=all|home|<work kind>|#<cell>/<building id>] [floor=0] [count=8] [outDir=reports/interiors]
 *
 * Ported from Scale (tools/interiorPlans.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { planTown } from '../../src/plan/town';
import { planInterior, workOf } from '../../src/interior/building';
import { polyBounds, type Poly } from '../../src/geom/geom2';
import type { FloorPlan, Spot } from '../../src/interior/types';

const ROOM: Record<string, string> = {
  living: '#f3e3c3', bedroom: '#dfe6f5', kitchen: '#e5f2dc', bath: '#d8f0f2', hall: '#eeeeee', corridor: '#e8e8e8', stairs: '#dddddd',
  office: '#f0f0e0', meeting: '#e6e0f0', shop: '#f6e8e8', dining: '#f6eadb', storage: '#e0e0e0', lobby: '#f2f2f2', bakehouse: '#f2e6d0',
  salon: '#f0e0ee', reading: '#e8eedc', cell: '#d6d6dc', workshop: '#e2e2d6', garage: '#dcdcdc', factory: '#d8dce0',
};
const SPOT: Record<Spot['use'], string> = { sit: '#2a2', sleep: '#26c', work: '#d22', serve: '#c60' };

export function planSvg(plan: FloorPlan, outline: Poly, spots: Spot[], title: string): string {
  const [x0, z0, x1, z1] = polyBounds(outline);
  const S = 40, pad = 1, W = (x1 - x0 + 2 * pad) * S, H = (z1 - z0 + 2 * pad) * S;
  const X = (x: number) => ((x - x0 + pad) * S).toFixed(1), Z = (z: number) => ((z - z0 + pad) * S).toFixed(1);
  const pts = (p: number[]) => { const o: string[] = []; for (let i = 0; i < p.length; i += 2) o.push(`${X(p[i])},${Z(p[i + 1])}`); return o.join(' '); };
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 30}" font-family="sans-serif">`, `<rect width="100%" height="100%" fill="white"/>`];
  out.push(`<text x="8" y="${H + 20}" font-size="16">${title}</text>`);
  out.push(`<polygon points="${pts(outline)}" fill="#fafafa" stroke="#3a7bd5" stroke-width="5"/>`);
  for (const r of plan.rooms) {
    out.push(`<polygon points="${pts(r.poly)}" fill="${ROOM[r.type] ?? '#f5f5f5'}" stroke="none"/>`);
    const [a, b, c, d] = polyBounds(r.poly);
    out.push(`<text x="${X((a + c) / 2)}" y="${Z((b + d) / 2)}" font-size="13" fill="#999" text-anchor="middle">${r.type}${r.unit >= 0 ? ` ${r.unit}` : ''}</text>`);
  }
  for (const f of plan.furniture) {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw), w = f.w / 2, d = f.d / 2;
    const P = (lx: number, lz: number) => [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
    const q = [...P(-w, -d), ...P(w, -d), ...P(w, d), ...P(-w, d)];
    const flat = f.kind === 'rug', hung = f.kind === 'painting' || f.kind === 'mirror' || f.kind === 'screen';
    const col = `rgb(${f.color.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
    out.push(`<polygon points="${pts(q)}" fill="${col}" fill-opacity="${flat ? 0.35 : 0.85}" stroke="${hung ? '#c00' : '#222'}" stroke-width="${hung ? 3 : 1}"/>`);
    if (!flat) { const [ax, az] = P(0, d * 0.6), [bx, bz] = P(0, d + 0.15); out.push(`<line x1="${X(ax)}" y1="${Z(az)}" x2="${X(bx)}" y2="${Z(bz)}" stroke="#d00" stroke-width="2"/>`); }
    if (!hung && f.kind !== 'chair' && f.kind !== 'tv' && f.kind !== 'monitor') out.push(`<text x="${X(f.x)}" y="${Z(f.z)}" font-size="10" text-anchor="middle" fill="#000">${f.kind}</text>`);
  }
  for (const w of plan.walls) {
    const dx = w.bx - w.ax, dz = w.bz - w.az;
    let t = 0;
    const segs: [number, number][] = [];
    for (const [d0, d1] of [...w.doors].sort((a, b) => a[0] - b[0])) { if (d0 > t) segs.push([t, d0]); t = Math.max(t, d1); }
    if (t < 1) segs.push([t, 1]);
    for (const [a, b] of segs) out.push(`<line x1="${X(w.ax + dx * a)}" y1="${Z(w.az + dz * a)}" x2="${X(w.ax + dx * b)}" y2="${Z(w.az + dz * b)}" stroke="#333" stroke-width="4"/>`);
  }
  for (const f of plan.flights) out.push(`<line x1="${X(f.x)}" y1="${Z(f.z)}" x2="${X(f.x + f.dx * f.run)}" y2="${Z(f.z + f.dz * f.run)}" stroke="#888" stroke-width="${f.width * S}" stroke-opacity="0.4"/>`);
  for (const s of spots) if (s.floor === plan.floor) out.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="5" fill="${SPOT[s.use]}"/>`);
  out.push('</svg>');
  return out.join('\n');
}

function main(): void {
  const a = process.argv.slice(2);
  const seed = Number(a[0] ?? 1), size = Number(a[1] ?? 0), filter = a[2] ?? 'all', floor = Number(a[3] ?? 0), count = Number(a[4] ?? 8);
  const outDir = a[5] ?? 'reports/interiors';
  mkdirSync(outDir, { recursive: true });
  const town = planTown({ seed, size });
  let n = 0, ms = 0;
  for (const [cell, b] of town.cells.flatMap((c, ci) => c.buildings.map((q) => [ci, q] as const))) {
    if (n >= count) break;
    const w = workOf(b);
    const ok = filter === 'all' || (filter.startsWith('#') ? filter.slice(1) === `${cell}/${b.id}` : filter === 'home' ? !w : w === filter);
    if (!ok || b.floors <= floor) continue;
    const t0 = performance.now();
    const I = planInterior(b);
    ms += performance.now() - t0;
    const plan = I.storeys[floor];
    writeFileSync(`${outDir}/plan-${seed}-${cell}-${b.id}-${floor}.svg`, planSvg(plan, plan.poly, I.spots, `seed ${seed} building ${cell}/${b.id} floor ${floor}: ${b.style} ${b.use}${b.amenity ? ` ${b.amenity}` : ''}${b.attached ? ', attached' : ''}, ${I.units.length} homes`));
    n++;
  }
  console.log(`${n} plans written to ${outDir}; ${(ms / Math.max(1, n)).toFixed(1)} ms per building`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
