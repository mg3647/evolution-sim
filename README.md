# Evolution Sim

A 2D world of creatures whose bodies and brains evolve under natural selection
alone: no fitness score, just a closed energy economy. Runs in the browser.

Status: all eight milestones of the v1 plan are built. Plants regrow on a fertility map. Creatures see with
three vision rays, decide with a small neural net whose wiring is inherited
and mutated, eat, pay energy costs, reproduce and die. Bodies and brains
evolve. Creatures can bite each other, the dead leave meat, and a diet gene
trades plant digestion against meat digestion, so foraging, scavenging and
hunting all emerge. The world has lakes and a river: land beside water is
richer, and creatures must drink and can swim. It has seasons and slowly
drifting fertility. You
can trigger droughts, ice ages and food booms, and use hand tools to place
meteors and plague, draw walls, and make land fertile or barren. Creatures can
leave and smell scent. You can inspect any creature's brain wiring, see the
family tree and species of the living population, change any setting while
the world runs, pick a preset, and save and load a world.

## Run it

Requires Node.js 22 or newer.

```
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm test` | Run the unit tests |
| `npm run check` | Type-check TypeScript and Svelte |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run longrun` | Run long headless worlds and print tuning numbers (see below) |

On Windows PowerShell, use `npm.cmd` in place of `npm` if scripts are blocked.

## Tuning with long runs

`npm run longrun` runs several seeds for many ticks with no drawing and prints
one line per seed: population range, reseeding (a sign of collapse), time
spent at the population cap (a sign of explosion), how often hunters were
present, the share of deaths that were kills, and the number of species.

Set these environment variables to change what it runs:

| Variable | Meaning | Default |
| --- | --- | --- |
| `SEEDS` | Comma-separated seeds | `genesis,second,third` |
| `TICKS` | Ticks per seed | `200000` |
| `TUNE` | JSON of setting overrides, e.g. `{"attackDamage":0.3}` | `{}` |
| `TRACE` | Ticks between progress lines; 0 is off | `0` |

## Publishing

`.github/workflows/deploy.yml` builds the site and publishes it to GitHub
Pages. It runs only when started by hand from the Actions tab, and needs Pages
enabled for the repository with "GitHub Actions" as the source.

## Layout

| Path | Contents |
| --- | --- |
| `src/sim` | The simulation core. Pure and headless: no DOM, no rendering. |
| `src/worker` | Runs the core in a Web Worker and defines the message protocol. |
| `src/render` | PixiJS renderer and camera. |
| `src/ui` | Svelte control panels. |
| `scripts` | Headless tuning runs. |

## Rules of the core

- All randomness goes through `Rng` in `src/sim/rng.ts`. No `Math.random`, no
  clock reads. The same seed and config always produce the same world.
  (Math functions like `exp` and `tanh` can differ in the last bit between
  browser engines, so a seed is only guaranteed to replay the same run in the
  same browser.)
- Every constant lives in `src/sim/config.ts`. The settings panel's sliders,
  hints and presets are in `src/sim/presets.ts`.
