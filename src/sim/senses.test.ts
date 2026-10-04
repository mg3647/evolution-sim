import { describe, expect, it } from 'vitest';
import { founderBrain, Innovations, Input, INPUT_COUNT, INPUT_LABELS, INPUTS_PER_RAY, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature, type Creatures } from './creatures';
import { cellIndexAt, createPlantField } from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { SpatialHash } from './spatialHash';

// A dry world, so each test places only the water it means to.
const config: SimConfig = { ...defaultConfig, worldWidth: 400, worldHeight: 400, waterShare: 0 };
const LEFT = 0;
const AHEAD = 1;
const RIGHT = 2;
const ray = (index: number) => Input.Rays + index * INPUTS_PER_RAY;

function setup(overrides: Partial<SimConfig> = {}) {
  const cfg = { ...config, ...overrides };
  const plants = createPlantField(cfg, new Rng('plants'));
  plants.energy.fill(0);
  const hash = new SpatialHash(cfg.worldWidth, cfg.worldHeight, cfg.senseRange);
  const creatures = createCreatures(8);
  const brain = founderBrain(new Rng('b'), new Innovations(), cfg);
  const add = (x: number, y: number, heading: number, hue = 0.5, size = 1, diet = 0.2) =>
    spawnCreature(creatures, {
      x,
      y,
      heading,
      energy: 25,
      genes: { size, speed: 1, sensorRange: 1, diet, hue, mutationRate: 0.05 },
      brain,
      age: 900,
    });
  const sense = (c: Creatures, i: number, tick = 0) => {
    hash.build(c.x, c.y, c.count);
    const inputs = new Float32Array(INPUT_COUNT);
    new Senses(cfg, plants, hash).sense(c, i, tick, inputs);
    return inputs;
  };
  return { plants, creatures, add, sense };
}

describe('the list of senses', () => {
  it('has a label for every input, in order', () => {
    expect(INPUT_LABELS).toHaveLength(INPUT_COUNT);
    expect(INPUT_LABELS[ray(AHEAD) + Ray.MeatEater]).toBe('Meat-eater ahead');
    expect(INPUT_LABELS[ray(RIGHT) + Ray.Hurt]).toBe('Hurt right');
    expect(INPUT_LABELS[Input.Behind]).toBe('Creature behind');
    expect(INPUT_LABELS[Input.Pain]).toBe('Pain');
    expect(INPUT_LABELS[Input.Bias]).toBe('Bias');
  });
});

describe('Senses', () => {
  it('reports internal state', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    const inputs = sense(creatures, i, config.clockPeriod / 4);
    expect(inputs[Input.Energy]).toBeCloseTo(25 / config.creatureMaxEnergy, 6);
    expect(inputs[Input.Age]).toBeCloseTo(900 / config.maxAge, 6);
    expect(inputs[Input.Clock]).toBeCloseTo(1, 6);
    expect(inputs[Input.Bias]).toBe(1);
  });

  it('sees plants underfoot and along the ray that points at them', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    // Full cover where the centre ray ends, straight ahead (+x).
    plants.energy[cellIndexAt(plants, 200 + config.senseRange, 200)] = config.plantCapacity;
    plants.energy[cellIndexAt(plants, 200, 200)] = config.plantCapacity / 2;
    const inputs = sense(creatures, i);
    expect(inputs[Input.Underfoot]).toBeCloseTo(0.5, 6);
    expect(inputs[ray(AHEAD) + Ray.Plants]).toBeGreaterThan(0.4);
    expect(inputs[ray(LEFT) + Ray.Plants]).toBe(0);
    expect(inputs[ray(RIGHT) + Ray.Plants]).toBe(0);
  });

  it('sees meat underfoot and along a ray, capped at 1', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.meat[cellIndexAt(plants, 210, 210)] = config.meatScale / 2;
    plants.meat[cellIndexAt(plants, 210 + config.senseRange / 2, 210)] = config.meatScale * 10;
    const inputs = sense(creatures, i);
    expect(inputs[Input.MeatUnderfoot]).toBeCloseTo(0.5, 6);
    expect(inputs[ray(AHEAD) + Ray.Meat]).toBe(1);
    expect(inputs[ray(LEFT) + Ray.Meat]).toBe(0);
  });

  it('smells scent underfoot and which side it is stronger on, and reports the season', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    const half = config.senseRange / 2;
    const side = config.raySpread;
    const leftCell = cellIndexAt(plants, 210 + half * Math.cos(-side), 210 + half * Math.sin(-side));
    const rightCell = cellIndexAt(plants, 210 + half * Math.cos(side), 210 + half * Math.sin(side));
    plants.scent[cellIndexAt(plants, 210, 210)] = 0.3;
    plants.scent[rightCell] = 0.8;
    const summer = sense(creatures, i, config.seasonLength / 4);
    expect(summer[Input.ScentUnderfoot]).toBeCloseTo(0.3, 6);
    expect(summer[Input.ScentSide]).toBeCloseTo(0.8, 6);
    expect(summer[Input.Season]).toBeCloseTo(1, 5);
    expect(sense(creatures, i, (config.seasonLength * 3) / 4)[Input.Season]).toBeCloseTo(-1, 5);

    plants.scent[rightCell] = 0;
    plants.scent[leftCell] = 5;
    expect(sense(creatures, i)[Input.ScentSide]).toBe(-1);
  });

  it('sees walls on the ray that crosses them, stronger when nearer', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.walls[cellIndexAt(plants, 210 + config.senseRange, 210)] = 1;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Wall]).toBeCloseTo(0.5, 6);
    plants.walls[cellIndexAt(plants, 210 + config.senseRange / 2, 210)] = 1;
    const inputs = sense(creatures, i);
    expect(inputs[ray(AHEAD) + Ray.Wall]).toBe(1);
    expect(inputs[ray(LEFT) + Ray.Wall]).toBe(0);
  });

  it('sees water on the ray that crosses it, feels it underfoot, and feels thirst', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.water[cellIndexAt(plants, 210 + config.senseRange, 210)] = 1;
    let inputs = sense(creatures, i);
    expect(inputs[ray(AHEAD) + Ray.Water]).toBeCloseTo(0.5, 6);
    expect(inputs[ray(LEFT) + Ray.Water]).toBe(0);
    expect(inputs[Input.InWater]).toBe(0);
    expect(inputs[Input.Thirst]).toBe(0);

    plants.water[cellIndexAt(plants, 210, 210)] = 1;
    creatures.hydration[i] = 0.25;
    inputs = sense(creatures, i);
    expect(inputs[Input.InWater]).toBe(1);
    expect(inputs[Input.Thirst]).toBeCloseTo(0.75, 6);
  });

  it('knows when it is sick, and sees another creature as hurt when it is sick or wounded', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    const other = add(230, 200, 0);
    let inputs = sense(creatures, i);
    expect(inputs[Input.Sick]).toBe(0);
    expect(inputs[ray(AHEAD) + Ray.Hurt]).toBe(0);

    creatures.health[other] = 0.25;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Hurt]).toBeCloseTo(0.75, 6);

    creatures.health[other] = 1;
    creatures.sick[i] = 100;
    creatures.sick[other] = 100;
    inputs = sense(creatures, i);
    expect(inputs[Input.Sick]).toBe(1);
    expect(inputs[ray(AHEAD) + Ray.Hurt]).toBe(1);
    // Immunity is not sickness.
    creatures.sick[i] = -100;
    creatures.sick[other] = -100;
    inputs = sense(creatures, i);
    expect(inputs[Input.Sick]).toBe(0);
    expect(inputs[ray(AHEAD) + Ray.Hurt]).toBe(0);
  });

  it('tells a meat-eater from a plant-eater, and both from nobody', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.MeatEater]).toBe(0);
    const other = add(230, 200, 0, 0.5, 1, 1);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.MeatEater]).toBe(1);
    creatures.diet[other] = 0;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.MeatEater]).toBe(-1);
    creatures.diet[other] = 0.75;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.MeatEater]).toBeCloseTo(0.5, 6);
  });

  it('sees whether the creature in view is facing this way', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    const other = add(230, 200, Math.PI); // facing back toward the viewer
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Approaching]).toBeCloseTo(1, 5);
    creatures.heading[other] = 0; // facing directly away
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Approaching]).toBeCloseTo(-1, 5);
    creatures.heading[other] = Math.PI / 2; // side-on
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Approaching]).toBeCloseTo(0, 5);
  });

  it('feels the nearest creature behind it without seeing it', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    expect(sense(creatures, i)[Input.Behind]).toBe(0);
    add(170, 200, 0); // behind
    add(160, 200, 0); // behind, farther
    const inputs = sense(creatures, i);
    expect(inputs[Input.Behind]).toBeCloseTo(1 - 30 / config.senseRange, 5);
    for (const r of [LEFT, AHEAD, RIGHT]) expect(inputs[ray(r) + Ray.Near]).toBe(0);
  });

  it('feels how crowded it is, counting creatures all around up to a full crowd', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    expect(sense(creatures, i)[Input.Crowding]).toBe(0);
    add(220, 200, 0);
    add(180, 200, 0);
    expect(sense(creatures, i)[Input.Crowding]).toBeCloseTo(2 / 8, 6);
    add(200 + config.senseRange + 10, 200, 0); // out of range: not counted
    expect(sense(creatures, i)[Input.Crowding]).toBeCloseTo(2 / 8, 6);
  });

  it('feels pain in proportion to the health just lost, up to a full reading', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    expect(sense(creatures, i)[Input.Pain]).toBe(0);
    creatures.pain[i] = 0.15;
    expect(sense(creatures, i)[Input.Pain]).toBeCloseTo(0.5, 6);
    creatures.pain[i] = 2;
    expect(sense(creatures, i)[Input.Pain]).toBe(1);
  });

  it('reads none of the social senses when they are switched off', () => {
    const { creatures, add, sense } = setup({ socialSenses: false });
    const i = add(200, 200, 0);
    const other = add(230, 200, Math.PI, 0.5, 1, 1);
    add(170, 200, 0);
    creatures.health[other] = 0.2;
    creatures.pain[i] = 1;
    const inputs = sense(creatures, i);
    expect(inputs[ray(AHEAD) + Ray.Near]).toBeGreaterThan(0);
    for (const offset of [Ray.MeatEater, Ray.Approaching, Ray.Hurt]) expect(inputs[ray(AHEAD) + offset]).toBe(0);
    for (const input of [Input.Behind, Input.Crowding, Input.Pain]) expect(inputs[input]).toBe(0);
  });

  it('reports health and whether the creature in view is bigger or smaller', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    creatures.health[i] = 0.4;
    add(240, 200, 0, 0.5, 3);
    const inputs = sense(creatures, i);
    expect(inputs[Input.Health]).toBeCloseTo(0.4, 6);
    expect(inputs[ray(AHEAD) + Ray.Bigger]).toBeCloseTo(0.5, 6);
    creatures.size[i] = 3;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Bigger]).toBe(0);
  });

  it('tracks the closest creature in view and the gap to it, for attacks', () => {
    const { plants, creatures, add } = setup();
    const i = add(200, 200, 0);
    const near = add(215, 200, 0);
    add(240, 200, 0);
    add(190, 200, 0); // closer, but behind
    const hash = new SpatialHash(config.worldWidth, config.worldHeight, config.senseRange);
    hash.build(creatures.x, creatures.y, creatures.count);
    const senses = new Senses(config, plants, hash);
    senses.sense(creatures, i, 0, new Float32Array(INPUT_COUNT));
    expect(senses.targetIndex).toBe(near);
    expect(senses.targetGap).toBeCloseTo(15 - 2 * config.creatureRadius, 5);

    senses.sense(creatures, near, 0, new Float32Array(INPUT_COUNT));
    expect(senses.targetIndex).not.toBe(i);
  });

  it('turns its rays with its heading', () => {
    const { plants, creatures, add, sense } = setup();
    // Halfway along a ray pointing in +y, from a start clear of any cell boundary.
    plants.energy[cellIndexAt(plants, 210, 205 + config.senseRange / 2)] = config.plantCapacity;
    const facingAway = add(210, 205, 0);
    const facingIt = add(210, 205, Math.PI / 2);
    expect(sense(creatures, facingAway)[ray(AHEAD) + Ray.Plants]).toBe(0);
    expect(sense(creatures, facingIt)[ray(AHEAD) + Ray.Plants]).toBeGreaterThan(0.4);
  });

  it('sees the nearest creature on the correct ray, with nearness and colour match', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0, 0.5);
    add(230, 200, 0, 0.5); // ahead, same colour
    add(250, 200, 0, 0.0); // ahead but farther: ignored
    const side = config.raySpread;
    add(200 + 20 * Math.cos(side), 200 + 20 * Math.sin(side), 0, 0.0); // +angle side, opposite colour
    const inputs = sense(creatures, i);

    expect(inputs[ray(AHEAD) + Ray.Near]).toBeCloseTo(1 - 30 / config.senseRange, 5);
    expect(inputs[ray(AHEAD) + Ray.Kin]).toBeCloseTo(1, 5);
    expect(inputs[ray(RIGHT) + Ray.Near]).toBeCloseTo(1 - 20 / config.senseRange, 5);
    expect(inputs[ray(RIGHT) + Ray.Kin]).toBeCloseTo(-1, 5);
    expect(inputs[ray(LEFT) + Ray.Near]).toBe(0);
    expect(inputs[ray(LEFT) + Ray.Kin]).toBe(0);
  });

  it('does not see creatures beyond its range, or itself', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    add(200 + config.senseRange + 5, 200, 0); // too far
    const inputs = sense(creatures, i);
    for (const r of [LEFT, AHEAD, RIGHT]) expect(inputs[ray(r) + Ray.Near]).toBe(0);
    expect(inputs[Input.Crowding]).toBe(0);
  });

  it('sees across the wrapped edge of the world', () => {
    const { creatures, add, sense } = setup();
    const i = add(395, 200, 0);
    add(15, 200, 0);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBeCloseTo(1 - 20 / config.senseRange, 5);
  });

  it('sees farther with a larger sensor range gene', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    add(200 + config.senseRange * 1.5, 200, 0);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBe(0);
    creatures.sensorRange[i] = 2;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBeCloseTo(0.25, 5);
  });
});
