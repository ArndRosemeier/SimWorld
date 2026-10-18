/**
 * The town's roads as one network of lines: the arterials, every local street and footpath of the
 * cells, and the country roads and farm tracks, each cut where another line's end meets it part
 * way along (a T-junction) and at both ends. Street names per arterial chain, local street and
 * country road. New in SimWorld.
 *
 * The one road network of the town: the place graph (`placeGraphOf`, walking and travel times for
 * the sim) and the traffic network (`RoadNet`, src/traffic/roadNet.ts) are both built from it, so
 * their nodes agree.
 *
 * Pure; a function of the planned town.
 */
import { clamp } from '@futuremagic/core';
import type { RoadNode } from '../sim/places';
import { RoadKind } from '../world/rural';
import { streetName } from './names';
import { RoadClass } from './types';
import type { Town } from './town';

/** Where a line comes from. */
export const enum LineSource { Arterial = 0, Local = 1, Country = 2, Track = 3 }

/** A road polyline and the nodes that cut it (its ends and the T-junctions on it). */
export interface RoadLine {
  /** Centreline (x, z, …). */
  pts: number[];
  /** Arc length at each vertex. */
  cum: Float64Array;
  /** Walking speed factor (1 town street, < 1 country road, track, footpath). */
  walk: number;
  /** Index into `TownRoads.streets`, -1 for unnamed footpaths and farm tracks. */
  street: number;
  /** Cuts by arc length, sorted: `{ s, node }` (node into `TownRoads.nodes`). */
  cuts: { s: number; node: number }[];
  source: LineSource;
  /** Road class (`RoadClass`; country roads count as streets, tracks as lanes). */
  cls: RoadClass;
  /** Carriageway width kerb to kerb (m). */
  width: number;
  /** Sidewalk width each side (m, 0 on country roads). */
  sidewalk: number;
  /** Lanes per direction. */
  lanes: number;
  /** Arterial edge id, country road id, or -1. */
  ref: number;
}

/** The nearest point on a line: line index, arc length, distance, the point. */
export interface LineHit { li: number; s: number; d: number; px: number; pz: number }

export interface TownRoads {
  nodes: RoadNode[];
  lines: RoadLine[];
  streets: { name: string; lines: number[] }[];
  /** Nearest point on any line within `max` m (`skip` a line; `named` only named streets). */
  nearest(x: number, z: number, max: number, skip?: number, named?: boolean): LineHit | null;
  /** A new node at (x, z) (for nodes added after the cuts, such as the place graph's spacing nodes). */
  addNode(x: number, z: number): number;
}

const NH = 8, SG = 32;
const hk = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

export function townRoads(town: Town): TownRoads {
  const { macro, cells, rural } = town;
  const seed = town.settings.seed;

  const nodes: RoadNode[] = [];
  const nodeHash = new Map<number, number[]>();
  const nodeAt = (x: number, z: number, snap = 2.5): number => {
    const i0 = Math.floor(x / NH), j0 = Math.floor(z / NH);
    let best = -1, bd = snap;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (const n of nodeHash.get(hk(i, j)) ?? []) { const d = Math.hypot(nodes[n].x - x, nodes[n].z - z); if (d < bd) { bd = d; best = n; } }
    }
    if (best >= 0) return best;
    nodes.push({ x, z });
    const k = hk(i0, j0);
    let l = nodeHash.get(k);
    if (!l) nodeHash.set(k, (l = []));
    l.push(nodes.length - 1);
    return nodes.length - 1;
  };

  // Streets: names per arterial chain (edges that run on straight through a node share one),
  // per local street and per country road.
  const streets: { name: string; lines: number[] }[] = [];
  const used = new Set<string>();
  const nameStreet = (id: number, cls: number): number => {
    let name = '';
    for (let k = 0; k < 8 && (!name || used.has(name)); k++) name = streetName(seed, id + k * 100003, cls);
    used.add(name);
    streets.push({ name, lines: [] });
    return streets.length - 1;
  };
  const lines: RoadLine[] = [];
  const addLine = (pts: number[], walk: number, street: number, source: LineSource, cls: RoadClass, width: number, sidewalk: number, lanes: number, ref: number) => {
    if (pts.length < 4) return;
    const n = pts.length >> 1, cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    lines.push({ pts, cum, walk, street, cuts: [], source, cls, width, sidewalk, lanes, ref });
    if (street >= 0) streets[street].lines.push(lines.length - 1);
  };
  const chain = arterialChains(macro);
  const chainStreet = new Map<number, number>();
  macro.edges.forEach((e, i) => {
    const c = chain[i];
    if (!chainStreet.has(c)) chainStreet.set(c, nameStreet(c, e.cls));
    addLine(e.pts, 1, chainStreet.get(c)!, LineSource.Arterial, e.cls, e.width, e.sidewalk, e.lanes, i);
  });
  cells.forEach((plan, ci) => plan.streets.forEach((s, si) => {
    if (s.arterial >= 0) return;
    const path = s.cls === RoadClass.Path;
    addLine(s.pts, path ? 0.95 : 1, path ? -1 : nameStreet(1_000_000 + ci * 1000 + si, s.cls), LineSource.Local, s.cls, s.width, s.sidewalk, s.lanes, -1);
  }));
  rural.roads.forEach((r, ri) => {
    if (r.kind === RoadKind.Track) addLine(r.pts, 0.85, -1, LineSource.Track, RoadClass.Lane, r.hw * 2, 0, 1, ri);
    else addLine(r.pts, 0.9, nameStreet(2_000_000 + ri, RoadClass.Street), LineSource.Country, r.kind === RoadKind.Main ? RoadClass.Street : RoadClass.Lane, r.hw * 2, 0, 1, ri);
  });

  // Ends become nodes; an end that meets another line part way along cuts that line there.
  const segHash = new Map<number, number[]>();
  lines.forEach((L, li) => {
    for (let i = 0; i + 3 < L.pts.length; i += 2) {
      const x0 = Math.min(L.pts[i], L.pts[i + 2]) - 4, x1 = Math.max(L.pts[i], L.pts[i + 2]) + 4;
      const z0 = Math.min(L.pts[i + 1], L.pts[i + 3]) - 4, z1 = Math.max(L.pts[i + 1], L.pts[i + 3]) + 4;
      for (let a = Math.floor(x0 / SG); a <= Math.floor(x1 / SG); a++) for (let b = Math.floor(z0 / SG); b <= Math.floor(z1 / SG); b++) {
        const k = hk(a, b);
        let l = segHash.get(k);
        if (!l) segHash.set(k, (l = []));
        l.push(li, i >> 1);
      }
    }
  });
  const nearest = (x: number, z: number, max: number, skip = -1, named = false): LineHit | null => {
    let best = null as LineHit | null;
    for (let r = 0; r <= Math.ceil(max / SG); r++) {
      const a0 = Math.floor(x / SG), b0 = Math.floor(z / SG);
      for (let a = a0 - r; a <= a0 + r; a++) for (let b = b0 - r; b <= b0 + r; b++) {
        if (Math.max(Math.abs(a - a0), Math.abs(b - b0)) !== r) continue;
        const l = segHash.get(hk(a, b));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 2) {
          const li = l[q], si = l[q + 1];
          if (li === skip || (named && lines[li].street < 0)) continue;
          const P = lines[li].pts, i = si * 2;
          const dx = P[i + 2] - P[i], dz = P[i + 3] - P[i + 1], l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? clamp(((x - P[i]) * dx + (z - P[i + 1]) * dz) / l2, 0, 1) : 0;
          const px = P[i] + dx * t, pz = P[i + 1] + dz * t, d = Math.hypot(px - x, pz - z);
          if (d <= max && (!best || d < best.d)) best = { li, s: lines[li].cum[si] + Math.sqrt(l2) * t, d, px, pz };
        }
      }
      if (best && best.d <= r * SG) break;
    }
    return best;
  };
  for (const L of lines) {
    const n = L.pts.length >> 1;
    L.cuts.push({ s: 0, node: nodeAt(L.pts[0], L.pts[1]) }, { s: L.cum[n - 1], node: nodeAt(L.pts[n * 2 - 2], L.pts[n * 2 - 1]) });
  }
  lines.forEach((L, li) => {
    for (const end of [L.cuts[0], L.cuts[1]]) {
      const N = nodes[end.node];
      const hit = nearest(N.x, N.z, 4, li);
      if (!hit) continue;
      const H = lines[hit.li];
      // Already one of its cuts (a shared end)?
      if (H.cuts.some((c) => c.node === end.node || Math.abs(c.s - hit.s) < 1.5)) continue;
      H.cuts.push({ s: hit.s, node: end.node });
    }
  });
  for (const L of lines) L.cuts.sort((a, b) => a.s - b.s);
  return { nodes, lines, streets, nearest, addNode: (x, z) => nodeAt(x, z, 0) };
}

/** The point at arc length s along a line. */
export function alongLine(L: Pick<RoadLine, 'pts' | 'cum'>, s: number): [number, number] {
  const i = Math.min(L.cum.length - 1, Math.max(1, upperBound(L.cum, s)));
  const t = clamp((s - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]), 0, 1);
  return [L.pts[i * 2 - 2] + (L.pts[i * 2] - L.pts[i * 2 - 2]) * t, L.pts[i * 2 - 1] + (L.pts[i * 2 + 1] - L.pts[i * 2 - 1]) * t];
}

/** The part of a line between arc lengths s0 < s1, as a polyline (x, z, …). */
export function slicePolyline(L: Pick<RoadLine, 'pts' | 'cum'>, s0: number, s1: number): number[] {
  const out = [...alongLine(L, s0)];
  for (let i = 0; i < L.cum.length; i++) if (L.cum[i] > s0 + 0.05 && L.cum[i] < s1 - 0.05) out.push(L.pts[i * 2], L.pts[i * 2 + 1]);
  out.push(...alongLine(L, s1));
  return out;
}

/** First index whose value exceeds s (binary search over a sorted array). */
export function upperBound(a: Float64Array, s: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Arterial chains: at every node the two edges that continue most straight through it (within
 * 35°) are one street; returns a chain id per edge.
 */
function arterialChains(macro: Town['macro']): number[] {
  const parent = macro.edges.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const dirAt = (eid: number, node: number): number => {
    const e = macro.edges[eid], P = e.pts, n = P.length;
    // Direction leaving the node along the edge.
    return e.a === node ? Math.atan2(P[3] - P[1], P[2] - P[0]) : Math.atan2(P[n - 3] - P[n - 1], P[n - 4] - P[n - 2]);
  };
  macro.nodes.forEach((N, ni) => {
    const es = N.edges;
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      let d = Math.abs(dirAt(es[i], ni) - dirAt(es[j], ni)) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      // Straight through: the two leave in opposite directions.
      const bend = Math.PI - d;
      if (bend < (35 * Math.PI) / 180 && macro.edges[es[i]].cls === macro.edges[es[j]].cls) pairs.push([bend, es[i], es[j]]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const done = new Set<number>();
    for (const [, a, b] of pairs) {
      if (done.has(a) || done.has(b)) continue;
      done.add(a); done.add(b);
      parent[find(a)] = find(b);
    }
  });
  return macro.edges.map((_, i) => find(i));
}
