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
  /** What it can digest: 0 eats only plants, 1 only meat, in between some of each. */
  diet: number;
  /** Body colour as a hue in [0, 1). Relatives look alike, and a creature the colour of the ground is harder to see. */
  hue: number;
  /** Thickness of its coat, from 0 (none) to 1: keeps cold out, makes heat worse, and costs a little to grow. */
  fur: number;
  /** Spines or poison, from 0 (none) to 1: whatever bites it is hurt in return. Costs energy to keep. */
  defense: number;
  /** Standard deviation of the changes applied to each gene at birth. */
  mutationRate: number;
}

/** Hue shifts by this fraction of the mutation rate, slowly enough that relatives look alike. */
const HUE_MUTATION_SCALE = 0.5;

/**
 * Clamp a gene to its limits. The result is rounded to 32-bit precision, the
 * precision genes are stored at, so energy sums computed from a fresh gene
 * and from the stored one agree exactly.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.fround(Math.min(max, Math.max(min, value)));
}

/** Genes for a creature with no parent: average traits, no fur or defenses, a random diet and a random colour. */
export function founderGenes(rng: Rng, config: SimConfig): Genes {
  return mutateGenes(
    {
      size: 1,
      speed: 1,
      sensorRange: 1,
      diet: rng.float() * config.founderDietMax,
      hue: rng.float(),
      fur: 0,
      defense: 0,
      mutationRate: config.initialMutationRate,
    },
    rng,
    config,
  );
}

/**
 * The genes of a child of two: each gene comes whole from one parent or the
 * other at random (the mutation rate is their average), before mutation.
 */
export function crossGenes(a: Genes, b: Genes, rng: Rng): Genes {
  const pick = <K extends keyof Genes>(key: K): number => (rng.chance(0.5) ? a[key] : b[key]);
  return {
    size: pick('size'),
    speed: pick('speed'),
    sensorRange: pick('sensorRange'),
    diet: pick('diet'),
    hue: pick('hue'),
    fur: pick('fur'),
    defense: pick('defense'),
    mutationRate: Math.fround((a.mutationRate + b.mutationRate) / 2),
  };
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
    // Diet shifts by a fixed step rather than a factor, so it can reach and leave zero.
    diet: clamp(parent.diet + rng.gaussian() * rate, 0, 1),
    hue: Math.fround(hue - Math.floor(hue)) % 1,
    // Like diet, fur shifts by a fixed step so it can grow from nothing.
    fur: clamp(parent.fur + rng.gaussian() * rate, 0, 1),
    defense: clamp(parent.defense + rng.gaussian() * rate, 0, 1),
    mutationRate: clamp(
      rate * Math.exp(rng.gaussian() * rate),
      config.minMutationRate,
      config.maxMutationRate,
    ),
  };
}

/** Energy locked up in a body of this size. It becomes meat when the creature dies. */
export function bodyEnergyFor(size: number, config: SimConfig): number {
  return config.bodyEnergy * size * size;
}

/**
 * Share of a full bite this diet gets from plants and from meat. The curves
 * bow outward: a creature loses little of its main food by taking up a bit of
 * the other, so diets can shift in small steps instead of needing a leap.
 */
export function plantDigestion(diet: number): number {
  return 1 - diet * diet;
}

export function meatDigestion(diet: number): number {
  return 1 - (1 - diet) * (1 - diet);
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

/** Energy a body of this size spends per tick just staying alive. */
export function upkeepFor(size: number, config: SimConfig): number {
  const fixed = config.upkeepFixedShare;
  return config.upkeepCost * (fixed + (1 - fixed) * size * Math.sqrt(size));
}

/**
 * How far a temperature is beyond what a body can comfortably bear: 0 when
 * comfortable, rising by 1 for each unit hotter or colder. Fur and a big body
 * both hold heat in, which helps in the cold and hurts in the heat.
 */
export function temperatureStress(temperature: number, size: number, fur: number, config: SimConfig): number {
  const held = config.sizeWarmth * (size - 1);
  const cold = -temperature - config.comfortBand - config.furWarmth * fur - held;
  const heat = temperature - config.comfortBand + config.furHeat * fur + held;
  return Math.max(0, cold, heat);
}

/**
 * Extra energy per tick that the temperature and a coat of fur cost a body.
 * Both scale with its upkeep, so they weigh on big and small alike.
 */
export function climateCostFor(temperature: number, size: number, fur: number, config: SimConfig): number {
  return (
    upkeepFor(size, config) *
    (config.temperatureCost * temperatureStress(temperature, size, fur, config) + config.furCost * fur)
  );
}

/** Energy per tick that keeping up defenses costs a body. */
export function defenseCostFor(size: number, defense: number, config: SimConfig): number {
  return upkeepFor(size, config) * config.defenseCost * defense;
}

/**
 * Energy spent per tick. Part of upkeep is the same for any body, which
 * penalises tiny bodies that cover little ground; the rest grows faster with
 * size than the stride does, which penalises huge ones. Moving costs grow
 * with the square of speed, so speed pays off only where food is sparse.
 */
export function tickCostFor(size: number, speed: number, thrust: number, config: SimConfig): number {
  return upkeepFor(size, config) + moveCostFor(size, speed, thrust, config);
}

/**
 * Energy spent per tick on moving. A body built for speed is costly per unit
 * of distance even when it ambles, so the speed gene is not a free option to
 * hold in reserve.
 */
export function moveCostFor(size: number, speed: number, thrust: number, config: SimConfig): number {
  return config.moveCost * config.creatureSpeed * size * size * speed * speed * thrust;
}
