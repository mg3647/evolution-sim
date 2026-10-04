import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { createWorld, hashWorld, step, wrap, wrappedDelta } from './world';

function runWorld(seed: string, ticks: number) {
  const world = createWorld({ ...defaultConfig, seed });
  for (let i = 0; i < ticks; i++) step(world);
  return world;
}

describe('world', () => {
  it('advances one tick per step', () => {
    expect(runWorld('a', 250).tick).toBe(250);
  });

  it('is deterministic: same seed and tick count give the same state', () => {
    expect(hashWorld(runWorld('same', 1000))).toBe(hashWorld(runWorld('same', 1000)));
  });

  it('differs across seeds and across tick counts', () => {
    expect(hashWorld(runWorld('one', 100))).not.toBe(hashWorld(runWorld('two', 100)));
    expect(hashWorld(runWorld('one', 100))).not.toBe(hashWorld(runWorld('one', 101)));
  });

  it('does not share config with the caller', () => {
    const config = { ...defaultConfig };
    const world = createWorld(config);
    config.worldWidth = 1;
    expect(world.config.worldWidth).toBe(defaultConfig.worldWidth);
  });
});

describe('wrapping', () => {
  it('wraps coordinates into [0, size)', () => {
    expect(wrap(5, 100)).toBe(5);
    expect(wrap(105, 100)).toBe(5);
    expect(wrap(-5, 100)).toBe(95);
    expect(wrap(100, 100)).toBe(0);
    expect(wrap(-200, 100)).toBe(0);
  });

  it('finds the shortest signed distance across the edge', () => {
    expect(wrappedDelta(10, 30, 100)).toBe(20);
    expect(wrappedDelta(30, 10, 100)).toBe(-20);
    expect(wrappedDelta(95, 5, 100)).toBe(10);
    expect(wrappedDelta(5, 95, 100)).toBe(-10);
  });
});
