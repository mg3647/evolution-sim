import type { SimConfig } from './config';
import type { Rng } from './rng';

/**
 * The heritable traits of a creature. Size and speed are multipliers on the
 * configured base radius and base speed.
 */
export interface Genes {
  size: number;
  speed: number;
  /** Multiplier on the configured length of the vision rays. */
  sensorRange: number;
  /** Body colour as a hue in [0, 1). No effect on survival; it marks lineages. */
  hue: number;
  /** Standard deviation of the changes applied to each gene at birth. */
  mutationRate: number;
}

/** Hue shifts by this fraction of the mutation rate, slowly enough that relatives look alike. */
const HUE_MUTATION_SCALE = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Genes for a creature with no parent: average traits and a random colour. */
export function founderGenes(rng: Rng, config: SimConfig): Genes {
  return mutateGenes(
    { size: 1, speed: 1, sensorRange: 1, hue: rng.float(), mutationRate: config.initialMutationRate },
    rng,
    config,
  );
}

/**
 * A mutated copy for a child. Size, speed and the mutation rate change by a
 * random factor, so a change is proportional to the current value.
 */
export function mutateGenes(parent: Genes, rng: Rng, config: SimConfig): Genes {
  const rate = parent.mutationRate;
  const hue = parent.hue + rng.gaussian() * rate * HUE_MUTATION_SCALE;
  return {
    size: clamp(parent.size * Math.exp(rng.gaussian() * rate), config.minSize, config.maxSize),
    speed: clamp(parent.speed * Math.exp(rng.gaussian() * rate), config.minSpeed, config.maxSpeed),
    sensorRange: clamp(
      parent.sensorRange * Math.exp(rng.gaussian() * rate),
      config.minSensorRange,
      config.maxSensorRange,
    ),
    hue: hue - Math.floor(hue),
    mutationRate: clamp(
      rate * Math.exp(rng.gaussian() * rate),
      config.minMutationRate,
      config.maxMutationRate,
    ),
  };
}

/** Most energy a creature of this size can store. */
export function maxEnergyFor(size: number, config: SimConfig): number {
  return config.creatureMaxEnergy * size * size;
}

/** Most plant energy a creature of this size can eat per tick. */
export function biteFor(size: number, config: SimConfig): number {
  return config.biteSize * size * size;
}

/** Energy the senses cost per tick. Seeing farther means watching a larger area. */
export function senseCostFor(sensorRange: number, config: SimConfig): number {
  return config.senseCost * sensorRange * sensorRange;
}

/**
 * Distance moved per tick at full thrust. Longer legs cover more ground, so a bigger body
 * reaches more food per tick at the same speed gene.
 */
export function strideFor(size: number, speed: number, config: SimConfig): number {
  return config.creatureSpeed * speed * Math.sqrt(size);
}

/**
 * Energy spent per tick. Part of upkeep is the same for any body, which
 * penalises tiny bodies that cover little ground; the rest grows faster with
 * size than the stride does, which penalises huge ones. Moving costs grow
 * with the square of speed, so speed pays off only where food is sparse.
 */
export function tickCostFor(size: number, speed: number, thrust: number, config: SimConfig): number {
  const fixed = config.upkeepFixedShare;
  const upkeep = config.upkeepCost * (fixed + (1 - fixed) * size * Math.sqrt(size));
  // A body built for speed is costly per unit of distance even when it ambles,
  // so the speed gene is not a free option to hold in reserve.
  const movement = config.moveCost * config.creatureSpeed * size * size * speed * speed * thrust;
  return upkeep + movement;
}
