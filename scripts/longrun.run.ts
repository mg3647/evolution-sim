/**
 * Long headless runs, for tuning. Prints one summary line per seed with the
 * numbers that show whether a world collapsed, exploded, or stayed varied.
 *
 *   npm run longrun
 *
 * Environment variables:
 *   SEEDS  comma-separated seeds        (default: genesis,second,third)
 *   TICKS  ticks per seed               (default: 200000)
 *   TUNE   JSON of config overrides     (default: {})
 *   TRACE  ticks between progress lines (default: 0, off)
 *   FROM   measure only after this tick (default: 0)
 *
 * To test whether an evolved population relies on something, change a
 * setting partway through and compare with an unchanged run:
 *   CHANGE_AT  tick at which to apply CHANGE
 *   CHANGE     JSON of config changes, e.g. {"socialSenses":false}
 */
import { it } from 'vitest';
import { defaultConfig, type SimConfig } from '../src/sim/config';
import { createWorld, step } from '../src/sim/world';

const seeds = (process.env.SEEDS ?? 'genesis,second,third').split(',');
const ticks = Number(process.env.TICKS ?? 200000);
const overrides = JSON.parse(process.env.TUNE ?? '{}') as Partial<SimConfig>;
const trace = Number(process.env.TRACE ?? 0);
const from = Number(process.env.FROM ?? 0);
const changeAt = Number(process.env.CHANGE_AT ?? 0);
const change = JSON.parse(process.env.CHANGE ?? '{}') as Partial<SimConfig>;
/** Ticks between measurements. */
const SAMPLE = 500;
/** A world counts as having hunters while at least this many creatures mainly eat meat. */
const HUNTER_QUORUM = 10;

interface Summary {
  seed: string;
  population: { min: number; mean: number; max: number };
  /** Parentless creatures added because the population fell below the minimum: a sign of collapse. */
  reseeded: number;
  /** Share of samples at the population cap: a sign of explosion. */
  atCap: number;
  /** Share of samples with a quorum of meat-eaters, and their mean number. */
  hunterTime: number;
  hunters: number;
  /** Share of all deaths that were kills. */
  killShare: number;
  /** Share of all deaths that were from thirst, and from old age. */
  thirstShare: number;
  oldAgeShare: number;
  /** Mean share of creatures calling at any moment. */
  callers: number;
  /** Energy given per thousand ticks, and the share of it that went to relatives. */
  givenPerThousand: number;
  givenToKin: number;
  species: { mean: number; max: number };
  meanSize: number;
  meanDiet: number;
  ticksPerSecond: number;
}

function run(seed: string): Summary {
  const world = createWorld({ ...defaultConfig, ...overrides, seed });
  const { creatures: c } = world;
  let samples = 0;
  let popSum = 0;
  let popMin = Infinity;
  let popMax = 0;
  let capped = 0;
  let hunterSamples = 0;
  let hunterSum = 0;
  let speciesSum = 0;
  let speciesMax = 0;
  let sizeSum = 0;
  let dietSum = 0;
  const started = performance.now();

  let callerSum = 0;
  let socialBefore = { ...world.social };
  let deathsBefore = { ...world.deaths };
  let reseededBefore = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === changeAt) Object.assign(world.config, change);
    step(world);
    if (tick === from) {
      deathsBefore = { ...world.deaths };
      socialBefore = { ...world.social };
      reseededBefore = world.reseeded;
    }
    if (tick % SAMPLE !== 0 || tick <= from) continue;
    samples++;
    popSum += c.count;
    popMin = Math.min(popMin, c.count);
    popMax = Math.max(popMax, c.count);
    if (c.count >= world.config.maxCreatures) capped++;
    let hunters = 0;
    let size = 0;
    let diet = 0;
    for (let i = 0; i < c.count; i++) {
      if (c.diet[i]! > 0.5) hunters++;
      size += c.size[i]!;
      diet += c.diet[i]!;
    }
    hunterSum += hunters;
    if (hunters >= HUNTER_QUORUM) hunterSamples++;
    callerSum += world.social.calling / Math.max(1, c.count);
    speciesSum += world.species.species.length;
    speciesMax = Math.max(speciesMax, world.species.species.length);
    sizeSum += size / Math.max(1, c.count);
    dietSum += diet / Math.max(1, c.count);
    if (trace > 0 && tick % trace === 0) {
      console.log(
        `  ${seed} t=${tick} pop=${c.count} hunters=${hunters} species=${world.species.species.length} killed=${world.deaths.killed}`,
      );
    }
  }

  // Deaths are counted over the measured part of the run only.
  const d = { ...world.deaths };
  for (const cause of Object.keys(d) as (keyof typeof d)[]) d[cause] -= deathsBefore[cause];
  const deaths = d.starved + d.oldAge + d.killed + d.disaster + d.thirst;
  const given = world.social.given - socialBefore.given;
  return {
    seed,
    population: { min: popMin, mean: popSum / samples, max: popMax },
    reseeded: world.reseeded - reseededBefore,
    atCap: capped / samples,
    hunterTime: hunterSamples / samples,
    hunters: hunterSum / samples,
    killShare: deaths > 0 ? d.killed / deaths : 0,
    thirstShare: deaths > 0 ? d.thirst / deaths : 0,
    oldAgeShare: deaths > 0 ? d.oldAge / deaths : 0,
    callers: callerSum / samples,
    givenPerThousand: (given * 1000) / Math.max(1, ticks - from),
    givenToKin: given > 0 ? (world.social.givenToKin - socialBefore.givenToKin) / given : 0,
    species: { mean: speciesSum / samples, max: speciesMax },
    meanSize: sizeSum / samples,
    meanDiet: dietSum / samples,
    ticksPerSecond: (ticks * 1000) / (performance.now() - started),
  };
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

it(`runs ${seeds.length} seeds for ${ticks} ticks`, () => {
  console.log(`overrides: ${JSON.stringify(overrides)} from: ${from} change at ${changeAt}: ${JSON.stringify(change)}`);
  for (const seed of seeds) {
    const s = run(seed);
    console.log(
      [
        `seed=${s.seed}`,
        `pop=${s.population.min}/${Math.round(s.population.mean)}/${s.population.max}`,
        `reseeded=${s.reseeded}`,
        `atCap=${percent(s.atCap)}`,
        `hunterTime=${percent(s.hunterTime)}`,
        `hunters=${s.hunters.toFixed(1)}`,
        `killShare=${percent(s.killShare)}`,
        `thirstShare=${percent(s.thirstShare)}`,
        `oldAgeShare=${percent(s.oldAgeShare)}`,
        `callers=${percent(s.callers)}`,
        `given=${s.givenPerThousand.toFixed(1)}/kt`,
        `toKin=${percent(s.givenToKin)}`,
        `species=${s.species.mean.toFixed(1)}/${s.species.max}`,
        `size=${s.meanSize.toFixed(2)}`,
        `diet=${s.meanDiet.toFixed(2)}`,
        `tps=${Math.round(s.ticksPerSecond)}`,
      ].join(' '),
    );
  }
});
