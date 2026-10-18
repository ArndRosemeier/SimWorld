/**
 * Judging a rendered swatch (the looks check, `npm run looks`, docs/CI.md): plain numbers in, a verdict out, so a
 * fast test can pin the rules. A swatch is one material kind's variant drawn alone into a small linear (half float)
 * render target with a clear background (alpha 0), so the pixels it covers are the ones with alpha.
 *
 * The failures it catches are the ones a broken shader makes, not taste: a surface with no colour of its own (the
 * street furniture's concrete, stone and shrubs once rendered black for hours unnoticed), blown-out white, NaN or
 * infinity, three's magenta, or nothing drawn where the geometry should cover pixels.
 */

export type LookVerdict = 'ok' | 'black' | 'white' | 'nan' | 'magenta' | 'empty';

export interface LookStats {
  /** Pixels the swatch covers (alpha > 0). */
  covered: number;
  /** Share of covered pixels with a NaN or infinite channel. */
  nan: number;
  /** Linear luminance of the covered pixels: 1st, 50th and 99th percentile. */
  p01: number;
  p50: number;
  p99: number;
  /** Mean linear colour of the covered (finite) pixels. */
  mean: [number, number, number];
  /** Share of covered pixels that are three's magenta (red and blue alike, no green). */
  magenta: number;
}

/**
 * Under even white light (no sun: `evenLight`, diffuse only) a surface shows its own colour. Below this 99th-percentile
 * luminance it has none: black. (The street furniture's black concrete still glossed to about 0.01 in the sun; under
 * even light it was exactly 0. The darkest real finishes, black paint and car glass, show about 0.0013.) Mirror
 * metals have no diffuse colour at all: those variants are marked `dark` (src/render/looks.ts `DARK`).
 */
export const BLACK_P99 = 0.0005;
/** Under even white light white paper shows about 0.3 and an interior lamp 1.6: above this 1st percentile it is blown out. */
export const WHITE_P01 = 4;
/** Shares of NaN and of magenta pixels that fail a swatch. */
export const NAN_SHARE = 0.002, MAGENTA_SHARE = 0.3;
/** A swatch that should cover at least this many pixels (`expectPx`) but covers under EMPTY_SHARE of them drew nothing. */
export const EMPTY_MIN_PX = 40, EMPTY_SHARE = 0.2;

/** IEEE half float to number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

/** Linear RGBA pixels (4 floats each) of one swatch into its statistics. */
export function lookStats(px: ArrayLike<number>): LookStats {
  const lums: number[] = [];
  let covered = 0, bad = 0, magenta = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (!(a > 0.004) && Number.isFinite(a)) continue;
    covered++;
    const R = px[i], G = px[i + 1], B = px[i + 2];
    if (!Number.isFinite(R) || !Number.isFinite(G) || !Number.isFinite(B) || !Number.isFinite(a)) { bad++; continue; }
    const hi = Math.max(R, B);
    if (hi > 0.05 && G < 0.02 * hi && Math.abs(R - B) < 0.1 * hi) magenta++;
    r += R; g += G; b += B;
    lums.push(0.2126 * R + 0.7152 * G + 0.0722 * B);
  }
  lums.sort((x, y) => x - y);
  const q = (p: number) => (lums.length ? lums[Math.min(lums.length - 1, Math.floor(p * lums.length))] : 0);
  const n = Math.max(1, lums.length);
  return { covered, nan: covered ? bad / covered : 0, p01: q(0.01), p50: q(0.5), p99: q(0.99), mean: [r / n, g / n, b / n], magenta: covered ? magenta / covered : 0 };
}

/**
 * The verdict on a swatch. `even`: drawn under even white light (`evenLight`), where its own colour is judged: black
 * (unless `dark`: a finish whose look is all reflection, like glass or chrome) and blown-out white. In the sun and at
 * night only NaN, magenta and nothing drawn count. `seeThrough`: rain, smoke and the like, faint by design, judged on
 * NaN and magenta only. `expectPx`: the pixels the swatch's front faces should cover.
 */
export function lookVerdict(s: LookStats, opts: { even: boolean; expectPx: number; dark?: boolean; seeThrough?: boolean }): LookVerdict {
  if (s.nan > NAN_SHARE) return 'nan';
  if (s.magenta > MAGENTA_SHARE) return 'magenta';
  if (opts.seeThrough) return 'ok';
  if (opts.expectPx >= EMPTY_MIN_PX && s.covered < EMPTY_SHARE * opts.expectPx) return 'empty';
  if (!opts.even || s.covered < 4) return 'ok';
  if (!opts.dark && s.p99 < BLACK_P99) return 'black';
  if (s.p01 > WHITE_P01) return 'white';
  return 'ok';
}
