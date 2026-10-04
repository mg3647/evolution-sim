import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { maxEnergyFor } from './genome';
import { wrappedDelta } from './geometry';
import { expectedEnergy } from './ledger';
import { totalMeatEnergy } from './plants';
import { createWorld, hashWorld, step, totalEnergy } from './world';

/** A small world so tests run fast. */
const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 60,
  minPopulation: 5,
  maxCreatures: 500,
};

/** Switches that isolate one mechanism at a time. */
const noBirths = { reproduceThreshold: 2 };
const noReseed = { minPopulation: 0 };
const noFighting = { attackDamage: 0 };

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
    expect(hashWorld(runWorld({ seed: 'same' }, 1500))).toBe(hashWorld(runWorld({ seed: 'same' }, 1500)));
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

  it('starts with the configured number of parentless creatures inside the world', () => {
    const world = createWorld(smallConfig);
    const { creatures } = world;
    expect(creatures.count).toBe(smallConfig.initialCreatures);
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.x[i]).toBeGreaterThanOrEqual(0);
      expect(creatures.x[i]).toBeLessThanOrEqual(smallConfig.worldWidth);
      expect(creatures.y[i]).toBeGreaterThanOrEqual(0);
      expect(creatures.y[i]).toBeLessThanOrEqual(smallConfig.worldHeight);
      expect(creatures.parentId[i]).toBe(0);
      expect(creatures.generation[i]).toBe(0);
    }
  });
});

describe('energy economy', () => {
  it('conserves energy through growth, births, deaths and reseeding', () => {
    const world = createWorld(smallConfig);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    for (let i = 0; i < 6000; i++) {
      step(world);
      if (i % 250 === 0) expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    }
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    expect(world.ledger.sunIn).toBeGreaterThan(0);
    expect(world.ledger.heatOut).toBeGreaterThan(0);
    expect(world.births).toBeGreaterThan(0);
    expect(world.deaths.starved + world.deaths.oldAge + world.deaths.killed).toBeGreaterThan(0);
  });

  it('never lets energy go negative or exceed its caps', () => {
    const world = runWorld({}, 2500);
    const { creatures, plants } = world;
    expect(creatures.count).toBeGreaterThan(0);
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.energy[i]).toBeGreaterThan(0);
      expect(creatures.energy[i]).toBeLessThanOrEqual(maxEnergyFor(creatures.size[i]!, world.config) + 1e-9);
    }
    for (let i = 0; i < plants.energy.length; i++) {
      expect(plants.energy[i]).toBeGreaterThanOrEqual(0);
      expect(plants.energy[i]).toBeLessThanOrEqual(plants.capacity[i]! + 1e-9);
    }
  });

  it('starves every creature when nothing grows', () => {
    const world = runWorld({ plantCapacity: 0, ...noReseed, ...noFighting }, 3000);
    expect(world.creatures.count).toBe(0);
    // A small founder can hold enough to split once before it starves.
    expect(world.deaths.starved).toBe(smallConfig.initialCreatures + world.births);
    // All that is left is the meat of their bodies, rotting away.
    expect(totalEnergy(world)).toBeCloseTo(totalMeatEnergy(world.plants), 9);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('kills creatures of old age', () => {
    const world = runWorld({ maxAge: 200, upkeepCost: 0, moveCost: 0, ...noBirths, ...noReseed, ...noFighting }, 200);
    expect(world.creatures.count).toBe(0);
    expect(world.deaths.oldAge).toBe(smallConfig.initialCreatures);
  });

  it('keeps every creature number finite, even in a barren world', () => {
    for (const overrides of [{}, { plantCapacity: 0 }]) {
      const { creatures } = runWorld(overrides, 300);
      for (let i = 0; i < creatures.count; i++) {
        expect(Number.isFinite(creatures.energy[i])).toBe(true);
        expect(Number.isFinite(creatures.x[i])).toBe(true);
        expect(Number.isFinite(creatures.heading[i])).toBe(true);
        for (const v of creatures.brain[i]!.activation) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('lets grazing creatures eat plants down', () => {
    const before = createWorld(smallConfig);
    const after = runWorld({}, 300);
    const sum = (a: Float64Array) => a.reduce((t, v) => t + v, 0);
    expect(sum(after.plants.energy)).toBeLessThan(sum(before.plants.energy));
  });
});

describe('reproduction', () => {
  it('produces children that record their parent and generation', () => {
    const world = runWorld({}, 1500);
    const { creatures } = world;
    expect(world.births).toBeGreaterThan(0);
    let children = 0;
    for (let i = 0; i < creatures.count; i++) {
      if (creatures.parentId[i] === 0) {
        expect(creatures.generation[i]).toBe(0);
      } else {
        children++;
        expect(creatures.generation[i]).toBeGreaterThan(0);
        expect(creatures.parentId[i]).toBeLessThan(creatures.id[i]!);
      }
    }
    expect(children).toBeGreaterThan(0);
  });

  it('places a child just behind its parent, not on top of it', () => {
    const world = createWorld(smallConfig);
    const { creatures, config } = world;
    while (world.births === 0) step(world);
    const child = creatures.count - 1;
    const parent = creatures.id.subarray(0, creatures.count).indexOf(creatures.parentId[child]!);
    expect(parent).toBeGreaterThanOrEqual(0);
    const dx = wrappedDelta(creatures.x[parent]!, creatures.x[child]!, config.worldWidth);
    const dy = wrappedDelta(creatures.y[parent]!, creatures.y[child]!, config.worldHeight);
    const gap = config.creatureRadius * (creatures.size[parent]! + creatures.size[child]!);
    expect(Math.hypot(dx, dy)).toBeCloseTo(gap, 3);
  });

  it('does not happen when the threshold is out of reach', () => {
    expect(runWorld(noBirths, 1500).births).toBe(0);
  });

  it('stops at the population cap', () => {
    const world = createWorld({ ...smallConfig, maxCreatures: 80, upkeepCost: 0, moveCost: 0 });
    for (let i = 0; i < 2000; i++) {
      step(world);
      expect(world.creatures.count).toBeLessThanOrEqual(80);
    }
    expect(world.creatures.count).toBe(80);
  });

  it('introduces variation in size and speed', () => {
    const { creatures } = runWorld({}, 3000);
    const sizes = new Set(creatures.size.subarray(0, creatures.count));
    const speeds = new Set(creatures.speed.subarray(0, creatures.count));
    expect(sizes.size).toBeGreaterThan(5);
    expect(speeds.size).toBeGreaterThan(5);
  });
});

describe('fighting', () => {
  it('kills, and leaves the body and its store behind as meat', () => {
    // Nothing to eat but each other, and no rot, so every death can be accounted for.
    const world = createWorld({ ...smallConfig, plantCapacity: 0, meatDecayRate: 0, attackDamage: 1, ...noReseed });
    let killed = 0;
    for (let i = 0; i < 400 && killed === 0; i++) {
      step(world);
      killed = world.deaths.killed;
    }
    expect(killed).toBeGreaterThan(0);
    expect(totalMeatEnergy(world.plants)).toBeGreaterThan(0);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('never happens when bites do no damage', () => {
    expect(runWorld(noFighting, 1500).deaths.killed).toBe(0);
  });

  it('keeps health between 0 and 1 and heals over time', () => {
    const world = runWorld({}, 800);
    const { creatures } = world;
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.health[i]).toBeGreaterThan(0);
      expect(creatures.health[i]).toBeLessThanOrEqual(1);
    }
    const hurt = createWorld({ ...smallConfig, ...noFighting });
    hurt.creatures.health[0] = 0.5;
    const id = hurt.creatures.id[0];
    for (let i = 0; i < 100; i++) step(hurt);
    const index = hurt.creatures.id.indexOf(id!);
    if (index >= 0 && index < hurt.creatures.count) {
      expect(hurt.creatures.health[index]).toBeCloseTo(0.5 + 100 * smallConfig.healRate, 5);
    }
  });
});

describe('reseeding', () => {
  it('tops a dying world back up to the minimum population', () => {
    const world = runWorld({ plantCapacity: 0, minPopulation: 5 }, 1500);
    expect(world.creatures.count).toBe(5);
    expect(world.reseeded).toBeGreaterThan(0);
    expect(world.ledger.seedIn).toBeGreaterThan(0);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });
});

describe('history', () => {
  it('samples the population at the configured interval', () => {
    const world = runWorld({ statsInterval: 50 }, 500);
    expect(world.history.count).toBe(11);
    expect(world.history.tick[0]).toBe(0);
    expect(world.history.tick[10]).toBe(500);
    expect(world.history.population[0]).toBe(smallConfig.initialCreatures);
    expect(world.history.meanSize[10]).toBeGreaterThan(0);
  });
});
