import { describe, expect, it } from 'vitest';
import { founderBrain, Innovations, Input, INPUT_COUNT, INPUT_LABELS, INPUTS_PER_RAY, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature, type Creatures } from './creatures';
import { cellIndexAt, createPlantField, groundHue, visibility } from './plants';
import { Rng } from './rng';
import { addBlock } from './blocks';
import { Senses } from './senses';
import { buildSound, createSoundField } from './sound';
import { SpatialHash } from './spatialHash';

// A dry world in permanent daylight, so each test places only the water it
// means to and sight does not change with the tick.
// Camouflage is off except in the tests about it, so colours do not decide who is seen,
// and temperature is off, so the land is all of one kind.
const config: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  dayLength: 0,
  camouflage: 0,
  temperatureStrength: 0,
};
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
      genes: { size, speed: 1, sensorRange: 1, diet, hue, fur: 0, defense: 0, mutationRate: 0.05 },
      brain,
      age: 900,
    });
  const sound = createSoundField(cfg);
  const sense = (c: Creatures, i: number, tick = 0) => {
    hash.build(c.x, c.y, c.count);
    buildSound(sound, c);
    const inputs = new Float32Array(INPUT_COUNT);
    new Senses(cfg, plants, hash, sound).sense(c, i, tick, inputs);
    return inputs;
  };
  return { plants, creatures, add, sense, sound };
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
    expect(inputs[ray(AHEAD) + Ray.Plants]).toBeCloseTo(0.25, 6);
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
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Wall]).toBeCloseTo(0.25, 6);
    plants.walls[cellIndexAt(plants, 210 + config.senseRange / 2, 210)] = 1;
    const inputs = sense(creatures, i);
    expect(inputs[ray(AHEAD) + Ray.Wall]).toBeCloseTo(0.75, 6);
    expect(inputs[ray(LEFT) + Ray.Wall]).toBe(0);
    plants.walls[cellIndexAt(plants, 210 + config.senseRange / 4, 210)] = 1;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Wall]).toBe(1);
  });

  it('sees water on the ray that crosses it, feels it underfoot, and feels thirst', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(210, 210, 0);
    plants.water[cellIndexAt(plants, 210 + config.senseRange, 210)] = 1;
    let inputs = sense(creatures, i);
    expect(inputs[ray(AHEAD) + Ray.Water]).toBeCloseTo(0.25, 6);
    expect(inputs[ray(LEFT) + Ray.Water]).toBe(0);
    expect(inputs[Input.InWater]).toBe(0);
    expect(inputs[Input.Thirst]).toBe(0);

    plants.water[cellIndexAt(plants, 210, 210)] = 1;
    creatures.hydration[i] = 0.25;
    inputs = sense(creatures, i);
    expect(inputs[Input.InWater]).toBe(1);
    expect(inputs[Input.Thirst]).toBeCloseTo(0.75, 6);
  });

  it('knows when it is sick, and tells another creature that is sick from one that is wounded', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    const other = add(230, 200, 0);
    let inputs = sense(creatures, i);
    expect(inputs[Input.Sick]).toBe(0);
    expect(inputs[ray(AHEAD) + Ray.Sick]).toBe(0);
    expect(inputs[ray(AHEAD) + Ray.Hurt]).toBe(0);

    creatures.health[other] = 0.25;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Hurt]).toBeCloseTo(0.75, 6);

    creatures.health[other] = 1;
    creatures.sick[i] = 100;
    creatures.sick[other] = 100;
    inputs = sense(creatures, i);
    expect(inputs[Input.Sick]).toBe(1);
    expect(inputs[ray(AHEAD) + Ray.Sick]).toBe(1);
    expect(inputs[ray(AHEAD) + Ray.Hurt]).toBe(0);
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

  it('hears a call on the side it comes from, and nothing when nobody calls', () => {
    const { creatures, add, sense } = setup();
    // Facing +x, so its right-hand side is +y. The sound cells here are 100 across.
    const i = add(150, 150, 0);
    const caller = add(150, 250, 0);
    let inputs = sense(creatures, i);
    expect(inputs[Input.HearLeft]).toBe(0);
    expect(inputs[Input.HearRight]).toBe(0);

    creatures.calling[caller] = 1;
    inputs = sense(creatures, i);
    expect(inputs[Input.HearRight]).toBe(1);
    expect(inputs[Input.HearRight]).toBeGreaterThan(inputs[Input.HearLeft]!);

    // Turned around, the same call is on its left.
    creatures.heading[i] = Math.PI;
    inputs = sense(creatures, i);
    expect(inputs[Input.HearLeft]).toBe(1);
    expect(inputs[Input.HearLeft]).toBeGreaterThan(inputs[Input.HearRight]!);
  });

  it('sees less far at night, and knows how light it is', () => {
    const { creatures, add, sense } = setup({ dayLength: 600, nightVision: 0.4 });
    const i = add(200, 200, 0);
    add(200 + config.senseRange * 0.7, 200, 0);
    const noon = sense(creatures, i, 0);
    expect(noon[Input.Daylight]).toBe(1);
    expect(noon[ray(AHEAD) + Ray.Near]).toBeCloseTo(0.3, 5);

    const midnight = sense(creatures, i, 300);
    expect(midnight[Input.Daylight]).toBeCloseTo(0, 6);
    // At 40% of its range, the other creature is now out of sight.
    expect(midnight[ray(AHEAD) + Ray.Near]).toBe(0);

    const dusk = sense(creatures, i, 150);
    expect(dusk[Input.Daylight]).toBeCloseTo(0.5, 6);
  });

  it('always reads full daylight when days are switched off', () => {
    const { creatures, add, sense } = setup({ dayLength: 0 });
    const i = add(200, 200, 0);
    for (const tick of [0, 150, 300, 451]) expect(sense(creatures, i, tick)[Input.Daylight]).toBe(1);
  });

  it('hears nothing when hearing is switched off', () => {
    const { creatures, add, sense } = setup({ hearing: false });
    const i = add(150, 150, 0);
    creatures.calling[add(150, 250, 0)] = 1;
    const inputs = sense(creatures, i);
    expect(inputs[Input.HearLeft]).toBe(0);
    expect(inputs[Input.HearRight]).toBe(0);
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
    const senses = new Senses(config, plants, hash, createSoundField(config));
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

describe('camouflage', () => {
  // The ground in these tests is bare, so its hue is the bare-soil brown.
  const far = config.senseRange * 0.8;
  const near = config.senseRange * 0.2;

  it('gives bare, grown, bloody and wet ground different hues', () => {
    const { plants } = setup();
    const bare = groundHue(plants, 0, config);
    plants.energy[1] = config.plantCapacity;
    const grown = groundHue(plants, 1, config);
    plants.meat[2] = config.meatScale;
    plants.water[3] = 1;
    expect(grown).toBeGreaterThan(bare + 0.2);
    expect(groundHue(plants, 2, config)).toBe(0);
    expect(groundHue(plants, 3, config)).toBeGreaterThan(grown);
  });

  it('hides a matching creature fully and a clashing one not at all', () => {
    expect(visibility(0.3, 0.3, 0.7)).toBeCloseTo(0.3, 6);
    expect(visibility(0.8, 0.3, 0.7)).toBe(1);
    // Hue is a circle: 0.98 and 0.02 are close.
    expect(visibility(0.98, 0.02, 0.7)).toBeLessThan(0.5);
    expect(visibility(0.3, 0.3, 0)).toBe(1);
  });

  it('hides a ground-coloured creature at a distance but not close up', () => {
    const { plants, creatures, add, sense } = setup({ camouflage: 0.7 });
    const soil = groundHue(plants, 0, config);
    const i = add(200, 200, 0);
    const other = add(200 + far, 200, 0, soil);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBe(0);
    creatures.x[other] = 200 + near;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBeGreaterThan(0);
  });

  it('shows a creature that clashes with the ground at any distance in range', () => {
    const { plants, creatures, add, sense } = setup({ camouflage: 0.7 });
    const i = add(200, 200, 0);
    add(200 + far, 200, 0, groundHue(plants, 0, config) + 0.5);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBeGreaterThan(0);
  });

  it('does nothing when switched off', () => {
    const { plants, creatures, add, sense } = setup({ camouflage: 0 });
    const i = add(200, 200, 0);
    add(200 + far, 200, 0, groundHue(plants, 0, config));
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Near]).toBeGreaterThan(0);
  });
});

describe('blocks and sight', () => {
  it('hide a creature behind them, in part or wholly, and let it be seen once they are gone', () => {
    const run = (overrides: Partial<SimConfig>, block: boolean) => {
      const { plants, creatures, add, sense } = setup(overrides);
      const watcher = add(100, 100, 0);
      add(145, 100, 0);
      if (block) addBlock(plants, cellIndexAt(plants, 125, 100));
      return sense(creatures, watcher)[ray(AHEAD) + Ray.Near]!;
    };
    expect(run({ blockCover: 1 }, false)).toBeGreaterThan(0);
    expect(run({ blockCover: 1 }, true)).toBe(0);
    expect(run({ blockCover: 0 }, true)).toBeGreaterThan(0);
  });

  it('read below zero ahead when heavy, above when light', () => {
    for (const heavy of [false, true]) {
      const { plants, creatures, add, sense } = setup();
      const watcher = add(100, 100, 0);
      addBlock(plants, cellIndexAt(plants, 125, 100), 0, false, heavy);
      const value = sense(creatures, watcher)[ray(AHEAD) + Ray.Block]!;
      expect(heavy ? value < 0 : value > 0).toBe(true);
    }
  });

  it('see a block pressed right up against them, and feel which kind is in front', () => {
    for (const heavy of [false, true]) {
      const { plants, creatures, add, sense } = setup();
      // At the far edge of its own cell, flush against the block in the next.
      const watcher = add(119.5, 110, 0);
      addBlock(plants, cellIndexAt(plants, 130, 110), 0, false, heavy);
      const inputs = sense(creatures, watcher);
      expect(inputs[ray(AHEAD) + Ray.Block]).toBe(heavy ? -1 : 1);
      expect(inputs[Input.Facing]).toBe(heavy ? -1 : 1);
    }
  });

  it('hide the ground behind them, and a wall hides the creature behind it', () => {
    const { plants, creatures, add, sense } = setup();
    const watcher = add(100, 110, 0);
    plants.energy[cellIndexAt(plants, 160, 110)] = config.plantCapacity;
    expect(sense(creatures, watcher)[ray(AHEAD) + Ray.Plants]).toBeGreaterThan(0);
    addBlock(plants, cellIndexAt(plants, 130, 110));
    expect(sense(creatures, watcher)[ray(AHEAD) + Ray.Plants]).toBe(0);

    const walled = setup();
    const looker = walled.add(100, 110, 0);
    walled.add(145, 110, 0);
    expect(walled.sense(walled.creatures, looker)[ray(AHEAD) + Ray.Near]).toBeGreaterThan(0);
    walled.plants.walls[cellIndexAt(walled.plants, 125, 110)] = 1;
    expect(walled.sense(walled.creatures, looker)[ray(AHEAD) + Ray.Near]).toBe(0);
  });

  it('feel shelter in or beside a block, unless shelter is switched off', () => {
    for (const shelter of [defaultConfig.shelter, 0]) {
      const { plants, creatures, add, sense } = setup({ shelter });
      const i = add(110, 110, Math.PI / 2);
      expect(sense(creatures, i)[Input.Sheltered]).toBe(0);
      addBlock(plants, cellIndexAt(plants, 130, 110));
      expect(sense(creatures, i)[Input.Sheltered]).toBe(shelter > 0 ? 1 : 0);
    }
  });
});

describe('items, stores and shore along the rays', () => {
  it('tell a stone ahead from a branch ahead', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(100, 110, 0);
    plants.stones[cellIndexAt(plants, 145, 110)] = 1;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Items]).toBeGreaterThan(0);
    plants.stones[cellIndexAt(plants, 145, 110)] = 0;
    plants.branches[cellIndexAt(plants, 145, 110)] = 1;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Items]).toBeLessThan(0);
  });

  it('see a store of dropped food from a distance, stronger when nearer', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(100, 110, 0);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Store]).toBe(0);
    plants.store[cellIndexAt(plants, 160, 110)] = config.biteSize * 4;
    const far = sense(creatures, i)[ray(AHEAD) + Ray.Store]!;
    expect(far).toBeGreaterThan(0);
    plants.store[cellIndexAt(plants, 130, 110)] = config.biteSize * 4;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Store]).toBeGreaterThan(far);
  });

  it('show the way to land while swimming', () => {
    const { plants, creatures, add, sense } = setup();
    const i = add(110, 110, 0);
    plants.water.fill(1);
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Water]).toBe(0);
    plants.water[cellIndexAt(plants, 160, 110)] = 0;
    expect(sense(creatures, i)[ray(AHEAD) + Ray.Water]).toBeGreaterThan(0);
    expect(sense(creatures, i)[ray(LEFT) + Ray.Water]).toBe(0);
  });
});

describe('what is behind', () => {
  it('feels which side the creature behind is on, and what it eats', () => {
    const { creatures, add, sense } = setup();
    const i = add(200, 200, 0);
    let inputs = sense(creatures, i);
    expect(inputs[Input.BehindSide]).toBe(0);
    expect(inputs[Input.BehindMeatEater]).toBe(0);
    // Behind and to its right (+y is right when heading along +x).
    const other = add(185, 215, 0, 0.5, 1, 1);
    inputs = sense(creatures, i);
    expect(inputs[Input.BehindSide]).toBeGreaterThan(0.5);
    expect(inputs[Input.BehindMeatEater]).toBe(1);
    creatures.y[other] = 185;
    creatures.diet[other] = 0;
    inputs = sense(creatures, i);
    expect(inputs[Input.BehindSide]).toBeLessThan(-0.5);
    expect(inputs[Input.BehindMeatEater]).toBe(-1);
  });
});

describe('hearing', () => {
  it('does not hear its own call', () => {
    const { creatures, add, sense } = setup();
    const caller = add(150, 150, 0);
    creatures.calling[caller] = 1;
    let inputs = sense(creatures, caller);
    expect(inputs[Input.HearLeft]).toBe(0);
    expect(inputs[Input.HearRight]).toBe(0);
    // Another caller nearby is still heard.
    const other = add(150, 50, 0);
    creatures.calling[other] = 1;
    inputs = sense(creatures, caller);
    expect(inputs[Input.HearLeft]).toBeGreaterThan(0);
  });
});
