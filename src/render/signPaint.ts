/**
 * How the town's signs are lettered (the painters the signs view hands to `lettering().put`): a
 * shop's fascia in its own colours and type, a pub's hanging sign, an office's brass plate, a
 * factory's name, the opening hours on the door, street-name blades, estate agents' boards, public
 * buildings' name boards and the town sign. Each draws into a slot of the text atlas
 * (src/render/textAtlas.ts); what it says comes from the sim (src/render/signsView.ts). Main
 * thread (canvas 2D). New in SimWorld.
 */
import { hashString } from '@futuremagic/core';
import type { Painter } from './textAtlas';

const SANS = 'Arial, Helvetica, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';

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

/** A fascia over an empty unit: the old sign painted out, the agent's board in the window. */
export function vacantFascia(agent: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#9a9890'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x < w; x += 23) g.fillRect(x, 0, 9, h);
    g.fillStyle = '#f7f5ee'; g.fillRect(w * 0.3, 6, w * 0.4, h - 12);
    g.fillStyle = '#b3191c'; g.fillRect(w * 0.3, 6, w * 0.4, h * 0.42);
    fit(g, 'TO LET', w / 2, 6 + h * 0.21, w * 0.36, h * 0.36, SANS, '#ffffff');
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
    fit(g, 'OPENING HOURS', w / 2, 27, w - 20, 26, SANS, '#ffffff');
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

/** A street-name blade: white letters on green with a white rule (the town's style, as the bus stop's). */
export const streetBlade = (name: string): Painter => ruled(name, () => '#1a6b3c', '#ffffff', 3, SANS, '#ffffff', 0.7);

/** An estate agent's board: FOR SALE or TO LET over the agent's name. */
export function estateBoard(what: 'FOR SALE' | 'TO LET', agent: string): Painter {
  return (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = what === 'FOR SALE' ? '#c0161b' : '#1d4f91'; g.fillRect(0, 0, w, h * 0.42);
    fit(g, what, w / 2, h * 0.22, w - 24, h * 0.24, SANS, '#ffffff');
    fit(g, agent, w / 2, h * 0.62, w - 24, h * 0.13, SERIF, '#1b1b1b', 'bold');
    g.fillStyle = '#d7d7d7'; g.fillRect(16, h * 0.78, w - 32, 2);
    fit(g, 'Viewings by appointment', w / 2, h * 0.88, w - 30, h * 0.08, SANS, '#444444', '600');
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
      fit(g, 'Welcome to', w / 2, h * 0.24, w - 80, h * 0.13, SERIF, '#1d3d6b', 'bold', true);
      fit(g, town, w / 2, h * 0.5, w - 60, h * 0.3, SERIF, '#1d3d6b', 'bold');
      fit(g, 'Please drive carefully', w / 2, h * 0.79, w - 80, h * 0.1, SANS, '#2c2c2c', '600');
    } else {
      fit(g, town, w / 2, h * 0.36, w - 60, h * 0.24, SERIF, '#1d3d6b', 'bold');
      fit(g, 'thanks you for your visit', w / 2, h * 0.64, w - 80, h * 0.12, SERIF, '#1d3d6b', 'bold', true);
    }
  };
}

/** A plain board: the slot of a sign that has no words drawn yet (atlas full, or nothing known). */
export const blank: Painter = (g, w, h) => { g.fillStyle = '#5b5f63'; g.fillRect(0, 0, w, h); };
