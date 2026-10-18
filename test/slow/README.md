# Slow tests

Tests that cannot fit the fast suite's budget (tools/ci/budget.json): long simulation soaks, many-day
rumour runs, browser checks. Name them `*.slow.test.ts`. They never run on pull requests: run them
with `npm run test:slow` locally, or Actions → **Slow tests** → Run workflow. See docs/CI.md.
