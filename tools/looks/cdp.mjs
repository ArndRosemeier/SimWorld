/**
 * Just enough of the Chrome DevTools Protocol to drive headless Chromium from Node, with no dependency: start the
 * browser, open a page, evaluate in it, take a screenshot. Node 22's built-in WebSocket. Used by the looks check
 * (tools/looks/check.mjs).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The Chromium to use: $CHROME, the cloud container's Playwright build, or the usual system names. */
export function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const hit = candidates.find((c) => c && fs.existsSync(c));
  if (!hit) throw new Error('no Chromium found: set CHROME to its path');
  return hit;
}

/**
 * Put into every page before its own scripts: frame pacing. Software WebGL needs seconds a frame for a whole town
 * (about 5.5 s at 1280×720, spread over everything on screen), and frames started back to back make swiftshader's
 * GPU process overrun its time limit and die a minute or so in (data-gpu="lost", black shots). So a frame starts only
 * after the GPU has been idle for as long as the last frame took (measured from its start to the next animation
 * frame). On a real GPU that is a frame every other vsync.
 */
const PACE_FRAMES = `(() => {
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const live = new Map();
  let start = -1e9, cost = 0, measuring = false, cur = -1, ids = 0;
  window.requestAnimationFrame = (cb) => {
    const id = ++ids;
    const run = (t) => {
      const now = performance.now();
      if (t !== cur) {
        if (measuring) { cost = now - start; measuring = false; }
        if (now - start < 2 * cost) { live.set(id, raf(run)); return; }
        cur = t; start = now; measuring = true;
      }
      live.delete(id);
      cb(t);
    };
    live.set(id, raf(run));
    return id;
  };
  window.cancelAnimationFrame = (id) => { caf(live.get(id)); live.delete(id); };
})();`;

/** Start headless Chromium (software WebGL 2, as on CI) and connect to it. */
export async function launch({ width = 1280, height = 720 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--no-first-run',
    '--disable-gpu-sandbox', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${dir}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`Chromium did not start: ${err.slice(-500)}`)), 30000);
    proc.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chromium exited (${code}): ${err.slice(-500)}`)));
  });
  const browser = await connect(wsUrl);
  return {
    async page(url) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (method, params = {}) => browser.send(method, params, sessionId);
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const errors = [];
      browser.on(sessionId, (m) => {
        if (process.env.LOOKS_CONSOLE && m.method === 'Runtime.consoleAPICalled') console.log(...m.params.args.map((a) => a.value));
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: PACE_FRAMES });
      await send('Page.navigate', { url });
      return {
        errors,
        /** Evaluate an expression (awaiting a promise) and return its value. */
        async eval(expression) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        },
        /** Wait until `expression` is truthy (polling), or fail after `ms`. */
        async waitFor(expression, ms, every = 500) {
          const end = Date.now() + ms;
          for (;;) {
            const v = await this.eval(expression).catch(() => undefined);
            if (v) return v;
            if (Date.now() > end) throw new Error(`timed out after ${ms / 1000} s waiting for ${expression}`);
            await new Promise((r) => setTimeout(r, every));
          }
        },
        /** Has the page's WebGL context been lost (the game sets data-gpu="lost")? Swiftshader's GPU process could die a
         *  minute or so after the town was built (now paced, PACE_FRAMES); everything after that comes out black. */
        gpuLost() { return this.eval("document.documentElement.dataset.gpu === 'lost'"); },
        /** A PNG screenshot of the viewport, base64. */
        async screenshot() { return (await send('Page.captureScreenshot', { format: 'png' })).data; },
        close: () => browser.send('Target.closeTarget', { targetId }),
      };
    },
    async close() {
      browser.close();
      const gone = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await gone;
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a temp folder left behind */ }
    },
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot reach ${url}`)); });
  let id = 0;
  const waiting = new Map(), listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message} ${m.error.data ?? ''}`)); else resolve(m.result);
    } else if (m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId)(m);
  };
  return {
    send(method, params = {}, sessionId) {
      const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
      return new Promise((resolve, reject) => { waiting.set(msg.id, { resolve, reject }); ws.send(JSON.stringify(msg)); });
    },
    on(sessionId, fn) { listeners.set(sessionId, fn); },
    close() { ws.close(); },
  };
}
