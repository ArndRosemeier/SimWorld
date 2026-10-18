import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GROUND, SPAN, lit, skyline } from '../src/app/titleScene';

test('title: the town at dusk is the same for a seed, sits on the ground and has a church', () => {
  const a = skyline(7), b = skyline(7), c = skyline(8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.buildings, c.buildings);
  assert.ok(a.buildings.length > 20);
  assert.equal(a.buildings.filter((x) => x.roof === 'spire').length, 1);
  for (const x of a.buildings) {
    assert.ok(x.top < GROUND && x.top > 0.3, `top ${x.top}`);
    assert.ok(x.x >= 0 && x.x < SPAN);
    for (const w of x.windows) assert.ok(w.y > x.top - 0.001 && w.y + w.h < GROUND, 'window inside its walls');
  }
});

test('title: few windows are lit at the start, most once the game is ready', () => {
  const wins = skyline(1).buildings.flatMap((b) => b.windows);
  const share = (p: number) => wins.filter((w) => lit(w, p)).length / wins.length;
  assert.ok(share(0) < 0.2, `start ${share(0)}`);
  assert.ok(share(1) > 0.7, `ready ${share(1)}`);
  assert.ok(share(0.5) > share(0) && share(0.5) < share(1));
});

test('title: the first chunk (src/main.ts) never pulls in three.js or the renderer', () => {
  // Follow the static imports from the entry; `import('…')` (the game, loaded behind the title) is not followed.
  const seen = new Set<string>(), todo = [resolve('src/main.ts')];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)) {
      const spec = m[1] ?? m[2];
      assert.ok(!/^three(\/|$)/.test(spec), `${file} imports ${spec}`);
      assert.ok(!spec.includes('/render/'), `${file} imports ${spec}`);
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(file), spec.split('?')[0]);
      const hit = [base, `${base}.ts`, `${base}/index.ts`].find((f) => existsSync(f) && f.endsWith('.ts'));
      if (hit) todo.push(hit);
    }
  }
  assert.ok(seen.size > 3);
});
