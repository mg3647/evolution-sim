import { describe, expect, it } from 'vitest';
import { founderBrain, Innovations, Input, INPUT_COUNT, INPUTS_PER_RAY, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { climateAt, createEnvironment } from './environment';
import { climateCostFor, founderGenes, mutateGenes, temperatureStress, upkeepFor } from './genome';
import { createPlantField, generateTemperature, temperatureAt } from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { createSoundField } from './sound';
import { SpatialHash } from './spatialHash';
import { createWorld, step } from './world';

const config: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  dayLength: 0,
  seasonLength: 0,
  camouflage: 0,
  // Thresholds nothing reaches, so the land is all grassland unless a test says otherwise.
  biomeTempThreshold: 2,
  biomeWetThreshold: 2,
};

describe('the temperature map', () => {
  it('spans the full range from coldest to hottest', () => {
    const map = generateTemperature(defaultConfig, new Rng('t'), 100, 100);
    expect(Math.min(...map)).toBeCloseTo(-1, 5);
    expect(Math.max(...map)).toBeCloseTo(1, 5);
  });

  it('has no seam where the world wraps', () => {
    const cols = 100;
    const map = generateTemperature(defaultConfig, new Rng('t'), cols, cols);
    let across = 0;
    let within = 0;
    for (let row = 0; row < cols; row++) {
      across = Math.max(across, Math.abs(map[row * cols]! - map[row * cols + cols - 1]!));
      within = Math.max(within, Math.abs(map[row * cols + 50]! - map[row * cols + 49]!));
    }
    // The step across the edge is no bigger than steps in the middle of the map.
    expect(across).toBeLessThan(within * 3 + 0.05);
  });

  it('is the same for the same seed', () => {
    const a = generateTemperature(defaultConfig, new Rng('t'), 50, 50);
    expect(Array.from(generateTemperature(defaultConfig, new Rng('t'), 50, 50))).toEqual(Array.from(a));
  });
});

describe('the temperature of the moment', () => {
  it('is warmer in summer and at noon, colder in winter, at midnight and in an ice age', () => {
    const cfg = { ...defaultConfig };
    const field = createPlantField(cfg, new Rng('f'));
    const env = createEnvironment(cfg, new Rng('e'), field);
    const noonSpring = climateAt(env, 0, cfg).warmth;
    // A quarter of the way through the year is midsummer; a whole number of days later, so still noon.
    const noonSummer = climateAt(env, cfg.seasonLength / 4 + cfg.dayLength / 2, cfg).warmth;
    const midnightSpring = climateAt(env, cfg.dayLength / 2, cfg).warmth;
    expect(noonSummer).toBeGreaterThan(noonSpring);
    expect(midnightSpring).toBeLessThan(noonSpring);
    env.active.push({ kind: 'iceAge', endTick: 10 });
    expect(climateAt(env, 0, cfg).warmth).toBeCloseTo(noonSpring - cfg.iceAgeChill, 6);
  });

  it('is zero everywhere when temperature is switched off', () => {
    const cfg = { ...config, temperatureStrength: 0 };
    const field = createPlantField(cfg, new Rng('f'));
    expect(temperatureAt(field, 0, 0.5, cfg)).toBeCloseTo(0, 9);
  });
});

describe('heat and cold', () => {
  it('cost nothing inside the comfort band', () => {
    expect(temperatureStress(0, 1, 0, config)).toBe(0);
    expect(temperatureStress(config.comfortBand - 0.01, 1, 0, config)).toBe(0);
    expect(temperatureStress(-config.comfortBand + 0.01, 1, 0, config)).toBe(0);
  });

  it('cost more the further beyond comfort', () => {
    expect(temperatureStress(-1, 1, 0, config)).toBeCloseTo(1 - config.comfortBand, 6);
    expect(temperatureStress(1, 1, 0, config)).toBeCloseTo(1 - config.comfortBand, 6);
  });

  it('are eased by fur in the cold and worsened by it in the heat', () => {
    expect(temperatureStress(-1, 1, 1, config)).toBeLessThan(temperatureStress(-1, 1, 0, config));
    expect(temperatureStress(1, 1, 1, config)).toBeGreaterThan(temperatureStress(1, 1, 0, config));
  });

  it('are eased by a big body in the cold and worsened by it in the heat', () => {
    expect(temperatureStress(-1, 2, 0, config)).toBeLessThan(temperatureStress(-1, 1, 0, config));
    expect(temperatureStress(1, 2, 0, config)).toBeGreaterThan(temperatureStress(1, 1, 0, config));
    expect(temperatureStress(1, 0.5, 0, config)).toBeLessThan(temperatureStress(1, 1, 0, config));
  });

  it('charge for fur even in mild weather', () => {
    expect(climateCostFor(0, 1, 0, config)).toBe(0);
    expect(climateCostFor(0, 1, 0.5, config)).toBeCloseTo(upkeepFor(1, config) * config.furCost * 0.5, 9);
  });
});

describe('the fur gene', () => {
  it('starts at none and stays between 0 and 1', () => {
    const rng = new Rng('fur');
    let genes = founderGenes(rng, defaultConfig);
    // A founder is one mutation away from bare.
    expect(genes.fur).toBeLessThan(0.5);
    let most = 0;
    for (let k = 0; k < 2000; k++) {
      genes = mutateGenes({ ...genes, mutationRate: 0.3 }, rng, defaultConfig);
      expect(genes.fur).toBeGreaterThanOrEqual(0);
      expect(genes.fur).toBeLessThanOrEqual(1);
      most = Math.max(most, genes.fur);
    }
    expect(most).toBeGreaterThan(0.5);
  });
});

describe('the new senses', () => {
  function setup(overrides: Partial<SimConfig> = {}) {
    const cfg = { ...config, ...overrides };
    const plants = createPlantField(cfg, new Rng('plants'));
    const hash = new SpatialHash(cfg.worldWidth, cfg.worldHeight, cfg.senseRange);
    const creatures = createCreatures(8);
    const brain = founderBrain(new Rng('b'), new Innovations(), cfg);
    const add = (x: number, y: number, hue: number) =>
      spawnCreature(creatures, {
        x,
        y,
        heading: 0,
        energy: 25,
        genes: { size: 1, speed: 1, sensorRange: 1, diet: 0.2, hue, fur: 0, defense: 0, mutationRate: 0.05 },
        brain,
      });
    const sense = (i: number, warmth = 0) => {
      hash.build(creatures.x, creatures.y, creatures.count);
      const inputs = new Float32Array(INPUT_COUNT);
      const senses = new Senses(cfg, plants, hash, createSoundField(cfg));
      senses.warmth = warmth;
      senses.sense(creatures, i, 0, inputs);
      return inputs;
    };
    return { cfg, plants, add, sense };
  }
  const ahead = Input.Rays + INPUTS_PER_RAY;

  it('feel the temperature underfoot and whether it is warmer ahead', () => {
    const { cfg, plants, add, sense } = setup();
    plants.temperature.fill(-0.5);
    const i = add(210, 210, 0.5);
    expect(sense(i)[Input.Temperature]).toBeCloseTo(-0.5, 6);
    expect(sense(i)[Input.WarmerAhead]).toBe(0);
    // The season's warmth shifts what is felt.
    expect(sense(i, 0.3)[Input.Temperature]).toBeCloseTo(-0.2, 6);
    // Make it hot where the centre ray ends.
    const col = Math.floor((210 + cfg.senseRange) / plants.cellWidth);
    const row = Math.floor(210 / plants.cellHeight);
    plants.temperature[row * plants.cols + col] = 0.5;
    expect(sense(i)[Input.WarmerAhead]).toBe(1);
  });

  it('read zero when temperature is switched off', () => {
    const { plants, add, sense } = setup({ temperatureStrength: 0 });
    plants.temperature.fill(0.8);
    const inputs = sense(add(210, 210, 0.5));
    expect(inputs[Input.Temperature]).toBe(0);
    expect(inputs[Input.WarmerAhead]).toBe(0);
  });

  it('see the actual colour of the creature ahead', () => {
    const { add, sense } = setup();
    const i = add(200, 200, 0.5);
    const other = add(230, 200, 0);
    let inputs = sense(i);
    // Hue 0 is red.
    expect(inputs[ahead + Ray.ColourWarm]).toBeCloseTo(1, 5);
    expect(inputs[ahead + Ray.ColourGreen]).toBeCloseTo(0, 5);
    // The same colour reads the same whoever is looking, unlike the kin sense.
    const third = add(200, 300, 0.9);
    const beside = add(230, 300, 0);
    expect(sense(third)[ahead + Ray.ColourWarm]).toBeCloseTo(1, 5);
    expect(beside).toBeGreaterThan(other);
    // Nobody there: both read zero.
    inputs = sense(other);
    expect(inputs[ahead + Ray.ColourWarm]).toBe(0);
    expect(inputs[ahead + Ray.ColourGreen]).toBe(0);
  });
});

describe('a world with temperature', () => {
  const small: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 60,
    minPopulation: 0,
    reproduceThreshold: 2,
    attackDamage: 0,
    seed: 'cold',
  };

  it('drains creatures faster where it is far too cold', () => {
    const energyAfter = (chill: number) => {
      const world = createWorld(small);
      world.plants.temperature.fill(chill);
      // No food, so only spending differs.
      world.plants.energy.fill(0);
      world.plants.capacity.fill(0);
      for (let k = 0; k < 50; k++) step(world);
      let total = 0;
      for (let i = 0; i < world.creatures.count; i++) total += world.creatures.energy[i]!;
      return total;
    };
    expect(energyAfter(-1)).toBeLessThan(energyAfter(0));
  });
});
