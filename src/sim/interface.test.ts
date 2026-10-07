import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, INPUTS_PER_RAY, Output, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { spawnCreature } from './creatures';
import { founderGenes } from './genome';
import { Rng } from './rng';
import { createWorld, step, type World } from './world';

/** One creature alone on rich ground, so a single output's effect shows. */
const lone: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  initialCreatures: 1,
  minPopulation: 0,
  plantCapacity: 24,
  camouflage: 0,
  reproduceThreshold: 2,
  randomEvents: false,
};

/** A brain that holds one output at a fixed value through the always-on Bias input. */
function holding(output: number, weight: number) {
  return compileBrain([{ innovation: 0, from: Input.Bias, to: INPUT_COUNT + output, weight, enabled: true }], []);
}

function worldWith(overrides: Partial<SimConfig>, brain: ReturnType<typeof holding> | null): World {
  const world = createWorld({ ...lone, ...overrides });
  if (brain) world.creatures.brain[0] = brain;
  return world;
}

function energyAfter(world: World, ticks: number): number {
  for (let i = 0; i < ticks; i++) step(world);
  return world.creatures.energy[0]!;
}

describe('the Eat output', () => {
  it('leaves eating on when nothing is wired to it', () => {
    const unwired = energyAfter(worldWith({}, compileBrain([], [])), 5);
    const start = lone.creatureStartEnergy;
    expect(unwired).toBeGreaterThan(start);
  });

  it('stops a creature eating when the brain switches it off', () => {
    const off = energyAfter(worldWith({}, holding(Output.Eat, -4)), 5);
    const on = energyAfter(worldWith({}, compileBrain([], [])), 5);
    expect(off).toBeLessThan(lone.creatureStartEnergy);
    expect(on).toBeGreaterThan(off);
  });
});

describe('the Display output', () => {
  it('shows nothing unless the brain asks, and shows more when it does', () => {
    const quiet = worldWith({}, compileBrain([], []));
    const bright = worldWith({}, holding(Output.Display, 4));
    step(quiet);
    step(bright);
    expect(quiet.creatures.display[0]).toBe(0);
    expect(bright.creatures.display[0]!).toBeGreaterThan(0.9);
  });

  it('costs energy in proportion to the brightness', () => {
    // Nothing to eat, so energy only falls, and the difference is the display.
    const base = { plantCapacity: 0, displayCost: 0.05 };
    const quiet = energyAfter(worldWith(base, compileBrain([], [])), 20);
    const bright = energyAfter(worldWith(base, holding(Output.Display, 4)), 20);
    expect(quiet - bright).toBeGreaterThan(0.05 * 20 * 0.9);
    expect(quiet - bright).toBeLessThan(0.05 * 20 * 1.1);
  });

  it('is seen by a creature looking at it, on the ray it is in', () => {
    const world = worldWith({ plantCapacity: 0 }, compileBrain([], []));
    const { creatures } = world;
    creatures.x[0] = 200;
    creatures.y[0] = 200;
    creatures.heading[0] = 0;
    const genes = founderGenes(new Rng('watched'), world.config);
    const other = spawnCreature(creatures, {
      x: 220,
      y: 200,
      heading: 0,
      energy: 40,
      genes,
      brain: holding(Output.Display, 4),
    });
    // It shows on its own turn and is seen on the next tick.
    step(world);
    step(world);
    const ahead = Input.Rays + 1 * INPUTS_PER_RAY + Ray.Display;
    expect(creatures.display[other]!).toBeGreaterThan(0.9);
    expect(creatures.brain[0]!.activation[ahead]!).toBeGreaterThan(0.9);
    expect(creatures.brain[0]!.activation[Input.Rays + Ray.Display]!).toBe(0);
  });
});

describe('the Energy trend sense', () => {
  it('rises while a creature is feeding and falls while it is not', () => {
    const feeding = worldWith({}, compileBrain([], []));
    for (let i = 0; i < 10; i++) step(feeding);
    expect(feeding.creatures.brain[0]!.activation[Input.EnergyTrend]!).toBeGreaterThan(0);

    const starving = worldWith({ plantCapacity: 0 }, compileBrain([], []));
    for (let i = 0; i < 10; i++) step(starving);
    expect(starving.creatures.brain[0]!.activation[Input.EnergyTrend]!).toBeLessThan(0);
  });
});
