/**
 * The one text atlas: all lettering and signage pictures in the world, drawn on a canvas at load
 * in the layout of src/build/textAtlasLayout.ts (which the build layer bakes uvs from). The
 * pictures: the street furniture's signage (stop sign, metro disc, bus stop, posters, newspapers,
 * pedestrian signal masks, manhole cover, kiosk band, mail labels, timetable, name plate, street
 * name blade), ported from Scale (src/props/furniture.ts getSignAtlas). The text slots: every run
 * of TEXT_RUNS, fitted into its strip. Main thread (a DOM canvas).
 */
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three/webgpu';
import { Rng } from '@futuremagic/core';
import { ATLAS_H, ATLAS_W, PICTURE_PX, TEXT_H, TEXT_RUNS, TEXT_W, picturePx, textPx, textRects, type TextRun } from '../build/textAtlasLayout';

let atlas: CanvasTexture | null = null;

const FONTS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, serif' };

/** The atlas texture with these runs in its text slots (made once, on first use: later calls get the same texture). */
export function textAtlas(runs: readonly TextRun[] = TEXT_RUNS): CanvasTexture {
  if (atlas) return atlas;
  const C = PICTURE_PX;
  const cv = document.createElement('canvas');
  cv.width = ATLAS_W;
  cv.height = ATLAS_H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const rng = Rng.from('signage');
  const cell = (i: number, draw: (g: CanvasRenderingContext2D) => void) => {
    g.save();
    g.translate(...picturePx(i));
    g.beginPath(); g.rect(0, 0, C, C); g.clip();
    draw(g);
    g.restore();
  };
  const text = (gg: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, font = 'Arial, Helvetica, sans-serif', weight = 'bold', sx = 1) => {
    gg.save();
    gg.translate(x, y);
    gg.scale(sx, 1);
    gg.fillStyle = col;
    gg.font = `${weight} ${size}px ${font}`;
    gg.textAlign = 'center';
    gg.textBaseline = 'middle';
    gg.fillText(s, 0, 0);
    gg.restore();
  };
  const octagon = (gg: CanvasRenderingContext2D, r: number) => {
    gg.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      if (i === 0) gg.moveTo(x, y); else gg.lineTo(x, y);
    }
    gg.closePath();
  };
  // 0 STOP
  cell(0, (gg) => {
    gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, C, C);
    octagon(gg, 128); gg.fillStyle = '#f2f2f2'; gg.fill();
    octagon(gg, 118); gg.fillStyle = '#b5121b'; gg.fill();
    text(gg, 'STOP', 128, 132, 78, '#ffffff', 'Arial, Helvetica, sans-serif', 'bold', 0.92);
  });
  // 1 metro "M" disc
  cell(1, (gg) => {
    gg.fillStyle = '#f4f4f0'; gg.fillRect(0, 0, C, C);
    gg.beginPath(); gg.arc(128, 128, 122, 0, Math.PI * 2); gg.fillStyle = '#f2c200'; gg.fill();
    gg.lineWidth = 6; gg.strokeStyle = '#222'; gg.stroke();
    text(gg, 'M', 128, 136, 190, '#111');
  });
  // 2 bus stop
  cell(2, (gg) => {
    gg.fillStyle = '#f2c94c'; gg.fillRect(0, 0, C, C);
    gg.beginPath(); gg.arc(128, 128, 112, 0, Math.PI * 2); gg.fillStyle = '#1f7a3a'; gg.fill();
    gg.fillStyle = '#ffffff';
    gg.fillRect(68, 64, 120, 84);
    gg.fillStyle = '#1f7a3a';
    gg.fillRect(78, 74, 46, 34); gg.fillRect(132, 74, 46, 34);
    gg.beginPath(); gg.arc(90, 152, 12, 0, Math.PI * 2); gg.arc(166, 152, 12, 0, Math.PI * 2); gg.fillStyle = '#ffffff'; gg.fill();
    text(gg, 'BUS', 128, 196, 48, '#ffffff');
  });
  // 3 & 4 posters
  const poster = (gg: CanvasRenderingContext2D, hue: number, title: string, r: Rng) => {
    const gr = gg.createLinearGradient(0, 0, 0, C);
    gr.addColorStop(0, `hsl(${hue},70%,55%)`);
    gr.addColorStop(1, `hsl(${hue + 40},65%,25%)`);
    gg.fillStyle = gr; gg.fillRect(0, 0, C, C);
    for (let i = 0; i < 6; i++) {
      gg.beginPath();
      gg.arc(r.range(30, 226), r.range(60, 180), r.range(15, 60), 0, Math.PI * 2);
      gg.fillStyle = `hsla(${hue + r.range(-60, 60)},80%,${r.range(50, 80)}%,0.55)`;
      gg.fill();
    }
    text(gg, title, 128, 40, 40, '#ffffff');
    gg.fillStyle = 'rgba(255,255,255,0.85)';
    gg.fillRect(40, 205, 176, 8); gg.fillRect(60, 222, 136, 6);
  };
  cell(3, (gg) => poster(gg, 200, 'MARKET', rng.fork('p1')));
  cell(4, (gg) => poster(gg, 330, 'SUMMER', rng.fork('p2')));
  // 5 newspaper fronts / magazines
  cell(5, (gg) => {
    gg.fillStyle = '#ddd'; gg.fillRect(0, 0, C, C);
    const r = rng.fork('news');
    for (let i = 0; i < 6; i++) {
      const x = (i % 3) * 85 + 3, y = Math.floor(i / 3) * 128 + 3;
      gg.fillStyle = i % 2 ? '#f4f1e8' : `hsl(${r.range(0, 360)},50%,55%)`;
      gg.fillRect(x, y, 80, 122);
      gg.fillStyle = '#111';
      gg.fillRect(x + 6, y + 8, 68, 14);
      for (let k = 0; k < 7; k++) { gg.fillStyle = 'rgba(0,0,0,0.45)'; gg.fillRect(x + 6, y + 34 + k * 11, r.range(40, 68), 4); }
      gg.fillStyle = `hsl(${r.range(0, 360)},40%,45%)`;
      gg.fillRect(x + 40, y + 60, 34, 40);
    }
  });
  // 6 TELEPHONE header
  cell(6, (gg) => {
    gg.fillStyle = '#111'; gg.fillRect(0, 0, C, C);
    text(gg, 'TELEPHONE', 128, 128, 40, '#f5f2e6', 'Georgia, serif', 'bold', 0.95);
  });
  // 7 pedestrian hand (mask, white on black) / 8 walking figure
  cell(7, (gg) => {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, C, C);
    gg.fillStyle = '#fff';
    gg.beginPath(); gg.roundRect(88, 120, 84, 90, 24); gg.fill();
    for (let i = 0; i < 4; i++) { gg.beginPath(); gg.roundRect(90 + i * 21, 52 + Math.abs(i - 1.5) * 10, 16, 90, 8); gg.fill(); }
    gg.beginPath(); gg.roundRect(56, 120, 50, 18, 9); gg.save(); gg.translate(70, 130); gg.rotate(-0.6); gg.translate(-70, -130); gg.fill(); gg.restore();
  });
  cell(8, (gg) => {
    gg.fillStyle = '#000'; gg.fillRect(0, 0, C, C);
    gg.fillStyle = '#fff'; gg.strokeStyle = '#fff'; gg.lineCap = 'round';
    gg.beginPath(); gg.arc(128, 48, 20, 0, Math.PI * 2); gg.fill();
    gg.lineWidth = 26;
    gg.beginPath(); gg.moveTo(124, 82); gg.lineTo(118, 150); gg.stroke();
    gg.lineWidth = 18;
    gg.beginPath(); gg.moveTo(118, 150); gg.lineTo(90, 196); gg.lineTo(78, 228); gg.stroke();
    gg.beginPath(); gg.moveTo(118, 150); gg.lineTo(146, 190); gg.lineTo(170, 222); gg.stroke();
    gg.lineWidth = 14;
    gg.beginPath(); gg.moveTo(124, 90); gg.lineTo(94, 128); gg.stroke();
    gg.beginPath(); gg.moveTo(124, 90); gg.lineTo(152, 120); gg.lineTo(168, 138); gg.stroke();
  });
  // 9 manhole cover: cast iron
  cell(9, (gg) => {
    gg.fillStyle = '#2f2f30'; gg.fillRect(0, 0, C, C);
    gg.beginPath(); gg.arc(128, 128, 126, 0, Math.PI * 2); gg.fillStyle = '#3a3a3b'; gg.fill();
    gg.save(); gg.beginPath(); gg.arc(128, 128, 104, 0, Math.PI * 2); gg.clip();
    gg.fillStyle = '#2a2a2b';
    for (let y = 0; y < C; y += 16) for (let x = 0; x < C; x += 16) {
      if (((x + y) / 16) % 2 === 0) gg.fillRect(x + 2, y + 2, 12, 12);
    }
    gg.restore();
    gg.lineWidth = 10; gg.strokeStyle = '#4a4a4b';
    for (const r of [104, 60]) { gg.beginPath(); gg.arc(128, 128, r, 0, Math.PI * 2); gg.stroke(); }
    gg.beginPath(); gg.arc(128, 128, 54, 0, Math.PI * 2); gg.fillStyle = '#3a3a3b'; gg.fill();
    text(gg, 'SEWER', 128, 130, 30, '#555556');
    for (const a of [0.4, 3.5]) { gg.beginPath(); gg.arc(128 + Math.cos(a) * 82, 128 + Math.sin(a) * 82, 6, 0, Math.PI * 2); gg.fillStyle = '#151515'; gg.fill(); }
  });
  // 10 kiosk sign band
  cell(10, (gg) => {
    gg.fillStyle = '#0f2f22'; gg.fillRect(0, 0, C, C);
    text(gg, 'PRESSE', 128, 120, 60, '#f0e6c8', 'Georgia, serif', 'bold', 1.25);
    gg.fillStyle = '#c9a54a'; gg.fillRect(10, 30, 236, 6); gg.fillRect(10, 214, 236, 6);
  });
  // 11 mailbox label / 12 post plate
  cell(11, (gg) => {
    gg.fillStyle = '#1b3a78'; gg.fillRect(0, 0, C, C);
    gg.strokeStyle = '#ffffff'; gg.lineWidth = 6; gg.strokeRect(24, 40, 208, 176);
    text(gg, 'MAIL', 128, 108, 70, '#ffffff');
    gg.fillStyle = '#ffffff'; gg.fillRect(60, 160, 136, 10); gg.fillRect(80, 182, 96, 8);
  });
  cell(12, (gg) => {
    gg.fillStyle = '#c8c4b8'; gg.fillRect(0, 0, C, C);
    gg.fillStyle = '#181818';
    text(gg, 'POST', 128, 60, 52, '#181818', 'Georgia, serif');
    for (let k = 0; k < 5; k++) gg.fillRect(40, 110 + k * 24, 176, 6);
  });
  // 13 timetable
  cell(13, (gg) => {
    gg.fillStyle = '#f7f7f2'; gg.fillRect(0, 0, C, C);
    gg.fillStyle = '#1f7a3a'; gg.fillRect(0, 0, C, 40);
    text(gg, '24  31  M8', 128, 21, 26, '#ffffff');
    gg.fillStyle = '#333';
    for (let k = 0; k < 14; k++) for (let c = 0; c < 4; c++) gg.fillRect(14 + c * 60, 56 + k * 14, 40, 5);
  });
  // 14 station name plate
  cell(14, (gg) => {
    gg.fillStyle = '#1b2b5a'; gg.fillRect(0, 0, C, C);
    text(gg, 'CENTRAL', 128, 128, 62, '#ffffff', 'Arial, Helvetica, sans-serif', 'bold', 0.9);
  });
  // 15 street name blade
  cell(15, (gg) => {
    gg.fillStyle = '#1a6b3c'; gg.fillRect(0, 0, C, C);
    gg.strokeStyle = '#ffffff'; gg.lineWidth = 6; gg.strokeRect(6, 90, 244, 76);
    text(gg, 'MAIN ST', 128, 128, 54, '#ffffff', 'Arial, Helvetica, sans-serif', 'bold', 0.85);
  });
  textRects(runs); // (checks they fit)
  runs.forEach((r, i) => {
    const [x, y] = textPx(i);
    g.save();
    g.fillStyle = r.background;
    g.fillRect(x, y, TEXT_W, TEXT_H);
    const size = TEXT_H * 0.72;
    g.font = `bold ${size}px ${FONTS[r.font ?? 'sans']}`;
    // Squeezed to fit the strip (never stretched).
    const sx = Math.min(1, (TEXT_W - 16) / Math.max(1, g.measureText(r.text).width));
    g.translate(x + TEXT_W / 2, y + TEXT_H / 2);
    g.scale(sx, 1);
    g.fillStyle = r.color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(r.text, 0, 0);
    g.restore();
  });
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  atlas = t;
  return t;
}
