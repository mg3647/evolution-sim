/**
 * Every tunable constant of the simulation lives here. The config is passed
 * in when a world is created; sim code never reads it as a global.
 *
 * Units: distances are world units, time is ticks, energy is abstract.
 */

export interface SimConfig {
  /** Seed for the world's random number generator. */
  seed: string;
  /** World size in world units. The world wraps at both edges. */
  worldWidth: number;
  worldHeight: number;
  /** Simulation ticks per second at 1x speed. */
  ticksPerSecond: number;

  /** Side of one plant-field cell. Rounded so cells tile the world exactly. */
  plantCellSize: number;
  /** Plant energy a cell holds when full, at fertility 1. */
  plantCapacity: number;
  /** Fraction of a cell's missing plant energy that regrows per tick, at best. */
  plantGrowthRate: number;
  /** Growth speed of a cell grazed bare, as a fraction of the best speed. */
  plantBareGrowth: number;
  /** Fertility below this is barren; raises contrast between rich and poor land. */
  fertilityFloor: number;

  initialCreatures: number;
  creatureStartEnergy: number;
  /** Most energy a creature of size 1 can store. Scales with size squared. */
  creatureMaxEnergy: number;
  /** Radius of a creature of size 1. */
  creatureRadius: number;
  /** Distance moved per tick at speed 1. */
  creatureSpeed: number;
  /** Largest random heading change per tick, in radians. */
  wanderTurn: number;
  /** Energy a creature of size 1 spends per tick just staying alive. */
  upkeepCost: number;
  /** Share of upkeep that every body pays regardless of its size. */
  upkeepFixedShare: number;
  /** Energy a creature of size 1 and speed 1 spends per unit of distance moved. */
  moveCost: number;
  /** Most plant energy a creature of size 1 can eat per tick. */
  biteSize: number;
  /** Creatures die of old age at this many ticks. */
  maxAge: number;

  /** A creature reproduces when its energy reaches this fraction of its maximum. */
  reproduceThreshold: number;
  /** Fraction of the parent's energy handed to the child. */
  offspringShare: number;
  /** Fraction of the handed-over energy lost as heat. */
  birthCost: number;
  /** Creatures younger than this many ticks cannot reproduce. */
  minReproduceAge: number;
  /** No births happen while the population is at this size. */
  maxCreatures: number;
  /** Below this population, new parentless creatures are added. */
  minPopulation: number;

  /** Gene limits. Size and speed are multipliers on the base values above. */
  minSize: number;
  maxSize: number;
  minSpeed: number;
  maxSpeed: number;
  /** Mutation rate of creatures with no parent. */
  initialMutationRate: number;
  minMutationRate: number;
  maxMutationRate: number;

  /** Ticks between history samples at the start of a run. */
  statsInterval: number;
  /** Number of history samples kept. */
  statsCapacity: number;
}

export const defaultConfig: SimConfig = {
  seed: 'genesis',
  worldWidth: 2000,
  worldHeight: 2000,
  ticksPerSecond: 30,

  plantCellSize: 20,
  plantCapacity: 12,
  plantGrowthRate: 0.006,
  plantBareGrowth: 0.1,
  fertilityFloor: 0.3,

  initialCreatures: 400,
  creatureStartEnergy: 40,
  creatureMaxEnergy: 100,
  creatureRadius: 5,
  creatureSpeed: 1.5,
  wanderTurn: 0.3,
  upkeepCost: 0.12,
  upkeepFixedShare: 0.5,
  moveCost: 0.05,
  biteSize: 1,
  maxAge: 9000,

  reproduceThreshold: 0.6,
  offspringShare: 0.5,
  birthCost: 0.1,
  minReproduceAge: 150,
  maxCreatures: 5000,
  minPopulation: 20,

  minSize: 0.4,
  maxSize: 3,
  minSpeed: 0.2,
  maxSpeed: 4,
  initialMutationRate: 0.08,
  minMutationRate: 0.005,
  maxMutationRate: 0.5,

  statsInterval: 30,
  statsCapacity: 1000,
};
