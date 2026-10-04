import { describe, expect, it } from 'vitest';
import { founderBrain, Innovations, Input, INPUT_COUNT, INPUTS_PER_RAY } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature, type Creatures } from './creatures';
import { cellIndexAt, createPlantField } from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { SpatialHash } from './spatialHash';

const config: SimConfig = { ...defaultConfig, worldWidth: 400, worldHeight: 400 };
const LEFT = 0;
const AHEAD = 1;
const RIGHT = 2;
/** Offsets of the per-ray inputs. */
const MEAT = 1;
const SCENT = 2;
const NEAR = 3;
const KIN = 4;
const BIGGER = 5;
const ray = (index: number) => Input.Rays + index * INPUTS_PER_RAY;

function setup() {
  const plants = createPlantField(config, new Rng('plants'));
  plants.energy.fill(0);
  const hash = new SpatialHash(config.worldWidth, config.worldHeight, config.senseRange);
  const creatures = createCreatures(8);
  const brain = founderBrain(new Rng('b'), new Innovations(), config);
  const add = (x: number, y: number, heading: number, hue = 0.5, size = 1) =>
    spawnCreature(creatures, {
      x,
      y,
      heading,
      energy: 25,
      genes: { size, speed: 1, sensorRange: 1, diet: 0.2, hue, mutationRate: 0.05 },
      brain,
      age: 900,
    });
  const sense = (c: Creatures, i: number, tick = 0) => {
    hash.build(c.x, c.y, c.count);
    const inputs = new Float32Array(INPUT_COUNT);
    new Senses(config, plants, hash).sense(c, i, tick, inputs);
    return inputs;
  };
  return { plants, creatures, add, sense };
}

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
    expect(inputs[ray(AHEAD)]).toBeGreaterThan(0.4);
    expect(inputs[ray(LEFT)]).toBe(0);
    expect(inputs[ray(RIGHT)]).toBe(0);
  });

  it('sees meat underfoot and along a ray, capped at 1', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.meat[cellIndexAt(plants, 210, 210)] = config.meatScale / 2;
    plants.meat[cellIndexAt(plants, 210 + config.senseRange / 2, 210)] = config.meatScale * 10;
    const inputs = sense(creatures, i);
    expect(inputs[Input.MeatUnderfoot]).toBeCloseTo(0.5, 6);
    expect(inputs[ray(AHEAD) + MEAT]).toBe(1);
    expect(inputs[ray(LEFT) + MEAT]).toBe(0);
  });

  it('smells scent underfoot and along a ray, and reports the season', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.scent[cellIndexAt(plants, 210, 210)] = 0.3;
    plants.scent[cellIndexAt(plants, 210 + config.senseRange / 2, 210)] = 5;
    const summer = sense(creatures, i, config.seasonLength / 4);
    expect(summer[Input.ScentUnderfoot]).toBeCloseTo(0.3, 6);
    expect(summer[ray(AHEAD) + SCENT]).toBe(1);
    expect(summer[ray(LEFT) + SCENT]).toBe(0);
    expect(summer[Input.Season]).toBeCloseTo(1, 5);
    expect(sense(creatures, i, (config.seasonLength * 3) / 4)[Input.Season]).toBeCloseTo(-1, 5);
  });

  it('reports health and whether the creature in view is bigger or smaller', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    creatures.health[i] = 0.4;
    add(240, 200, 0, 0.5, 3);
    const inputs = sense(creatures, i);
    expect(inputs[Input.Health]).toBeCloseTo(0.4, 6);
    expect(inputs[ray(AHEAD) + BIGGER]).toBeCloseTo(0.5, 6);
    creatures.size[i] = 3;
    expect(sense(creatures, i)[ray(AHEAD) + BIGGER]).toBe(0);
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
    plants.energy[cellIndexAt(plants, 210, 210 + config.senseRange / 2)] = config.plantCapacity;
    const facingAway = add(210, 210, 0);
    const facingIt = add(210, 210, Math.PI / 2);
    expect(sense(creatures, facingAway)[ray(AHEAD)]).toBe(0);
    expect(sense(creatures, facingIt)[ray(AHEAD)]).toBeGreaterThan(0.4);
  });

  it('sees the nearest creature on the correct ray, with nearness and colour match', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0, 0.5);
    add(230, 200, 0, 0.5); // ahead, same colour
    add(250, 200, 0, 0.0); // ahead but farther: ignored
    const side = config.raySpread;
    add(200 + 20 * Math.cos(side), 200 + 20 * Math.sin(side), 0, 0.0); // +angle side, opposite colour
    const inputs = sense(creatures, i);

    expect(inputs[ray(AHEAD) + NEAR]).toBeCloseTo(1 - 30 / config.senseRange, 5);
    expect(inputs[ray(AHEAD) + KIN]).toBeCloseTo(1, 5);
    expect(inputs[ray(RIGHT) + NEAR]).toBeCloseTo(1 - 20 / config.senseRange, 5);
    expect(inputs[ray(RIGHT) + KIN]).toBeCloseTo(-1, 5);
    expect(inputs[ray(LEFT) + NEAR]).toBe(0);
    expect(inputs[ray(LEFT) + KIN]).toBe(0);
  });

  it('does not see creatures behind it, beyond its range, or itself', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    add(170, 200, 0); // behind
    add(200 + config.senseRange + 5, 200, 0); // too far
    const inputs = sense(creatures, i);
    for (const r of [LEFT, AHEAD, RIGHT]) expect(inputs[ray(r) + NEAR]).toBe(0);
  });

  it('sees across the wrapped edge of the world', () => {
    const { creatures, add, sense } = setup();
    const i = add(395, 200, 0);
    add(15, 200, 0);
    expect(sense(creatures, i)[ray(AHEAD) + NEAR]).toBeCloseTo(1 - 20 / config.senseRange, 5);
  });

  it('sees farther with a larger sensor range gene', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    add(200 + config.senseRange * 1.5, 200, 0);
    expect(sense(creatures, i)[ray(AHEAD) + NEAR]).toBe(0);
    creatures.sensorRange[i] = 2;
    expect(sense(creatures, i)[ray(AHEAD) + NEAR]).toBeCloseTo(0.25, 5);
  });
});
