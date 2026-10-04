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
  /** Fraction of a cell's missing plant energy that regrows per tick. */
  plantGrowthRate: number;
  /** Fertility below this is barren; raises contrast between rich and poor land. */
  fertilityFloor: number;

  initialCreatures: number;
  creatureStartEnergy: number;
  /** A creature cannot store more than this. */
  creatureMaxEnergy: number;
  creatureRadius: number;
  /** Distance moved per tick. */
  creatureSpeed: number;
  /** Largest random heading change per tick, in radians. */
  wanderTurn: number;
  /** Energy spent per tick just staying alive. */
  upkeepCost: number;
  /** Energy spent per unit of distance moved. */
  moveCost: number;
  /** Most plant energy a creature can eat per tick. */
  biteSize: number;
  /** Creatures die of old age at this many ticks. */
  maxAge: number;
}

export const defaultConfig: SimConfig = {
  seed: 'genesis',
  worldWidth: 2000,
  worldHeight: 2000,
  ticksPerSecond: 30,

  plantCellSize: 20,
  plantCapacity: 12,
  plantGrowthRate: 0.001,
  fertilityFloor: 0.3,

  initialCreatures: 400,
  creatureStartEnergy: 40,
  creatureMaxEnergy: 100,
  creatureRadius: 5,
  creatureSpeed: 1.5,
  wanderTurn: 0.3,
  upkeepCost: 0.05,
  moveCost: 0.02,
  biteSize: 1,
  maxAge: 9000,
};
