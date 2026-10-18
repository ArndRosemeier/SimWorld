import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, listFiles, codeOnly, checkBanned, checkLayers, checkDuplication, duplicationFindings, readBaseline } from './guards.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-fx-'));
  for (const [f, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), src);
  }
  return root;
}

// ---- the guards themselves -------------------------------------------------------------------

test('codeOnly ignores comments and strings', () => {
  const c = codeOnly("// Math.random()\nconst s = 'Math.random()'; /* Math.random() */ x();");
  assert.ok(!c.includes('Math.random'));
  assert.ok(c.includes('x();'));
});

test('banned: a pattern outside its owner is reported with file and line', () => {
  const root = fixture({ 'src/a.ts': 'const a = 1;\nconst r = Math.random();\n', 'src/persist/s.ts': 'localStorage.x = 1;' });
  const p = checkBanned(root, listFiles(root, 'src'), [
    { id: 'Math.random', pattern: '\\bMath\\.random\\s*\\(', only: [], why: 'seeded' },
    { id: 'localStorage', pattern: '\\blocalStorage\\b', only: ['src/persist/'], why: 'persist' },
  ]);
  assert.deepEqual(p.length, 1);
  assert.match(p[0], /^src\/a\.ts:2 {2}Math\.random/);
});

test('shader rules: materials, onBeforeCompile and compile calls outside their owners are reported', () => {
  const root = fixture({
    'src/lab/a.ts': 'const m = new MeshBasicNodeMaterial();\nm.onBeforeCompile = f;\nrenderer.compileAsync(o, c, s);\n',
    'src/render/materials.ts': 'const m = new MeshStandardNodeMaterial();',
    'src/render/stage.ts': 'await this.renderer.compileAsync(g, c, s);',
  });
  const p = checkBanned(root, listFiles(root, 'src'));
  assert.deepEqual(p.map((x) => x.split('  ')[0]), ['src/lab/a.ts:1', 'src/lab/a.ts:2', 'src/lab/a.ts:3']);
});

test('layers: a denied import (relative or package) is reported, an allowed one is not', () => {
  const root = fixture({
    'src/gen/a.ts': "import * as THREE from 'three';\nimport { b } from '../render/b';\nimport { c } from './c';\n",
    'src/gen/c.ts': 'export const c = 1;',
    'src/render/b.ts': "import { c } from '../gen/c';\nexport const b = c;",
  });
  const p = checkLayers(root, listFiles(root, 'src'), [{ from: 'src/gen', deny: ['three', 'src/render'], why: 'pure' }]);
  assert.equal(p.length, 2);
  assert.ok(p.some((x) => x.includes('imports three')));
  assert.ok(p.some((x) => x.includes('imports src/render/b')));
});

test('duplication ratchet: new, stale and unexplained entries go red', () => {
  assert.deepEqual(checkDuplication(['a'], [{ key: 'a', reason: 'ok' }]), []);
  assert.match(checkDuplication(['a', 'b'], [{ key: 'a', reason: 'ok' }])[0], /^NEW b/);
  assert.match(checkDuplication([], [{ key: 'a', reason: 'ok' }])[0], /^STALE a/);
  assert.match(checkDuplication(['a'], [{ key: 'a', reason: '' }])[0], /^UNEXPLAINED a/);
});

test('duplication finder sees a body copied under another name across roots', () => {
  const body = (name) => `export function ${name}(pts: number[], k: number): number {\n  let best = Infinity, at = -1;\n  for (let i = 0; i < pts.length; i += 2) {\n    const dx = pts[i] - k, dz = pts[i + 1] + k;\n    const d = dx * dx + dz * dz;\n    if (d < best) { best = d; at = i; }\n  }\n  return at < 0 ? -1 : at / 2 + best * 0;\n}\n`;
  const root = fixture({ 'src/a.ts': body('nearestIndex'), 'pkg/src/b.ts': body('closestPoint') });
  const f = duplicationFindings(root, { game: 'src', pkg: 'pkg/src' });
  assert.ok(f.some((k) => k.startsWith('clone:') && k.includes('game/a.ts#nearestIndex') && k.includes('pkg/b.ts#closestPoint')), f.join('\n'));
});

// ---- this repository -------------------------------------------------------------------------

const files = listFiles(REPO, 'src');

test('repo: no banned pattern outside its owner', () => {
  assert.deepEqual(checkBanned(REPO, files), []);
});

test('repo: layer boundaries hold', () => {
  assert.deepEqual(checkLayers(REPO, files), []);
});

// The ratchet, one test per finder (each within the per-test budget): every finding is in the
// baseline with a reason, every baseline line of that finder is still found.
const ofKind = (prefixes) => readBaseline().filter((b) => prefixes.some((p) => b.key.startsWith(p)));

test('repo: duplication matches the baseline exactly (ratchet: clones)', () => {
  const problems = checkDuplication(duplicationFindings(undefined, undefined, ['clones']), ofKind(['clone:']));
  assert.equal(problems.length, 0, '\n' + problems.join('\n'));
});

test('repo: duplication matches the baseline exactly (ratchet: idioms)', () => {
  const problems = checkDuplication(duplicationFindings(undefined, undefined, ['idioms']), ofKind(['idiom:']));
  assert.equal(problems.length, 0, '\n' + problems.join('\n'));
});

test('repo: duplication matches the baseline exactly (ratchet: same names)', () => {
  const problems = checkDuplication(duplicationFindings(undefined, undefined, ['names']), ofKind(['same name:']));
  assert.equal(problems.length, 0, '\n' + problems.join('\n'));
});

test('repo: every baseline line belongs to a finder', () => {
  assert.deepEqual(readBaseline().filter((b) => !/^(clone|idiom|same name):/.test(b.key)).map((b) => b.key), []);
});
