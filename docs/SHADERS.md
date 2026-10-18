# Shader policy

Shader compiles are the worst kind of stutter: the frame waits for a driver. Scale fought this for a long time, Dunfinity had the rules from its first commit, and SimWorld takes Dunfinity's pipeline with Arnd's rules tightened.

## The rules (Arnd, 2026-10-18)

1. **No shader build may block for more than 100 ms.** That is the hard upper bound. **A normal shader should take about 10 ms**; slower ones are listed as warnings.
2. **After the warm-up, one build at a time, and the next one starts at least 200 ms after the previous one finished**, at most 5 per second, at most one per frame.
3. **Nothing compiles on the render path.** An object enters the scene only after its shaders are ready.
4. **No "compiling" box.** Warm-up is hidden behind something worth watching: the character selector over the live town (docs/design/simworld-plan.md, R2).

Arnd's PC is the reference machine for timings.

## How the code keeps them

| Piece | File | What it does |
|---|---|---|
| Material registry | `src/render/materials.ts` | Every material is a *kind* from a closed list; every mesh of a kind shares one material. Variation goes in vertex attributes or uniforms, never in a new material. |
| Lights | `src/render/lights.ts` | The fixed set of lights, made before the warm-up (the light count is part of every shader's cache key). |
| Stage | `src/render/stage.ts` | `warmUp()` compiles every kind against the real scene; `add(obj)` compiles first, then adds; `warmLater()` compiles under the cap while something already plays. |
| Cap | `src/render/shaders/cap.ts` | Hands out build slots: one in flight, ≥ 200 ms after the previous build's end, ≤ 5 per second, one per frame. Off during warm-up. |
| Renderer hooks | `src/render/shaders/patches.ts` | Async node builds queue one at a time behind the cap; a draw pipeline nobody compiled is created async and the object skipped until ready; compile and link costs are timed. |
| Monitor | `src/render/shaders/monitor.ts` | Records every build. `shaders.report()` in the console lists violations (over 100 ms, gaps under 200 ms) and warnings (over 10 ms); the HUD shows a summary. |
| Guards | `tools/guards/rules.json` | `npm test` fails on `new *Material` outside the registry, `new *Light` outside lights.ts, `onBeforeCompile`, or `renderer.compile*` outside the Stage. |

## What you must do

- **A new look is a new kind** in `materials.ts`, with the attributes its meshes carry. The attribute set and the index are part of the cache key.
- **Lights are fixed before the warm-up.** Never add or reparent a light afterwards; unused pool lights stay at intensity 0.
- **Put things into the scene with `stage.add`**, or `stage.prepare` first when adding to your own group.
- **A typed TSL `Fn` (one with a layout, `Fn(f, { p: 'vec2', return: 'vec4' })`) reads only its parameters.** three builds its code once per backend and reuses it in every later build (another material, another render target), so a uniform, attribute or texture it closes over is declared only the first time and the next build fails (`nodeUniform… undeclared`). Pass them in as parameters (src/render/tsl/ground.ts `parcelAt`), or leave the layout off.
- **Humans** (the `@futuremagic/humanoid` package) make their own node materials: build them before the warm-up and pass them to `stage.warmUp(extra)`, or compile them with `stage.warmLater`.

## Planned

- A headless check (slow tier, docs/CI.md): after warm-up, a fly-through over the town builds zero shaders.
- A per-kind compile benchmark run on Arnd's PC, stored as a baseline file, so a slower kind shows up in review.
