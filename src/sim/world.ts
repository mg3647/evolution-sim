import type { SimConfig } from './config';
import { Rng } from './rng';

export interface World {
  config: SimConfig;
  tick: number;
  rng: Rng;
}

export function createWorld(config: SimConfig): World {
  return {
    config: { ...config },
    tick: 0,
    rng: new Rng(config.seed),
  };
}

/** Advance the world by one fixed timestep. */
export function step(world: World): void {
  world.tick++;
}

/** Wrap a coordinate into [0, size) for the toroidal world. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Shortest signed distance from a to b along one wrapped axis. */
export function wrappedDelta(a: number, b: number, size: number): number {
  let d = (b - a) % size;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/**
 * Hash of the full world state (FNV-1a over its numbers). Two worlds with the
 * same hash are, for testing purposes, in the same state.
 */
export function hashWorld(world: World): number {
  const s = world.rng.getState();
  const values = [world.tick, s.a, s.b, s.c, s.d];
  let h = 2166136261;
  for (const v of values) {
    for (let shift = 0; shift < 32; shift += 8) {
      h ^= (v >>> shift) & 0xff;
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}
