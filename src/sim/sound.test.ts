import { describe, expect, it } from 'vitest';
import { compileBrain, INPUT_COUNT, Input, Output, type LinkGene } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { loadWorld, saveWorld } from './serialize';
import { buildSound, createSoundField, soundCellAt } from './sound';
import { createWorld, hashWorld, step, totalEnergy, type World } from './world';

const config: SimConfig = { ...defaultConfig, worldWidth: 500, worldHeight: 500, waterShare: 0 };
const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.1, hue: 0.5, fur: 0, defense: 0, mutationRate: 0.05 };

function creaturesAt(points: [number, number, boolean][]) {
  const c = createCreatures(8);
  for (const [x, y, calling] of points) {
    const i = spawnCreature(c, { x, y, heading: 0, energy: 1, genes, brain: compileBrain([], []) });
    c.calling[i] = calling ? 1 : 0;
  }
  return c;
}

describe('sound field', () => {
  it('is loudest in the caller’s cell and carries, fainter, to the cells around', () => {
    const field = createSoundField(config);
    expect(field.cols).toBe(5);
    const count = buildSound(field, creaturesAt([[250, 250, true]]));
    expect(count).toBe(1);
    expect(field.loudness[soundCellAt(field, 250, 250)]).toBe(1);
    expect(field.loudness[soundCellAt(field, 350, 250)]).toBe(0.5);
    expect(field.loudness[soundCellAt(field, 250, 150)]).toBe(0.5);
    expect(field.loudness[soundCellAt(field, 350, 350)]).toBe(0.25);
    expect(field.loudness[soundCellAt(field, 450, 250)]).toBe(0);
  });

  it('wraps around the edges of the world', () => {
    const field = createSoundField(config);
    buildSound(field, creaturesAt([[50, 50, true]]));
    expect(field.loudness[soundCellAt(field, 450, 50)]).toBe(0.5);
    expect(field.loudness[soundCellAt(field, 50, 450)]).toBe(0.5);
    expect(field.loudness[soundCellAt(field, 450, 450)]).toBe(0.25);
  });

  it('adds up several callers and ignores the silent', () => {
    const field = createSoundField(config);
    const count = buildSound(
      field,
      creaturesAt([
        [250, 250, true],
        [260, 240, true],
        [350, 250, true],
        [250, 260, false],
      ]),
    );
    expect(count).toBe(3);
    expect(field.loudness[soundCellAt(field, 250, 250)]).toBe(2.5);
  });

  it('falls silent as soon as nobody is calling', () => {
    const field = createSoundField(config);
    buildSound(field, creaturesAt([[250, 250, true]]));
    expect(buildSound(field, creaturesAt([[250, 250, false]]))).toBe(0);
    expect(field.loudness.every((value) => value === 0)).toBe(true);
  });
});

/** A world of creatures whose brains are replaced by one fixed set of links. */
function scriptedWorld(links: LinkGene[], overrides: Partial<SimConfig> = {}): World {
  const world = createWorld({
    ...config,
    initialCreatures: 2,
    minPopulation: 0,
    attackDamage: 0,
    reproduceThreshold: 2,
    founderLinks: 0,
    ...overrides,
  });
  const { creatures } = world;
  for (let i = 0; i < creatures.count; i++) {
    creatures.brain[i] = compileBrain(
      links.map((link) => ({ ...link })),
      [],
    );
    creatures.speed[i] = 0;
    creatures.age[i] = 0;
  }
  return world;
}

const biasTo = (output: number, weight: number, innovation: number): LinkGene => ({
  innovation,
  from: Input.Bias,
  to: INPUT_COUNT + output,
  weight,
  enabled: true,
});

describe('calling in the world', () => {
  it('marks callers, counts their calls and charges for them', () => {
    const calling = scriptedWorld([biasTo(Output.Call, 5, 0)]);
    const silent = scriptedWorld([biasTo(Output.Call, -5, 0)]);
    for (let t = 0; t < 10; t++) {
      step(calling);
      step(silent);
    }
    expect(Array.from(calling.creatures.calling.subarray(0, 2))).toEqual([1, 1]);
    expect(Array.from(silent.creatures.calling.subarray(0, 2))).toEqual([0, 0]);
    // A call made on one tick is heard, and counted, on the next.
    expect(calling.social.calls).toBe(18);
    expect(calling.social.calling).toBe(2);
    expect(silent.social.calls).toBe(0);
    expect(calling.ledger.heatOut - silent.ledger.heatOut).toBeCloseTo(20 * config.callCost, 6);
  });
});

describe('giving', () => {
  /** Two creatures face to face and touching; the first gives if its brain says so. */
  function pair(giveWeight: number, hues: [number, number] = [0.5, 0.5]) {
    // Nothing to eat and nothing to pay, so giving is the only thing that moves energy.
    const world = scriptedWorld([biasTo(Output.Give, giveWeight, 0)], {
      plantCapacity: 0,
      upkeepCost: 0,
      senseCost: 0,
      brainLinkCost: 0,
    });
    const { creatures } = world;
    creatures.size[0] = creatures.size[1] = 1;
    creatures.x[0] = 240;
    creatures.x[1] = 252;
    creatures.y[0] = creatures.y[1] = 250;
    creatures.heading[0] = 0;
    creatures.heading[1] = Math.PI;
    creatures.energy[0] = 60;
    creatures.energy[1] = 10;
    creatures.hue[0] = hues[0];
    creatures.hue[1] = hues[1];
    // The second never gives back.
    creatures.brain[1] = compileBrain([biasTo(Output.Give, -5, 0)], []);
    return world;
  }

  it('passes energy to the creature in front, conserving the total', () => {
    const world = pair(5);
    const before = totalEnergy(world);
    step(world);
    const { creatures } = world;
    expect(creatures.energy[0]).toBeCloseTo(60 - config.giveRate, 6);
    expect(creatures.energy[1]).toBeCloseTo(10 + config.giveRate, 6);
    expect(world.social.given).toBeCloseTo(config.giveRate, 6);
    expect(world.social.givenToKin).toBeCloseTo(config.giveRate, 6);
    // Nothing was made or lost: what one gave, the other received.
    expect(totalEnergy(world)).toBeCloseTo(before, 6);
  });

  it('does not happen when the brain does not ask for it', () => {
    const world = pair(-5);
    step(world);
    expect(world.social.given).toBe(0);
    expect(world.creatures.energy[1]).toBe(10);
  });

  it('counts a gift to a differently coloured creature as not to kin', () => {
    const world = pair(5, [0.5, 0.9]);
    step(world);
    expect(world.social.given).toBeGreaterThan(0);
    expect(world.social.givenToKin).toBe(0);
  });

  it('never gives more than the receiver has room for', () => {
    const world = pair(5);
    world.creatures.energy[1] = config.creatureMaxEnergy - 0.1;
    step(world);
    expect(world.creatures.energy[1]).toBeLessThanOrEqual(config.creatureMaxEnergy + 1e-9);
    expect(world.social.given).toBeCloseTo(0.1, 5);
  });

  it('gives only from what it holds above its reserve', () => {
    const world = pair(5);
    const reserve = config.giveReserve * config.creatureMaxEnergy;
    world.creatures.energy[0] = reserve + 0.2;
    step(world);
    expect(world.social.given).toBeCloseTo(0.2, 5);
    step(world);
    expect(world.social.given).toBeCloseTo(0.2, 5);
    expect(world.creatures.energy[0]).toBeCloseTo(reserve, 5);
  });

  it('needs the other creature within reach', () => {
    const world = pair(5);
    world.creatures.x[1] = 290;
    step(world);
    expect(world.social.given).toBe(0);
  });
});

describe('saving a world with calls and gifts', () => {
  it('continues exactly as the original would have', () => {
    const world = createWorld({ ...config, worldWidth: 800, worldHeight: 800, initialCreatures: 80, waterShare: 0.15 });
    for (let t = 0; t < 400; t++) step(world);
    const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
    expect(copy.social).toEqual(world.social);
    for (let t = 0; t < 400; t++) {
      step(world);
      step(copy);
    }
    expect(hashWorld(copy)).toBe(hashWorld(world));
    expect(copy.social).toEqual(world.social);
  });
});
