import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { climateAt, seasonAt, spreadScent } from './environment';
import { wrappedDelta } from './geometry';
import { expectedEnergy } from './ledger';
import { cellIndexAt, totalPlantEnergy } from './plants';
import { applyTool, clearWorldWalls, createWorld, hashWorld, step, totalEnergy, triggerWorldEvent } from './world';

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
  /** A crowded world where nothing else kills, so the disease can be watched alone. */
  const crowded: SimConfig = {
    ...smallConfig,
    worldWidth: 300,
    worldHeight: 300,
    initialCreatures: 120,
    attackDamage: 0,
    reproduceThreshold: 2,
    upkeepCost: 0,
    moveCost: 0,
    senseCost: 0,
    maxAge: 100000,
  };
  const infected = (world: ReturnType<typeof createWorld>) =>
    Array.from(world.creatures.sick.subarray(0, world.creatures.count)).filter((s) => s > 0).length;

  it('starts by infecting a few creatures and logs the outbreak', () => {
    const world = createWorld(crowded);
    triggerWorldEvent(world, 'plague');
    const seeds = infected(world);
    expect(seeds).toBeGreaterThanOrEqual(3);
    expect(seeds).toBeLessThanOrEqual(Math.round(120 * crowded.plagueSeedShare));
    expect(world.environment.log[0]!.text).toBe(`Plague broke out: ${seeds} infected`);
  });

  it('spreads by contact through a crowd', () => {
    const world = createWorld({ ...crowded, plagueDeathChance: 0 });
    triggerWorldEvent(world, 'plague');
    const seeds = infected(world);
    for (let t = 0; t < 150; t++) step(world);
    expect(infected(world)).toBeGreaterThan(seeds * 3);
  });

  it('does not spread when it cannot be passed on', () => {
    const world = createWorld({ ...crowded, plagueTransmission: 0, plagueDeathChance: 0 });
    triggerWorldEvent(world, 'plague');
    const seeds = infected(world);
    for (let t = 0; t < 150; t++) step(world);
    expect(infected(world)).toBe(seeds);
  });

  it('kills some of the sick, counted as disaster deaths, and conserves energy', () => {
    const world = createWorld({ ...crowded, plagueDeathChance: 0.01 });
    triggerWorldEvent(world, 'plague');
    for (let t = 0; t < 600; t++) step(world);
    expect(world.deaths.disaster).toBeGreaterThan(0);
    expect(world.deaths.killed).toBe(0);
    expect(world.creatures.count).toBe(120 - world.deaths.disaster - world.deaths.starved);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('ends in recovery and immunity, and the immune cannot be reinfected', () => {
    const world = createWorld({ ...crowded, plagueDeathChance: 0, plagueDuration: 50 });
    triggerWorldEvent(world, 'plague');
    for (let t = 0; t < 600; t++) step(world);
    expect(infected(world)).toBe(0);
    const { creatures } = world;
    const immune = Array.from(creatures.sick.subarray(0, creatures.count)).filter((s) => s < 0).length;
    expect(immune).toBeGreaterThan(60);

    triggerWorldEvent(world, 'plague');
    for (let i = 0; i < creatures.count; i++) {
      if (creatures.sick[i]! > 0) expect(creatures.sick[i]).toBe(world.config.plagueDuration);
    }
    expect(infected(world)).toBeLessThanOrEqual(creatures.count - immune);
  });

  it('slows the sick', () => {
    const moved = (sick: boolean) => {
      const world = createWorld({ ...crowded, initialCreatures: 40, plagueTransmission: 0, plagueDeathChance: 0 });
      const { creatures } = world;
      if (sick) creatures.sick.fill(1000);
      let distance = 0;
      for (let t = 0; t < 20; t++) {
        const before = Array.from(creatures.x.subarray(0, creatures.count));
        step(world);
        for (let i = 0; i < creatures.count; i++) {
          distance += Math.abs(wrappedDelta(before[i]!, creatures.x[i]!, world.config.worldWidth));
        }
      }
      return distance;
    };
    expect(moved(true)).toBeLessThan(moved(false) * 0.7);
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

  it('let a blocked creature slide along the wall instead of stopping', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 1, reproduceThreshold: 2, founderLinks: 0 });
    const { creatures, plants } = world;
    // A wall across the whole world along the row below the creature.
    creatures.x[0] = 210;
    creatures.y[0] = 210;
    creatures.heading[0] = Math.PI / 4;
    const wallRow = Math.floor(210 / plants.cellHeight) + 1;
    for (let cx = 0; cx < plants.cols; cx++) plants.walls[wallRow * plants.cols + cx] = 1;
    // With no links the brain holds thrust at half and never turns: it heads down and right.
    for (let t = 0; t < 120; t++) step(world);
    expect(creatures.count).toBe(1);
    expect(creatures.y[0]).toBeLessThan(wallRow * plants.cellHeight);
    expect(creatures.y[0]).toBeGreaterThan(wallRow * plants.cellHeight - 3);
    expect(wrappedDelta(210, creatures.x[0]!, world.config.worldWidth)).toBeGreaterThan(40);
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

describe('hand tools', () => {
  const quiet = { ...smallConfig, attackDamage: 0, fertilityDriftPeriod: 0 };

  it('meteor strikes where it is aimed and nowhere else', () => {
    const world = createWorld({ ...quiet, meteorRadius: 100 });
    const { creatures, config } = world;
    const inside = (i: number) =>
      Math.hypot(
        wrappedDelta(400, creatures.x[i]!, config.worldWidth),
        wrappedDelta(400, creatures.y[i]!, config.worldHeight),
      ) <= 100;
    const doomed = new Set<number>();
    const safe = new Set<number>();
    for (let i = 0; i < creatures.count; i++) (inside(i) ? doomed : safe).add(creatures.id[i]!);
    expect(doomed.size).toBeGreaterThan(0);

    applyTool(world, 'meteor', 400, 400, 400, 400);
    expect(world.plants.energy[cellIndexAt(world.plants, 400, 400)]).toBe(0);
    step(world);
    expect(world.deaths.disaster).toBe(doomed.size);
    const alive = new Set(Array.from(creatures.id.subarray(0, creatures.count)));
    for (const id of doomed) expect(alive.has(id)).toBe(false);
    expect(world.environment.log[0]!.text).toBe(`Meteor killed ${doomed.size} creatures`);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
    expect(safe.size).toBeGreaterThan(0);
  });

  it('plague infects the creatures within reach of the point, and only those', () => {
    const world = createWorld(quiet);
    const { creatures, config } = world;
    applyTool(world, 'plague', 400, 400, 400, 400);
    let infected = 0;
    for (let i = 0; i < creatures.count; i++) {
      const near =
        Math.hypot(
          wrappedDelta(400, creatures.x[i]!, config.worldWidth),
          wrappedDelta(400, creatures.y[i]!, config.worldHeight),
        ) <= config.plagueToolRadius;
      expect(creatures.sick[i]! > 0).toBe(near);
      if (near) infected++;
    }
    expect(infected).toBeGreaterThan(0);
    expect(world.environment.plagueActive).toBe(true);
    expect(world.environment.log[0]!.text).toBe(`Plague broke out: ${infected} infected`);
  });

  it('wall draws along a drag and erase removes it', () => {
    const world = createWorld(quiet);
    const { plants } = world;
    applyTool(world, 'wall', 500, 300, 300, 300);
    for (let x = 300; x <= 500; x += 10) expect(plants.walls[cellIndexAt(plants, x, 300)]).toBe(1);
    expect(plants.walls[cellIndexAt(plants, 400, 500)]).toBe(0);
    applyTool(world, 'erase', 500, 300, 300, 300);
    expect(plants.walls.every((cell) => cell === 0)).toBe(true);
  });

  it('fertilise makes land fully fertile and blight makes it barren, both lasting', () => {
    const world = createWorld({ ...quiet, initialCreatures: 0, fertilityDriftPeriod: 2000, fertilityUpdateInterval: 50 });
    const { plants, config } = world;
    const here = cellIndexAt(plants, 400, 400);
    const far = cellIndexAt(plants, 100, 100);
    const farBefore = plants.fertility[far];

    applyTool(world, 'blight', 400, 400, 400, 400);
    expect(plants.fertility[here]).toBe(0);
    expect(plants.capacity[here]).toBe(0);
    expect(plants.energy[here]).toBe(0);
    expect(plants.fertility[far]).toBe(farBefore);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);

    applyTool(world, 'fertilise', 400, 400, 400, 400);
    expect(plants.fertility[here]).toBe(1);
    expect(plants.capacity[here]).toBe(config.plantCapacity);
    // Still fertile after the map has drifted for a while.
    for (let t = 0; t < 1500; t++) step(world);
    expect(plants.fertility[here]).toBe(1);
    expect(plants.energy[here]).toBeGreaterThan(config.plantCapacity * 0.5);
    expect(world.plantCapacityTotal).toBeCloseTo(
      plants.capacity.reduce((sum, value) => sum + value, 0),
      6,
    );
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
