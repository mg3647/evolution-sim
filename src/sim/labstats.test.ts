import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { compileBrain } from './brain';
import {
  BEHAVIOUR_DIET_BINS,
  BEHAVIOUR_SPEED_BINS,
  createBehaviourHistory,
  createDensityHistory,
  createHistory,
  DENSITY_GRID,
  HISTORY_SERIES,
  recordBehaviour,
  recordDensity,
  recordSample,
  type Sample,
} from './stats';
import { createWorld, step } from './world';

const small: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 80,
  minPopulation: 5,
  maxCreatures: 600,
  seed: 'lab',
};

function run(overrides: Partial<SimConfig>, ticks: number) {
  const world = createWorld({ ...small, ...overrides });
  for (let k = 0; k < ticks; k++) step(world);
  return world;
}

const blank = (tick: number) => Object.fromEntries(HISTORY_SERIES.map((name) => [name, name === 'tick' ? tick : 0])) as unknown as Sample;

describe('what the Lab charts are drawn from', () => {
  const world = run({}, 3000);
  const h = world.history;
  const last = h.count - 1;
  const sum = (series: Float32Array) => series.subarray(0, h.count).reduce((a, b) => a + b, 0);

  it('records deaths by cause as rates that add up to the deaths counted', () => {
    const { deaths } = world;
    const total = deaths.starved + deaths.oldAge + deaths.killed + deaths.temperature + deaths.thirst + deaths.disaster;
    expect(total).toBeGreaterThan(0);
    // Each sample holds deaths per 1,000 ticks over the interval before it.
    let recorded = 0;
    for (let k = 1; k < h.count; k++) {
      const span = h.tick[k]! - h.tick[k - 1]!;
      recorded +=
        ((h.deathsStarved[k]! +
          h.deathsOldAge[k]! +
          h.deathsKilled[k]! +
          h.deathsTemperature[k]! +
          h.deathsThirst[k]! +
          h.deathsOther[k]!) *
          span) /
        1000;
    }
    expect(recorded).toBeCloseTo(total, 0);
  });

  it('records what was eaten, by whom', () => {
    expect(sum(h.flowPlantsToPlantEaters)).toBeGreaterThan(0);
    for (const flow of [h.flowPlantsToMeatEaters, h.flowMeatToPlantEaters, h.flowMeatToMeatEaters]) {
      expect(sum(flow)).toBeGreaterThanOrEqual(0);
    }
  });

  it('records life histories within what is possible', () => {
    expect(h.lifespan[last]).toBeGreaterThan(0);
    expect(h.lifespan[last]).toBeLessThanOrEqual(small.maxAge);
    expect(h.firstBirthAge[last]).toBeGreaterThanOrEqual(small.minReproduceAge);
    expect(h.generationLength[last]).toBeGreaterThanOrEqual(h.firstBirthAge[last]! * 0.5);
    expect(h.offspring[last]).toBeGreaterThanOrEqual(0);
  });

  it('counts each creature under one behaviour at most', () => {
    for (let k = 0; k < h.count; k++) {
      const shares = h.shareResting[k]! + h.shareForaging[k]! + h.shareChasing[k]! + h.shareFleeing[k]!;
      expect(shares).toBeGreaterThanOrEqual(0);
      expect(shares).toBeLessThanOrEqual(1.0001);
    }
    expect(sum(h.shareForaging)).toBeGreaterThan(0);
  });

  it('counts the children each creature has had', () => {
    const { creatures: c } = world;
    let children = 0;
    for (let i = 0; i < c.count; i++) children += c.children[i]!;
    expect(children).toBeGreaterThan(0);
    expect(children).toBeLessThanOrEqual(world.births);
  });

  it('follows the members of every species, adding up to the population', () => {
    expect(h.species.size).toBeGreaterThan(0);
    let members = 0;
    for (const series of h.species.values()) members += series[last]!;
    expect(members).toBe(h.population[last]);
  });

  it('puts deaths from running out of energy in the cold down to temperature', () => {
    const cold = createWorld({ ...small, reproduceThreshold: 2, attackDamage: 0, minPopulation: 0, waterShare: 0 });
    cold.plants.temperature.fill(-1);
    cold.plants.energy.fill(0);
    cold.plants.capacity.fill(0);
    cold.config.fertilityUpdateInterval = 1e9;
    for (let k = 0; k < 1500; k++) step(cold);
    expect(cold.deaths.temperature).toBeGreaterThan(0);
    expect(cold.deaths.temperature).toBeGreaterThan(cold.deaths.starved);
  });
});

describe('the species stream', () => {
  it('thins with the rest of the history and forgets species with no members left in it', () => {
    const history = createHistory(10, 4);
    recordSample(history, blank(0), new Map([[1, 5]]));
    recordSample(history, blank(10), new Map([[2, 7]]));
    recordSample(history, blank(20), new Map([[1, 3]]));
    recordSample(history, blank(30), new Map([[1, 2]]));
    // Full: the next sample halves it, keeping ticks 0 and 20, where species 2 had nobody.
    recordSample(history, blank(40), new Map([[1, 1]]));
    expect(history.count).toBe(3);
    expect(history.species.has(2)).toBe(false);
    expect(Array.from(history.species.get(1)!.subarray(0, 3))).toEqual([5, 3, 1]);
  });
});

describe('the density history', () => {
  function herd(x: number, y: number, count: number) {
    const creatures = createCreatures(count);
    const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0, fur: 0, defense: 0, mutationRate: 0.05 };
    for (let k = 0; k < count; k++) {
      spawnCreature(creatures, { x, y, heading: 0, energy: 1, genes, brain: compileBrain([], []) });
    }
    return creatures;
  }

  it('counts creatures into the cell they stand in and closes a frame when it is full', () => {
    const density = createDensityHistory();
    const creatures = herd(10, 790, 3);
    for (let k = 0; k < density.samplesPerFrame; k++) recordDensity(density, creatures, 800, 800, k * 30);
    expect(density.frames).toHaveLength(1);
    const frame = density.frames[0]!;
    expect(frame[(DENSITY_GRID - 1) * DENSITY_GRID]).toBe(3 * 8);
    expect(frame.reduce((a, b) => a + b, 0)).toBe(3 * 8);
  });

  it('merges frames in pairs when it runs out, losing no counts', () => {
    const density = createDensityHistory();
    const creatures = herd(400, 400, 2);
    const per = density.samplesPerFrame;
    for (let k = 0; k < per * 24; k++) recordDensity(density, creatures, 800, 800, k);
    expect(density.frames).toHaveLength(12);
    expect(density.samplesPerFrame).toBe(per * 2);
    const total = density.frames.reduce((sum, frame) => sum + frame.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(2 * per * 24);
    expect(density.ticks[density.ticks.length - 1]).toBe(per * 24 - 1);
  });
});

describe('behaviour map', () => {
  const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0, fur: 0, defense: 0, mutationRate: 0.05 };

  it('counts each creature into its diet and speed cell under its species', () => {
    const creatures = createCreatures(8);
    const add = (diet: number, speed: number, species: number) =>
      spawnCreature(creatures, {
        x: 0, y: 0, heading: 0, energy: 1, genes: { ...genes, diet, speed }, brain: compileBrain([], []), species,
      });
    add(0, 0.2, 1); // slowest plant-eater: bottom left
    add(0.99, 4, 2); // fastest meat-eater: top right
    add(0.99, 4, 2);
    add(0.99, 4, 3);
    const behaviour = createBehaviourHistory();
    recordBehaviour(behaviour, creatures, 0.2, 4);
    recordBehaviour(behaviour, creatures, 0.2, 4);
    expect(behaviour.cells[0]!.get(1)).toBe(2);
    const topRight = (BEHAVIOUR_SPEED_BINS - 1) * BEHAVIOUR_DIET_BINS + BEHAVIOUR_DIET_BINS - 1;
    expect(behaviour.cells[topRight]!.get(2)).toBe(4);
    expect(behaviour.cells[topRight]!.get(3)).toBe(2);
    const total = behaviour.cells.reduce((sum, cell) => sum + [...cell.values()].reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(8);
  });
});
