import { describe, expect, it } from 'vitest';
import { Biome, BIOME_COUNT, BIOME_LABELS, BIOME_TRAITS, biomeFor, bloomGrowth } from './biomes';
import { founderBrain, Innovations, Input, INPUT_COUNT, INPUTS_PER_RAY, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { createLedger } from './ledger';
import {
  cellCapacity,
  cellIndexAt,
  classifyBiomes,
  createPlantField,
  decayMeat,
  growPlants,
  temperatureAt,
} from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { createSoundField } from './sound';
import { SpatialHash } from './spatialHash';
import { createWorld, step } from './world';

const rules = { temperature: 0.35, wetness: 0.55 };
const small: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  dayLength: 0,
  seasonLength: 0,
  camouflage: 0,
};

describe('telling biomes apart', () => {
  it('names every biome', () => {
    expect(BIOME_LABELS).toHaveLength(BIOME_COUNT);
    expect(BIOME_TRAITS).toHaveLength(BIOME_COUNT);
  });

  it('follows heat and wetness', () => {
    expect(biomeFor(0, 0.2, rules)).toBe(Biome.Grassland);
    expect(biomeFor(0, 0.9, rules)).toBe(Biome.Forest);
    expect(biomeFor(0.8, 0.9, rules)).toBe(Biome.Rainforest);
    expect(biomeFor(0.8, 0.2, rules)).toBe(Biome.Desert);
    expect(biomeFor(-0.8, 0.2, rules)).toBe(Biome.Tundra);
    expect(biomeFor(-0.8, 0.9, rules)).toBe(Biome.Tundra);
  });

  it('gives every default world all five biomes', () => {
    for (const seed of ['genesis', 'second', 'third']) {
      const field = createPlantField({ ...defaultConfig, seed }, new Rng(seed));
      expect(new Set(field.biome).size).toBe(BIOME_COUNT);
    }
  });

  it('makes all land grassland when temperature is off', () => {
    const field = createPlantField({ ...defaultConfig, temperatureStrength: 0 }, new Rng('off'));
    expect(new Set(field.biome)).toEqual(new Set([Biome.Grassland]));
  });

  it('turns land to tundra in a colder world and to desert or rainforest in a hotter one', () => {
    const share = (climateShift: number, wanted: number[]) => {
      const field = createPlantField({ ...defaultConfig, climateShift }, new Rng('shift'));
      return field.biome.filter((biome) => wanted.includes(biome)).length / field.biome.length;
    };
    expect(share(-0.5, [Biome.Tundra])).toBeGreaterThan(share(0, [Biome.Tundra]) + 0.2);
    expect(share(0.5, [Biome.Desert, Biome.Rainforest])).toBeGreaterThan(
      share(0, [Biome.Desert, Biome.Rainforest]) + 0.2,
    );
  });
});

describe('what biomes do to the land', () => {
  function fieldOf(biome: number, config = small) {
    const field = createPlantField(config, new Rng('land'));
    field.biome.fill(biome);
    return field;
  }

  it('holds more plants in forest and rainforest, fewer in desert', () => {
    const capacity = (biome: number) => {
      const field = fieldOf(biome);
      field.fertility.fill(0.5);
      return cellCapacity(field, 0, small);
    };
    expect(capacity(Biome.Forest)).toBeGreaterThan(capacity(Biome.Grassland));
    expect(capacity(Biome.Rainforest)).toBeGreaterThan(capacity(Biome.Forest));
    expect(capacity(Biome.Desert)).toBeLessThan(capacity(Biome.Grassland));
  });

  it('grows tundra plants only in the warm half of the year', () => {
    expect(bloomGrowth(-1)).toBe(0);
    expect(bloomGrowth(0)).toBe(0);
    expect(bloomGrowth(1)).toBeGreaterThan(1);
    const grown = (biome: number, bloom: number) => {
      const field = fieldOf(biome);
      field.capacity.fill(10);
      field.energy.fill(5);
      const ledger = createLedger();
      growPlants(field, 0.01, 0.1, ledger, bloom);
      return ledger.sunIn;
    };
    expect(grown(Biome.Tundra, 0)).toBe(0);
    expect(grown(Biome.Tundra, 3)).toBeGreaterThan(grown(Biome.Grassland, 3));
    // Other biomes ignore the bloom.
    expect(grown(Biome.Grassland, 0)).toBe(grown(Biome.Grassland, 3));
  });

  it('keeps meat four times longer on tundra', () => {
    const rotted = (biome: number) => {
      const field = fieldOf(biome);
      field.meat.fill(10);
      const ledger = createLedger();
      decayMeat(field, 0.01, ledger);
      return ledger.heatOut;
    };
    expect(rotted(Biome.Tundra)).toBeCloseTo(rotted(Biome.Grassland) / 4, 6);
  });

  it('swings further between day and night in the desert', () => {
    const desert = fieldOf(Biome.Desert);
    const grass = fieldOf(Biome.Grassland);
    desert.temperature.fill(0.5);
    grass.temperature.fill(0.5);
    const noon = small.dayTempSwing;
    expect(temperatureAt(desert, 0, noon, small, noon)).toBeGreaterThan(temperatureAt(grass, 0, noon, small, noon));
    expect(temperatureAt(desert, 0, -noon, small, -noon)).toBeLessThan(temperatureAt(grass, 0, -noon, small, -noon));
  });

  it('reclassifies when asked, so drifting wetness moves the biomes', () => {
    const field = createPlantField(small, new Rng('drift'));
    field.temperature.fill(0);
    field.fertility.fill(0.1);
    classifyBiomes(field, small);
    expect(field.biome[0]).toBe(Biome.Grassland);
    field.fertility.fill(0.9);
    classifyBiomes(field, small);
    expect(field.biome[0]).toBe(Biome.Forest);
  });
});

describe('what biomes do to creatures', () => {
  function setup(biome: number, viewerBiome = biome) {
    const plants = createPlantField(small, new Rng('plants'));
    plants.biome.fill(biome);
    const hash = new SpatialHash(small.worldWidth, small.worldHeight, small.senseRange);
    const creatures = createCreatures(8);
    const brain = founderBrain(new Rng('b'), new Innovations(), small);
    const add = (x: number, y: number) =>
      spawnCreature(creatures, {
        x,
        y,
        heading: 0,
        energy: 25,
        genes: { size: 1, speed: 1, sensorRange: 1, diet: 0.2, hue: 0.9, fur: 0, defense: 0, mutationRate: 0.05 },
        brain,
      });
    const viewer = add(200, 200);
    plants.biome[cellIndexAt(plants, 200, 200)] = viewerBiome;
    const sees = (distance: number) => {
      const other = creatures.count > 1 ? 1 : add(200 + distance, 200);
      creatures.x[other] = 200 + distance;
      hash.build(creatures.x, creatures.y, creatures.count);
      const inputs = new Float32Array(INPUT_COUNT);
      new Senses(small, plants, hash, createSoundField(small)).sense(creatures, viewer, 0, inputs);
      return inputs[Input.Rays + INPUTS_PER_RAY + Ray.Near]! > 0;
    };
    return { sees };
  }
  const range = small.senseRange;

  it('hides a creature standing in forest from far off, and one in rainforest more', () => {
    expect(setup(Biome.Grassland).sees(range * 0.8)).toBe(true);
    expect(setup(Biome.Forest).sees(range * 0.8)).toBe(false);
    expect(setup(Biome.Forest).sees(range * 0.5)).toBe(true);
    expect(setup(Biome.Rainforest).sees(range * 0.5)).toBe(false);
    expect(setup(Biome.Rainforest).sees(range * 0.3)).toBe(true);
  });

  it('lets a creature standing in desert see further', () => {
    expect(setup(Biome.Grassland).sees(range * 1.3)).toBe(false);
    // The viewer stands in desert; the one it looks at stands on open grassland.
    expect(setup(Biome.Grassland, Biome.Desert).sees(range * 1.3)).toBe(true);
  });

  const world: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 60,
    minPopulation: 0,
    reproduceThreshold: 2,
    attackDamage: 0,
    seasonLength: 0,
    dayLength: 0,
    waterShare: 0.2,
    seed: 'land',
  };

  it('makes creatures thirstier in desert and less thirsty in rainforest', () => {
    const waterAfter = (biome: number) => {
      const w = createWorld(world);
      // Nowhere to drink, and biomes held still.
      w.plants.shore.fill(0);
      w.config.fertilityUpdateInterval = 1e9;
      w.plants.biome.fill(biome);
      w.plants.temperature.fill(0);
      for (let k = 0; k < 100; k++) step(w);
      let total = 0;
      for (let i = 0; i < w.creatures.count; i++) total += w.creatures.hydration[i]!;
      return total / w.creatures.count;
    };
    expect(waterAfter(Biome.Desert)).toBeLessThan(waterAfter(Biome.Grassland));
    expect(waterAfter(Biome.Rainforest)).toBeGreaterThan(waterAfter(Biome.Grassland));
  });

  it('makes moving cost more in forest', () => {
    const energyAfter = (biome: number) => {
      const w = createWorld({ ...world, waterShare: 0 });
      w.config.fertilityUpdateInterval = 1e9;
      w.plants.biome.fill(biome);
      w.plants.temperature.fill(0);
      w.plants.energy.fill(0);
      w.plants.capacity.fill(0);
      for (let k = 0; k < 100; k++) step(w);
      let total = 0;
      for (let i = 0; i < w.creatures.count; i++) total += w.creatures.energy[i]!;
      return total;
    };
    expect(energyAfter(Biome.Forest)).toBeLessThan(energyAfter(Biome.Grassland));
  });
});
