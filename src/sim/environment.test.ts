import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { climateAt, seasonAt, spreadScent } from './environment';
import { wrappedDelta } from './geometry';
import { expectedEnergy } from './ledger';
import { cellIndexAt, totalPlantEnergy } from './plants';
import { clearWorldWalls, createWorld, hashWorld, step, totalEnergy, triggerWorldEvent } from './world';

const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 80,
  minPopulation: 0,
};

describe('seasons', () => {
  it('swing sunlight around 1 by the configured strength, once a year', () => {
    const config = { ...defaultConfig, seasonLength: 1000, seasonStrength: 0.4 };
    expect(seasonAt(0, config)).toBeCloseTo(1, 9);
    expect(seasonAt(250, config)).toBeCloseTo(1.4, 9);
    expect(seasonAt(750, config)).toBeCloseTo(0.6, 9);
    expect(seasonAt(1250, config)).toBeCloseTo(1.4, 9);
  });

  it('can be turned off', () => {
    expect(seasonAt(123, { ...defaultConfig, seasonLength: 0 })).toBe(1);
  });

  it('make plants grow faster in summer than in winter', () => {
    const grown = (tick: number) => {
      const world = createWorld({ ...smallConfig, initialCreatures: 0, seasonLength: 1000 });
      world.plants.energy.fill(0);
      world.tick = tick;
      const before = world.ledger.sunIn;
      step(world);
      return world.ledger.sunIn - before;
    };
    expect(grown(250)).toBeGreaterThan(grown(750) * 1.5);
  });
});

describe('timed events', () => {
  it('change the climate while they run and end on time', () => {
    const world = createWorld({ ...smallConfig, seasonLength: 0, droughtLength: 100 });
    triggerWorldEvent(world, 'drought');
    step(world);
    expect(world.climate.growth).toBeCloseTo(smallConfig.droughtGrowth, 9);
    for (let i = 0; i < 100; i++) step(world);
    expect(world.climate.growth).toBe(1);
    expect(world.environment.active).toEqual([]);
    expect(world.environment.log.map((entry) => entry.text)).toEqual(['Drought began', 'Drought ended']);
  });

  it('stack with each other, and an ice age also raises the cost of living', () => {
    const world = createWorld({ ...smallConfig, seasonLength: 0 });
    triggerWorldEvent(world, 'iceAge');
    triggerWorldEvent(world, 'foodBoom');
    const climate = climateAt(world.environment, world.tick, world.config);
    expect(climate.growth).toBeCloseTo(smallConfig.iceAgeGrowth * smallConfig.foodBoomGrowth, 9);
    expect(climate.cost).toBe(smallConfig.iceAgeCost);
  });

  it('run longer when triggered again while already running', () => {
    const world = createWorld({ ...smallConfig, droughtLength: 100 });
    triggerWorldEvent(world, 'drought');
    triggerWorldEvent(world, 'drought');
    expect(world.environment.active).toEqual([{ kind: 'drought', endTick: 200 }]);
  });
});

describe('plague', () => {
  it('strikes one colour family and leaves the rest', () => {
    const world = createWorld({ ...smallConfig, plagueLethality: 1, attackDamage: 0 });
    const { creatures } = world;
    const huesBefore = Array.from(creatures.hue.subarray(0, creatures.count));
    triggerWorldEvent(world, 'plague');
    step(world);

    const dead = world.deaths.disaster;
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThan(huesBefore.length);
    // Survivors' hues leave a gap as wide as the plague around where the dead were.
    const survivors = new Set(Array.from(creatures.hue.subarray(0, creatures.count)));
    const struckHues = huesBefore.filter((hue) => !survivors.has(hue));
    const centre = struckHues[0]!;
    for (const hue of struckHues) {
      expect(Math.abs(wrappedDelta(centre, hue, 1))).toBeLessThanOrEqual(2 * smallConfig.plagueHueWidth + 1e-6);
    }
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });
});

describe('meteor', () => {
  it('kills creatures and burns the ground inside its radius, conserving energy', () => {
    const world = createWorld({ ...smallConfig, meteorRadius: 300, attackDamage: 0 });
    const plantsBefore = totalPlantEnergy(world.plants);
    const countBefore = world.creatures.count;
    triggerWorldEvent(world, 'meteor');
    expect(totalPlantEnergy(world.plants)).toBeLessThan(plantsBefore);
    step(world);
    expect(world.deaths.disaster).toBeGreaterThan(0);
    expect(world.creatures.count).toBe(countBefore - world.deaths.disaster - world.deaths.starved);
    expect(world.environment.log[0]!.text).toMatch(/^Meteor killed \d+ creatures$/);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });
});

describe('walls', () => {
  it('are raised by the wall event and removed by clearing', () => {
    const world = createWorld(smallConfig);
    triggerWorldEvent(world, 'wall');
    const cells = world.plants.walls.reduce((total, cell) => total + cell, 0);
    expect(cells).toBeGreaterThan(5);
    expect(cells).toBeLessThan(world.plants.walls.length / 4);
    clearWorldWalls(world);
    expect(world.plants.walls.every((cell) => cell === 0)).toBe(true);
  });

  it('stop creatures from entering walled cells', () => {
    const world = createWorld({ ...smallConfig, reproduceThreshold: 2, attackDamage: 0 });
    const { creatures, plants } = world;
    // Wall off everything except the cells creatures start in.
    plants.walls.fill(1);
    const home = new Map<number, number>();
    for (let i = 0; i < creatures.count; i++) {
      const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
      plants.walls[cell] = 0;
      home.set(creatures.id[i]!, cell);
    }
    for (let t = 0; t < 200; t++) step(world);
    expect(creatures.count).toBeGreaterThan(0);
    for (let i = 0; i < creatures.count; i++) {
      const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
      expect(plants.walls[cell]).toBe(0);
    }
  });
});

describe('fertility drift', () => {
  it('moves the map to a new one over the drift period and keeps plants within capacity', () => {
    const world = createWorld({
      ...smallConfig,
      initialCreatures: 0,
      fertilityDriftPeriod: 400,
      fertilityUpdateInterval: 20,
    });
    const start = world.plants.fertility.slice();
    const target = world.environment.fertilityTo.slice();
    expect(Array.from(target)).not.toEqual(Array.from(start));
    for (let t = 0; t < 380; t++) step(world);
    const { fertility, capacity, energy } = world.plants;
    let towardTarget = 0;
    let fromStart = 0;
    let capacityTotal = 0;
    for (let i = 0; i < fertility.length; i++) {
      towardTarget += Math.abs(fertility[i]! - target[i]!);
      fromStart += Math.abs(fertility[i]! - start[i]!);
      capacityTotal += capacity[i]!;
      expect(energy[i]).toBeLessThanOrEqual(capacity[i]! + 1e-9);
    }
    expect(towardTarget).toBeLessThan(fromStart / 10);
    expect(world.plantCapacityTotal).toBeCloseTo(capacityTotal, 6);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('can be turned off', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 0, fertilityDriftPeriod: 0 });
    const start = world.plants.fertility.slice();
    for (let t = 0; t < 300; t++) step(world);
    expect(world.plants.fertility).toEqual(start);
  });
});

describe('scent', () => {
  it('fades, seeps into neighboring cells and wraps around the edge', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 0 });
    const { plants, environment, config } = world;
    plants.scent[0] = 1;
    spreadScent(environment, plants, config);
    const scent = world.plants.scent;
    expect(scent[0]).toBeLessThan(1);
    expect(scent[1]).toBeGreaterThan(0);
    expect(scent[plants.cols - 1]).toBeGreaterThan(0);
    expect(scent[plants.cols * (plants.rows - 1)]).toBeGreaterThan(0);
    const total = scent.reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1 - config.scentDecay, 5);
  });

  it('eventually disappears', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 0 });
    world.plants.scent[5] = 1;
    for (let t = 0; t < 3000; t++) spreadScent(world.environment, world.plants, world.config);
    expect(world.plants.scent.every((value) => value === 0)).toBe(true);
  });
});

describe('random events', () => {
  const random = { ...smallConfig, randomEvents: true, randomEventInterval: 100, minPopulation: 5 };

  it('strike when switched on, and never when off', () => {
    const on = createWorld(random);
    const off = createWorld({ ...random, randomEvents: false });
    for (let t = 0; t < 2000; t++) {
      step(on);
      step(off);
    }
    expect(on.environment.log.length).toBeGreaterThan(3);
    expect(off.environment.log).toEqual([]);
  });

  it('keep the run deterministic and the energy books balanced', () => {
    const run = () => {
      const world = createWorld(random);
      for (let t = 0; t < 3000; t++) step(world);
      return world;
    };
    const a = run();
    expect(hashWorld(a)).toBe(hashWorld(run()));
    expect(totalEnergy(a)).toBeCloseTo(expectedEnergy(a.ledger), 5);
  });
});
