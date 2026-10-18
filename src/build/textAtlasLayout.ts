/**
 * The layout of the one text atlas (src/render/textAtlas.ts draws it at load): pure, so the
 * build layer bakes atlas uvs into meshes in the workers and the main thread draws the same
 * places. 1024 × 2048 px. The top half: 16 pictures of 256 px in a 4 × 4 grid (the street
 * furniture's signage: stop sign, bus stop, posters, …; `pictureRect`). The bottom half:
 * TEXT_SLOTS strips of 512 × 64 px for lettering runs (`textRects`): shop names and hours,
 * street names, notices. A new piece of lettering appends its run to TEXT_RUNS and bakes
 * `textRects(TEXT_RUNS)[its index]`.
 */

/** Atlas size in pixels. */
export const ATLAS_W = 1024, ATLAS_H = 2048;
/** Picture cells (top half). */
export const PICTURE_PX = 256, PICTURES = 16;
/** Text strips (bottom half): 2 columns of 16 rows. */
export const TEXT_W = 512, TEXT_H = 64, TEXT_SLOTS = (ATLAS_W / TEXT_W) * (ATLAS_H / 2 / TEXT_H);

/** A uv rectangle: u0, v0, u1, v1 (v up: the canvas is drawn flipped, as three uploads it). */
export type AtlasRect = [number, number, number, number];

/** One run of lettering: the text fitted into its strip, on its background colour (CSS colours). */
export interface TextRun {
  text: string;
  color: string;
  background: string;
  font?: 'sans' | 'serif';
}

/** Every lettering run in the world, in slot order (append only: the index is the slot). */
export const TEXT_RUNS: readonly TextRun[] = [];

/** A pixel rectangle (x, y from the top left, w, h) as uvs, inset by `inset` px against bleeding. */
function rect(x: number, y: number, w: number, h: number, inset: number): AtlasRect {
  return [(x + inset) / ATLAS_W, 1 - (y + h - inset) / ATLAS_H, (x + w - inset) / ATLAS_W, 1 - (y + inset) / ATLAS_H];
}

/** The pixel place of picture `cell` (0..15, row by row from the top left). */
export function picturePx(cell: number): [number, number] {
  return [(cell % 4) * PICTURE_PX, Math.floor(cell / 4) * PICTURE_PX];
}

/** The uv rect of picture `cell`. */
export function pictureRect(cell: number): AtlasRect {
  const [x, y] = picturePx(cell);
  return rect(x, y, PICTURE_PX, PICTURE_PX, 4);
}

/** The pixel place of text slot `slot`. */
export function textPx(slot: number): [number, number] {
  return [(slot % 2) * TEXT_W, ATLAS_H / 2 + Math.floor(slot / 2) * TEXT_H];
}

/** The uv rects of these runs, one slot each in order (throws past TEXT_SLOTS). */
export function textRects(runs: readonly TextRun[]): AtlasRect[] {
  if (runs.length > TEXT_SLOTS) throw new Error(`${runs.length} text runs, the atlas has ${TEXT_SLOTS} slots`);
  return runs.map((_, i) => {
    const [x, y] = textPx(i);
    return rect(x, y, TEXT_W, TEXT_H, 2);
  });
}
