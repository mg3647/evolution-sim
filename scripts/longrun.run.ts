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
 *   REPEAT runs per seed, each with its own sub-seed (seed#1, seed#2, ...); with more
 *          than one, a mean and spread per seed is printed after the runs (default: 1)
 *   NO_RESEED  1 to stop adding parentless creatures when the population falls below
 *          the minimum, so a collapsed world stays collapsed (default: 0)
 *
 * To test whether an evolved population relies on something, change a
 * setting partway through and compare with an unchanged run:
 *   CHANGE_AT  tick at which to apply CHANGE
 *   CHANGE     JSON of config changes, e.g. {"socialSenses":false}
 */
import { it } from 'vitest';
import { BIOME_COUNT, BIOME_LABELS } from '../src/sim/biomes';
import { defaultConfig, type SimConfig } from '../src/sim/config';
import { brainProfile } from '../src/sim/profile';
import { Held } from '../src/sim/creatures';
import { daylightAt } from '../src/sim/environment';
import { maxEnergyFor, upkeepFor } from '../src/sim/genome';
import { cellIndexAt, groundHue, visibility } from '../src/sim/plants';
import { createWorld, step } from '../src/sim/world';
import { functionalHidden, Locality, type LocalitySummary } from './locality';

const seeds = (process.env.SEEDS ?? 'genesis,second,third').split(',');
const ticks = Number(process.env.TICKS ?? 200000);
const overrides = {
  ...(process.env.NO_RESEED === '1' ? { minPopulation: 0 } : {}),
  ...(JSON.parse(process.env.TUNE ?? '{}') as Partial<SimConfig>),
};
const repeat = Math.max(1, Number(process.env.REPEAT ?? 1));
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
  /** Share of deaths from running out of energy (not counting the hot or cold ones), and the two together; thirst, heat or cold and disasters together are the abiotic share. */
  starvedShare: number;
  starvedOrTemperatureShare: number;
  abioticShare: number;
  /** Generations of the living at the end: mean and highest. */
  generation: { mean: number; max: number };
  /** Brain changes added by mutation per birth of one parent, as counted and as the settings should give, for links and neurons. */
  structural: { links: number; neurons: number; expectedLinks: number; expectedNeurons: number };
  /** Of links first carried at least `wiringSurvivalTicks` before the end: share still carried by anyone, and share carried with a weight beyond 0.3. */
  linksStillCarried: number;
  linksStillStrong: number;
  /** Mean enabled links per creature, their energy cost as a share of one body's upkeep, and the share of all links that are switched off. */
  linksPerCreature: number;
  linkCostShare: number;
  disabledShare: number;
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
  /** Brain features, averaged over the samples: mean learning rate over all links, the share of links that can learn, mean time constant, and the share of slow neurons. */
  meanPlasticity: number;
  /** Mean links in use, in the shadow, mean link activity real and shadow, and the share of new links still carried, real and shadow (real above shadow is a sign of selection). */
  wiring: { live: number; shadowLive: number; activity: number; shadowActivity: number; survival: number; shadowSurvival: number };
  plasticLinkShare: number;
  meanTau: number;
  slowNeuronShare: number;
  /** Share of creatures with a loop in their brain. */
  recurrentShare: number;
  /** At the end: for the largest species, members, mean learning rate over their links, and the share of their links that can learn. */
  speciesLearning: { id: number; members: number; meanPlasticity: number; plasticShare: number; hidden: number; links: number; looped: number }[];
  haulDistance: number;
  /**
   * Breeding: births per creature per 1,000 ticks, the mean age at death,
   * how full of energy a newborn is, the mean age of a parent at a birth,
   * and how full of plants the world is.
   */
  birthRate: number;
  /** Share of the period's births that had two parents, and of those the share between close kin. */
  sexualShare: number;
  kinShare: number;
  lifespan: number;
  newbornEnergy: number;
  parentAge: number;
  plantFill: number;
  /**
   * Blocks: pushes and set-downs per creature per 1,000 ticks, the mean share
   * of creatures carrying one, the share of creatures in or beside a block's
   * cell against the share of land that is, the longest straight run of
   * blocks creatures moved, and the share of blocks any creature has moved.
   */
  blockPushes: number;
  blockSetDowns: number;
  holdingBlock: number;
  shelteredCreatures: number;
  shelteredLand: number;
  longestLine: number;
  builtShare: number;
  /** Mean fur and defense genes overall. */
  meanFur: number;
  meanDefense: number;
  /**
   * Per biome: its share of the land, the share of the population standing
   * in it, the share of samples in which it held at least a few creatures,
   * and those creatures' mean fur, size, speed and diet.
   */
  biomes: { land: number; share: number; occupied: number; fur: number; size: number; speed: number; diet: number }[];
  /** Local adaptation by birthplace, and how much children behave like their parents. */
  locality: LocalitySummary;
  /** At the end: hidden neurons per brain, and those whose removal changes what the brain does. */
  hiddenNeurons: { hidden: number; functional: number };
  ticksPerSecond: number;
  /** The investment and readiness genes; see lifeHistoryOf. */
  lifeHistory: LifeHistory;
}

interface GeneSpread {
  mean: number;
  sd: number;
}

/**
 * The life-history genes: means and spreads at the end (and of their product,
 * the share of a full store a child is given), their means at each quarter of
 * the run, by diet and in the biggest species; and over the measured period,
 * the share of deaths before breeding age and failed tries to breed per birth.
 */
interface LifeHistory {
  investment: GeneSpread;
  readiness: GeneSpread;
  product: GeneSpread;
  quarters: { tick: number; investment: number; readiness: number }[];
  byDiet: { plants: { n: number; investment: number; readiness: number }; meat: { n: number; investment: number; readiness: number } };
  bySpecies: { id: number; n: number; investment: number; readiness: number }[];
  juvenileDeathShare: number;
  tooSmallPerBirth: number;
}

function spreadOfValues(values: number[]): GeneSpread {
  const n = Math.max(1, values.length);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return { mean, sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n) };
}

function meanGenes(c: ReturnType<typeof createWorld>['creatures'], pick: (i: number) => boolean) {
  let n = 0;
  let investment = 0;
  let readiness = 0;
  for (let i = 0; i < c.count; i++) {
    if (!pick(i)) continue;
    n++;
    investment += c.investment[i]!;
    readiness += c.readiness[i]!;
  }
  return { n, investment: investment / Math.max(1, n), readiness: readiness / Math.max(1, n) };
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
  let matingBefore = { ...world.mating };
  let blocksBefore = { ...world.blockTally };
  let shelteredSum = 0;
  let shelteredLandSum = 0;
  let creatureTicks = 0;
  let newborns = 0;
  let newbornFill = 0;
  const heldSum = [0, 0, 0, 0, 0, 0];
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
  const locality = new Locality(world);

  let callerSum = 0;
  let dayActivity = 0;
  let daySamples = 0;
  let nightActivity = 0;
  let nightSamples = 0;
  let socialBefore = { ...world.social };
  let deathsBefore = { ...world.deaths };
  let reseededBefore = 0;
  let firesBefore = { ...world.fires };
  let lifeBefore = { ...world.lifeHistory };
  const quarters: LifeHistory['quarters'] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === changeAt) Object.assign(world.config, change);
    step(world);
    locality.afterStep(tick, tick > from);
    if (tick === from) {
      deathsBefore = { ...world.deaths };
      socialBefore = { ...world.social };
      reseededBefore = world.reseeded;
      firesBefore = { ...world.fires };
      birthsBefore = world.births;
      matingBefore = { ...world.mating };
      blocksBefore = { ...world.blockTally };
      carryBefore = { ...world.carry };
      lifeBefore = { ...world.lifeHistory };
    }
    if (tick % Math.max(1, Math.floor(ticks / 4)) === 0) {
      const m = meanGenes(c, () => true);
      quarters.push({ tick, investment: m.investment, readiness: m.readiness });
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
    locality.sample(SAMPLE);
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
    let land = 0;
    let landSheltered = 0;
    let sheltered = 0;
    for (let cell = 0; cell < world.plants.biome.length; cell++) {
      if (world.plants.water[cell] === 1) continue;
      biomeLand[world.plants.biome[cell]!]!++;
      land++;
      if (world.plants.nearBlocks[cell]! > 0) landSheltered++;
    }
    shelteredLandSum += landSheltered / Math.max(1, land);
    for (let i = 0; i < c.count; i++) {
      const cell = cellIndexAt(world.plants, c.x[i]!, c.y[i]!);
      const ground = groundHue(world.plants, cell, world.config);
      const biome = world.plants.biome[cell]!;
      if (world.plants.nearBlocks[cell]! > 0) sheltered++;
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
    shelteredSum += sheltered / Math.max(1, c.count);
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
    starvedShare: deaths > 0 ? d.starved / deaths : 0,
    starvedOrTemperatureShare: deaths > 0 ? (d.starved + d.temperature) / deaths : 0,
    abioticShare: deaths > 0 ? (d.thirst + d.temperature + d.disaster) / deaths : 0,
    lifeHistory: lifeHistoryOf(world, quarters, deaths, lifeBefore, world.births - birthsBefore),
    ...endOfRun(world),
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
    blockPushes: ((world.blockTally.pushed - blocksBefore.pushed) * 1000) / Math.max(1, creatureTicks),
    blockSetDowns: ((world.blockTally.setDown - blocksBefore.setDown) * 1000) / Math.max(1, creatureTicks),
    holdingBlock: heldSum[Held.Block]! / samples,
    shelteredCreatures: shelteredSum / samples,
    shelteredLand: shelteredLandSum / samples,
    longestLine: world.history.longestBuiltLine[world.history.count - 1]!,
    builtShare:
      world.history.builtBlocks[world.history.count - 1]! /
      Math.max(1, world.plants.blocks.reduce((a, b) => a + b, 0)),
    birthRate: ((world.births - birthsBefore) * 1000) / Math.max(1, creatureTicks),
    sexualShare: (world.mating.sexual - matingBefore.sexual) / Math.max(1, world.births - birthsBefore),
    kinShare: (world.mating.kin - matingBefore.kin) / Math.max(1, world.mating.sexual - matingBefore.sexual),
    lifespan: mean(world.history.lifespan, world.history.tick, world.history.count, from),
    parentAge: mean(world.history.generationLength, world.history.tick, world.history.count, from),
    plantFill: mean(world.history.plantFill, world.history.tick, world.history.count, from),
    newbornEnergy: newbornFill / Math.max(1, newborns),
    holdingStone: heldSum[Held.Stone]! / samples,
    holdingBranch: heldSum[Held.Branch]! / samples,
    holdingFood: (heldSum[Held.Plants]! + heldSum[Held.Meat]!) / samples,
    wiring: {
      live: mean(world.history.wiringLive, world.history.tick, world.history.count, from),
      shadowLive: mean(world.history.wiringShadowLive, world.history.tick, world.history.count, from),
      activity: mean(world.history.wiringActivity, world.history.tick, world.history.count, from),
      shadowActivity: mean(world.history.wiringShadowActivity, world.history.tick, world.history.count, from),
      survival: mean(world.history.wiringSurvival, world.history.tick, world.history.count, from),
      shadowSurvival: mean(world.history.wiringShadowSurvival, world.history.tick, world.history.count, from),
    },
    meanPlasticity: mean(world.history.meanPlasticity, world.history.tick, world.history.count, from),
    plasticLinkShare: mean(world.history.plasticLinkShare, world.history.tick, world.history.count, from),
    meanTau: mean(world.history.meanTau, world.history.tick, world.history.count, from),
    slowNeuronShare: mean(world.history.slowNeuronShare, world.history.tick, world.history.count, from),
    recurrentShare: mean(world.history.recurrentShare, world.history.tick, world.history.count, from),
    speciesLearning: speciesLearning(world),
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
    locality: locality.summary(),
    hiddenNeurons: functionalHidden(world),
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

/** For the five largest species alive now: how much of their wiring can learn. */
function speciesLearning(world: ReturnType<typeof createWorld>): Summary['speciesLearning'] {
  const tally = new Map<number, { members: number; links: number; plastic: number; rate: number; indices: number[] }>();
  const { creatures } = world;
  for (let i = 0; i < creatures.count; i++) {
    const t = tally.get(creatures.species[i]!) ?? { members: 0, links: 0, plastic: 0, rate: 0, indices: [] };
    t.indices.push(i);
    const brain = creatures.brain[i]!;
    t.members++;
    t.links += brain.linkWeight.length;
    t.plastic += brain.plasticLinks.length;
    for (const r of brain.plasticRate) t.rate += r;
    tally.set(creatures.species[i]!, t);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1].members - a[1].members)
    .slice(0, 5)
    .map(([id, t]) => {
      const profile = brainProfile(creatures, t.indices);
      return {
        id,
        members: t.members,
        meanPlasticity: t.links > 0 ? t.rate / t.links : 0,
        plasticShare: t.links > 0 ? t.plastic / t.links : 0,
        hidden: profile.meanHidden,
        links: profile.meanLinks,
        looped: profile.recurrentShare,
      };
    });
}

/** Measures that are only meaningful at the end of a run. */
function lifeHistoryOf(
  world: ReturnType<typeof createWorld>,
  quarters: LifeHistory['quarters'],
  deaths: number,
  before: { tooSmall: number; juvenileDeaths: number },
  births: number,
): LifeHistory {
  const c = world.creatures;
  const all = Array.from({ length: c.count }, (_, i) => i);
  const sizes = new Map<number, number>();
  for (const i of all) sizes.set(c.species[i]!, (sizes.get(c.species[i]!) ?? 0) + 1);
  const biggest = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    investment: spreadOfValues(all.map((i) => c.investment[i]!)),
    readiness: spreadOfValues(all.map((i) => c.readiness[i]!)),
    product: spreadOfValues(all.map((i) => c.investment[i]! * c.readiness[i]!)),
    quarters,
    byDiet: { plants: meanGenes(c, (i) => c.diet[i]! <= 0.5), meat: meanGenes(c, (i) => c.diet[i]! > 0.5) },
    bySpecies: biggest.map(([id]) => ({ id, ...meanGenes(c, (i) => c.species[i] === id) })),
    juvenileDeathShare: (world.lifeHistory.juvenileDeaths - before.juvenileDeaths) / Math.max(1, deaths),
    tooSmallPerBirth: (world.lifeHistory.tooSmall - before.tooSmall) / Math.max(1, births),
  };
}

function endOfRun(world: ReturnType<typeof createWorld>) {
  const c = world.creatures;
  let generationSum = 0;
  let generationMax = 0;
  let links = 0;
  let disabled = 0;
  let upkeep = 0;
  const carried = new Set<number>();
  const strong = new Set<number>();
  for (let i = 0; i < c.count; i++) {
    generationSum += c.generation[i]!;
    generationMax = Math.max(generationMax, c.generation[i]!);
    upkeep += upkeepFor(c.size[i]!, world.config);
    for (const link of c.brain[i]!.links) {
      if (!link.enabled) {
        disabled++;
        continue;
      }
      links++;
      carried.add(link.innovation);
      if (Math.abs(link.weight) > 0.3) strong.add(link.innovation);
    }
  }
  const births = Math.max(1, world.births - world.mating.sexual);
  let old = 0;
  let kept = 0;
  let stronger = 0;
  for (const [id, at] of world.wiring.realFirst) {
    if (at > world.wiring.startTick && world.tick - at >= world.config.wiringSurvivalTicks) {
      old++;
      if (carried.has(id)) kept++;
      if (strong.has(id)) stronger++;
    }
  }
  const n = Math.max(1, c.count);
  return {
    generation: { mean: generationSum / n, max: generationMax },
    structural: {
      links: world.structural.links / births,
      neurons: world.structural.neurons / births,
      expectedLinks: world.config.addLinkChance,
      expectedNeurons: world.config.addNeuronChance,
    },
    linksStillCarried: old > 0 ? kept / old : 0,
    linksStillStrong: old > 0 ? stronger / old : 0,
    linksPerCreature: links / n,
    linkCostShare: upkeep > 0 ? (links * world.config.brainLinkCost) / upkeep : 0,
    disabledShare: links + disabled > 0 ? disabled / (links + disabled) : 0,
  };
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

it(`runs ${seeds.length} seeds for ${ticks} ticks`, () => {
  console.log(`overrides: ${JSON.stringify(overrides)} from: ${from} change at ${changeAt}: ${JSON.stringify(change)}`);
  const runs = new Map<string, Summary[]>();
  for (const seed of seeds.flatMap((base) => (repeat > 1 ? Array.from({ length: repeat }, (_, k) => `${base}#${k + 1}`) : [base]))) {
    const s = run(seed);
    const base = seed.split('#')[0]!;
    runs.set(base, [...(runs.get(base) ?? []), s]);
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
        `starvedShare=${percent(s.starvedShare)} abioticShare=${percent(s.abioticShare)} starved+temperature=${percent(s.starvedOrTemperatureShare)}`,
        `generation mean/max=${s.generation.mean.toFixed(1)}/${s.generation.max}`,
        `structural/birth links=${s.structural.links.toFixed(3)} (settings give ${s.structural.expectedLinks.toFixed(3)}) neurons=${s.structural.neurons.toFixed(3)} (settings give ${s.structural.expectedNeurons.toFixed(3)})`,
        `newLinks still carried/strong=${percent(s.linksStillCarried)}/${percent(s.linksStillStrong)} links/creature=${s.linksPerCreature.toFixed(1)} linkCost=${percent(s.linkCostShare)}ofUpkeep disabled=${percent(s.disabledShare)}`,
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
        `births=${s.birthRate.toFixed(2)}/creature/kt sexual=${percent(s.sexualShare)} kin=${percent(s.kinShare)} lifespan=${s.lifespan.toFixed(0)} parentAge=${s.parentAge.toFixed(0)} newbornEnergy=${percent(s.newbornEnergy)} plants=${percent(s.plantFill)}`,
        `holding stone/branch/food=${(s.holdingStone * 100).toFixed(1)}%/${(s.holdingBranch * 100).toFixed(1)}%/${(s.holdingFood * 100).toFixed(1)}% haul=${s.haulDistance.toFixed(0)}`,

        `tps=${Math.round(s.ticksPerSecond)}`,
      ].join(' '),
    );
    const l = s.lifeHistory;
    const g = (x: GeneSpread) => `${x.mean.toFixed(3)}±${x.sd.toFixed(3)}`;
    const m = (x: { n: number; investment: number; readiness: number }) => `n=${x.n} inv=${x.investment.toFixed(3)} ready=${x.readiness.toFixed(3)}`;
    console.log(
      [
        `  lifeHistory investment=${g(l.investment)} readiness=${g(l.readiness)} product=${g(l.product)}`,
        `juvenileDeaths=${percent(l.juvenileDeathShare)} tooSmall/birth=${l.tooSmallPerBirth.toFixed(2)}`,
        `quarters=${l.quarters.map((q) => `t${q.tick}:${q.investment.toFixed(3)}/${q.readiness.toFixed(3)}`).join(',')}`,
        `plantEaters(${m(l.byDiet.plants)}) meatEaters(${m(l.byDiet.meat)})`,
        `species=${l.bySpecies.map((x) => `[${x.id} ${m(x)}]`).join(' ')}`,
      ].join(' '),
    );
    console.log(
      'RESULT ' +
        JSON.stringify({
          seed: s.seed,
          population: s.population.mean,
          popMax: s.population.max,
          atCap: s.atCap,
          lifespan: s.lifespan,
          parentAge: s.parentAge,
          births: s.birthRate,
          abiotic: s.abioticShare,
          thirst: s.thirstShare,
          temperature: s.temperatureShare,
          starved: s.starvedShare,
          starvedOrTemperature: s.starvedOrTemperatureShare,
          killed: s.killShare,
          oldAge: s.oldAgeShare,
          hunters: s.hunters,
          species: s.species.mean,
          fur: s.meanFur,
          hidden: s.hidden,
          generationMean: s.generation.mean,
          generationMax: s.generation.max,
          structuralLinks: s.structural.links,
          structuralNeurons: s.structural.neurons,
          kept: s.wiring.survival,
          keptShadow: s.wiring.shadowSurvival,
          stillCarried: s.linksStillCarried,
          stillStrong: s.linksStillStrong,
          linkCost: s.linkCostShare,
          disabled: s.disabledShare,
          reseeded: s.reseeded,
          recurrent: s.recurrentShare,
          slowNeurons: s.slowNeuronShare,
          hiddenNeurons: s.hiddenNeurons.hidden,
          functionalHidden: s.hiddenNeurons.functional,
          ...s.locality,
        }),
    );
    console.log(
      `    blocks: pushes=${s.blockPushes.toFixed(2)}/creature/kt setDowns=${s.blockSetDowns.toFixed(3)}/creature/kt holding=${(s.holdingBlock * 100).toFixed(2)}% shelteredCreatures=${percent(s.shelteredCreatures)} shelteredLand=${percent(s.shelteredLand)} longestLine=${s.longestLine} builtShare=${percent(s.builtShare)}`,
    );
    console.log(
      `    brains: learningRate=${s.meanPlasticity.toFixed(4)} linksThatLearn=${percent(s.plasticLinkShare)} meanTau=${s.meanTau.toFixed(2)} slowNeurons=${percent(s.slowNeuronShare)} brainsWithLoop=${percent(s.recurrentShare)}`,
    );
    console.log(
      `    wiring: links=${s.wiring.live.toFixed(0)} shadow=${s.wiring.shadowLive.toFixed(0)} activity real/shadow=${s.wiring.activity.toFixed(1)}/${s.wiring.shadowActivity.toFixed(1)} newLinksKept real/shadow=${percent(s.wiring.survival)}/${percent(s.wiring.shadowSurvival)}`,
    );
    const l = s.locality;
    console.log(
      `    locality: residency=${percent(l.residency)} (by chance ${percent(l.residencyByChance)}) furByBirthBiome=${l.furByBirth.toFixed(3)} sizeByBirthBiome=${l.sizeByBirth.toFixed(3)} furVsBirthTemp r=${l.furTemperatureR.toFixed(3)} fur tundra/desert-born=${l.tundraFur.toFixed(2)}/${l.desertFur.toFixed(2)} climateHomeGap=${percent(l.climateHomeGap)} breedingHomeAdvantage=${l.homeAdvantage.toFixed(2)}`,
    );
    console.log(
      `    inheritance: childParentGap=${l.childParentGap.toFixed(3)} (both parents ${l.childParentsMeanGap.toFixed(3)}) sameSpeciesGap=${l.sameSpeciesGap.toFixed(3)} actionsAgree child/species=${percent(l.childParentAgree)}/${percent(l.sameSpeciesAgree)} probes=${l.probes} mutationRate=${l.mutationRate.toFixed(3)} hidden=${s.hiddenNeurons.hidden.toFixed(2)} functionalHidden=${s.hiddenNeurons.functional.toFixed(2)}`,
    );
    for (const sp of s.speciesLearning) {
      console.log(
        `      species ${sp.id}: members=${sp.members} hidden=${sp.hidden.toFixed(1)} links=${sp.links.toFixed(1)} loop=${percent(sp.looped)} learningRate=${sp.meanPlasticity.toFixed(4)} linksThatLearn=${percent(sp.plasticShare)}`,
      );
    }
    for (const [k, b] of s.biomes.entries()) {
      console.log(
        `    ${BIOME_LABELS[k]!.padEnd(10)} land=${percent(b.land)} creatures=${percent(b.share)} occupied=${percent(b.occupied)} fur=${b.fur.toFixed(2)} size=${b.size.toFixed(2)} speed=${b.speed.toFixed(2)} diet=${b.diet.toFixed(2)}`,
      );
    }
  }
  if (repeat > 1) {
    const measures: [string, (s: Summary) => number, (x: number) => string][] = [
      ['population', (s) => s.population.mean, (x) => x.toFixed(0)],
      ['reseeded', (s) => s.reseeded, (x) => x.toFixed(1)],
      ['hunters', (s) => s.hunters, (x) => x.toFixed(1)],
      ['killShare', (s) => s.killShare, percent],
      ['species', (s) => s.species.mean, (x) => x.toFixed(1)],
      ['lifespan', (s) => s.lifespan, (x) => x.toFixed(0)],
      ['learningRate', (s) => s.meanPlasticity, (x) => x.toFixed(4)],
      ['linksThatLearn', (s) => s.plasticLinkShare, percent],
      ['slowNeurons', (s) => s.slowNeuronShare, percent],
      ['brainsWithLoop', (s) => s.recurrentShare, percent],
      ['newLinksKept real', (s) => s.wiring.survival, percent],
      ['newLinksKept shadow', (s) => s.wiring.shadowSurvival, percent],
      ['residency', (s) => s.locality.residency, percent],
      ['furVsBirthTemp r', (s) => s.locality.furTemperatureR, (x) => x.toFixed(3)],
      ['climateHomeGap', (s) => s.locality.climateHomeGap, percent],
      ['breedingHomeAdvantage', (s) => s.locality.homeAdvantage, (x) => x.toFixed(2)],
      ['childParentGap', (s) => s.locality.childParentGap, (x) => x.toFixed(3)],
      ['sameSpeciesGap', (s) => s.locality.sameSpeciesGap, (x) => x.toFixed(3)],
      ['mutationRate', (s) => s.locality.mutationRate, (x) => x.toFixed(3)],
      ['hiddenNeurons', (s) => s.hiddenNeurons.hidden, (x) => x.toFixed(2)],
      ['functionalHidden', (s) => s.hiddenNeurons.functional, (x) => x.toFixed(2)],
    ];
    for (const [base, list] of runs) {
      console.log(`${base}: mean (spread = standard deviation) over ${list.length} runs`);
      for (const [name, pick, show] of measures) {
        const values = list.map(pick);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
        console.log(`    ${name.padEnd(22)} ${show(mean)} (spread ${show(spread)})`);
      }
    }
  }
});
