import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { expectedEnergy } from './ledger';
import { createWorld, hashWorld, step, totalEnergy } from './world';

/** A small world so tests run fast. */
const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  initialCreatures: 60,
};

function runWorld(overrides: Partial<SimConfig>, ticks: number) {
  const world = createWorld({ ...smallConfig, ...overrides });
  for (let i = 0; i < ticks; i++) step(world);
  return world;
}

describe('world', () => {
  it('advances one tick per step', () => {
    expect(runWorld({}, 250).tick).toBe(250);
  });

  it('is deterministic: same seed and tick count give the same state', () => {
    expect(hashWorld(runWorld({ seed: 'same' }, 500))).toBe(hashWorld(runWorld({ seed: 'same' }, 500)));
  });

  it('differs across seeds and across tick counts', () => {
    expect(hashWorld(runWorld({ seed: 'one' }, 100))).not.toBe(hashWorld(runWorld({ seed: 'two' }, 100)));
    expect(hashWorld(runWorld({ seed: 'one' }, 100))).not.toBe(hashWorld(runWorld({ seed: 'one' }, 101)));
  });

  it('does not share config with the caller', () => {
    const config = { ...smallConfig };
    const world = createWorld(config);
    config.worldWidth = 1;
    expect(world.config.worldWidth).toBe(smallConfig.worldWidth);
  });

  it('starts with the configured number of creatures inside the world', () => {
    const world = createWorld(smallConfig);
    const { creatures } = world;
    expect(creatures.count).toBe(smallConfig.initialCreatures);
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.x[i]).toBeGreaterThanOrEqual(0);
      expect(creatures.x[i]).toBeLessThanOrEqual(smallConfig.worldWidth);
      expect(creatures.y[i]).toBeGreaterThanOrEqual(0);
      expect(creatures.y[i]).toBeLessThanOrEqual(smallConfig.worldHeight);
    }
  });
});

describe('energy economy', () => {
  it('conserves energy: world total always matches the ledger', () => {
    const world = createWorld(smallConfig);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    for (let i = 0; i < 3000; i++) {
      step(world);
      if (i % 250 === 0) expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    }
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    expect(world.ledger.sunIn).toBeGreaterThan(0);
    expect(world.ledger.heatOut).toBeGreaterThan(0);
  });

  it('never lets energy go negative or exceed its caps', () => {
    const world = runWorld({}, 1500);
    const { creatures, plants } = world;
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.energy[i]).toBeGreaterThan(0);
      expect(creatures.energy[i]).toBeLessThanOrEqual(smallConfig.creatureMaxEnergy);
    }
    for (let i = 0; i < plants.energy.length; i++) {
      expect(plants.energy[i]).toBeGreaterThanOrEqual(0);
      expect(plants.energy[i]).toBeLessThanOrEqual(plants.capacity[i]! + 1e-9);
    }
  });

  it('starves every creature when nothing grows', () => {
    const world = runWorld({ plantCapacity: 0 }, 1000);
    expect(world.creatures.count).toBe(0);
    expect(world.deaths.starved).toBe(smallConfig.initialCreatures);
    expect(totalEnergy(world)).toBeCloseTo(0, 6);
  });

  it('kills creatures of old age', () => {
    const world = runWorld({ maxAge: 200, upkeepCost: 0, moveCost: 0 }, 200);
    expect(world.creatures.count).toBe(0);
    expect(world.deaths.oldAge).toBe(smallConfig.initialCreatures);
  });

  it('lets grazing creatures eat plants down', () => {
    const before = createWorld(smallConfig);
    const after = runWorld({}, 300);
    const sum = (a: Float64Array) => a.reduce((t, v) => t + v, 0);
    expect(sum(after.plants.energy)).toBeLessThan(sum(before.plants.energy));
  });
});
