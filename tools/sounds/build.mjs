// Cut the chosen takes into the game's clips (public/sounds/<id>[_n].ogg), from tools/sounds/cuts.json.
// The steps of Scale's tools/sfx/build.py, in Node with ffmpeg doing the decoding and encoding:
//   one-shots: mono, DC removed, leading silence trimmed (5 ms pre-roll), cosine fade-out, peak −1 dBFS;
//   loops: the tail cross-faded (equal power) over the head so the end flows into the start, RMS −24 dBFS.
// 32 kHz mono Ogg Vorbis.
//
//   node tools/sounds/build.mjs RAW_DIR [id …]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SR = 32000;
const OUT = new URL('../../public/sounds/', import.meta.url).pathname;
const CUTS = JSON.parse(fs.readFileSync(new URL('./cuts.json', import.meta.url), 'utf8'));

function decode(file, from, to) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(from), '-to', String(to), '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

function encode(x, name) {
  const tmp = path.join(OUT, `${name}.f32`);
  fs.writeFileSync(tmp, Buffer.from(x.buffer));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', tmp, '-c:a', 'libvorbis', '-q:a', '4', path.join(OUT, `${name}.ogg`)]);
  fs.unlinkSync(tmp);
}

function dc(x) { let m = 0; for (const v of x) m += v; m /= x.length; for (let i = 0; i < x.length; i++) x[i] -= m; return x; }
const peak = (x) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

function oneShot(x) {
  dc(x);
  const p = peak(x), thr = p * 0.06;
  let on = 0;
  while (on < x.length && Math.abs(x[on]) < thr) on++;
  x = x.slice(Math.max(0, on - Math.round(0.005 * SR)));
  const fade = Math.min(x.length >> 2, Math.round(0.25 * SR));
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fade);
  const g = Math.pow(10, -1 / 20) / peak(x);
  return x.map((v) => v * g);
}

function loop(x, xf) {
  dc(x);
  const n = Math.round(xf * SR), N = x.length - n;
  const out = x.slice(0, N);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = x[i] * Math.sin(t * Math.PI / 2) + x[N + i] * Math.cos(t * Math.PI / 2);
  }
  const g = Math.pow(10, -24 / 20) / rms(out);
  const lim = Math.min(g, 0.97 / peak(out));
  return out.map((v) => v * lim);
}

const [raw, ...only] = process.argv.slice(2);
if (!raw) { console.error('usage: build.mjs RAW_DIR [id …]'); process.exit(1); }
for (const [id, cuts] of Object.entries(CUTS)) {
  if (id.startsWith('_') || (only.length && !only.includes(id))) continue;
  cuts.forEach((c, k) => {
    const x = decode(path.join(raw, `${c.take}.wav`), c.from, c.to);
    const y = c.loop ? loop(x, c.xf ?? 1) : oneShot(x);
    const name = cuts.length > 1 ? `${id}_${k + 1}` : id;
    encode(y, name);
    console.log(name, (y.length / SR).toFixed(2), 's');
  });
}
