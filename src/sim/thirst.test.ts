import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { expectedEnergy } from './ledger';
import { cellIndexAt, waterDerived } from './plants';
import { createWorld, step, totalEnergy, type World } from './world';

const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 60,
  minPopulation: 0,
  attackDamage: 0,
  reproduceThreshold: 2,
};

/** Replace a world's water with the given cells, and bring everything derived from it up to date. */
function setWater(world: World, wet: (x: number, y: number) => boolean): void {
  const { plants, config } = world;
  const water = new Uint8Array(plants.cols * plants.rows);
  for (let cy = 0; cy < plants.rows; cy++) {
    for (let cx = 0; cx < plants.cols; cx++) {
      if (wet((cx + 0.5) * plants.cellWidth, (cy + 0.5) * plants.cellHeight)) water[cy * plants.cols + cx] = 1;
    }
  }
  Object.assign(plants, waterDerived(water, plants.cols, plants.rows, config));
}

describe('water in the world', () => {
  it('covers about the configured share, grows no plants, and enriches the land beside it', () => {
    // Temperature off, so no biome makes land richer or poorer than its soil.
    const world = createWorld({ ...smallConfig, initialCreatures: 0, waterShare: 0.2, temperatureStrength: 0 });
    const { plants, config } = world;
    const wet = plants.water.reduce((sum, cell) => sum + cell, 0);
    expect(wet / plants.water.length).toBeCloseTo(0.2, 1);

    let shoreCapacity = 0;
    let shoreCells = 0;
    let inlandCapacity = 0;
    let inlandCells = 0;
    for (let i = 0; i < plants.water.length; i++) {
      if (plants.water[i]) {
        expect(plants.capacity[i]).toBe(0);
        expect(plants.energy[i]).toBe(0);
      } else if (plants.moisture[i]! > 0.8) {
        shoreCapacity += plants.capacity[i]!;
        shoreCells++;
      } else if (plants.moisture[i] === 0) {
        inlandCapacity += plants.capacity[i]!;
        inlandCells++;
      }
      expect(plants.capacity[i]).toBeLessThanOrEqual(config.plantCapacity);
    }
    expect(shoreCells).toBeGreaterThan(0);
    expect(inlandCells).toBeGreaterThan(0);
    expect(shoreCapacity / shoreCells).toBeGreaterThan(inlandCapacity / inlandCells);
  });

  it('keeps water bare through fertility drift and painting', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 0, fertilityDriftPeriod: 300, fertilityUpdateInterval: 20 });
    for (let t = 0; t < 400; t++) step(world);
    const { plants } = world;
    for (let i = 0; i < plants.water.length; i++) {
      if (plants.water[i]) expect(plants.energy[i]).toBe(0);
    }
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('starts founders on dry land', () => {
    const world = createWorld({ ...smallConfig, waterShare: 0.3 });
    const { creatures, plants } = world;
    let inWater = 0;
    for (let i = 0; i < creatures.count; i++) {
      if (plants.water[cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!)]) inWater++;
    }
    expect(inWater).toBe(0);
  });
});

describe('thirst', () => {
  it('kills every creature in a world whose only water is out of reach', () => {
    // No costs, so thirst is the only way to die; one far corner of water nobody starts near.
    const world = createWorld({ ...smallConfig, upkeepCost: 0, moveCost: 0, senseCost: 0, thirstRate: 0.01, maxAge: 100000 });
    setWater(world, (x, y) => x < 20 && y < 20);
    const { creatures } = world;
    // Pin everyone in place, far from the water.
    for (let i = 0; i < creatures.count; i++) {
      creatures.x[i] = 400;
      creatures.y[i] = 400;
      creatures.speed[i] = 0;
    }
    for (let t = 0; t < 110; t++) step(world);
    expect(creatures.count).toBe(0);
    expect(world.deaths.thirst).toBe(smallConfig.initialCreatures);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('is quenched in water and on the cells beside it', () => {
    const world = createWorld({ ...smallConfig, initialCreatures: 3, thirstRate: 0.01, drinkRate: 0.05 });
    setWater(world, (x) => x < 100);
    const { creatures, plants } = world;
    const place = (i: number, x: number) => {
      creatures.x[i] = x;
      creatures.y[i] = 400;
      creatures.speed[i] = 0;
      creatures.hydration[i] = 0.5;
    };
    place(0, 50); // in the water
    place(1, 110); // on the shore: the first dry cell
    place(2, 400); // far inland
    expect(plants.shore[cellIndexAt(plants, 110, 400)]).toBe(1);
    expect(plants.shore[cellIndexAt(plants, 400, 400)]).toBe(0);
    for (let t = 0; t < 20; t++) step(world);
    expect(creatures.hydration[0]).toBe(1);
    expect(creatures.hydration[1]).toBe(1);
    expect(creatures.hydration[2]).toBeCloseTo(0.3, 5);
  });

  it('does not exist in a world with no water', () => {
    const world = createWorld({ ...smallConfig, waterShare: 0, thirstRate: 0.01 });
    for (let t = 0; t < 300; t++) step(world);
    expect(world.deaths.thirst).toBe(0);
    for (let i = 0; i < world.creatures.count; i++) expect(world.creatures.hydration[i]).toBe(1);
  });

  it('gives a child its parent’s level of water', () => {
    const world = createWorld({ ...smallConfig, waterShare: 0.2, reproduceThreshold: 0.5, minReproduceAge: 0 });
    const { creatures } = world;
    for (let t = 0; t < 1500 && world.births === 0; t++) step(world);
    expect(world.births).toBeGreaterThan(0);
    for (let i = 0; i < creatures.count; i++) {
      expect(creatures.hydration[i]).toBeGreaterThan(0);
      expect(creatures.hydration[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('swimming', () => {
  it('is slower than walking and costs more', () => {
    const run = (wet: boolean) => {
      const world = createWorld({ ...smallConfig, initialCreatures: 20, founderLinks: 0 });
      setWater(world, () => wet);
      const { creatures } = world;
      const before = Array.from(creatures.x.subarray(0, creatures.count));
      const energy = Array.from(creatures.energy.subarray(0, creatures.count));
      // With no brain links every creature moves straight ahead at half thrust.
      for (let i = 0; i < creatures.count; i++) creatures.heading[i] = 0;
      step(world);
      let moved = 0;
      let spent = 0;
      for (let i = 0; i < creatures.count; i++) {
        moved += creatures.x[i]! - before[i]!;
        spent += energy[i]! - creatures.energy[i]!;
      }
      return { moved, spent };
    };
    const land = run(false);
    const sea = run(true);
    expect(sea.moved).toBeCloseTo(land.moved * smallConfig.swimSpeed, 1);
    // Land creatures also eat, so compare what swimming alone must cost.
    expect(sea.spent).toBeGreaterThan(land.spent);
  });
});
