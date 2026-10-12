import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, INPUT_LABELS, Output, OUTPUT_COUNT, OUTPUT_LABELS } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { Held, spawnCreature } from './creatures';
import { biteFor } from './genome';
import { expectedEnergy } from './ledger';
import { cellIndexAt } from './plants';
import { PRESETS } from './presets';
import { createWorld, hashWorld, step, totalEnergy } from './world';

/** An empty, plain, still world with no food: creatures placed by hand are all that is in it. */
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
  fireChance: 0,
  branchRegrowTicks: 0,
  healRate: 0,
  plantCapacity: 0,
};

type Wiring = Partial<Record<keyof typeof Output, number>>;

/** A brain whose outputs are held at fixed values by the bias. Unlisted outputs sit at zero; thrust defaults to still. */
function brainOf(wiring: Wiring) {
  const outputs: Wiring = { Thrust: -5, ...wiring };
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

function setup(overrides: Partial<SimConfig> = {}) {
  const world = createWorld({ ...arena, ...overrides });
  const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0.9, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 };
  const add = (x: number, wiring: Wiring, diet = 0) =>
    spawnCreature(world.creatures, {
      x,
      y: 210,
      heading: 0,
      energy: 50,
      genes: { ...genes, diet },
      brain: brainOf(wiring),
    });
  const cellAt = (i: number) => cellIndexAt(world.plants, world.creatures.x[i]!, world.creatures.y[i]!);
  /** Make the books balance as the world stands, after a test has put energy in by hand. */
  const settle = () => {
    const { ledger } = world;
    ledger.initial = totalEnergy(world) - ledger.sunIn - ledger.seedIn + ledger.heatOut;
  };
  return { world, add, cellAt, settle };
}

describe('the hold action', () => {
  it('has a label, and the new senses have theirs', () => {
    expect(OUTPUT_LABELS).toHaveLength(OUTPUT_COUNT);
    expect(OUTPUT_LABELS[Output.Hold]).toBe('Hold');
    expect(INPUT_LABELS).toHaveLength(INPUT_COUNT);
    expect(INPUT_LABELS[Input.HoldingFood]).toBe('Holding food');
  });

  it('picks up a stone underfoot, keeps it, and sets it down on letting go', () => {
    const { world, add, cellAt } = setup();
    const i = add(210, { Hold: 5 });
    world.plants.stones[cellAt(i)] = 1;
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Stone);
    expect(world.plants.stones[cellAt(i)]).toBe(0);
    expect(world.carry.pickups).toBe(1);
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Stone);

    world.creatures.brain[i] = brainOf({ Hold: -5 });
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Nothing);
    expect(world.plants.stones[cellAt(i)]).toBe(1);
  });

  it('prefers a stone to a branch, and a branch to food', () => {
    const { world, add, cellAt } = setup();
    const i = add(210, { Hold: 5 });
    const cell = cellAt(i);
    world.plants.stones[cell] = 1;
    world.plants.branches[cell] = 1;
    world.plants.meat[cell] = 50;
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Stone);
    const j = add(210, { Hold: 5 });
    step(world);
    expect(world.creatures.held[j]).toBe(Held.Branch);
    const k = add(210, { Hold: 5 });
    step(world);
    expect(world.creatures.held[k]).toBe(Held.Meat);
  });

  it('does nothing empty-handed where there is nothing to pick up', () => {
    const { world, add } = setup();
    const i = add(210, { Hold: 5 });
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Nothing);
    expect(world.carry.pickups).toBe(0);
  });

  it('slows the holder', () => {
    const moved = (stone: number) => {
      const { world, add, cellAt } = setup();
      const i = add(210, { Hold: 5, Thrust: 5 });
      world.plants.stones[cellAt(i)] = stone;
      // The first step picks the stone up; measure the second.
      step(world);
      const from = world.creatures.x[i]!;
      step(world);
      return world.creatures.x[i]! - from;
    };
    expect(moved(1)).toBeCloseTo(moved(0) * (1 - arena.carrySlow), 4);
  });

  it('drops what was held when the holder dies', () => {
    const { world, add, cellAt } = setup();
    const i = add(210, { Hold: 5 });
    const cell = cellAt(i);
    world.plants.stones[cell] = 1;
    step(world);
    world.creatures.energy[i] = 0;
    step(world);
    expect(world.creatures.count).toBe(0);
    expect(world.plants.stones[cell]).toBe(1);
  });
});

describe('a stone and a branch in a fight', () => {
  function bite(biterHolds: number, victimHolds: number) {
    const { world, add } = setup();
    const biter = add(200, { Attack: 5 }, 1);
    const victim = add(200 + world.config.creatureRadius * 2 + 2, {});
    world.creatures.held[biter] = biterHolds;
    world.creatures.held[victim] = victimHolds;
    // Both keep their grip: the output at zero counts as letting go, so hold on.
    world.creatures.brain[biter] = brainOf({ Attack: 5, Hold: 5 });
    world.creatures.brain[victim] = brainOf({ Hold: 5 });
    step(world);
    return 1 - world.creatures.health[victim]!;
  }

  it('make the bite stronger with a stone and weaker against a branch', () => {
    const plain = bite(Held.Nothing, Held.Nothing);
    expect(plain).toBeGreaterThan(0);
    expect(bite(Held.Stone, Held.Nothing)).toBeCloseTo(plain * (1 + arena.stoneBite), 5);
    expect(bite(Held.Nothing, Held.Branch)).toBeCloseTo(plain * (1 - arena.branchShield), 5);
  });
});

describe('carrying food', () => {
  it('picks up a load of meat and sets it down elsewhere, keeping energy conserved', () => {
    const { world, add, cellAt, settle } = setup();
    const i = add(210, { Hold: 5, Thrust: 5 });
    const from = cellAt(i);
    world.plants.meat[from] = 30;
    settle();
    step(world);
    const load = biteFor(1, world.config) * world.config.carryMouthfuls;
    expect(world.creatures.held[i]).toBe(Held.Meat);
    expect(world.creatures.heldEnergy[i]).toBeCloseTo(load, 6);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);

    for (let k = 0; k < 40; k++) step(world);
    world.creatures.brain[i] = brainOf({ Hold: -5 });
    step(world);
    const to = cellAt(i);
    expect(to).not.toBe(from);
    expect(world.creatures.held[i]).toBe(Held.Nothing);
    expect(world.plants.meat[to]).toBeGreaterThan(load * 0.9);
    expect(world.carry.meatDropped).toBeCloseTo(load, 6);
    expect(world.carry.haul / world.carry.meatDropped).toBeGreaterThan(20);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('turns dropped plant food into a store that can be eaten and slowly spoils', () => {
    const { world, add, cellAt, settle } = setup({ storeDecay: 0.01 });
    const i = add(210, { Hold: 5 });
    const cell = cellAt(i);
    // Plants are put straight in the cell; with no capacity nothing regrows.
    world.plants.energy[cell] = 20;
    settle();
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Plants);
    const load = world.creatures.heldEnergy[i]!;
    expect(load).toBeGreaterThan(0);

    world.creatures.brain[i] = brainOf({ Hold: -5 });
    // Full, so it eats none of what it sets down.
    world.creatures.energy[i] = world.config.creatureMaxEnergy;
    settle();
    step(world);
    expect(world.plants.store[cell]).toBeCloseTo(load, 6);
    expect(world.carry.plantsDropped).toBeCloseTo(load, 6);

    const before = world.plants.store[cell]!;
    step(world);
    expect(world.plants.store[cell]).toBeLessThan(before);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);

    // A hungry creature eats from the store.
    world.creatures.energy[i] = 5;
    settle();
    const stored = world.plants.store[cell]!;
    step(world);
    expect(world.plants.store[cell]).toBeLessThan(stored * 0.99);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('feels what it holds and what lies underfoot', () => {
    const { world, add, cellAt } = setup();
    const i = add(210, { Hold: 5 });
    world.plants.stones[cellAt(i)] = 2;
    step(world);
    step(world);
    const inputs = world.creatures.brain[i]!.activation;
    expect(inputs[Input.HoldingTool]).toBe(1);
    expect(inputs[Input.ItemUnderfoot]).toBe(1);
    expect(inputs[Input.HoldingFood]).toBe(0);
  });
});

describe('a whole world with carrying', () => {
  const small: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 80,
    minPopulation: 5,
    maxCreatures: 500,
    seed: 'haul',
  };

  it('conserves energy and stays deterministic', () => {
    const run = () => {
      const world = createWorld(small);
      for (let k = 0; k < 2500; k++) step(world);
      return world;
    };
    const world = run();
    expect(world.carry.pickups).toBeGreaterThan(0);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 4);
    expect(hashWorld(world)).toBe(hashWorld(run()));
  });
});

describe('presets', () => {
  it('include Long lives at 10,000 ticks, with the default lifespan still 5,000', () => {
    expect(PRESETS.find((preset) => preset.id === 'longLives')?.overrides.maxAge).toBe(10000);
    expect(defaultConfig.maxAge).toBe(5000);
  });
});
