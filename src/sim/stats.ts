import type { Creatures } from './creatures';

/**
 * Samples of world statistics over time, for charts. Holds a fixed number of
 * samples: when full, it keeps every other one and samples half as often, so
 * it always spans the whole run.
 */
export interface History {
  /** Ticks between samples. Doubles each time the history fills up. */
  interval: number;
  count: number;
  /** Increases whenever the contents change. */
  version: number;
  tick: Float64Array;
  population: Float32Array;
  /** Plant energy as a fraction of the fully grown world. */
  plantFill: Float32Array;
  meanSize: Float32Array;
  meanSpeed: Float32Array;
  meanSensorRange: Float32Array;
  meanDiet: Float32Array;
  meanFur: Float32Array;
  meanDefense: Float32Array;
  /** Creatures holding a stone or branch, and creatures holding food. */
  toolHolders: Float32Array;
  foodHolders: Float32Array;
  /** Creatures whose diet gene is above one half. */
  meatEaters: Float32Array;
  speciesCount: Float32Array;
  /** Mean number of enabled links and of hidden neurons per brain. */
  meanLinks: Float32Array;
  meanNeurons: Float32Array;
  /** Mean genes of the creatures that had young since the last sample, weighted by births. */
  parentSize: Float32Array;
  parentSpeed: Float32Array;
  parentSensorRange: Float32Array;
  parentDiet: Float32Array;
  /** How varied the body genes are: the mean of their standard deviations. */
  diversity: Float32Array;
  /** The standard deviation of each gene across living creatures. */
  spreadSize: Float32Array;
  spreadSpeed: Float32Array;
  spreadSensorRange: Float32Array;
  spreadDiet: Float32Array;
  spreadFur: Float32Array;
  spreadDefense: Float32Array;
  /** Deaths per 1,000 ticks since the previous sample, by cause. Other is plague, meteors and fire. */
  deathsStarved: Float32Array;
  deathsOldAge: Float32Array;
  deathsKilled: Float32Array;
  deathsTemperature: Float32Array;
  deathsThirst: Float32Array;
  deathsOther: Float32Array;
  /** Energy eaten per tick since the previous sample: plants and meat, by plant-eaters and by meat-eaters. */
  flowPlantsToPlantEaters: Float32Array;
  flowPlantsToMeatEaters: Float32Array;
  flowMeatToPlantEaters: Float32Array;
  flowMeatToMeatEaters: Float32Array;
  /**
   * Life histories of creatures since the previous sample: mean age at death,
   * mean age at a first birth, mean children had by those that died, and
   * mean age of a parent at a birth. Each holds its last value when nothing
   * of the kind happened.
   */
  lifespan: Float32Array;
  firstBirthAge: Float32Array;
  offspring: Float32Array;
  generationLength: Float32Array;
  /** Share of creatures doing each thing on the sampling tick; see Behaviour in world.ts. */
  shareResting: Float32Array;
  shareForaging: Float32Array;
  shareChasing: Float32Array;
  shareFleeing: Float32Array;
  /**
   * Blocks moved by creatures per 1,000 ticks since the previous sample, the
   * longest straight run of blocks creatures have moved, how many blocks have
   * ever been moved, the share of creatures in or beside a block's cell, and
   * the number carrying a block.
   */
  blockMoveRate: Float32Array;
  longestBuiltLine: Float32Array;
  builtBlocks: Float32Array;
  shelteredShare: Float32Array;
  blockHolders: Float32Array;

  /**
   * Brain features: mean learning rate over all enabled links, the share of
   * enabled links that can learn at all, mean time constant over hidden
   * neurons, and the share of hidden neurons that are slow (above 1).
   */
  meanPlasticity: Float32Array;
  plasticLinkShare: Float32Array;
  meanTau: Float32Array;
  slowNeuronShare: Float32Array;

  /** Evolutionary activity of brain links, real and neutral shadow; see wiring.ts. */
  wiringLive: Float32Array;
  wiringShadowLive: Float32Array;
  wiringActivity: Float32Array;
  wiringShadowActivity: Float32Array;
  wiringSurvival: Float32Array;
  wiringShadowSurvival: Float32Array;

  /** Share of creatures whose brain contains a loop, so it can keep a state from one tick to the next. */
  recurrentShare: Float32Array;

  /** Blocks moved per 1,000 ticks by each species, by species id. Not saved, like `species`. */
  blockMoves: Map<number, Float32Array>;

  /**
   * Members of each species at every sample, by species id. Not part of a
   * saved world: after loading, it starts again.
   */
  species: Map<number, Float32Array>;
  /** Where creatures have been; see DensityHistory. Not saved either. */
  density: DensityHistory;
  /** Which species fills each diet and speed combination; see BehaviourHistory. Not saved either. */
  behaviour: BehaviourHistory;
}

/** Cells along each axis of the behaviour map: diet from plants to meat, and speed from slow to fast. */
export const BEHAVIOUR_DIET_BINS = 10;
export const BEHAVIOUR_SPEED_BINS = 10;

/**
 * A map of body type against species, in the manner of the quality-diversity
 * "map of elites": for each combination of diet and speed, how many
 * creature-samples each species has contributed over the whole run. It is a
 * way of looking at the population, not something that selects it: filled
 * cells in many colours mean many kinds of creature, in many species.
 */
export interface BehaviourHistory {
  /** Species counts per cell, cell = speedBin * BEHAVIOUR_DIET_BINS + dietBin. */
  cells: Map<number, number>[];
}

export function createBehaviourHistory(): BehaviourHistory {
  return { cells: Array.from({ length: BEHAVIOUR_DIET_BINS * BEHAVIOUR_SPEED_BINS }, () => new Map()) };
}

/** Count every creature into its cell of the behaviour map. Speed is binned on a log scale between the limits. */
export function recordBehaviour(
  behaviour: BehaviourHistory,
  creatures: Creatures,
  minSpeed: number,
  maxSpeed: number,
): void {
  const span = Math.log(maxSpeed / minSpeed);
  for (let i = 0; i < creatures.count; i++) {
    const d = Math.min(BEHAVIOUR_DIET_BINS - 1, Math.floor(creatures.diet[i]! * BEHAVIOUR_DIET_BINS));
    const along = span > 0 ? Math.log(creatures.speed[i]! / minSpeed) / span : 0;
    const v = Math.min(BEHAVIOUR_SPEED_BINS - 1, Math.max(0, Math.floor(along * BEHAVIOUR_SPEED_BINS)));
    const cell = behaviour.cells[v * BEHAVIOUR_DIET_BINS + d]!;
    const species = creatures.species[i]!;
    cell.set(species, (cell.get(species) ?? 0) + 1);
  }
}

/** Side of the grid that density is counted on, in cells. */
export const DENSITY_GRID = 32;
/** Most frames a density history keeps. */
const DENSITY_FRAMES = 24;

/**
 * Where creatures spend their time, as a series of frames covering the whole
 * run. Each frame is a coarse grid counting the creatures seen in each cell
 * over a stretch of samples. When the frames run out, neighbouring pairs are
 * merged and each new frame covers twice as long.
 */
export interface DensityHistory {
  /** Finished frames, oldest first, each DENSITY_GRID squared counts. */
  frames: Float32Array[];
  /** Tick each finished frame ends at. */
  ticks: number[];
  /** Samples in every finished frame. */
  samplesPerFrame: number;
  /** The frame being filled, and how many samples are in it. */
  current: Float32Array;
  currentSamples: number;
}

export function createDensityHistory(): DensityHistory {
  return {
    frames: [],
    ticks: [],
    samplesPerFrame: 8,
    current: new Float32Array(DENSITY_GRID * DENSITY_GRID),
    currentSamples: 0,
  };
}

/** Count every creature into the frame being filled, and close the frame when it is full. */
export function recordDensity(
  density: DensityHistory,
  creatures: Creatures,
  worldWidth: number,
  worldHeight: number,
  tick: number,
): void {
  const { current } = density;
  for (let i = 0; i < creatures.count; i++) {
    const gx = Math.min(DENSITY_GRID - 1, Math.floor((creatures.x[i]! / worldWidth) * DENSITY_GRID));
    const gy = Math.min(DENSITY_GRID - 1, Math.floor((creatures.y[i]! / worldHeight) * DENSITY_GRID));
    current[gy * DENSITY_GRID + gx]!++;
  }
  if (++density.currentSamples < density.samplesPerFrame) return;
  density.frames.push(current);
  density.ticks.push(tick);
  density.current = new Float32Array(DENSITY_GRID * DENSITY_GRID);
  density.currentSamples = 0;
  if (density.frames.length < DENSITY_FRAMES) return;
  // Full: merge neighbouring pairs, so each frame from now on covers twice as long.
  const frames: Float32Array[] = [];
  const ticks: number[] = [];
  for (let k = 0; k + 1 < density.frames.length; k += 2) {
    const merged = density.frames[k]!;
    const other = density.frames[k + 1]!;
    for (let cell = 0; cell < merged.length; cell++) merged[cell]! += other[cell]!;
    frames.push(merged);
    ticks.push(density.ticks[k + 1]!);
  }
  density.frames = frames;
  density.ticks = ticks;
  density.samplesPerFrame *= 2;
}

/** Names of every series, in a fixed order. */
export const HISTORY_SERIES = [
  'tick',
  'population',
  'plantFill',
  'meanSize',
  'meanSpeed',
  'meanSensorRange',
  'meanDiet',
  'meanFur',
  'meanDefense',
  'toolHolders',
  'foodHolders',
  'meatEaters',
  'speciesCount',
  'meanLinks',
  'meanNeurons',
  'parentSize',
  'parentSpeed',
  'parentSensorRange',
  'parentDiet',
  'diversity',
  'spreadSize',
  'spreadSpeed',
  'spreadSensorRange',
  'spreadDiet',
  'spreadFur',
  'spreadDefense',
  'deathsStarved',
  'deathsOldAge',
  'deathsKilled',
  'deathsTemperature',
  'deathsThirst',
  'deathsOther',
  'flowPlantsToPlantEaters',
  'flowPlantsToMeatEaters',
  'flowMeatToPlantEaters',
  'flowMeatToMeatEaters',
  'lifespan',
  'firstBirthAge',
  'offspring',
  'generationLength',
  'shareResting',
  'shareForaging',
  'shareChasing',
  'shareFleeing',
  'blockMoveRate',
  'longestBuiltLine',
  'builtBlocks',
  'shelteredShare',
  'blockHolders',
  'meanPlasticity',
  'plasticLinkShare',
  'meanTau',
  'slowNeuronShare',
  'wiringLive',
  'wiringShadowLive',
  'wiringActivity',
  'wiringShadowActivity',
  'wiringSurvival',
  'wiringShadowSurvival',
  'recurrentShare',
] as const;

export interface Sample {
  tick: number;
  population: number;
  plantFill: number;
  meanSize: number;
  meanSpeed: number;
  meanSensorRange: number;
  meanDiet: number;
  meanFur: number;
  meanDefense: number;
  toolHolders: number;
  foodHolders: number;
  meatEaters: number;
  speciesCount: number;
  meanLinks: number;
  meanNeurons: number;
  parentSize: number;
  parentSpeed: number;
  parentSensorRange: number;
  parentDiet: number;
  diversity: number;
  spreadSize: number;
  spreadSpeed: number;
  spreadSensorRange: number;
  spreadDiet: number;
  spreadFur: number;
  spreadDefense: number;
  deathsStarved: number;
  deathsOldAge: number;
  deathsKilled: number;
  deathsTemperature: number;
  deathsThirst: number;
  deathsOther: number;
  flowPlantsToPlantEaters: number;
  flowPlantsToMeatEaters: number;
  flowMeatToPlantEaters: number;
  flowMeatToMeatEaters: number;
  lifespan: number;
  firstBirthAge: number;
  offspring: number;
  generationLength: number;
  shareResting: number;
  shareForaging: number;
  shareChasing: number;
  shareFleeing: number;
  blockMoveRate: number;
  longestBuiltLine: number;
  builtBlocks: number;
  shelteredShare: number;
  blockHolders: number;
  meanPlasticity: number;
  plasticLinkShare: number;
  meanTau: number;
  slowNeuronShare: number;
  wiringLive: number;
  wiringShadowLive: number;
  wiringActivity: number;
  wiringShadowActivity: number;
  wiringSurvival: number;
  wiringShadowSurvival: number;
  recurrentShare: number;
}

export function createHistory(interval: number, capacity: number): History {
  return {
    interval,
    count: 0,
    version: 0,
    tick: new Float64Array(capacity),
    population: new Float32Array(capacity),
    plantFill: new Float32Array(capacity),
    meanSize: new Float32Array(capacity),
    meanSpeed: new Float32Array(capacity),
    meanSensorRange: new Float32Array(capacity),
    meanDiet: new Float32Array(capacity),
    meanFur: new Float32Array(capacity),
    meanDefense: new Float32Array(capacity),
    toolHolders: new Float32Array(capacity),
    foodHolders: new Float32Array(capacity),
    meatEaters: new Float32Array(capacity),
    speciesCount: new Float32Array(capacity),
    meanLinks: new Float32Array(capacity),
    meanNeurons: new Float32Array(capacity),
    parentSize: new Float32Array(capacity),
    parentSpeed: new Float32Array(capacity),
    parentSensorRange: new Float32Array(capacity),
    parentDiet: new Float32Array(capacity),
    diversity: new Float32Array(capacity),
    spreadSize: new Float32Array(capacity),
    spreadSpeed: new Float32Array(capacity),
    spreadSensorRange: new Float32Array(capacity),
    spreadDiet: new Float32Array(capacity),
    spreadFur: new Float32Array(capacity),
    spreadDefense: new Float32Array(capacity),
    deathsStarved: new Float32Array(capacity),
    deathsOldAge: new Float32Array(capacity),
    deathsKilled: new Float32Array(capacity),
    deathsTemperature: new Float32Array(capacity),
    deathsThirst: new Float32Array(capacity),
    deathsOther: new Float32Array(capacity),
    flowPlantsToPlantEaters: new Float32Array(capacity),
    flowPlantsToMeatEaters: new Float32Array(capacity),
    flowMeatToPlantEaters: new Float32Array(capacity),
    flowMeatToMeatEaters: new Float32Array(capacity),
    lifespan: new Float32Array(capacity),
    firstBirthAge: new Float32Array(capacity),
    offspring: new Float32Array(capacity),
    generationLength: new Float32Array(capacity),
    shareResting: new Float32Array(capacity),
    shareForaging: new Float32Array(capacity),
    shareChasing: new Float32Array(capacity),
    shareFleeing: new Float32Array(capacity),
    blockMoveRate: new Float32Array(capacity),
    longestBuiltLine: new Float32Array(capacity),
    builtBlocks: new Float32Array(capacity),
    shelteredShare: new Float32Array(capacity),
    blockHolders: new Float32Array(capacity),
    meanPlasticity: new Float32Array(capacity),
    plasticLinkShare: new Float32Array(capacity),
    meanTau: new Float32Array(capacity),
    slowNeuronShare: new Float32Array(capacity),
    wiringLive: new Float32Array(capacity),
    wiringShadowLive: new Float32Array(capacity),
    wiringActivity: new Float32Array(capacity),
    wiringShadowActivity: new Float32Array(capacity),
    wiringSurvival: new Float32Array(capacity),
    wiringShadowSurvival: new Float32Array(capacity),
    recurrentShare: new Float32Array(capacity),
    blockMoves: new Map(),
    species: new Map(),
    density: createDensityHistory(),
    behaviour: createBehaviourHistory(),
  };
}

/**
 * Add a sample. `speciesCounts`, if given, is the number of members of each
 * living species, by id; `blockMoves` is the blocks each species moved per
 * 1,000 ticks since the previous sample.
 */
export function recordSample(
  history: History,
  sample: Sample,
  speciesCounts?: Map<number, number>,
  blockMoves?: Map<number, number>,
): void {
  if (history.count === history.tick.length) {
    const kept = Math.ceil(history.count / 2);
    for (const name of HISTORY_SERIES) {
      const series = history[name];
      for (let i = 0; i < kept; i++) series[i] = series[i * 2]!;
    }
    for (const perSpecies of [history.species, history.blockMoves]) thin(perSpecies, kept);
    history.count = kept;
    history.interval *= 2;
  }
  const i = history.count++;
  for (const name of HISTORY_SERIES) history[name][i] = sample[name];
  if (speciesCounts) write(history.species, speciesCounts, i, history.tick.length);
  if (blockMoves) write(history.blockMoves, blockMoves, i, history.tick.length);
  history.version++;
}

/** Keep every other sample of each per-species series, and forget a species left with nothing. */
function thin(perSpecies: Map<number, Float32Array>, kept: number): void {
  for (const [id, series] of perSpecies) {
    let any = false;
    for (let i = 0; i < kept; i++) {
      series[i] = series[i * 2]!;
      if (series[i]! > 0) any = true;
    }
    series.fill(0, kept);
    // A species with nothing at any sample still kept is forgotten.
    if (!any) perSpecies.delete(id);
  }
}

/** Write one sample's value for each species, starting a series for a species not seen before. */
function write(perSpecies: Map<number, Float32Array>, values: Map<number, number>, at: number, capacity: number): void {
  for (const [id, value] of values) {
    let series = perSpecies.get(id);
    if (!series) {
      if (value === 0) continue;
      series = new Float32Array(capacity);
      perSpecies.set(id, series);
    }
    series[at] = value;
  }
}

/** Mean of a gene across living creatures, or 0 when there are none. */
export function meanOf(values: Float32Array, creatures: Creatures): number {
  if (creatures.count === 0) return 0;
  let total = 0;
  for (let i = 0; i < creatures.count; i++) total += values[i]!;
  return total / creatures.count;
}

/** Standard deviation of a gene across living creatures, or 0 when there are none. */
export function spreadOf(values: Float32Array, creatures: Creatures): number {
  if (creatures.count === 0) return 0;
  const mean = meanOf(values, creatures);
  let total = 0;
  for (let i = 0; i < creatures.count; i++) total += (values[i]! - mean) ** 2;
  return Math.sqrt(total / creatures.count);
}