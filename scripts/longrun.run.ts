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
import { BIOME_COUNT, BIOME_LABELS } from '../src/sim/biomes';
import { defaultConfig, type SimConfig } from '../src/sim/config';
import { Held } from '../src/sim/creatures';
import { daylightAt } from '../src/sim/environment';
import { maxEnergyFor } from '../src/sim/genome';
import { cellIndexAt, groundHue, visibility } from '../src/sim/plants';
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
/** A biome counts as holding creatures while at least this many stand in it. */
const BIOME_QUORUM = 5;

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
  /** Share of all deaths that were from thirst, from running out of energy while too hot or cold, and from old age. */
  thirstShare: number;
  temperatureShare: number;
  oldAgeShare: number;
  /** Mean share of creatures calling at any moment. */
  callers: number;
  /** Mean thrust creatures chose by day and by night: 0 still, 1 flat out. */
  dayActivity: number;
  nightActivity: number;
  /** Energy given per thousand ticks, and the share of it that went to relatives. */
  givenPerThousand: number;
  givenToKin: number;
  species: { mean: number; max: number };
  meanSize: number;
  meanDiet: number;
  /**
   * How well creatures match the ground they stand on: 0 if none match, 1 if
   * all match exactly. Random colours score about 0.2.
   */
  hidden: number;
  /** Share of all deaths that were from plague, meteors and fire. */
  disasterShare: number;
  /** Wildfires started, and cells burned as a multiple of the map's cells, per 10,000 ticks. */
  firesPerTenThousand: number;
  burnedPerTenThousand: number;
  /**
   * Mean share of creatures holding a stone, a branch, and food; and how far,
   * on average, a load of food was carried before being set down.
   */
  holdingStone: number;
  holdingBranch: number;
  holdingFood: number;
  haulDistance: number;
  /**
   * Breeding: births per creature per 1,000 ticks, the mean age at death,
   * how full of energy a newborn is, the mean age of a parent at a birth,
   * and how full of plants the world is.
   */
  birthRate: number;
  lifespan: number;
  newbornEnergy: number;
  parentAge: number;
  plantFill: number;
  /** Mean fur and defense genes overall. */
  meanFur: number;
  meanDefense: number;
  /**
   * Per biome: its share of the land, the share of the population standing
   * in it, the share of samples in which it held at least a few creatures,
   * and those creatures' mean fur, size, speed and diet.
   */
  biomes: { land: number; share: number; occupied: number; fur: number; size: number; speed: number; diet: number }[];
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
  let hiddenSum = 0;
  let furSum = 0;
  let defenseSum = 0;
  let birthsBefore = 0;
  let creatureTicks = 0;
  let newborns = 0;
  let newbornFill = 0;
  const heldSum = [0, 0, 0, 0, 0];
  let carryBefore = { ...world.carry };
  const zero = () => new Array<number>(BIOME_COUNT).fill(0);
  const biomeCount = zero();
  const biomeOccupied = zero();
  const biomeLand = zero();
  const biomeFur = zero();
  const biomeSize = zero();
  const biomeSpeed = zero();
  const biomeDiet = zero();
  const started = performance.now();

  let callerSum = 0;
  let dayActivity = 0;
  let daySamples = 0;
  let nightActivity = 0;
  let nightSamples = 0;
  let socialBefore = { ...world.social };
  let deathsBefore = { ...world.deaths };
  let reseededBefore = 0;
  let firesBefore = { ...world.fires };
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === changeAt) Object.assign(world.config, change);
    step(world);
    if (tick === from) {
      deathsBefore = { ...world.deaths };
      socialBefore = { ...world.social };
      reseededBefore = world.reseeded;
      firesBefore = { ...world.fires };
      birthsBefore = world.births;
      carryBefore = { ...world.carry };
    }
    if (tick > from) {
      creatureTicks += c.count;
      // A newborn has not yet acted, so its age is still zero.
      for (let i = c.count - 1; i >= 0 && c.age[i] === 0; i--) {
        if (c.parentId[i] === 0) continue;
        newborns++;
        newbornFill += c.energy[i]! / maxEnergyFor(c.size[i]!, world.config);
      }
    }
    // Activity is sampled often and at odd intervals, so it does not fall in step with the day.
    if (tick > from && tick % 37 === 0) {
      if (daylightAt(tick, world.config) >= 0.5) {
        dayActivity += world.activity;
        daySamples++;
      } else {
        nightActivity += world.activity;
        nightSamples++;
      }
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
    let hidden = 0;
    let fur = 0;
    let defense = 0;
    const here = zero();
    for (let cell = 0; cell < world.plants.biome.length; cell++) {
      if (world.plants.water[cell] === 0) biomeLand[world.plants.biome[cell]!]!++;
    }
    for (let i = 0; i < c.count; i++) {
      const cell = cellIndexAt(world.plants, c.x[i]!, c.y[i]!);
      const ground = groundHue(world.plants, cell, world.config);
      const biome = world.plants.biome[cell]!;
      here[biome]!++;
      biomeFur[biome]! += c.fur[i]!;
      biomeSize[biome]! += c.size[i]!;
      biomeSpeed[biome]! += c.speed[i]!;
      biomeDiet[biome]! += c.diet[i]!;
      fur += c.fur[i]!;
      defense += c.defense[i]!;
      heldSum[c.held[i]!]! += 1 / Math.max(1, c.count);
      hidden += 1 - visibility(c.hue[i]!, ground, 1);
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
    hiddenSum += hidden / Math.max(1, c.count);
    furSum += fur / Math.max(1, c.count);
    defenseSum += defense / Math.max(1, c.count);
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      biomeCount[biome]! += here[biome]!;
      if (here[biome]! >= BIOME_QUORUM) biomeOccupied[biome]!++;
    }
    if (trace > 0 && tick % trace === 0) {
      console.log(
        `  ${seed} t=${tick} pop=${c.count} hunters=${hunters} species=${world.species.species.length} killed=${world.deaths.killed}`,
      );
    }
  }

  // Deaths are counted over the measured part of the run only.
  const d = { ...world.deaths };
  for (const cause of Object.keys(d) as (keyof typeof d)[]) d[cause] -= deathsBefore[cause];
  const deaths = d.starved + d.oldAge + d.killed + d.disaster + d.thirst + d.temperature;
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
    temperatureShare: deaths > 0 ? d.temperature / deaths : 0,
    oldAgeShare: deaths > 0 ? d.oldAge / deaths : 0,
    disasterShare: deaths > 0 ? d.disaster / deaths : 0,
    firesPerTenThousand: ((world.fires.started - firesBefore.started) * 10000) / Math.max(1, ticks - from),
    burnedPerTenThousand:
      ((world.fires.cellsBurned - firesBefore.cellsBurned) * 10000) /
      Math.max(1, ticks - from) /
      world.plants.biome.length,
    callers: callerSum / samples,
    dayActivity: dayActivity / Math.max(1, daySamples),
    nightActivity: nightActivity / Math.max(1, nightSamples),
    givenPerThousand: (given * 1000) / Math.max(1, ticks - from),
    givenToKin: given > 0 ? (world.social.givenToKin - socialBefore.givenToKin) / given : 0,
    species: { mean: speciesSum / samples, max: speciesMax },
    meanSize: sizeSum / samples,
    meanDiet: dietSum / samples,
    hidden: hiddenSum / samples,
    meanFur: furSum / samples,
    meanDefense: defenseSum / samples,
    birthRate: ((world.births - birthsBefore) * 1000) / Math.max(1, creatureTicks),
    lifespan: mean(world.history.lifespan, world.history.tick, world.history.count, from),
    parentAge: mean(world.history.generationLength, world.history.tick, world.history.count, from),
    plantFill: mean(world.history.plantFill, world.history.tick, world.history.count, from),
    newbornEnergy: newbornFill / Math.max(1, newborns),
    holdingStone: heldSum[Held.Stone]! / samples,
    holdingBranch: heldSum[Held.Branch]! / samples,
    holdingFood: (heldSum[Held.Plants]! + heldSum[Held.Meat]!) / samples,
    haulDistance:
      (world.carry.haul - carryBefore.haul) /
      Math.max(
        1e-9,
        world.carry.plantsDropped + world.carry.meatDropped - carryBefore.plantsDropped - carryBefore.meatDropped,
      ),
    biomes: biomeCount.map((count, biome) => ({
      land: biomeLand[biome]! / Math.max(1, biomeLand.reduce((a, b) => a + b, 0)),
      share: count / Math.max(1, biomeCount.reduce((a, b) => a + b, 0)),
      occupied: biomeOccupied[biome]! / samples,
      fur: biomeFur[biome]! / Math.max(1, count),
      size: biomeSize[biome]! / Math.max(1, count),
      speed: biomeSpeed[biome]! / Math.max(1, count),
      diet: biomeDiet[biome]! / Math.max(1, count),
    })),
    ticksPerSecond: (ticks * 1000) / (performance.now() - started),
  };
}

/** Mean of a history series over the samples taken after `from`. */
function mean(series: Float32Array, ticks: Float64Array, count: number, from: number): number {
  let total = 0;
  let used = 0;
  for (let k = 0; k < count; k++) {
    if (ticks[k]! <= from) continue;
    total += series[k]!;
    used++;
  }
  return used > 0 ? total / used : 0;
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
        `temperatureShare=${percent(s.temperatureShare)}`,
        `oldAgeShare=${percent(s.oldAgeShare)}`,
        `disasterShare=${percent(s.disasterShare)}`,
        `fires=${s.firesPerTenThousand.toFixed(1)}/10kt burned=${(s.burnedPerTenThousand * 100).toFixed(2)}%/10kt`,
        `callers=${percent(s.callers)}`,
        `activity day/night=${s.dayActivity.toFixed(3)}/${s.nightActivity.toFixed(3)}`,
        `given=${s.givenPerThousand.toFixed(1)}/kt`,
        `toKin=${percent(s.givenToKin)}`,
        `species=${s.species.mean.toFixed(1)}/${s.species.max}`,
        `size=${s.meanSize.toFixed(2)}`,
        `diet=${s.meanDiet.toFixed(2)}`,
        `hidden=${s.hidden.toFixed(2)}`,
        `fur=${s.meanFur.toFixed(2)}`,
        `defense=${s.meanDefense.toFixed(2)}`,
        `births=${s.birthRate.toFixed(2)}/creature/kt lifespan=${s.lifespan.toFixed(0)} parentAge=${s.parentAge.toFixed(0)} newbornEnergy=${percent(s.newbornEnergy)} plants=${percent(s.plantFill)}`,
        `holding stone/branch/food=${(s.holdingStone * 100).toFixed(1)}%/${(s.holdingBranch * 100).toFixed(1)}%/${(s.holdingFood * 100).toFixed(1)}% haul=${s.haulDistance.toFixed(0)}`,

        `tps=${Math.round(s.ticksPerSecond)}`,
      ].join(' '),
    );
    for (const [k, b] of s.biomes.entries()) {
      console.log(
        `    ${BIOME_LABELS[k]!.padEnd(10)} land=${percent(b.land)} creatures=${percent(b.share)} occupied=${percent(b.occupied)} fur=${b.fur.toFixed(2)} size=${b.size.toFixed(2)} speed=${b.speed.toFixed(2)} diet=${b.diet.toFixed(2)}`,
      );
    }
  }
});
