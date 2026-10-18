import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** The humanoid package's assets (bodies, clips), served and built under /humanoid/ (see src/render/humans). */
const HUMANOID_ASSETS = path.resolve('vendor/assetgenerator/packages/humanoid/assets');

function humanoidAssets(): Plugin {
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return {
    name: 'humanoid-assets',
    configureServer(server) {
      server.middlewares.use('/humanoid/', (req, res, next) => {
        const file = path.join(HUMANOID_ASSETS, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(HUMANOID_ASSETS + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
    },
    generateBundle() {
      for (const f of files(HUMANOID_ASSETS)) {
        this.emitFile({ type: 'asset', fileName: 'humanoid/' + path.relative(HUMANOID_ASSETS, f).split(path.sep).join('/'), source: fs.readFileSync(f) });
      }
    },
  };
}

// `npm run build:publish` builds for the shared host's /simworld/ subpath (SIMWORLD_BASE overrides it);
// the plain build stays root-relative for local previews.
export default defineConfig(({ mode }) => ({
  base: mode === 'publish' ? (process.env.SIMWORLD_BASE ?? '/simworld/') : '/',
  plugins: [humanoidAssets()],
  // One three.js: the vendored packages have their own node_modules (for their tests), and a second
  // copy would split TSL's state ("No stack defined for assign").
  resolve: { dedupe: ['three'] },
  server: { port: 5200, host: true, fs: { allow: ['.', 'vendor/assetgenerator/packages'] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    // three.js in a chunk of its own: it changes only on an upgrade, so a new deploy of the game
    // leaves it in the browser's cache, and the entry stays under the warning limit.
    // Two pages: the game, and the looks check's contact sheet of every material (src/looks.ts, docs/CI.md).
    rolldownOptions: { input: { main: path.resolve('index.html'), looks: path.resolve('looks.html') }, output: { codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] } } },
  },
}));
