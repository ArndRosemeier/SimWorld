/**
 * The layout of the one text atlas (src/render/textAtlas.ts draws it): pure, so the build layer
 * bakes picture uvs into furniture meshes in the workers and the main thread draws the same
 * places. 2048 × 4096 px.
 *
 * The pictures: 16 cells of 256 px in a 4 × 4 grid at the top left (the street furniture's fixed
 * signage: stop sign, bus stop, posters, …; `pictureRect`), drawn once at load.
 *
 * The lettering: everything else is slots handed out at run time by a `SlotPacker` (shop names,
 * opening hours, street names, the town sign, notices, timetables), redrawn when what they say
 * changes. Their uvs are not baked into meshes: a sign carries its slot's rect per instance
 * (`iSign` of the FURNITURE kind), so slots can be reused when a sign changes or the camera moves
 * on (src/render/signsView.ts).
 */

/** Atlas size in pixels. */
export const ATLAS_W = 2048, ATLAS_H = 4096;
/** Picture cells (top left 1024 × 1024). */
export const PICTURE_PX = 256, PICTURES = 16;

/** A uv rectangle: u0, v0, u1, v1 (v up: the canvas is drawn flipped, as three uploads it). */
export type AtlasRect = [number, number, number, number];

/**
 * Lettering slot sizes in pixels: `wide` a shop fascia or a name board (8:1), `strip` a street-name
 * blade, a door plate or a brass plate (8:1, half the size), `card` a square panel (a hanging
 * sign, an estate board, a notice, opening hours in full), `board` a 2:1 panel (the town sign, a
 * public building's name board, a timetable, a notice board's cork), `sheet` a portrait page (a
 * notice or a poster, about A4).
 */
export const SLOT_SIZES = { wide: [512, 64], strip: [256, 32], card: [256, 256], board: [512, 256], sheet: [256, 352] } as const;
export type SlotSize = keyof typeof SLOT_SIZES;

/** A pixel rectangle (x, y from the top left, w, h) as uvs, inset by `inset` px against bleeding. */
export function pxRect(x: number, y: number, w: number, h: number, inset: number): AtlasRect {
  return [(x + inset) / ATLAS_W, 1 - (y + h - inset) / ATLAS_H, (x + w - inset) / ATLAS_W, 1 - (y + inset) / ATLAS_H];
}

/** The pixel place of picture `cell` (0..15, row by row from the top left). */
export function picturePx(cell: number): [number, number] {
  return [(cell % 4) * PICTURE_PX, Math.floor(cell / 4) * PICTURE_PX];
}

/** The uv rect of picture `cell`. */
export function pictureRect(cell: number): AtlasRect {
  const [x, y] = picturePx(cell);
  return pxRect(x, y, PICTURE_PX, PICTURE_PX, 4);
}

/** A lettering slot: its pixel place and size. */
export interface Slot { x: number; y: number; w: number; h: number; size: SlotSize }

/** The uv rect of a slot (inset 2 px). */
export function slotRect(s: Slot): AtlasRect {
  return pxRect(s.x, s.y, s.w, s.h, 2);
}

/** The free areas for lettering: right of the pictures, then everything below them. */
const BANDS: readonly { x0: number; x1: number; y0: number; y1: number }[] = [
  { x0: 1024, x1: ATLAS_W, y0: 0, y1: 1024 },
  { x0: 0, x1: ATLAS_W, y0: 1024, y1: ATLAS_H },
];

/**
 * Hands out lettering slots: shelves of one slot size each, opened top to bottom in the free bands
 * as needed and filled left to right; a released slot goes back to its size's free list and is
 * the next one of that size given out. Deterministic. `take` returns null when the atlas is full
 * (the caller frees a slot it values less, or shows the sign blank).
 */
export class SlotPacker {
  private readonly free: Record<SlotSize, Slot[]> = { wide: [], strip: [], card: [], board: [], sheet: [] };
  private readonly shelves: { size: SlotSize; band: number; y: number; next: number }[] = [];
  /** How far down each band's shelves reach. */
  private readonly used = BANDS.map((b) => b.y0);

  take(size: SlotSize): Slot | null {
    const back = this.free[size].pop();
    if (back) return back;
    const [w, h] = SLOT_SIZES[size];
    for (const s of this.shelves) {
      if (s.size !== size || s.next + w > BANDS[s.band].x1) continue;
      const slot = { x: s.next, y: s.y, w, h, size };
      s.next += w;
      return slot;
    }
    for (let b = 0; b < BANDS.length; b++) {
      const band = BANDS[b];
      if (this.used[b] + h > band.y1 || band.x0 + w > band.x1) continue;
      const shelf = { size, band: b, y: this.used[b], next: band.x0 + w };
      this.used[b] += h;
      this.shelves.push(shelf);
      return { x: band.x0, y: shelf.y, w, h, size };
    }
    return null;
  }

  give(slot: Slot): void {
    this.free[slot.size].push(slot);
  }
}
