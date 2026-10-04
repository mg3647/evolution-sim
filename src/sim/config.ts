/**
 * Every tunable constant of the simulation lives here. The config is passed
 * in when a world is created; sim code never reads it as a global.
 */

export interface SimConfig {
  /** Seed for the world's random number generator. */
  seed: string;
  /** World size in world units. The world wraps at both edges. */
  worldWidth: number;
  worldHeight: number;
  /** Simulation ticks per second at 1x speed. */
  ticksPerSecond: number;
}

export const defaultConfig: SimConfig = {
  seed: 'genesis',
  worldWidth: 2000,
  worldHeight: 2000,
  ticksPerSecond: 30,
};
