# Keeping CI lean

Arnd (2026-10-18): "Right from the start, the CI process needs to be streamlined and also capped. In older projects, I had CI devouring all the dev time from accumulated tests."

CI is a tool for the developer's loop, so its cost is measured in **minutes of waiting per PR**. The rules below keep that number small and flat as the project grows.

## The budget (enforced)

| Limit | Value | Where |
|---|---|---|
| One top-level test | 1 s | `tools/ci/budget.json` |
| One test file | 3 s | `tools/ci/budget.json` |
| The whole fast suite | 60 s | `tools/ci/budget.json` |
| The CI job (install, typecheck, tests, build) | 8 min hard timeout | `.github/workflows/ci.yml` |

`npm test` runs through `tools/ci/budget-reporter.mjs`, which fails the run when any limit is breached and names the slowest tests. **Raising a limit is Arnd's decision, never a fix.** The fix is to make the test faster or move it to the slow tier.

## Two tiers

- **Fast (every PR, every push to main):** `test/*.test.ts` and the tools' own tests. Unit tests and small, property-style checks: a 200-person town for one game day, not 2,000 people for a year.
- **Slow (by hand only):** `test/slow/*.slow.test.ts`, `npm run test:slow`, Actions → **Slow tests**. Long soaks, many-day rumour runs, balance sweeps, browser and shader checks. Never on pull requests and never on a schedule nobody reads.

## What keeps the fast tier fast

1. **One job, no matrix, no sharding.** Sharding hides growth: three runners at 2 minutes each looks fine until it is ten runners. One job makes the cost visible.
2. **No real waiting.** Time is injected everywhere (the shader cap and monitor take a clock; the society sim takes a tick). A test never sleeps or polls.
3. **Small fixtures.** Tests build the smallest world that shows the property. Big worlds belong to the slow tier.
4. **Deterministic, so no retries.** Everything derives from a seed. A flaky test is fixed or deleted the same day; CI never retries.
5. **No duplicated coverage.** One test per behaviour, at the lowest layer that shows it. A bug fix adds a regression test only where no existing test could have caught it.
6. **Pruning is part of the sweep.** Every ~10 PRs (CLAUDE.md rule 8) the sweep also reads the slowest tests (the reporter prints them) and merges or deletes tests that no longer earn their time.
7. **Cancel stale runs.** A new push to a PR cancels its older run.
8. **Cheap setup.** npm cache, no browser install in the fast tier, the build without extra passes.

## Local loop

`npm test` runs the same suite with the same budget. On a slow machine, `CI_BUDGET_SCALE=2 npm test` doubles the limits locally (CI always runs at 1).

## Deploy

`.github/workflows/pages.yml` publishes main to GitHub Pages after each merge's changelog fold, so the deployed build shows the version that merge became. It is its own workflow: the PR check job never waits on it. Re-run it by hand with Actions → **Pages** → Run workflow.
