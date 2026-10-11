# Evolution Sim: notes for Claude

An artificial-life sandbox: creatures with evolved neural-network brains in a
changing 2D world. Live at https://mg3647.github.io/evolution-sim/ (rebuilt on
every push to `main`). See `README.md` for features, commands and layout.

## The premise (don't break it)

There is no fitness function. Selection comes only from the world: energy,
water, heat and cold, predators, disease. Don't add outside scores, rewards or
novelty search. Anything new should give creatures a reason to evolve a
behaviour, not hand them the behaviour.

## Who you're working for

Matt is not a developer. Write to him in plain words, lead with the answer,
keep it short, and use a table for anything he approves or denies. Say when an
idea is already built or already planned. Ask only when a choice changes what
he will see or can't be undone; otherwise pick the sensible default and say
which.

## Rules of the core

- All randomness goes through `Rng` (`src/sim/rng.ts`): no `Math.random`, no
  clock reads. Same seed and config give the same world.
- Every constant lives in `src/sim/config.ts`; sliders, hints and presets in
  `src/sim/presets.ts`.
- `src/sim` is pure and headless (no DOM). The UI talks to it through the
  worker protocol in `src/worker/protocol.ts`.
- A change to what a save holds bumps `SAVE_VERSION` in
  `src/sim/serialize.ts` and adds a migration so older saves still open, with
  a test in `serialize.test.ts`.
- Adding or removing a sense or action changes `INPUT_LABELS` /
  `OUTPUT_LABELS` in `src/sim/brain.ts`, which changes brain sizes and needs a
  save bump.
- If the run report format changes, bump `reportVersion` and update
  `runs/README.md`.

## Checks before a PR is ready

1. `npm test` and `npm run build` (the build type-checks) pass. CI runs both.
2. A change to the sim itself (not only the screen) gets a long run on at
   least two seeds against current `main`, e.g.
   `SEEDS=genesis,second TICKS=60000 npm run longrun`, with the numbers in the
   PR. The `experimenter` agent does this.
3. A new mechanic, sense or action is reviewed first by the
   `neuroevolution-expert` agent; say in the PR what it changed.
4. A UI change is checked by the `ui-critic` agent with screenshots.
5. Fill in `.github/pull_request_template.md`.

## Working in parallel

Several threads work on this repo at once, each on its own branch and PR.

- Branch from the latest `main`. If `main` moves on, merge `main` into the
  branch (don't rebase or force-push), rerun the tests and push.
- Only one open PR at a time may change the save format or the number of
  senses or actions. If another PR already does, wait for it or stack on it,
  and say so in the PR.
- Files that collide most often: `src/sim/serialize.ts`, `src/sim/brain.ts`,
  `src/sim/config.ts`, `src/sim/presets.ts`, `src/ui/App.svelte`. Keep edits
  there small.
- Merge only when Matt says so and CI is green. Squash-merge, delete the
  branch, and confirm the Pages deploy succeeded.

## Agents

In `.claude/agents/`: `neuroevolution-expert` (plan review against the
literature), `experimenter` (long runs and run reports), `ui-critic`
(screenshot review of the built site), `visionary` (ranked next ideas).
