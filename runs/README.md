# Run reports

One JSON file per report, made by the **Report** button in the app (top bar,
next to Save and Load). Reports are data for later analysis; nothing in the app
reads them back. Adding a file here does not rebuild the site.

## File name

`<date>_<time>_<seed>_tick<N>.json`, for example
`2026-10-11_15-00-00_genesis_tick60000.json`.

## What is inside (reportVersion 4)

| Part | What it holds |
| --- | --- |
| `question`, `notes` | What the person was testing and noticed, in their words. |
| `appVersion`, `saveVersion`, `reportVersion` | Which code made the run, so results are only compared across the same behaviour. |
| `run` | Seed, tick, population, the full `config`, `changedSettings` (only what differs from the defaults), and `configKey`: the same for every run with the same settings and a different seed, so repeats group together. |
| `clean` | True when nothing was done by hand and nothing was reseeded: a fair sample of its settings. |
| `interventions` | Everything done by hand: events, tools, setting changes, loading a save. A loaded save loses what was done before it, so a `loadedSave` entry means the history is incomplete. |
| `headline` | A few numbers to scan: peak and minimum population, species counts, first time meat-eaters passed 10%, how fast traits were still moving in the second half (`*TrendPer10k`, near 0 means settled), and `wiringActivityRatioEnd` (above 1: selection kept brain links; near or below 1: drift). |
| `series` | Every charted statistic over the whole run, as columns (`names[i]` matches `data[i]`), thinned to at most 200 points. `tick` is the first column. |
| `species` | Each species' first and last tick seen, peak size and final size. |
| `events` | The most recent entries of the event log (the log keeps 30). |
| `final` | Where the population ended: trait spreads (mean, 10th, 50th, 90th percentile), generations, creatures per biome against land share, diet histogram, and cumulative totals (births, deaths by cause, mating, blocks, fires). Version 4 adds the `investment` and `readiness` genes to the traits, and to the totals `birthsTooSmall` (tries to breed whose gift could not build a body), `childStartEnergy` (mean energy a child started with) and `juvenileDeaths` (deaths before breeding age). |
| `wiring` | Added in version 2. Brain habits: which senses are linked to which actions (directly or through hidden neurons). `common` is the most widespread habits now, with `share` and mean `effect` (above 0, more of the sense gives more of the action). `spread` and `faded` are the habits whose share changed most since the app started sampling (`startShare`); a loaded save starts sampling again. `breeding` compares young per 1,000 ticks lived among adults: `traits` the upper half against the lower half, `habits` those with a habit against those without, keeping only those that stand out once the number of comparisons is allowed for (`standsOut`, Benjamini-Hochberg at a 5% false discovery rate; `habitsTested` is how many habits were compared). Version 2 kept every `z` of at least 2 either way, which lets dozens through by chance alone. These are associations among the living, not proof of cause. |

## Comparing runs

Group by `run.configKey`, keep `clean: true`, compare `headline` and `series`
across seeds. Runs with different `appVersion` may not be comparable if the
simulation changed between them.

## Version changes

- **3** (2026-10-12): `breeding` entries gain `standsOut`, `breeding.habitsTested` is added, and `habits` keeps only those that stand out after a Benjamini-Hochberg correction. The neutral shadow behind the wiring numbers now copies only creatures old enough to breed, and wiring brought in by reseeded founders no longer counts as new, so `wiringSurvival` and `wiringShadowSurvival` are not comparable with version 2 reports.
- **4** (2026-10-12): `final.traits` gains the `investment` and `readiness` genes, and `final.totals` gains `birthsTooSmall`, `childStartEnergy` and `juvenileDeaths`. These genes now evolve, so runs are not comparable with version 3 reports on breeding.
