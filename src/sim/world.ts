import type { SimConfig } from './config';
import {
  createCreatures,
  genesOf,
  removeCreature,
  spawnCreature,
  totalCreatureEnergy,
  type Creatures,
} from './creatures';
import { biteFor, founderGenes, maxEnergyFor, mutateGenes, strideFor, tickCostFor } from './genome';
import { wrap } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import { cellIndexAt, createPlantField, growPlants, totalPlantEnergy, type PlantField } from './plants';
import { Rng } from './rng';
import { createHistory, meanOf, recordSample, type History } from './stats';

export interface World {
  config: SimConfig;
  tick: number;
  rng: Rng;
  plants: PlantField;
  /** Plant energy the field holds when fully grown. */
  plantCapacityTotal: number;
  creatures: Creatures;
  ledger: EnergyLedger;
  history: History;
  /** Cumulative counts since the world was created. */
  births: number;
  reseeded: number;
  deaths: { starved: number; oldAge: number };
}

/** Add a creature with no parent at a random position. Returns its energy. */
function spawnFounder(world: World, age: number): number {
  const { config, rng, creatures } = world;
  const genes = founderGenes(rng, config);
  const energy = Math.min(config.creatureStartEnergy, maxEnergyFor(genes.size, config));
  spawnCreature(creatures, {
    x: rng.range(0, config.worldWidth),
    y: rng.range(0, config.worldHeight),
    heading: rng.range(0, Math.PI * 2),
    energy,
    genes,
    age,
  });
  return energy;
}

export function createWorld(config: SimConfig): World {
  config = { ...config };
  const rng = new Rng(config.seed);
  const plants = createPlantField(config, rng);
  const world: World = {
    config,
    tick: 0,
    rng,
    plants,
    plantCapacityTotal: totalPlantEnergy(plants),
    creatures: createCreatures(Math.max(16, config.initialCreatures)),
    ledger: createLedger(),
    history: createHistory(config.statsInterval, config.statsCapacity),
    births: 0,
    reseeded: 0,
    deaths: { starved: 0, oldAge: 0 },
  };

  for (let i = 0; i < config.initialCreatures; i++) {
    // Spread starting ages so the founders don't all die of old age at once.
    spawnFounder(world, rng.int(0, Math.floor(config.maxAge / 2)));
  }
  world.ledger.initial = totalEnergy(world);
  sampleHistory(world);
  return world;
}

/** Advance the world by one fixed timestep. */
export function step(world: World): void {
  const { config, rng, plants, creatures, ledger } = world;
  world.tick++;

  growPlants(plants, config.plantGrowthRate, config.plantBareGrowth, ledger);

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  for (let i = 0; i < alive; i++) {
    const size = creatures.size[i]!;
    const speed = creatures.speed[i]!;

    // Wander: a small random turn, then a step forward.
    const heading = creatures.heading[i]! + rng.range(-config.wanderTurn, config.wanderTurn);
    const distance = strideFor(size, speed, config);
    creatures.heading[i] = heading;
    creatures.x[i] = wrap(creatures.x[i]! + Math.cos(heading) * distance, config.worldWidth);
    creatures.y[i] = wrap(creatures.y[i]! + Math.sin(heading) * distance, config.worldHeight);

    // Eat from the cell underfoot, limited by bite size and stomach room.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    const maxEnergy = maxEnergyFor(size, config);
    let energy = creatures.energy[i]!;
    const bite = Math.max(0, Math.min(biteFor(size, config), plants.energy[cell]!, maxEnergy - energy));
    plants.energy[cell]! -= bite;
    energy += bite;

    // Pay for living and moving; whatever is spent leaves the world as heat.
    const paid = Math.min(tickCostFor(size, speed, config), energy);
    energy -= paid;
    ledger.heatOut += paid;
    const age = ++creatures.age[i]!;

    if (
      energy >= config.reproduceThreshold * maxEnergy &&
      age >= config.minReproduceAge &&
      creatures.count < config.maxCreatures
    ) {
      energy -= giveBirth(world, i, energy);
    }
    creatures.energy[i] = energy;
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

  // Keep a dying world going with fresh parentless creatures.
  while (creatures.count < config.minPopulation) {
    ledger.seedIn += spawnFounder(world, 0);
    world.reseeded++;
  }

  if (world.tick % world.history.interval === 0) sampleHistory(world);
}

/**
 * Split off a mutated child from the creature at `parent`, which currently
 * holds `energy`. Returns the energy the parent gives up.
 */
function giveBirth(world: World, parent: number, energy: number): number {
  const { config, rng, creatures, ledger } = world;
  const genes = mutateGenes(genesOf(creatures, parent), rng, config);
  // A smaller child may not be able to hold a full share; the parent keeps the rest.
  const childMax = maxEnergyFor(genes.size, config);
  const given = Math.min(energy * config.offspringShare, childMax / (1 - config.birthCost));
  const lost = given * config.birthCost;
  ledger.heatOut += lost;

  spawnCreature(creatures, {
    x: creatures.x[parent]!,
    y: creatures.y[parent]!,
    heading: rng.range(0, Math.PI * 2),
    energy: given - lost,
    genes,
    parentId: creatures.id[parent]!,
    generation: creatures.generation[parent]! + 1,
  });
  world.births++;
  return given;
}

function sampleHistory(world: World): void {
  const { creatures } = world;
  recordSample(world.history, {
    tick: world.tick,
    population: creatures.count,
    plantFill: world.plantCapacityTotal > 0 ? totalPlantEnergy(world.plants) / world.plantCapacityTotal : 0,
    meanSize: meanOf(creatures.size, creatures),
    meanSpeed: meanOf(creatures.speed, creatures),
  });
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
  for (const field of [
    c.id,
    c.parentId,
    c.generation,
    c.x,
    c.y,
    c.heading,
    c.energy,
    c.age,
    c.size,
    c.speed,
    c.hue,
    c.mutationRate,
  ]) {
    h = hashBytes(h, bytesOf(field, c.count));
  }
  return h >>> 0;
}
