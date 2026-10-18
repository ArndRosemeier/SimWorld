/**
 * The town's bridges over rivers (the arterials of `macro.bridges`): the deck's carriageway,
 * raised sidewalks with curbs and (stone bridges) parapets in the ground format, so it shares
 * the ground material; and the structure by style (stone multi-arch with cutwaters, steel arch,
 * girders on piers, through truss, suspension), the deck slab, steel railings and lamp posts in
 * the facade format (facadeSpecs: plain surfaces, no openings).
 *
 * Ported from Scale (src/build/bridges.ts) without element ids and without the
 * fallen spans (BridgeBreaks gaps and their wreckage). New: the deck runs the whole arterial
 * edge from node to node (no cell draws a bridge edge, so its land ends lie on the ground).
 */
import type { Terrain } from '../world/terrain';
import type { ArterialEdge, Bridge } from '../plan/types';
import { CURB_H, deckHeight, type DeckSpan } from '../world/ground';
import { MeshBuilder } from './meshBuilder';
import { groundSpecs, GroundLayer } from './ground';
import { facadeSpecs, paint } from './massing';

export interface BridgeMeshes {
  /** Carriageway, sidewalks, curbs, stone parapets (ground format). */
  deck: MeshBuilder | null;
  /** Deck slab, piers, arches, girders, truss, towers and cables, railings, lamp posts (facade format). */
  structure: MeshBuilder | null;
}

/** A bridge laid out along its edge: a straight line from a, the water span s0..s1, the deck height. */
interface Profile {
  ax: number; az: number; dx: number; dz: number;
  /** Length of the edge (the deck runs 0..L). */
  L: number;
  /** The span over the water (plus 6 m each side). */
  s0: number; s1: number;
  y: (s: number) => number;
}

/** Deck height above the ground at its land ends (just above the cell carriageway it meets). */
const DECK_LIFT = 0.01;

function profileOf(br: Bridge, terrain: Terrain): Profile | null {
  const p = br.pts;
  const ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 1) return null;
  const dx = (bx - ax) / L, dz = (bz - az) / L;
  // Water extent along the edge.
  let w0 = L, w1 = 0;
  for (let s = 0; s <= L; s += 2) {
    if (terrain.isWater(ax + dx * s, az + dz * s, 1)) { w0 = Math.min(w0, s); w1 = Math.max(w1, s); }
  }
  if (w1 <= w0) return null;
  const s0 = Math.max(0, w0 - 6), s1 = Math.min(L, w1 + 6);
  const h0 = terrain.height(ax + dx * s0, az + dz * s0), h1 = terrain.height(ax + dx * s1, az + dz * s1);
  const span = s1 - s0;
  const arch = Math.max(0, Math.min(br.clearance - 2.5, span * 0.04));
  const y = (s: number) => {
    // On the land ends the deck lies on the ground along its centreline.
    if (s < s0 || s > s1) return terrain.height(ax + dx * s, az + dz * s) + DECK_LIFT;
    const t = (s - s0) / span;
    return h0 + (h1 - h0) * t + arch * Math.sin(Math.PI * t) + DECK_LIFT;
  };
  return { ax, az, dx, dz, L, s0, s1, y };
}

/**
 * The water spans of all bridges as plain data (each within half its width plus `margin`): what the street layer
 * stands people on and the physics world makes decks of (src/world/ground.ts `deckHeight`, `deckAlong`).
 */
export function deckSpans(bridges: readonly Bridge[], terrain: Terrain, margin = 1): DeckSpan[] {
  return bridges.flatMap((br) => {
    const p = profileOf(br, terrain);
    if (!p) return [];
    const at = (s: number) => p.y(s), mid = (p.s0 + p.s1) / 2, h0 = at(p.s0), h1 = at(p.s1);
    return [{ ax: p.ax, az: p.az, dx: p.dx, dz: p.dz, s0: p.s0, s1: p.s1, h0, h1, arch: at(mid) - (h0 + h1) / 2, hw: br.width / 2 + margin }];
  });
}

/**
 * The deck heights of all bridges at a point: a function of (x, z) giving the deck surface of the bridge whose
 * water span it lies on (within half its width plus `margin`), or null off every deck. For things placed by
 * position (people on the street layer); traffic follows a deck by arc length (`bridgeDeckSurface`).
 */
export function bridgeDecksAt(bridges: readonly Bridge[], terrain: Terrain, margin = 1): (x: number, z: number) => number | null {
  const spans = deckSpans(bridges, terrain, margin);
  return (x, z) => deckHeight(spans, x, z);
}

/**
 * Height of a bridged arterial's deck at arc length s along its edge, or null when the bridge has
 * no water span (then the road lies on the ground).
 */
export function bridgeDeckSurface(br: Bridge, terrain: Terrain): ((s: number) => number) | null {
  const pr = profileOf(br, terrain);
  if (!pr) return null;
  // The profile runs along the straight line from the edge's first to its last point.
  const P = br.pts, cum = [0];
  for (let i = 2; i < P.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(P[i] - P[i - 2], P[i + 1] - P[i - 1]));
  const k = pr.L / Math.max(1e-6, cum[cum.length - 1]);
  return (s) => pr.y(s * k);
}

/**
 * Pier stations (arc length) of a stone or girder bridge between its span ends; none for the
 * other styles.
 */
export function bridgePiers(style: Bridge['style'], s0: number, s1: number): number[] {
  if (style !== 'stone' && style !== 'girder') return [];
  const span = s1 - s0, n = Math.max(1, Math.round(span / (style === 'stone' ? 28 : 45))), sl = span / n;
  const out: number[] = [];
  for (let k = 1; k < n; k++) out.push(s0 + k * sl);
  return out;
}

/** Every bridge of the town: `edges` are the macro plan's (the carriageway width of each bridge's edge). */
export function buildBridges(bridges: readonly Bridge[], terrain: Terrain, edges: readonly ArterialEdge[]): BridgeMeshes {
  const deck = new MeshBuilder(groundSpecs());
  const mb = new MeshBuilder(facadeSpecs());
  mb.set('aSeed', 0.5);
  for (const br of bridges) {
    const pr = profileOf(br, terrain);
    if (pr) buildBridge(deck, mb, br, edges[br.edge], pr);
  }
  return { deck: deck.empty ? null : deck, structure: mb.empty ? null : mb };
}

function buildBridge(deck: MeshBuilder, mb: MeshBuilder, br: Bridge, e: ArterialEdge, pr: Profile): void {
  const wl = br.waterLevel;
  const half = br.width / 2;
  const carr = e.width / 2;
  const nx = -pr.dz, nz = pr.dx;
  const onDeck = (s: number, o: number, y: number): [number, number, number] => [pr.ax + pr.dx * s + nx * o, y, pr.az + pr.dz * s + nz * o];
  const yaw = -Math.atan2(pr.dz, pr.dx);
  const pieces = (a: number, b: number): [number, number][] => {
    const n = Math.max(1, Math.ceil((b - a) / 4)), d = (b - a) / n;
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) out.push([a + k * d, a + (k + 1) * d]);
    return out;
  };
  const all = pieces(0, pr.L), span = pieces(pr.s0, pr.s1);
  const stone = br.style === 'stone';
  const structLayer = stone ? 4 : br.style === 'girder' ? 8 : 11;
  const structTint: [number, number, number] = stone ? [0.85, 0.8, 0.72] : br.style === 'girder' ? [0.75, 0.75, 0.74] : br.style === 'truss' ? [0.32, 0.42, 0.38] : [0.45, 0.48, 0.5];
  const thick = br.style === 'girder' ? 2.4 : stone ? 1.6 : 1.3;

  // --- Deck surfaces (ground format): carriageway, raised sidewalks, curbs, node to node.
  for (const [sa, sb] of all) {
    const ya = pr.y(sa), yb = pr.y(sb);
    deck.set('aLayer', GroundLayer.Asphalt);
    quadUp(deck, onDeck(sa, -carr, ya), onDeck(sb, -carr, yb), onDeck(sb, carr, yb), onDeck(sa, carr, ya));
    deck.set('aLayer', GroundLayer.Paving);
    quadUp(deck, onDeck(sa, carr, ya + CURB_H), onDeck(sb, carr, yb + CURB_H), onDeck(sb, half, yb + CURB_H), onDeck(sa, half, ya + CURB_H));
    quadUp(deck, onDeck(sa, -half, ya + CURB_H), onDeck(sb, -half, yb + CURB_H), onDeck(sb, -carr, yb + CURB_H), onDeck(sa, -carr, ya + CURB_H));
    deck.set('aLayer', GroundLayer.Curb);
    curbSide(deck, onDeck(sa, carr, ya), onDeck(sb, carr, yb), CURB_H, -nx, -nz);
    curbSide(deck, onDeck(sb, -carr, yb), onDeck(sa, -carr, ya), CURB_H, nx, nz);
  }
  // --- Deck slab over the water (facade format): underside and fascia.
  paint(mb, structLayer, structTint);
  for (const [sa, sb] of span) {
    const ya = pr.y(sa), yb = pr.y(sb);
    quadDown(mb, onDeck(sa, -half, ya - thick), onDeck(sb, -half, yb - thick), onDeck(sb, half, yb - thick), onDeck(sa, half, ya - thick));
    curbSide(mb, onDeck(sb, half, yb - thick), onDeck(sa, half, ya - thick), thick + CURB_H, nx, nz);
    curbSide(mb, onDeck(sa, -half, ya - thick), onDeck(sb, -half, yb - thick), thick + CURB_H, -nx, -nz);
  }
  // --- Parapets (stone, in the ground format) or railings (steel, facade format) over the span.
  for (const sgn of [-1, 1]) {
    for (const [sa, sb] of span) {
      const ds = sb - sa;
      const ya = pr.y(sa) + CURB_H, yb = pr.y(sb) + CURB_H;
      const o = sgn * (half - 0.15);
      if (stone) {
        deck.set('aLayer', GroundLayer.Curb);
        const mid = onDeck((sa + sb) / 2, o, (ya + yb) / 2 + 0.5);
        deck.box(mid[0], mid[1], mid[2], ds / 2, 0.5, 0.18, yaw);
        // coping
        const top = onDeck((sa + sb) / 2, o, (ya + yb) / 2 + 1.06);
        deck.box(top[0], top[1], top[2], ds / 2 + 0.02, 0.06, 0.25, yaw);
      } else {
        paint(mb, 11, [0.25, 0.27, 0.28]);
        const rail = onDeck((sa + sb) / 2, o, (ya + yb) / 2 + 1.05);
        mb.box(rail[0], rail[1], rail[2], ds / 2, 0.04, 0.05, yaw);
        const rail2 = onDeck((sa + sb) / 2, o, (ya + yb) / 2 + 0.5);
        mb.box(rail2[0], rail2[1], rail2[2], ds / 2, 0.03, 0.03, yaw);
        const post = onDeck(sa, o, ya + 0.55);
        mb.box(post[0], post[1], post[2], 0.04, 0.55, 0.04);
      }
    }
  }
  // --- Lamp posts every ~25 m (unlit: the lamp pool is the renderer's).
  paint(mb, 11, [0.18, 0.2, 0.2]);
  for (let s = pr.s0 + 8; s < pr.s1 - 4; s += 25) {
    for (const sgn of [-1, 1]) {
      const y = pr.y(s) + CURB_H;
      const p = onDeck(s, sgn * (half - 0.4), y);
      mb.box(p[0], y + 2.5, p[2], 0.07, 2.5, 0.07);
      mb.box(p[0], y + 5.05, p[2], 0.2, 0.12, 0.2);
    }
  }
  // --- Structure.
  const S = pr.s1 - pr.s0;
  paint(mb, structLayer, structTint);
  if (stone || br.style === 'girder') {
    // Piers in the water + arches (stone) or straight girders on piers.
    const piers = bridgePiers(br.style, pr.s0, pr.s1);
    const nSpan = piers.length + 1;
    const sl = S / nSpan;
    for (const s of piers) {
      const y = pr.y(s) - thick;
      const bottom = wl - 4;
      const p = onDeck(s, 0, (y + bottom) / 2);
      const pw = stone ? 2.2 : 1.6;
      mb.box(p[0], p[1], p[2], pw, (y - bottom) / 2, half - (stone ? 0 : 1.5), yaw);
      if (stone) {
        // Cutwaters (pointed ends) up to just above the water.
        for (const sgn of [-1, 1]) {
          const c = onDeck(s, sgn * (half + 1.2), (wl + 1.2 + bottom) / 2);
          mb.box(c[0], c[1], c[2], pw * 0.72, (wl + 1.2 - bottom) / 2, 1.3, yaw + Math.PI / 4);
        }
      }
    }
    if (stone) {
      // Arch vaults: spandrel side walls with a semicircular (segmental) opening.
      for (let k = 0; k < nSpan; k++) {
        const sa = pr.s0 + k * sl, sb = sa + sl;
        const rise = Math.min(sl * 0.45, Math.max(2, pr.y((sa + sb) / 2) - thick - wl - 0.8));
        const springY = pr.y((sa + sb) / 2) - thick - rise;
        const archSeg = 14;
        for (const sgn of [-1, 1]) {
          const o = sgn * half;
          for (let i = 0; i < archSeg; i++) {
            const t0 = i / archSeg, t1 = (i + 1) / archSeg;
            const s0 = sa + 1.1 + (sl - 2.2) * t0, s1 = sa + 1.1 + (sl - 2.2) * t1;
            const d0 = pr.y(s0) - thick, d1 = pr.y(s1) - thick;
            // (The crown never rises through the deck: a spandrel turned inside out would face in.)
            const a0 = Math.min(d0, springY + rise * Math.sin(Math.PI * t0)), a1 = Math.min(d1, springY + rise * Math.sin(Math.PI * t1));
            // spandrel face from arch curve up to the deck underside
            const A = onDeck(s0, o, a0), B = onDeck(s1, o, a1), C = onDeck(s1, o, d1), D = onDeck(s0, o, d0);
            if (sgn > 0) quadSide(mb, A, B, C, D, nx, nz);
            else quadSide(mb, B, A, D, C, -nx, -nz);
            // intrados (vault underside)
            const E = onDeck(s0, -half, a0), F = onDeck(s1, -half, a1), G = onDeck(s1, half, a1), H = onDeck(s0, half, a0);
            if (sgn > 0) quadDown(mb, E, F, G, H);
          }
        }
      }
    }
  } else if (br.style === 'arch') {
    // Two steel arch ribs under the deck springing from the banks, with vertical struts.
    const rise = Math.min(S * 0.18, Math.max(4, pr.y((pr.s0 + pr.s1) / 2) - wl - 1.5));
    const yMid = pr.y((pr.s0 + pr.s1) / 2) - thick;
    const springY = yMid - rise;
    const n = 24;
    for (const sgn of [-1, 1]) {
      const o = sgn * (half - 1.5);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const s0 = pr.s0 + S * t0, s1 = pr.s0 + S * t1;
        const y0 = springY + rise * Math.sin(Math.PI * t0), y1 = springY + rise * Math.sin(Math.PI * t1);
        const a = onDeck(s0, o, y0), b = onDeck(s1, o, y1);
        mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.45, 0.6);
        if (i % 2 === 0 && i > 0) {
          const d = pr.y(s0) - thick;
          const c = onDeck(s0, o, (y0 + d) / 2);
          if (d - y0 > 0.3) mb.box(c[0], c[1], c[2], 0.2, (d - y0) / 2, 0.2, yaw);
        }
      }
    }
  } else if (br.style === 'truss') {
    // Through truss: top chords, verticals and diagonals on both sides of the deck.
    const panels = Math.max(4, Math.round(S / 9));
    const pl = S / panels;
    const th = 7;
    for (const sgn of [-1, 1]) {
      const o = sgn * (half + 0.2);
      for (let k = 0; k <= panels; k++) {
        const s = pr.s0 + k * pl;
        const y = pr.y(s);
        const a = onDeck(s, o, y), b = onDeck(s, o, y + th);
        mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.18, 0.18);
        if (k < panels) {
          const s2 = s + pl, y2 = pr.y(s2);
          const c = onDeck(s2, o, y2 + th);
          mb.beam(b[0], b[1], b[2], c[0], c[1], c[2], 0.25, 0.25);
          const da = k < panels / 2 ? onDeck(s, o, y + th) : onDeck(s, o, y);
          const db = k < panels / 2 ? onDeck(s2, o, y2) : onDeck(s2, o, y2 + th);
          mb.beam(da[0], da[1], da[2], db[0], db[1], db[2], 0.14, 0.14);
        }
      }
    }
    // Portal bracing across the top.
    for (let k = 0; k <= panels; k += 2) {
      const s = pr.s0 + k * pl, y = pr.y(s) + th;
      const a = onDeck(s, -half - 0.2, y), b = onDeck(s, half + 0.2, y);
      mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.15, 0.15);
    }
  } else {
    // Suspension: two towers, main cables, hangers.
    const tH = Math.min(80, 25 + S * 0.12);
    const sT0 = pr.s0 + S * 0.18, sT1 = pr.s1 - S * 0.18;
    paint(mb, 8, [0.8, 0.8, 0.78]);
    for (const sT of [sT0, sT1]) {
      for (const sgn of [-1, 1]) {
        const y0 = wl - 4, y1 = pr.y(sT) + tH;
        const p = onDeck(sT, sgn * (half + 0.6), (y0 + y1) / 2);
        mb.box(p[0], p[1], p[2], 1.4, (y1 - y0) / 2, 1.4, yaw);
      }
      for (const hy of [0.45, 0.95]) {
        const y = pr.y(sT) + tH * hy;
        const a = onDeck(sT, -half - 0.6, y), b = onDeck(sT, half + 0.6, y);
        mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 1.0, 1.2);
      }
    }
    paint(mb, 11, [0.55, 0.3, 0.25]);
    const cableY = (s: number) => {
      const mid = (sT0 + sT1) / 2, halfL = (sT1 - sT0) / 2;
      const top = pr.y(sT0) + tH, low = pr.y(mid) + 3;
      const t = (s - mid) / halfL;
      if (Math.abs(t) <= 1) return low + (top - low) * t * t;
      // side spans down to the anchorages
      const tt = s < sT0 ? (sT0 - s) / (sT0 - pr.s0) : (s - sT1) / (pr.s1 - sT1);
      return top - (top - pr.y(s) - 1) * Math.min(1, tt);
    };
    const n = 40;
    for (const sgn of [-1, 1]) {
      const o = sgn * (half + 0.6);
      for (let i = 0; i < n; i++) {
        const s0 = pr.s0 + (S * i) / n, s1 = pr.s0 + (S * (i + 1)) / n;
        const a = onDeck(s0, o, cableY(s0)), b = onDeck(s1, o, cableY(s1));
        mb.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0.35, 0.35);
        const d = pr.y(s0);
        if (cableY(s0) - d > 1.5) {
          const c = onDeck(s0, o, (cableY(s0) + d) / 2);
          mb.box(c[0], c[1], c[2], 0.04, (cableY(s0) - d) / 2, 0.04);
        }
      }
    }
  }
  // Abutments at both ends (stone/concrete blocks into the bank).
  paint(mb, stone ? 4 : 8, stone ? [0.82, 0.78, 0.7] : [0.75, 0.75, 0.74]);
  for (const s of [pr.s0 + 2, pr.s1 - 2]) {
    const y = pr.y(s) - thick, bottom = wl - 3;
    const p = onDeck(s, 0, (y + bottom) / 2);
    mb.box(p[0], p[1], p[2], 3, (y - bottom) / 2, half + 0.5, yaw);
  }
}

function quadUp(mb: MeshBuilder, a: number[], b: number[], c: number[], d: number[]): void {
  emitQuad(mb, a, b, c, d, true);
}
function quadDown(mb: MeshBuilder, a: number[], b: number[], c: number[], d: number[]): void {
  emitQuad(mb, a, b, c, d, false);
}
/** A near-horizontal quad facing up or down, uv = world x/z; winding from the actual geometric normal. */
function emitQuad(mb: MeshBuilder, a: number[], b: number[], c: number[], d: number[], up: boolean): void {
  const ny = up ? 1 : -1;
  const i0 = mb.v(a[0], a[1], a[2], 0, ny, 0, a[0], a[2]);
  mb.v(b[0], b[1], b[2], 0, ny, 0, b[0], b[2]);
  mb.v(c[0], c[1], c[2], 0, ny, 0, c[0], c[2]);
  mb.v(d[0], d[1], d[2], 0, ny, 0, d[0], d[2]);
  const ex = b[0] - a[0], ez = b[2] - a[2], fx = d[0] - a[0], fz = d[2] - a[2];
  const gy = ez * fx - ex * fz;
  if ((gy > 0) === up) mb.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  else mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
}

/** Vertical strip from segment a→b (bottom) up by h, facing (fx, fz). (Scale's `side`.) */
function curbSide(mb: MeshBuilder, a: number[], b: number[], h: number, fx: number, fz: number): void {
  quadSide(mb, a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], fx, fz);
}

/** A vertical quad a, b (bottom), c, d (top) facing (fx, fz). */
function quadSide(mb: MeshBuilder, a: number[], b: number[], c: number[], d: number[], fx: number, fz: number): void {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const i0 = mb.v(a[0], a[1], a[2], fx, 0, fz, 0, a[1]);
  mb.v(b[0], b[1], b[2], fx, 0, fz, L, b[1]);
  mb.v(c[0], c[1], c[2], fx, 0, fz, L, c[1]);
  mb.v(d[0], d[1], d[2], fx, 0, fz, 0, d[1]);
  const ex = b[0] - a[0], ez = b[2] - a[2];
  if (ez * fx - ex * fz > 0) mb.quad(i0, i0 + 3, i0 + 2, i0 + 1);
  else mb.quad(i0, i0 + 1, i0 + 2, i0 + 3);
}
