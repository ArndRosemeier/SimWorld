/**
 * How the town's signs are lettered (the painters the signs view hands to `lettering().put`): a
 * shop's fascia in its own colours and type, a pub's hanging sign, an office's brass plate, a
 * factory's name, the opening hours on the door, street-name blades, estate agents' boards, public
 * buildings' name boards and the town sign. Each draws into a slot of the text atlas
 * (src/render/textAtlas.ts); what it says comes from the sim (src/render/signsView.ts). Main
 * thread (canvas 2D). New in SimWorld.
 */
import { hashString } from '@futuremagic/core';
import { boardWord } from '../lang/words';
import type { Notice } from '../sim/media';
import type { Painter } from './textAtlas';

const SANS = 'Arial, Helvetica, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
/** The town's street-name blades: slate ground, cream letters (the atlas's wayfinding blade uses them too). */
export const BLADE_GROUND = '#50667a', BLADE_INK = '#f6eed8';

/** A sign's house style from its name: background, letter colour, typeface, border. */
interface Style { bg: string; fg: string; font: string; weight: string; italic: boolean; rule: string | null }

/** Shop colours: deep paints with gold or cream letters, and light ones with dark letters. */
const PALETTE: readonly [string, string][] = [
  ['#183d2c', '#e3c77a'], ['#13284a', '#f1ead6'], ['#5a1820', '#e8cf8a'], ['#151515', '#f2f2f2'], ['#efe7d3', '#1f2b3a'],
  ['#f6f6f2', '#7a1b1b'], ['#1f4f57', '#f4efe2'], ['#2d2f33', '#e9c46a'], ['#7c2d12', '#fff3dc'], ['#e9d8a6', '#3b2a1a'],
  ['#0f3b63', '#ffffff'], ['#3f5f2a', '#f7f1d0'],
];

function styleOf(name: string, kind: string): Style {
  const h = hashString(`${kind}|${name}`) >>> 0;
  const [bg, fg] = PALETTE[h % PALETTE.length];
  const serif = ((h >>> 5) & 3) !== 0 ? ((h >>> 9) & 1) === 1 : false;
  return { bg, fg, font: serif ? SERIF : SANS, weight: serif ? 'bold' : ((h >>> 11) & 1 ? 'bold' : '600'), italic: serif && ((h >>> 13) & 3) === 0, rule: ((h >>> 15) & 1) ? fg : null };
}

/** Draw `text` centred at (x, y) in at most `maxW` px, at most `size` px tall (squeezed, never stretched). */
function fit(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, color: string, weight = 'bold', italic = false): void {
  g.save();
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  const sx = Math.min(1, maxW / Math.max(1, g.measureText(text).width));
  g.translate(x, y);
  g.scale(sx, 1);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 0);
  g.restore();
}

/** Words of `text` broken into at most `lines` lines of about equal length. */
function lineBreak(text: string, lines: number): string[] {
  const words = text.split(' ');
  if (lines <= 1 || words.length < 2) return [text];
  const out: string[] = [];
  let cur = '';
  const target = text.length / Math.min(lines, words.length);
  for (const w of words) {
    if (cur && (cur.length + w.length / 2 > target) && out.length < lines - 1) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  out.push(cur);
  return out;
}

/** A shop fascia: the name across the board in the shop's own style, its trade small at the end. */
export function fascia(name: string, trade: string): Painter {
  return (g, w, h) => {
    const s = styleOf(name, trade);
    g.fillStyle = s.bg; g.fillRect(0, 0, w, h);
    if (s.rule) { g.strokeStyle = s.rule; g.lineWidth = 2; g.strokeRect(5, 5, w - 10, h - 10); }
    fit(g, name, w / 2, h * 0.53, w - 40, h * 0.62, s.font, s.fg, s.weight, s.italic);
  };
}

/** A fascia over an empty unit: the old sign painted out, the agent's for-rent board on it. */
export function vacantFascia(agent: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#9a9890'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x < w; x += 23) g.fillRect(x, 0, 9, h);
    g.fillStyle = '#f7f5ee'; g.fillRect(w * 0.3, 6, w * 0.4, h - 12);
    g.fillStyle = '#b3191c'; g.fillRect(w * 0.3, 6, w * 0.4, h * 0.42);
    fit(g, boardWord('forRent'), w / 2, 6 + h * 0.21, w * 0.36, h * 0.36, SANS, '#ffffff');
    fit(g, agent, w / 2, h * 0.7, w * 0.37, h * 0.26, SANS, '#1b1b1b', '600');
  };
}

/** A hanging sign: a framed square with the name over two or three lines. */
export function hanging(name: string, trade: string): Painter {
  return (g, w, h) => {
    const s = styleOf(name, trade);
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = s.bg; g.fillRect(10, 10, w - 20, h - 20);
    g.strokeStyle = s.fg; g.lineWidth = 3; g.strokeRect(20, 20, w - 40, h - 40);
    const lines = lineBreak(name, 3), lh = (h - 70) / Math.max(2, lines.length);
    lines.forEach((l, i) => fit(g, l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh, w - 60, Math.min(lh * 0.8, 54), s.font, s.fg, s.weight, s.italic));
  };
}

/** One line of lettering on a ground with a rule round it (`inset` px in). */
function ruled(text: string, ground: (g: CanvasRenderingContext2D, h: number) => string | CanvasGradient, rule: string, inset: number, font: string, color: string, size: number): Painter {
  return (g, w, h) => {
    g.fillStyle = ground(g, h); g.fillRect(0, 0, w, h);
    g.strokeStyle = rule; g.lineWidth = 2; g.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
    fit(g, text, w / 2, h * 0.55, w - 16, h * size, font, color, 'bold');
  };
}

/** Brass, top to bottom. */
const brass = (g: CanvasRenderingContext2D, h: number) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#d9b968'); gr.addColorStop(0.5, '#b8913f'); gr.addColorStop(1, '#8c6b2a');
  return gr;
};

/** An office's brass plate. */
export const plate = (name: string): Painter => ruled(name, brass, '#5c4518', 2, SERIF, '#2b1f08', 0.6);

/** A works' name high on the wall: big letters on a plain panel. */
export function wallSign(name: string): Painter {
  return (g, w, h) => {
    const s = styleOf(name, 'works');
    g.fillStyle = s.bg; g.fillRect(0, 0, w, h);
    fit(g, name.toUpperCase(), w / 2, h * 0.54, w - 24, h * 0.7, SANS, s.fg, 'bold');
  };
}

/** The opening hours on the door: a title and a line per run of days. */
export function hoursCard(name: string, lines: readonly string[]): Painter {
  return (g, w, h) => {
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#20252b'; g.fillRect(0, 0, w, 50);
    fit(g, boardWord('openingHours'), w / 2, 27, w - 20, 26, SANS, '#ffffff');
    fit(g, name, w / 2, 70, w - 24, 20, SERIF, '#20252b', 'bold', true);
    const lh = Math.min(26, (h - 96) / Math.max(1, lines.length));
    lines.forEach((l, i) => {
      const [days, times] = l.split('  ');
      const y = 100 + lh * (i + 0.5);
      g.save();
      g.font = `600 ${Math.round(lh * 0.62)}px ${SANS}`;
      g.fillStyle = '#20252b';
      g.textBaseline = 'middle';
      g.textAlign = 'left'; g.fillText(days, 14, y, 80);
      g.textAlign = 'right'; g.fillText(times ?? '', w - 14, y, w - 110);
      g.restore();
    });
  };
}

/** A street-name blade in the town's own style: cream letters on slate with a cream rule (no real country's colours). */
export const streetBlade = (name: string): Painter => ruled(name, () => BLADE_GROUND, BLADE_INK, 3, SANS, BLADE_INK, 0.7);

/** An estate agent's board: for sale or for rent over the agent's name. */
export function estateBoard(what: 'forSale' | 'forRent', agent: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = what === 'forSale' ? '#c0161b' : '#1d4f91'; g.fillRect(0, 0, w, h * 0.42);
    fit(g, boardWord(what), w / 2, h * 0.22, w - 24, h * 0.24, SANS, '#ffffff');
    fit(g, agent, w / 2, h * 0.62, w - 24, h * 0.13, SERIF, '#1b1b1b', 'bold');
    g.fillStyle = '#d7d7d7'; g.fillRect(16, h * 0.78, w - 32, 2);
    fit(g, boardWord('callToView'), w / 2, h * 0.88, w - 30, h * 0.08, SANS, '#444444', '600');
  };
}

/** A public building's name board: navy, a white rule, the name. */
export function siteBoard(name: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#1b2b4a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8e2cf'; g.lineWidth = 4; g.strokeRect(12, 12, w - 24, h - 24);
    const lines = lineBreak(name, 2);
    lines.forEach((l, i) => fit(g, l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * h * 0.3, w - 60, h * 0.24, SERIF, '#f3efe2', 'bold'));
  };
}

/** The town sign: "Welcome to <town>, please drive carefully", or on its back "<town> thanks you for your visit". */
export function townSign(town: string, back: boolean): Painter {
  return (g, w, h) => {
    g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1d3d6b'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    if (!back) {
      fit(g, boardWord('welcome'), w / 2, h * 0.24, w - 80, h * 0.13, SERIF, '#1d3d6b', 'bold', true);
      fit(g, town, w / 2, h * 0.5, w - 60, h * 0.3, SERIF, '#1d3d6b', 'bold');
      fit(g, boardWord('driveCarefully'), w / 2, h * 0.79, w - 80, h * 0.1, SANS, '#2c2c2c', '600');
    } else {
      fit(g, town, w / 2, h * 0.36, w - 60, h * 0.24, SERIF, '#1d3d6b', 'bold');
      fit(g, boardWord('thanks'), w / 2, h * 0.64, w - 80, h * 0.12, SERIF, '#1d3d6b', 'bold', true);
    }
  };
}

/** A plain board: the slot of a sign that has no words drawn yet (atlas full, or nothing known). */
export const blank: Painter = (g, w, h) => { g.fillStyle = '#5b5f63'; g.fillRect(0, 0, w, h); };

/**
 * A notice board's cork in its wooden frame, "NOTICES" along the top. `aspect`: the board's width
 * over its height, so the letters keep their shape on a board of another shape than the slot.
 */
export function cork(aspect: number): Painter {
  return (g, w, h) => {
    const sy = aspect / (w / h);
    g.fillStyle = '#5a3a1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b98a57'; g.fillRect(12, 12, w - 24, h - 24);
    // Cork speckle, the same on every board (a fixed pattern, no randomness).
    for (let i = 0; i < 900; i++) {
      const x = 12 + ((i * 7919) % 997) / 997 * (w - 24), y = 12 + ((i * 104729) % 991) / 991 * (h - 24);
      g.fillStyle = i % 3 === 0 ? 'rgba(90,55,25,0.35)' : 'rgba(230,200,150,0.3)';
      g.fillRect(x, y, 2, 2);
    }
    g.save();
    g.translate(0, h * 0.075);
    g.scale(1, sy);
    fit(g, boardWord('notices'), w / 2, 0, w * 0.5, (h * 0.11) / sy, SERIF, '#f3e6c8', 'bold');
    g.restore();
  };
}

/** What a notice shows (src/sim/media.ts). */
export type NoticeFace = Pick<Notice, 'kind' | 'title' | 'lines'>;

/** The notice's own colours by kind: page, header band, header letters, body letters. */
const NOTICE_LOOK: Record<NoticeFace['kind'], [string, string, string, string]> = {
  event: ['#fff8e6', '#1f6fb2', '#ffffff', '#1d2733'],
  funeral: ['#ffffff', '#111111', '#ffffff', '#111111'],
  lostPet: ['#ffffff', '#c8161d', '#ffffff', '#1b1b1b'],
  opening: ['#fff3a8', '#e2581c', '#ffffff', '#2a1a05'],
  closing: ['#ffffff', '#333333', '#ffffff', '#222222'],
};

/** A notice or poster: a header band with the title, then its lines; a lost pet's has tear-off tabs, a funeral notice a black border. */
export function notice(n: NoticeFace): Painter {
  return (g, w, h) => {
    const found = n.kind === 'lostPet' && n.title.toUpperCase().startsWith(boardWord('found'));
    const [page, band, head, ink] = NOTICE_LOOK[n.kind];
    g.fillStyle = page; g.fillRect(0, 0, w, h);
    if (n.kind === 'funeral') {
      g.strokeStyle = '#111111'; g.lineWidth = 10; g.strokeRect(9, 9, w - 18, h - 18);
      fit(g, n.title, w / 2, h * 0.16, w - 50, 30, SERIF, ink, 'bold', true);
      g.fillStyle = '#111111'; g.fillRect(w * 0.3, h * 0.25, w * 0.4, 2);
    } else {
      g.fillStyle = found ? '#1f8a3a' : band; g.fillRect(0, 0, w, h * 0.24);
      fit(g, n.kind === 'event' ? n.title : n.title.toUpperCase(), w / 2, h * 0.125, w - 24, h * 0.15, n.kind === 'event' ? SERIF : SANS, head, 'bold');
    }
    const tabs = n.kind === 'lostPet' && !found;
    const top = h * 0.31, bottom = tabs ? h * 0.78 : h * 0.94, lh = (bottom - top) / Math.max(3, n.lines.length);
    n.lines.forEach((l, i) => fit(g, l, w / 2, top + lh * (i + 0.5), w - 26, Math.min(22, lh * 0.7), n.kind === 'funeral' ? SERIF : SANS, ink, i === 0 ? 'bold' : '600'));
    if (tabs) {
      // Tear-off phone tabs along the bottom.
      g.strokeStyle = '#888888'; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(0, h * 0.8); g.lineTo(w, h * 0.8); g.stroke();
      for (let x = w / 7; x < w - 1; x += w / 7) { g.beginPath(); g.moveTo(x, h * 0.8); g.lineTo(x, h); g.stroke(); }
      g.setLineDash([]);
      g.fillStyle = '#555555';
      for (let k = 0; k < 7; k++) g.fillRect(k * (w / 7) + w / 14 - 1, h * 0.84, 2, h * 0.12);
    }
  };
}
