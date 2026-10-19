/**
 * Open a "Report this spot" repro link (docs/REPORTS.md) in headless Chromium against the local build, and come back
 * with a screenshot and the game's own report of where it ended up (the same text the player copied).
 *
 *   npm run build
 *   node tools/repro/open.mjs "<repro link or a file holding the report>" [--save <file>] [--out <dir>] [--wait <s>]
 *
 * The link's origin and path are swapped for a local `vite preview` of dist/. `--save` copies the report's save file
 * into dist/ and adds `&save=` (needed when the report says "Exact: no"). Writes <out>/repro.png and <out>/report.txt
 * and prints the report. Swiftshader is slow: give the take-over time (`--wait`, default 25 s after the town is built).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from '../looks/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The repro link in `arg`: the link itself, or the `Repro:` line of a report file. */
export function linkOf(arg) {
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  const m = /Repro:\s*(\S+)/.exec(text) ?? /(https?:\/\/\S+)/.exec(text);
  if (!m) throw new Error('no repro link found (a "Repro: https://…" line)');
  return m[1];
}

/** The same query on the local server (`base`, ending in /), with `save` added when given. */
export function localUrl(link, base, save) {
  const q = new URL(link).searchParams;
  if (save) q.set('save', save);
  return `${base}?${q.toString().replace(/=(?=&|$)/g, '')}`;
}

async function serve() {
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('no dist/: run `npm run build` first');
  const port = 5300 + (process.pid % 500);
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return { url, stop: () => p.kill() }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  p.kill();
  throw new Error('vite preview did not start');
}

async function main() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const link = linkOf(a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--')) ?? '');
  const out = path.resolve(get('--out') ?? 'repro-out'), wait = Number(get('--wait') ?? 25);
  fs.mkdirSync(out, { recursive: true });
  let save;
  if (get('--save')) { fs.copyFileSync(get('--save'), path.join(ROOT, 'dist/repro.save.gz')); save = 'repro.save.gz'; }
  const server = await serve();
  const browser = await launch({ width: 1280, height: 720 });
  try {
    const url = localUrl(link, server.url, save);
    console.log(`opening ${url}`);
    let page = await browser.page(url);
    await page.waitFor("document.documentElement.dataset.town === 'built'", 15 * 60_000, 2000);
    await new Promise((r) => setTimeout(r, wait * 1000));
    if (await page.gpuLost()) {
      // Swiftshader's GPU process gave up (a black screen): once more, with a shorter wait.
      console.log('the WebGL context was lost (black screen); opening the link again with a shorter wait');
      await page.close();
      page = await browser.page(url);
      await page.waitFor("document.documentElement.dataset.town === 'built'", 15 * 60_000, 2000);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      if (await page.gpuLost()) console.log('the WebGL context was lost again: repro.png is black');
    }
    fs.writeFileSync(path.join(out, 'repro.png'), Buffer.from(await page.screenshot(), 'base64'));
    const report = await page.eval("window.debugReport ? window.debugReport() : 'no debugReport() on this build'");
    fs.writeFileSync(path.join(out, 'report.txt'), report);
    console.log(report);
    for (const e of page.errors) console.log(`page error: ${e}`);
    console.log(`\nwrote ${path.join(out, 'repro.png')} and report.txt`);
  } finally {
    await browser.close();
    server.stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
