# SimWorld

A living, breathing procedural town in the browser. Every inhabitant, animals included, has a life of their own. What people know spreads from person to person, the way it does in a real town. You pick any inhabitant to be, and you can talk to anyone: with an OpenRouter key, people answer in natural language, remember you, and act on what was said.

Status: foundation. The plan is in [docs/design/simworld-plan.md](docs/design/simworld-plan.md).

## Run

```sh
git clone --recurse-submodules https://github.com/ArndRosemeier/SimWorld
cd SimWorld
npm install
npm run dev        # http://localhost:5200
npm test           # unit tests and the code guards
npm run build      # type-check and production bundle
```

## Built on

- **Scale** (the town planner, streaming, props, interiors, people) and **Dunfinity** (the render foundation and shader policy, the guards).
- **AssetGenerator**'s shared packages (`@futuremagic/core`, `@futuremagic/humanoid`), as a submodule.
- **Toolbox**'s duplicate finders, in `tools/`.
