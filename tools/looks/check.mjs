/**
 * The looks check (docs/CI.md, slow tier): what the game draws, checked in headless Chromium on software WebGL 2.
 *
 *  1. The swatches (looks.html, src/looks.ts): every registered material kind in each of its variants, from the
 *     game's own mesh data, under even white light, at noon and at midnight. Fails on any swatch that comes out with
 *     no colour of its own (black), blown out, NaN, magenta or not drawn, and on a kind with no swatch.
 *  2. The town shots: the town from fixed cameras (index.html?still&…), their colour statistics compared with
 *     tools/looks/baseline.json. Fails when a shot's colours moved further than the tolerances below, or show
 *     magenta. A change that is meant to change the look updates the baseline: `npm run looks -- --update`.
 *
 * Usage: `npm run build && npm run looks` (it serves dist/ itself), or `node tools/looks/check.mjs --url <base>` for
 * a running server. `--only swatches|shots`, `--update` (write the shots' baseline), `--out <dir>` (where the
 * contact sheet, the shots and looks-report.json go; default looks-out/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASELINE = path.join(HERE, 'baseline.json');

/** The town shots: a name and the page's query (default seed and size). Fixed date, time and weather. */
export const SHOTS = [
  { name: 'town at noon', query: 'still&mute&date=2026-06-21&time=12:00&wx=clear&a=0.6' },
  { name: 'streets at noon', query: 'still&mute&date=2026-06-21&time=12:00&wx=clear&a=2.2&r=140&h=45' },
  { name: 'town at night', query: 'still&mute&date=2026-06-21&time=23:30&wx=clear&a=0.6' },
  { name: 'town in snow', query: 'still&mute&date=2027-01-14&time=12:00&wx=snow&a=0.6' },
];

/** How far a shot may move from its baseline: mean channel (0…1 sRGB), histogram (L1 of 8 luminance bins), black and white shares. */
export const TOLERANCE = { mean: 0.07, hist: 0.3, black: 0.08, white: 0.08, magenta: 0.005 };

/** Where a shot's statistics moved past the tolerances against its baseline (pure, tested). */
export function shotDrift(now, base, tol = TOLERANCE) {
  const out = [];
  if (now.magenta > tol.magenta) out.push(`magenta ${(now.magenta * 100).toFixed(1)} %`);
  if (!base) return out;
  for (let c = 0; c < 3; c++) {
    const d = now.mean[c] - base.mean[c];
    if (Math.abs(d) > tol.mean) out.push(`${'rgb'[c]} mean ${base.mean[c].toFixed(3)} → ${now.mean[c].toFixed(3)}`);
  }
  const l1 = now.hist.reduce((a, v, i) => a + Math.abs(v - base.hist[i]), 0);
  if (l1 > tol.hist) out.push(`brightness spread moved ${l1.toFixed(2)} (histogram L1)`);
  if (now.black - base.black > tol.black) out.push(`black share ${(base.black * 100).toFixed(1)} → ${(now.black * 100).toFixed(1)} %`);
  if (now.white - base.white > tol.white) out.push(`white share ${(base.white * 100).toFixed(1)} → ${(now.white * 100).toFixed(1)} %`);
  return out;
}

/** Colour statistics of a PNG screenshot, computed in the page (no image library here). */
const SHOT_STATS = (png) => `(async () => {
  const img = new Image();
  img.src = 'data:image/png;base64,${png}';
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
  const mean = [0, 0, 0], hist = new Array(8).fill(0); let black = 0, white = 0, magenta = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    mean[0] += r; mean[1] += g; mean[2] += b;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.min(7, Math.floor(l * 8))]++;
    if (r < 0.02 && g < 0.02 && b < 0.02) black++;
    if (r > 0.98 && g > 0.98 && b > 0.98) white++;
    if (r > 0.8 && b > 0.8 && g < 0.15) magenta++;
  }
  return { mean: mean.map((v) => v / n), hist: hist.map((v) => v / n), black: black / n, white: white / n, magenta: magenta / n };
})()`;

function args() {
  const a = process.argv.slice(2), get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return { url: get('--url'), only: get('--only'), out: path.resolve(get('--out') ?? 'looks-out'), update: a.includes('--update') };
}

/** Serve dist/ with `vite preview` on a free port; resolves to its base URL and a stop function. */
async function serve() {
  if (!fs.existsSync(path.join(ROOT, 'dist/looks.html'))) throw new Error('no dist/looks.html: run `npm run build` first');
  const port = 4300 + Math.floor((process.pid % 600));
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url + 'looks.html')).ok) return { url, stop: () => p.kill() }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  p.kill();
  throw new Error('vite preview did not start');
}

async function main() {
  const o = args();
  fs.mkdirSync(o.out, { recursive: true });
  const server = o.url ? { url: o.url.endsWith('/') ? o.url : o.url + '/', stop() {} } : await serve();
  const browser = await launch({ width: 1280, height: 720 });
  const report = { swatches: null, shots: {} };
  const problems = [];
  try {
    if (o.only !== 'shots') {
      const t0 = Date.now();
      const page = await browser.page(server.url + 'looks.html');
      await page.waitFor('window.looks && window.looks.done', 20 * 60_000, 2000);
      const r = await page.eval('window.looks');
      fs.writeFileSync(path.join(o.out, 'swatches.png'), Buffer.from(await page.screenshot(), 'base64'));
      report.swatches = { ms: r.ms, tiles: r.tiles.length, missing: r.missing, failures: r.failures, error: r.error };
      if (r.error) problems.push(`swatches page failed: ${r.error}`);
      for (const k of r.missing) problems.push(`material kind ${k} has no swatch (src/render/looks.ts)`);
      for (const f of r.failures) problems.push(`swatch ${f.pass} ${f.kind} ${f.label}: ${f.verdict}`);
      for (const e of page.errors) problems.push(`swatches page error: ${e}`);
      console.log(`swatches: ${r.tiles.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.failures.length} failing`);
      await page.close();
    }
    if (o.only !== 'swatches') {
      const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { shots: {} };
      for (const s of SHOTS) {
        const t0 = Date.now();
        // A shot whose GPU gave up (black) is taken again once on a fresh page.
        let page, png;
        for (let attempt = 0; attempt < 2; attempt++) {
          page = await browser.page(`${server.url}?${s.query}`);
          await page.waitFor("document.documentElement.dataset.town === 'built'", 10 * 60_000, 2000);
          // A moment for the last pieces (vehicles, signs) to go in, then nothing but the 3D view.
          await new Promise((r) => setTimeout(r, 8000));
          await page.eval("document.head.append(Object.assign(document.createElement('style'), { textContent: 'body > :not(canvas) { display: none !important }' })); true");
          await new Promise((r) => setTimeout(r, 500));
          png = await page.screenshot();
          if (!(await page.gpuLost())) break;
          console.log(`shot "${s.name}": the WebGL context was lost${attempt ? '' : ', taking it again'}`);
          if (!attempt) await page.close();
        }
        const file = s.name.replace(/\W+/g, '-') + '.png';
        fs.writeFileSync(path.join(o.out, file), Buffer.from(png, 'base64'));
        if (await page.gpuLost()) problems.push(`shot "${s.name}": the WebGL context was lost twice, the shot is black (see ${file})`);
        const stats = await page.eval(SHOT_STATS(png));
        report.shots[s.name] = stats;
        const drift = shotDrift(stats, o.update ? null : base.shots[s.name]);
        for (const d of drift) problems.push(`shot "${s.name}": ${d} (see ${file})`);
        if (!base.shots[s.name] && !o.update) problems.push(`shot "${s.name}" has no baseline: run with --update`);
        for (const e of page.errors) problems.push(`shot "${s.name}" page error: ${e}`);
        console.log(`shot "${s.name}": ${((Date.now() - t0) / 1000).toFixed(0)} s, mean ${stats.mean.map((v) => v.toFixed(3)).join(' ')}${drift.length ? `, ${drift.join('; ')}` : ''}`);
        await page.close();
      }
      if (o.update) {
        fs.writeFileSync(BASELINE, JSON.stringify({ note: 'Colour statistics of the looks check\'s town shots (tools/looks/check.mjs --update).', shots: report.shots }, null, 1) + '\n');
        console.log(`baseline written: ${path.relative(ROOT, BASELINE)}`);
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }
  fs.writeFileSync(path.join(o.out, 'looks-report.json'), JSON.stringify({ problems, ...report }, null, 1));
  if (problems.length) {
    console.log(`LOOKS CHECK FAILED (${problems.length}). Contact sheet and shots in ${path.relative(ROOT, o.out) || '.'}:\n${problems.map((p) => '  ' + p).join('\n')}`);
    process.exitCode = 1;
  } else console.log('looks: all green');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
