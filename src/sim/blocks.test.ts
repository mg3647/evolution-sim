import { describe, expect, it } from 'vitest';
import { Biome } from './biomes';
import {
  addBlock,
  canHoldBlock,
  blockBetween,
  cellBeyond,
  freeCellNear,
  isSolid,
  longestBuiltLine,
  pushBlock,
  rebuildNearBlocks,
  removeBlock,
  scatterBlocks,
} from './blocks';
import { compileBrain, Input, INPUT_COUNT, INPUT_LABELS, INPUTS_PER_RAY, Output, Ray } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { Held, spawnCreature } from './creatures';
import { ignite, createFireTally } from './fire';
import { createLedger, expectedEnergy } from './ledger';
import { cellIndexAt, createPlantField, spoilStores } from './plants';
import { Rng } from './rng';
import { loadWorld, saveWorld } from './serialize';
import { applyTool, createWorld, hashWorld, step, totalEnergy } from './world';

/** A small, plain, still world with no blocks but the ones a test puts in it. */
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
  blockDensity: 0,
  plantCapacity: 0,
};

const field = (overrides: Partial<SimConfig> = {}) => createPlantField({ ...arena, ...overrides }, new Rng('blocks'));
const at = (cx: number, cy: number) => cy * 20 + cx;

type Wiring = Partial<Record<keyof typeof Output, number>>;
function brainOf(wiring: Wiring) {
  return compileBrain(
    Object.entries(wiring).map(([name, weight], k) => ({
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
  const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0.9, fur: 0, defense: 0, mutationRate: 0.05 };
  // Standing in the middle of cell (10, 10), facing along +x.
  const add = (wiring: Wiring, x = 210, y = 210) =>
    spawnCreature(world.creatures, { x, y, heading: 0, energy: 50, genes, brain: brainOf(wiring), species: 7 });
  return { world, add };
}

describe('a block on the map', () => {
  it('is solid, and counts itself and its eight neighbours as beside it', () => {
    const f = field();
    addBlock(f, at(5, 5));
    expect(isSolid(f, at(5, 5))).toBe(true);
    expect(canHoldBlock(f, at(5, 5))).toBe(false);
    expect(f.nearBlocks[at(5, 5)]).toBe(1);
    expect(f.nearBlocks[at(4, 4)]).toBe(1);
    expect(f.nearBlocks[at(6, 5)]).toBe(1);
    expect(f.nearBlocks[at(7, 5)]).toBe(0);
    addBlock(f, at(6, 5));
    expect(f.nearBlocks[at(5, 5)]).toBe(2);
    expect(removeBlock(f, at(5, 5))).toBe(true);
    expect(removeBlock(f, at(5, 5))).toBe(false);
    expect(f.nearBlocks[at(4, 4)]).toBe(0);
    expect(f.nearBlocks[at(5, 5)]).toBe(1);
  });

  it('wraps round the edges of the world when counting what is beside it', () => {
    const f = field();
    addBlock(f, at(0, 0));
    expect(f.nearBlocks[at(19, 19)]).toBe(1);
    const counted = Array.from(f.nearBlocks);
    rebuildNearBlocks(f);
    expect(Array.from(f.nearBlocks)).toEqual(counted);
  });

  it('cannot stand in water or on a wall', () => {
    const f = field();
    f.water[at(3, 3)] = 1;
    f.walls[at(4, 4)] = 1;
    expect(canHoldBlock(f, at(3, 3))).toBe(false);
    expect(canHoldBlock(f, at(4, 4))).toBe(false);
    expect(freeCellNear(f, at(4, 4))).toBeGreaterThanOrEqual(0);
    expect(freeCellNear(f, at(4, 4))).not.toBe(at(4, 4));
  });

  it('does not burn, and shelters stored food beside it from spoiling', () => {
    const f = field({ plantCapacity: 24 });
    f.energy.fill(24);
    addBlock(f, at(5, 5));
    expect(ignite(f, at(5, 5), { ...arena, plantCapacity: 24 }, createFireTally())).toBe(false);
    f.store[at(5, 6)] = 10;
    f.store[at(9, 9)] = 10;
    spoilStores(f, 0.1, createLedger(), 0.5);
    expect(10 - f.store[at(5, 6)]!).toBeCloseTo((10 - f.store[at(9, 9)]!) / 2, 9);
  });

  it('is scattered at about the configured density, thicker in desert and tundra', () => {
    const f = field({ blockDensity: 0.05 });
    const half = f.biome.length / 2;
    f.biome.fill(Biome.Grassland, 0, half);
    f.biome.fill(Biome.Desert, half);
    scatterBlocks(f, { ...arena, blockDensity: 0.05 }, new Rng('scatter'));
    const count = (from: number, to: number) => f.blocks.subarray(from, to).reduce((a, b) => a + b, 0);
    const total = count(0, f.biome.length);
    expect(total / f.biome.length).toBeGreaterThan(0.02);
    expect(total / f.biome.length).toBeLessThan(0.09);
    expect(count(half, f.biome.length)).toBeGreaterThan(count(0, half));
  });
});

describe('pushing', () => {
  it('finds the cell beyond, the short way round the world', () => {
    const f = field();
    expect(cellBeyond(f, at(5, 5), at(6, 5))).toBe(at(7, 5));
    expect(cellBeyond(f, at(5, 5), at(6, 6))).toBe(at(7, 7));
    expect(cellBeyond(f, at(19, 5), at(0, 5))).toBe(at(1, 5));
    expect(cellBeyond(f, at(5, 5), at(5, 5))).toBe(-1);
  });

  it('shoves a block one cell on and records who did it', () => {
    const f = field();
    addBlock(f, at(6, 5));
    expect(pushBlock(f, at(5, 5), at(6, 5), 9)).toBe(true);
    expect(f.blocks[at(6, 5)]).toBe(0);
    expect(f.blocks[at(7, 5)]).toBe(1);
    expect(f.blockSpecies[at(7, 5)]).toBe(9);
    expect(f.blockBuilt[at(7, 5)]).toBe(1);
  });

  it('fails against a wall, another block or water', () => {
    for (const obstacle of ['wall', 'block', 'water'] as const) {
      const f = field();
      addBlock(f, at(6, 5));
      if (obstacle === 'wall') f.walls[at(7, 5)] = 1;
      else if (obstacle === 'block') addBlock(f, at(7, 5));
      else f.water[at(7, 5)] = 1;
      expect(pushBlock(f, at(5, 5), at(6, 5), 9)).toBe(false);
      expect(f.blocks[at(6, 5)]).toBe(1);
      expect(f.blockBuilt[at(6, 5)]).toBe(0);
    }
  });

  it('happens when a creature grabs as it walks into a block, and stops it when the block cannot move', () => {
    const { world, add } = setup();
    const i = add({ Thrust: 5, Hold: 5 });
    addBlock(world.plants, at(11, 10));
    for (let k = 0; k < 40; k++) step(world);
    expect(world.blockTally.pushed).toBeGreaterThan(0);
    expect(world.plants.blocks[at(11, 10)]).toBe(0);
    expect(world.creatures.x[i]).toBeGreaterThan(225);

    const stuck = setup();
    const j = stuck.add({ Thrust: 5, Hold: 5 });
    addBlock(stuck.world.plants, at(11, 10));
    stuck.world.plants.walls[at(12, 10)] = 1;
    for (let k = 0; k < 40; k++) step(stuck.world);
    expect(stuck.world.blockTally.pushed).toBe(0);
    expect(stuck.world.creatures.x[j]).toBeLessThan(220);
  });
});

describe('blocks that are not grabbed', () => {
  it('stop a creature that merely walks into them', () => {
    const { world, add } = setup();
    const i = add({ Thrust: 5 });
    addBlock(world.plants, at(11, 10));
    for (let k = 0; k < 40; k++) step(world);
    expect(world.blockTally.pushed).toBe(0);
    expect(world.plants.blocks[at(11, 10)]).toBe(1);
    expect(world.creatures.x[i]).toBeLessThan(220);
  });
});

describe('seeing past a block', () => {
  it('finds a block between two points but not at either end', () => {
    const f = field();
    const cw = f.cellWidth;
    expect(blockBetween(f, 5.5 * cw, 5.5 * cw, 4 * cw, 0, 400, 400)).toBe(false);
    addBlock(f, at(7, 5));
    expect(blockBetween(f, 5.5 * cw, 5.5 * cw, 4 * cw, 0, 400, 400)).toBe(true);
    expect(blockBetween(f, 7.5 * cw, 5.5 * cw, 4 * cw, 0, 400, 400)).toBe(false);
  });
});

describe('heavy blocks', () => {
  it('stay put for one pusher, even one that keeps pushing, and move for two different ones', () => {
    const f = field();
    addBlock(f, at(6, 5), 0, false, true);
    for (let tick = 0; tick < 10; tick++) expect(pushBlock(f, at(5, 5), at(6, 5), 9, { tick, creature: 1 })).toBe(false);
    expect(pushBlock(f, at(5, 5), at(6, 5), 9)).toBe(false);
    expect(pushBlock(f, at(5, 5), at(6, 5), 9, { tick: 10, creature: 2 })).toBe(true);
    expect(f.blocks[at(7, 5)]).toBe(1);
    expect(f.blockHeavy[at(7, 5)]).toBe(1);
    expect(f.blockHeavy[at(6, 5)]).toBe(0);
  });

  it('do not move when the second creature pushes long after the first', () => {
    const f = field();
    addBlock(f, at(6, 5), 0, false, true);
    expect(pushBlock(f, at(5, 5), at(6, 5), 9, { tick: 0, creature: 1 })).toBe(false);
    expect(pushBlock(f, at(5, 5), at(6, 5), 9, { tick: 5, creature: 2 })).toBe(false);
  });

  it('are shoved along by two creatures in the world, and not picked up by one', () => {
    const one = setup();
    one.add({ Thrust: 5, Hold: 5 });
    addBlock(one.world.plants, at(11, 10), 0, false, true);
    for (let k = 0; k < 40; k++) step(one.world);
    expect(one.world.plants.blocks[at(11, 10)]).toBe(1);
    expect(one.world.creatures.held[0]).toBe(Held.Nothing);

    const two = setup();
    const a = two.add({ Thrust: 5, Hold: 5 });
    const b = two.add({ Thrust: 5, Hold: 5 }, 210, 214);
    addBlock(two.world.plants, at(11, 10), 0, false, true);
    for (let k = 0; k < 40; k++) step(two.world);
    expect(two.world.blockTally.pushed).toBeGreaterThan(0);
    expect(two.world.plants.blocks[at(11, 10)]).toBe(0);
    expect(Math.max(two.world.creatures.x[a]!, two.world.creatures.x[b]!)).toBeGreaterThan(225);
  });
});

describe('carrying a block', () => {
  it('grabs the block it is facing, is slowed by it, and sets it down in front', () => {
    const { world, add } = setup();
    const i = add({ Hold: 5, Thrust: -5 });
    addBlock(world.plants, at(11, 10));
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Block);
    expect(world.plants.blocks[at(11, 10)]).toBe(0);
    expect(world.plants.nearBlocks[at(10, 10)]).toBe(0);
    expect(world.creatures.brain[i]!.activation[Input.HoldingBlock]).toBe(0);
    step(world);
    expect(world.creatures.brain[i]!.activation[Input.HoldingBlock]).toBe(1);

    // Turn round, walk a few cells and let go.
    world.creatures.heading[i] = Math.PI;
    world.creatures.brain[i] = brainOf({ Hold: 5, Thrust: 5 });
    const from = world.creatures.x[i]!;
    step(world);
    const laden = from - world.creatures.x[i]!;
    for (let k = 0; k < 30; k++) step(world);
    world.creatures.brain[i] = brainOf({ Hold: -5, Thrust: -5 });
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Nothing);
    const cell = cellIndexAt(world.plants, world.creatures.x[i]!, world.creatures.y[i]!);
    const front = cell - 1;
    expect(world.plants.blocks[front]).toBe(1);
    expect(world.plants.blockBuilt[front]).toBe(1);
    expect(world.plants.blockSpecies[front]).toBe(7);
    expect(world.blockTally.setDown).toBe(1);

    // Empty-handed it walks faster by the block's weight.
    world.creatures.brain[i] = brainOf({ Thrust: 5 });
    world.creatures.heading[i] = Math.PI / 2;
    const y = world.creatures.y[i]!;
    step(world);
    expect(laden).toBeCloseTo((world.creatures.y[i]! - y) * (1 - arena.blockWeight), 3);
  });

  it('keeps hold where there is no room to set the block down', () => {
    const { world, add } = setup();
    const i = add({ Hold: -5, Thrust: -5 });
    world.creatures.held[i] = Held.Block;
    world.plants.walls[at(11, 10)] = 1;
    step(world);
    expect(world.creatures.held[i]).toBe(Held.Block);
  });

  it('drops the block where its carrier dies', () => {
    const { world, add } = setup();
    const i = add({ Hold: 5, Thrust: -5 });
    world.creatures.held[i] = Held.Block;
    world.creatures.energy[i] = 0;
    step(world);
    expect(world.creatures.count).toBe(0);
    expect(world.plants.blocks.reduce((a, b) => a + b, 0)).toBe(1);
    expect(world.plants.blocks[at(10, 10)]).toBe(1);
  });
});

describe('what a block is good for', () => {
  it('shelters a creature beside it from the cost of cold', () => {
    const spent = (blockBeside: boolean) => {
      const { world, add } = setup({ temperatureStrength: 1, biomeTempThreshold: 2, biomeWetThreshold: 2 });
      world.plants.temperature.fill(-1);
      const i = add({ Thrust: -5 });
      if (blockBeside) addBlock(world.plants, at(10, 11));
      for (let k = 0; k < 20; k++) step(world);
      return 50 - world.creatures.energy[i]!;
    };
    expect(spent(true)).toBeLessThan(spent(false));
  });

  it('is seen along the ray that crosses it, apart from walls', () => {
    const { world, add } = setup();
    const i = add({ Thrust: -5 });
    addBlock(world.plants, at(13, 10));
    step(world);
    const inputs = world.creatures.brain[i]!.activation;
    const ahead = Input.Rays + INPUTS_PER_RAY;
    expect(inputs[ahead + Ray.Block]).toBeGreaterThan(0);
    expect(inputs[ahead + Ray.Wall]).toBe(0);
    expect(inputs[Input.Rays + Ray.Block]).toBe(0);
    expect(INPUT_LABELS[ahead + Ray.Block]).toBe('Block ahead');
    expect(INPUT_LABELS[Input.HoldingBlock]).toBe('Holding a block');
  });
});

describe('building', () => {
  it('measures the longest straight run of blocks that creatures moved', () => {
    const f = field();
    expect(longestBuiltLine(f)).toBe(0);
    for (let cx = 3; cx < 8; cx++) addBlock(f, at(cx, 4), 1, true);
    // Blocks nobody has moved do not lengthen it.
    addBlock(f, at(8, 4));
    addBlock(f, at(9, 4));
    expect(longestBuiltLine(f)).toBe(5);
    for (let k = 0; k < 7; k++) addBlock(f, at(10 + k, 10 + k), 1, true);
    expect(longestBuiltLine(f)).toBe(7);
  });

  it('can be done by hand with the Block tool, and undone with Erase', () => {
    const { world } = setup();
    applyTool(world, 'block', 210, 210, 210, 210);
    expect(world.plants.blocks[at(10, 10)]).toBe(1);
    expect(world.plants.blockBuilt[at(10, 10)]).toBe(0);
    applyTool(world, 'erase', 210, 210, 210, 210);
    expect(world.plants.blocks[at(10, 10)]).toBe(0);
  });
});

describe('a whole world with blocks', () => {
  const small: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 80,
    minPopulation: 5,
    maxCreatures: 500,
    blockDensity: 0.03,
    seed: 'build',
  };

  it('keeps every block, conserves energy, stays deterministic, and records moves', () => {
    const run = () => {
      const world = createWorld(small);
      const blocks = () => world.plants.blocks.reduce((a, b) => a + b, 0);
      const before = blocks();
      for (let k = 0; k < 2500; k++) step(world);
      let carried = 0;
      for (let i = 0; i < world.creatures.count; i++) if (world.creatures.held[i] === Held.Block) carried++;
      return { world, before, after: blocks() + carried };
    };
    const { world, before, after } = run();
    expect(before).toBeGreaterThan(10);
    expect(after).toBe(before);
    expect(world.blockTally.pushed + world.blockTally.setDown).toBeGreaterThan(0);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 4);
    expect(hashWorld(world)).toBe(hashWorld(run().world));

    const h = world.history;
    const moved = h.blockMoveRate.subarray(0, h.count).reduce((a, b) => a + b, 0);
    expect(moved).toBeGreaterThan(0);
    expect(h.builtBlocks[h.count - 1]).toBeGreaterThan(0);
    expect(h.longestBuiltLine[h.count - 1]).toBeGreaterThanOrEqual(1);
    expect(h.shelteredShare[h.count - 1]).toBeGreaterThanOrEqual(0);
    expect(h.shelteredShare[h.count - 1]).toBeLessThanOrEqual(1);
    // Two full runs: slow enough to pass the default 5 seconds when the machine is busy.
  }, 30000);

  it('survives saving and loading', () => {
    const world = createWorld(small);
    for (let k = 0; k < 600; k++) step(world);
    const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
    expect(Array.from(copy.plants.nearBlocks)).toEqual(Array.from(world.plants.nearBlocks));
    for (let k = 0; k < 300; k++) {
      step(world);
      step(copy);
    }
    expect(hashWorld(copy)).toBe(hashWorld(world));
  });
});
