# Changelog

## v0.002 — Merge rule

- Pull requests merge to main by themselves once CI is green, so nobody has to use Git by hand.

## v0.001 — Foundation

- The project skeleton: three.js on WebGL 2, the shared packages from AssetGenerator, the plan in docs/design.
- The shader policy is live from the first commit: every shader compiles during warm-up or one at a time later, at least 200 ms after the previous one finished, and the HUD shows any breach.
- Code guards and the Toolbox duplicate finders run with every test.

