# Working on SimWorld

SimWorld is a living procedural town in the browser (TypeScript, three.js on WebGL 2, Vite). The plan and every decision Arnd made are in [docs/design/simworld-plan.md](docs/design/simworld-plan.md). Read its "Decisions so far" table before starting anything.

1. **Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the seam index) before writing any helper.** Use the one way it names. A new seam gets its row in the same PR. Rows marked *planned* name the seam to build; do not invent a different one. If a second way to do a listed thing seems needed, stop and report it instead of writing it.
2. **Shaders follow [docs/SHADERS.md](docs/SHADERS.md):** materials only from `src/render/materials.ts`, lights only from `src/render/lights.ts`, things enter the scene through `stage.add`, no `onBeforeCompile`, no `renderer.compile*` outside the Stage. 100 ms per build is the hard limit; aim for ~10 ms.
3. **No `Math.random`.** Every random number comes from a seed (`Rng`, `deriveSeed` from `@futuremagic/core`).
4. **Pure layers stay pure.** `src/sim`, `src/plan`, `src/world`, `src/talk`, `src/llm` never import three or the renderer (guarded); the society simulation must run in a worker and in headless tests.
5. **Every LLM call goes through `src/llm`** (model roster, task routing, usage tracking; guarded). The LLM proposes, the game disposes: it never writes NPC state directly.
6. **Every PR description has a `COPIES:` line**: `COPIES: 1 — checked (grepped: ...)` or `COPIES: 3→1 — <seam>`.
7. **`npm test` must be green.** It runs the guards: banned patterns, layer boundaries and the duplication ratchet (Toolbox finders over `src/` and the shared core package). A `NEW` finding means fold the copy into one seam, or add it to `tools/guards/duplication-baseline.json` with a reason. A `STALE` one means delete its baseline line.
8. **Every ~10 PRs, a sweep:** run both finders (`npm run dup`, `npm run repeated`), read for concept duplicates, fold what is worth folding.
9. **Each PR adds a change note** `changes/<slug>.md` (`# Title`, then `- ` bullets; see [changes/README.md](changes/README.md)). Never edit `CHANGELOG.md`; a workflow folds the notes after the merge.
10. **Porting from Scale or Dunfinity:** take the code with its tests, adapt names to SimWorld, and note the source file in the header comment. Leave superhero, combat and dungeon content behind.
11. **Merge your own PRs.** Arnd does not do Git (2026-10-18): the thread that opens a PR squash-merges it to main as soon as CI is green and review findings are handled. When main has moved, bring it in first and let CI run again. With many tracks merging in parallel, after every merge to main each thread checks its open PRs for conflicts and resolves them right away, without being asked (GitHub's conflict notices do not always arrive). Two PRs can also clash without a textual conflict: if main turns red after your merge, fix it before anything else.
12. **The world is invented, only western-adjacent** (D27): people drive on the right and have English names, but nothing identifies a real region. Use no real places, brands or institutions, no strongly British or American words, no real currency, and no real plate, phone, postcode or emergency-number formats. Spelling is colour/centre/metre. School years are grades. Words, money and formats come from `src/setting/`; the rules are in the plan's R7.

Shared packages come from the AssetGenerator submodule (`vendor/assetgenerator/packages`: `@futuremagic/core`, `@futuremagic/humanoid`). Clone with `--recurse-submodules`, or run `git submodule update --init`.

Checks that need a browser: `npm run build`, then `npx vite preview` and a headless Chromium (in the cloud container: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=out.png <url>`). Arnd's PC is the reference machine for shader timings.
