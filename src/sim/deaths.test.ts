import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, Output } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { spawnCreature } from './creatures';
import { createWorld, step } from './world';

/** An empty, plain, still world: the creatures placed by hand are all that is in it. */
const arena: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  initialCreatures: 0,
  minPopulation: 0,
  reproduceThreshold: 2,
  temperatureStrength: 0,
  camouflage: 0,
  dayLength: 0,
  seasonLength: 0,
  fertilityDriftPeriod: 0,
  healRate: 0,
};

const genes = { size: 1, speed: 1, sensorRange: 1, diet: 1, hue: 0.9, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 };

/** A brain whose outputs are each held fully on or off by a bias link. */
function brainOf(outputs: Partial<Record<keyof typeof Output, number>>) {
  return compileBrain(
    Object.entries(outputs).map(([name, weight], k) => ({
      innovation: k,
      from: Input.Bias,
      to: INPUT_COUNT + Output[name as keyof typeof Output],
      weight: weight!,
      enabled: true,
    })),
    [],
  );
}

describe('the cause of a death', () => {
  it('is a kill, not a disaster, when a big meat-eater kills a small creature in one bite', () => {
    const world = createWorld(arena);
    const { creatures, config } = world;
    spawnCreature(creatures, {
      x: 200, y: 200, heading: 0, energy: 50,
      genes: { ...genes, size: 3 },
      brain: brainOf({ Attack: 5, Thrust: -5 }),
    });
    spawnCreature(creatures, {
      x: 200 + config.creatureRadius * 3.4 + 2, y: 200, heading: 0, energy: 5,
      genes: { ...genes, size: 0.4, diet: 0, hue: 0.4 },
      brain: brainOf({ Thrust: -5 }),
    });
    step(world);
    expect(creatures.count).toBe(1);
    expect(world.deaths.killed).toBe(1);
    expect(world.deaths.disaster).toBe(0);
  });
});

describe('a creature killed during its own turn', () => {
  it('does not go on to have young', () => {
    const world = createWorld({ ...arena, reproduceThreshold: 0, minReproduceAge: 0, plagueDeathChance: 1 });
    const { creatures } = world;
    const i = spawnCreature(creatures, {
      x: 200, y: 200, heading: 0, energy: 80, genes,
      brain: brainOf({ Reproduce: 5, Thrust: -5 }),
    });
    creatures.sick[i] = 10;
    step(world);
    expect(world.births).toBe(0);
    expect(creatures.count).toBe(0);
    expect(world.deaths.disaster).toBe(1);
  });
});
