import { describe, expect, it } from 'vitest';
import { Biome } from './biomes';
import { Input, INPUT_COUNT, INPUTS_PER_RAY, Ray, founderBrain, Innovations } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { burn, createFireTally, douse, dropBranches, ignite, maybeLightning, scatterItems } from './fire';
import { expectedEnergy, createLedger } from './ledger';
import { cellIndexAt, createPlantField, growPlants, temperatureAt } from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { createSoundField } from './sound';
import { SpatialHash } from './spatialHash';
import { applyTool, createWorld, hashWorld, step, totalEnergy } from './world';

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

/** A field of full, even grass. */
function meadow(overrides: Partial<SimConfig> = {}) {
  const cfg = { ...config, ...overrides };
  const field = createPlantField(cfg, new Rng('meadow'));
  field.capacity.fill(cfg.plantCapacity);
  field.energy.fill(cfg.plantCapacity);
  return { cfg, field, ledger: createLedger(), tally: createFireTally(), rng: new Rng('fire') };
}

describe('branches and stones', () => {
  it('start in forests and deserts only', () => {
    const { cfg, field, rng } = meadow();
    const third = Math.floor(field.biome.length / 3);
    field.biome.fill(Biome.Forest, 0, third);
    field.biome.fill(Biome.Desert, third, third * 2);
    scatterItems(field, cfg, rng);
    const sum = (items: Uint8Array, from: number, to: number) => items.subarray(from, to).reduce((a, b) => a + b, 0);
    expect(sum(field.branches, 0, third)).toBeGreaterThan(0);
    expect(sum(field.stones, third, third * 2)).toBeGreaterThan(0);
    expect(sum(field.branches, third, field.biome.length)).toBe(0);
    expect(sum(field.stones, 0, third)).toBe(0);
    expect(sum(field.stones, third * 2, field.biome.length)).toBe(0);
  });

  it('keep falling in forests, up to a few per cell', () => {
    const { cfg, field, rng } = meadow({ branchRegrowTicks: 10 });
    field.biome.fill(Biome.Forest);
    for (let k = 0; k < 400; k++) dropBranches(field, cfg, rng);
    expect(Math.max(...field.branches)).toBe(3);
    expect(field.branches.reduce((a, b) => a + b, 0)).toBeGreaterThan(field.branches.length);
  });
});

describe('wildfire', () => {
  it('catches where there is enough to burn and not on bare ground or water', () => {
    const { cfg, field, tally } = meadow();
    expect(ignite(field, 0, cfg, tally)).toBe(true);
    expect(ignite(field, 0, cfg, tally)).toBe(false);
    field.energy[1] = 0;
    expect(ignite(field, 1, cfg, tally)).toBe(false);
    field.branches[1] = 1;
    expect(ignite(field, 1, cfg, tally)).toBe(true);
    field.water[2] = 1;
    expect(ignite(field, 2, cfg, tally)).toBe(false);
    expect(tally.cellsBurned).toBe(2);
  });

  it('burns plants away as heat, then goes out and leaves ash', () => {
    const { cfg, field, ledger, tally, rng } = meadow({ fireSpread: 0 });
    ignite(field, 0, cfg, tally);
    const before = field.energy[0]!;
    for (let k = 0; k < cfg.fireDuration; k++) burn(field, cfg, rng, ledger, tally);
    expect(field.fire[0]).toBe(0);
    expect(tally.burning).toBe(0);
    expect(field.energy[0]).toBeLessThan(before * 0.2);
    expect(ledger.heatOut).toBeCloseTo(before - field.energy[0]!, 6);
    expect(field.ash[0]).toBeGreaterThan(0.9);
    // It does not spread when spreading is off.
    expect(field.fire.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('spreads through plants but stops at grazed ground', () => {
    const { cfg, field, ledger, tally, rng } = meadow({ fireSpread: 0.5 });
    // A bare firebreak across the middle of the map.
    const rows = field.rows;
    const breakRow = Math.floor(rows / 2);
    for (let row = breakRow; row < breakRow + 2; row++) field.energy.fill(0, row * field.cols, (row + 1) * field.cols);
    for (let row = rows - 2; row < rows; row++) field.energy.fill(0, row * field.cols, (row + 1) * field.cols);
    ignite(field, field.cols * 3 + 3, cfg, tally);
    for (let k = 0; k < 2000 && tally.burning > 0; k++) burn(field, cfg, rng, ledger, tally);
    expect(tally.burning).toBe(0);
    let above = 0;
    let below = 0;
    for (let cell = 0; cell < field.ash.length; cell++) {
      if (field.ash[cell]! === 0) continue;
      if (Math.floor(cell / field.cols) < breakRow) above++;
      else below++;
    }
    expect(above).toBeGreaterThan(20);
    expect(below).toBe(0);
  });

  it('burns longer where there is a branch', () => {
    const lasts = (branches: number) => {
      const { cfg, field, ledger, tally, rng } = meadow({ fireSpread: 0 });
      field.branches[0] = branches;
      ignite(field, 0, cfg, tally);
        let ticks = 0;
      while (tally.burning > 0 && ticks < 10000) {
        burn(field, cfg, rng, ledger, tally);
        ticks++;
      }
      return ticks;
    };
    expect(lasts(2)).toBe(lasts(0) * 3);
  });

  it('warms the land around it, less with distance', () => {
    const { cfg, field, ledger, tally, rng } = meadow({ fireSpread: 0 });
    field.temperature.fill(0);
    const centre = field.cols * 5 + 5;
    ignite(field, centre, cfg, tally);
    burn(field, cfg, rng, ledger, tally);
    const here = temperatureAt(field, centre, 0, cfg);
    const near = temperatureAt(field, centre + 1, 0, cfg);
    const far = temperatureAt(field, centre + 4, 0, cfg);
    expect(here).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeCloseTo(0, 6);
    // When it goes out, the warmth goes with it.
    for (let k = 0; k < cfg.fireDuration + 1; k++) burn(field, cfg, rng, ledger, tally);
    expect(temperatureAt(field, centre, 0, cfg)).toBeCloseTo(0, 6);
  });

  it('leaves ash on which plants regrow faster, and the ash fades', () => {
    const { cfg, field } = meadow();
    field.energy.fill(cfg.plantCapacity / 2);
    field.ash[0] = 1;
    field.hasAsh = true;
    const ledger = createLedger();
    growPlants(field, 0.01, 0.1, ledger, 1, cfg.ashGrowth);
    expect(field.energy[0]! - cfg.plantCapacity / 2).toBeCloseTo((field.energy[1]! - cfg.plantCapacity / 2) * 3, 6);
    const tally = createFireTally();
    for (let k = 0; k < 20000; k++) burn(field, cfg, new Rng('x'), ledger, tally);
    expect(field.ash[0]).toBe(0);
    expect(field.hasAsh).toBe(false);
  });

  it('burns on from a lightning strike without any help', () => {
    const { cfg, field, ledger, tally, rng } = meadow({ fireChance: 1, fireSpread: 0.5 });
    maybeLightning(field, cfg, rng, tally, () => 1);
    expect(tally.started).toBe(1);
    expect(tally.burning).toBe(1);
    for (let k = 0; k < 30; k++) burn(field, cfg, rng, ledger, tally);
    expect(tally.cellsBurned).toBeGreaterThan(5);
  });

  it('is put out by rain, leaving the plants standing and no ash', () => {
    const { cfg, field, ledger, tally, rng } = meadow({ fireSpread: 0 });
    ignite(field, 0, cfg, tally);
    burn(field, cfg, rng, ledger, tally);
    expect(tally.burning).toBe(1);
    const left = field.energy[0]!;
    expect(douse(field, 0, tally)).toBe(true);
    expect(douse(field, 0, tally)).toBe(false);
    expect(tally.burning).toBe(0);
    for (let k = 0; k < 10; k++) burn(field, cfg, rng, ledger, tally);
    expect(field.fire[0]).toBe(0);
    expect(field.ash[0]).toBe(0);
    expect(field.energy[0]).toBe(left);
  });

  it('is started by lightning only where it is hot', () => {
    const strikes = (heat: number) => {
      const { cfg, field, tally, rng } = meadow({ fireChance: 1 });
      for (let k = 0; k < 50; k++) maybeLightning(field, cfg, rng, tally, () => heat);
      return tally.started;
    };
    expect(strikes(1)).toBeGreaterThan(0);
    expect(strikes(0)).toBe(0);
  });

  it('never starts by itself when lightning is off', () => {
    const { cfg, field, tally, rng } = meadow({ fireChance: 0 });
    for (let k = 0; k < 1000; k++) maybeLightning(field, cfg, rng, tally, () => 2);
    expect(tally.started).toBe(0);
  });
});

describe('fire and creatures', () => {
  it('is seen along the ray that crosses it', () => {
    const cfg = { ...config, temperatureStrength: 0 };
    const plants = createPlantField(cfg, new Rng('plants'));
    const hash = new SpatialHash(cfg.worldWidth, cfg.worldHeight, cfg.senseRange);
    const creatures = createCreatures(4);
    const i = spawnCreature(creatures, {
      x: 210,
      y: 210,
      heading: 0,
      energy: 25,
      genes: { size: 1, speed: 1, sensorRange: 1, diet: 0.2, hue: 0.5, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 },
      brain: founderBrain(new Rng('b'), new Innovations(), cfg),
    });
    plants.fire[cellIndexAt(plants, 210 + cfg.senseRange, 210)] = 10;
    hash.build(creatures.x, creatures.y, creatures.count);
    const inputs = new Float32Array(INPUT_COUNT);
    new Senses(cfg, plants, hash, createSoundField(cfg)).sense(creatures, i, 0, inputs);
    expect(inputs[Input.Rays + INPUTS_PER_RAY + Ray.Fire]).toBeGreaterThan(0);
    expect(inputs[Input.Rays + Ray.Fire]).toBe(0);
    expect(inputs[Input.Rays + 2 * INPUTS_PER_RAY + Ray.Fire]).toBe(0);
  });

  const small: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 60,
    minPopulation: 0,
    maxCreatures: 500,
    seed: 'burn',
  };

  it('hurts creatures standing in it and counts those it kills as disaster deaths', () => {
    const world = createWorld({ ...small, reproduceThreshold: 2, attackDamage: 0, fireChance: 0 });
    world.plants.fire.fill(1000);
    world.fires.burning = world.plants.fire.length;
    for (let k = 0; k < 60; k++) step(world);
    expect(world.deaths.disaster).toBeGreaterThan(0);
  });

  it('can be started by hand, and keeps energy conserved while it burns', () => {
    const world = createWorld({ ...small, fireChance: 0, fireSpread: 0.2 });
    let lit = 0;
    for (let x = 10; x < 800 && lit === 0; x += 20) {
      applyTool(world, 'fire', x, 410, x, 410);
      lit = world.fires.started;
    }
    expect(lit).toBe(1);
    for (let k = 0; k < 400; k++) step(world);
    expect(world.fires.cellsBurned).toBeGreaterThan(1);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 4);
  });

  it('can be put out by hand with the Rain tool', () => {
    const world = createWorld({ ...small, fireChance: 0, fireSpread: 0.2 });
    let at = 0;
    for (let x = 10; x < 800 && world.fires.started === 0; x += 20) {
      applyTool(world, 'fire', x, 410, x, 410);
      at = x;
    }
    for (let k = 0; k < 30; k++) step(world);
    expect(world.fires.burning).toBeGreaterThan(1);
    // A fire spreading one cell at a time has not got far: rain over it and its surroundings.
    for (let dx = -200; dx <= 200; dx += 50) {
      for (let dy = -200; dy <= 200; dy += 50) applyTool(world, 'rain', at + dx, 410 + dy, at + dx, 410 + dy);
    }
    expect(world.plants.fire.reduce((sum, ticks) => sum + (ticks > 0 ? 1 : 0), 0)).toBe(0);
    step(world);
    expect(world.fires.burning).toBe(0);
  });

  it('stays deterministic with fires burning', () => {    const run = () => {
      const world = createWorld({ ...small, fireChance: 0.05, fireMinHeat: -2 });
      for (let k = 0; k < 600; k++) step(world);
      return world;
    };
    const a = run();
    expect(a.fires.started).toBeGreaterThan(0);
    expect(hashWorld(a)).toBe(hashWorld(run()));
  });
});
