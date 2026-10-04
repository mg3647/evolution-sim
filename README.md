# Evolution Sim

A 2D world of creatures whose bodies and brains evolve under natural selection
alone: no fitness score, just a closed energy economy. Runs in the browser.

Status: milestone 4 of 8. Plants regrow on a fertility map. Creatures see with
three vision rays, decide with a small neural net whose wiring is inherited
and mutated, eat, pay energy costs, reproduce and die. Bodies and brains
evolve; foraging emerges. There is no predation yet.

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

## Layout

| Path | Contents |
| --- | --- |
| `src/sim` | The simulation core. Pure and headless: no DOM, no rendering. |
| `src/worker` | Runs the core in a Web Worker and defines the message protocol. |
| `src/render` | PixiJS renderer and camera. |
| `src/ui` | Svelte control panels. |

## Rules of the core

- All randomness goes through `Rng` in `src/sim/rng.ts`. No `Math.random`, no
  clock reads. The same seed and config always produce the same world.
- Every constant lives in `src/sim/config.ts`.
