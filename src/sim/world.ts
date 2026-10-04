import type { SimConfig } from './config';
import {
  createCreatures,
  removeCreature,
  spawnCreature,
  totalCreatureEnergy,
  type Creatures,
} from './creatures';
import { wrap } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import { cellIndexAt, createPlantField, growPlants, totalPlantEnergy, type PlantField } from './plants';
import { Rng } from './rng';

export interface World {
  config: SimConfig;
  tick: number;
  rng: Rng;
  plants: PlantField;
  creatures: Creatures;
  ledger: EnergyLedger;
  /** Cumulative deaths by cause. */
  deaths: { starved: number; oldAge: number };
}

export function createWorld(config: SimConfig): World {
  config = { ...config };
  const rng = new Rng(config.seed);
  const plants = createPlantField(config, rng);
  const creatures = createCreatures(Math.max(16, config.initialCreatures));

  for (let i = 0; i < config.initialCreatures; i++) {
    spawnCreature(
      creatures,
      rng.range(0, config.worldWidth),
      rng.range(0, config.worldHeight),
      rng.range(0, Math.PI * 2),
      config.creatureStartEnergy,
      // Spread starting ages so the founders don't all die of old age at once.
      rng.int(0, Math.floor(config.maxAge / 2)),
    );
  }

  const ledger = createLedger();
  ledger.initial = totalPlantEnergy(plants) + totalCreatureEnergy(creatures);

  return { config, tick: 0, rng, plants, creatures, ledger, deaths: { starved: 0, oldAge: 0 } };
}

/** Advance the world by one fixed timestep. */
export function step(world: World): void {
  const { config, rng, plants, creatures, ledger } = world;
  world.tick++;

  growPlants(plants, config.plantGrowthRate, ledger);

  const cost = config.upkeepCost + config.moveCost * config.creatureSpeed;
  for (let i = 0; i < creatures.count; i++) {
    // Wander: a small random turn, then a step forward.
    const heading = creatures.heading[i]! + rng.range(-config.wanderTurn, config.wanderTurn);
    creatures.heading[i] = heading;
    const x = wrap(creatures.x[i]! + Math.cos(heading) * config.creatureSpeed, config.worldWidth);
    const y = wrap(creatures.y[i]! + Math.sin(heading) * config.creatureSpeed, config.worldHeight);
    creatures.x[i] = x;
    creatures.y[i] = y;

    // Eat from the cell underfoot, limited by bite size and stomach room.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    let energy = creatures.energy[i]!;
    const bite = Math.min(config.biteSize, plants.energy[cell]!, config.creatureMaxEnergy - energy);
    plants.energy[cell]! -= bite;
    energy += bite;

    // Pay for living and moving; whatever is spent leaves the world as heat.
    const paid = Math.min(cost, energy);
    creatures.energy[i] = energy - paid;
    ledger.heatOut += paid;
    creatures.age[i]!++;
  }

  // Deaths. Backwards, so a removal only moves an already-checked creature.
  for (let i = creatures.count - 1; i >= 0; i--) {
    const starved = creatures.energy[i]! <= 0;
    if (!starved && creatures.age[i]! < config.maxAge) continue;
    if (starved) world.deaths.starved++;
    else world.deaths.oldAge++;
    // Until corpses exist (milestone 5), leftover energy dissipates.
    ledger.heatOut += creatures.energy[i]!;
    removeCreature(creatures, i);
  }
}

/** Energy currently held by everything in the world. */
export function totalEnergy(world: World): number {
  return totalPlantEnergy(world.plants) + totalCreatureEnergy(world.creatures);
}

function hashBytes(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return h;
}

function bytesOf(array: Uint32Array | Float32Array | Float64Array, count: number): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, count * array.BYTES_PER_ELEMENT);
}

/**
 * Hash of the full world state (FNV-1a over its bytes). Two worlds with the
 * same hash are, for testing purposes, in the same state.
 */
export function hashWorld(world: World): number {
  const { creatures: c, plants } = world;
  const s = world.rng.getState();
  let h = 2166136261;
  h = hashBytes(h, bytesOf(new Uint32Array([world.tick, s.a, s.b, s.c, s.d, c.count, c.nextId]), 7));
  h = hashBytes(h, bytesOf(plants.energy, plants.energy.length));
  h = hashBytes(h, bytesOf(c.id, c.count));
  h = hashBytes(h, bytesOf(c.x, c.count));
  h = hashBytes(h, bytesOf(c.y, c.count));
  h = hashBytes(h, bytesOf(c.heading, c.count));
  h = hashBytes(h, bytesOf(c.energy, c.count));
  h = hashBytes(h, bytesOf(c.age, c.count));
  return h >>> 0;
}
