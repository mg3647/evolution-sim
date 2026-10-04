import {
  brainCost,
  enabledLinks,
  founderBrain,
  Innovations,
  INPUT_COUNT,
  mutateBrain,
  Output,
  think,
} from './brain';
import type { SimConfig } from './config';
import {
  createCreatures,
  genesOf,
  removeCreature,
  spawnCreature,
  totalCreatureEnergy,
  type Creatures,
} from './creatures';
import {
  biteFor,
  bodyEnergyFor,
  founderGenes,
  maxEnergyFor,
  meatDigestion,
  mutateGenes,
  plantDigestion,
  senseCostFor,
  strideFor,
  tickCostFor,
} from './genome';
import { wrap } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import {
  cellIndexAt,
  createPlantField,
  decayMeat,
  growPlants,
  totalMeatEnergy,
  totalPlantEnergy,
  type PlantField,
} from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { SpatialHash } from './spatialHash';
import { createHistory, meanOf, recordSample, type History } from './stats';

export interface World {
  config: SimConfig;
  tick: number;
  rng: Rng;
  plants: PlantField;
  /** Plant energy the field holds when fully grown. */
  plantCapacityTotal: number;
  creatures: Creatures;
  innovations: Innovations;
  /** Creature positions as of the start of the current tick. */
  hash: SpatialHash;
  senses: Senses;
  ledger: EnergyLedger;
  history: History;
  /** Cumulative counts since the world was created. */
  births: number;
  reseeded: number;
  deaths: { starved: number; oldAge: number; killed: number };
}

/** Add a creature with no parent at a random position. Returns the energy it embodies. */
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
    brain: founderBrain(rng, world.innovations, config),
    age,
  });
  return energy + bodyEnergyFor(genes.size, config);
}

export function createWorld(config: SimConfig): World {
  config = { ...config };
  const rng = new Rng(config.seed);
  const plants = createPlantField(config, rng);
  const hash = new SpatialHash(config.worldWidth, config.worldHeight, config.senseRange);
  const world: World = {
    config,
    tick: 0,
    rng,
    plants,
    plantCapacityTotal: totalPlantEnergy(plants),
    creatures: createCreatures(Math.max(16, config.initialCreatures)),
    innovations: new Innovations(),
    hash,
    senses: new Senses(config, plants, hash),
    ledger: createLedger(),
    history: createHistory(config.statsInterval, config.statsCapacity),
    births: 0,
    reseeded: 0,
    deaths: { starved: 0, oldAge: 0, killed: 0 },
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
  const { config, plants, creatures, ledger } = world;
  world.tick++;

  growPlants(plants, config.plantGrowthRate, config.plantBareGrowth, ledger);
  decayMeat(plants, config.meatDecayRate, ledger);
  world.hash.build(creatures.x, creatures.y, creatures.count);

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  for (let i = 0; i < alive; i++) {
    const size = creatures.size[i]!;
    const brain = creatures.brain[i]!;

    // Sense, then think. Outputs are in [-1, 1].
    world.senses.sense(creatures, i, world.tick, brain.activation);
    think(brain);
    const turn = brain.activation[INPUT_COUNT + Output.Turn]! * config.maxTurn;
    const thrust = (brain.activation[INPUT_COUNT + Output.Thrust]! + 1) / 2;
    const wantsChild = brain.activation[INPUT_COUNT + Output.Reproduce]! >= 0;
    const attacking = brain.activation[INPUT_COUNT + Output.Attack]! > 0;
    const diet = creatures.diet[i]!;

    // Bite the closest creature in view if it is within reach. Teeth made for
    // meat do more harm, and a bigger attacker hurts a smaller victim more.
    if (attacking && world.senses.targetIndex >= 0 && world.senses.targetGap <= config.attackReach) {
      const victim = world.senses.targetIndex;
      const ratio = size / creatures.size[victim]!;
      const teeth = config.herbivoreAttack + (1 - config.herbivoreAttack) * diet;
      creatures.health[victim]! -= config.attackDamage * teeth * ratio * ratio;
    }

    // Act: turn, then move forward.
    const speed = creatures.speed[i]!;
    const heading = creatures.heading[i]! + turn;
    const distance = strideFor(size, speed, config) * thrust;
    creatures.heading[i] = heading;
    creatures.x[i] = wrap(creatures.x[i]! + Math.cos(heading) * distance, config.worldWidth);
    creatures.y[i] = wrap(creatures.y[i]! + Math.sin(heading) * distance, config.worldHeight);

    // Eat from the cell underfoot: meat first, then plants, each as far as the
    // diet allows. Moving fast makes for a poor bite.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    const maxEnergy = maxEnergyFor(size, config);
    let energy = creatures.energy[i]!;
    const reach = biteFor(size, config) * (1 - config.eatSlowdown * thrust);
    const meatBite = Math.max(0, Math.min(reach * config.meatBiteScale * meatDigestion(diet), plants.meat[cell]!, maxEnergy - energy));
    plants.meat[cell]! -= meatBite;
    energy += meatBite;
    const bite = Math.max(0, Math.min(reach * plantDigestion(diet), plants.energy[cell]!, maxEnergy - energy));
    plants.energy[cell]! -= bite;
    energy += bite;

    // Pay for body, movement, senses, brain and fighting; what is spent leaves as heat.
    const cost =
      tickCostFor(size, speed, thrust, config) +
      (attacking ? config.attackCost * size * size : 0) +
      senseCostFor(creatures.sensorRange[i]!, config) +
      brainCost(brain, config);
    const paid = Math.min(cost, energy);
    energy -= paid;
    ledger.heatOut += paid;
    const age = ++creatures.age[i]!;

    if (
      wantsChild &&
      energy >= config.reproduceThreshold * maxEnergy &&
      age >= config.minReproduceAge &&
      creatures.count < config.maxCreatures
    ) {
      energy -= giveBirth(world, i, energy);
    }
    creatures.energy[i] = energy;
    // Health is read here, after any bites taken earlier this tick, so healing never hides a kill.
    if (creatures.health[i]! > 0) creatures.health[i] = Math.min(1, creatures.health[i]! + config.healRate);
  }

  // Deaths. Backwards, so a removal only moves an already-checked creature.
  for (let i = creatures.count - 1; i >= 0; i--) {
    const killed = creatures.health[i]! <= 0;
    const starved = creatures.energy[i]! <= 0;
    if (!killed && !starved && creatures.age[i]! < config.maxAge) continue;
    if (killed) world.deaths.killed++;
    else if (starved) world.deaths.starved++;
    else world.deaths.oldAge++;
    // The body and whatever it had stored stay behind as meat.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    plants.meat[cell]! += creatures.energy[i]! + bodyEnergyFor(creatures.size[i]!, config);
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
  const parentGenes = genesOf(creatures, parent);
  const genes = mutateGenes(parentGenes, rng, config);
  const brain = mutateBrain(
    creatures.brain[parent]!,
    parentGenes.mutationRate,
    rng,
    world.innovations,
    config,
  );
  // The parent's share first builds the child's body; the rest is the child's
  // starting store. A smaller child may not hold a full share, and the parent
  // keeps what does not fit.
  const body = bodyEnergyFor(genes.size, config);
  const childMax = maxEnergyFor(genes.size, config);
  const given = Math.min(energy * config.offspringShare, (childMax + body) / (1 - config.birthCost));
  const lost = given * config.birthCost;
  // Too little to build a body: no birth this tick.
  if (given - lost <= body) return 0;
  ledger.heatOut += lost;

  spawnCreature(creatures, {
    x: creatures.x[parent]!,
    y: creatures.y[parent]!,
    heading: rng.range(0, Math.PI * 2),
    energy: given - lost - body,
    genes,
    brain,
    parentId: creatures.id[parent]!,
    generation: creatures.generation[parent]! + 1,
  });
  world.births++;
  return given;
}

function sampleHistory(world: World): void {
  const { creatures } = world;
  let links = 0;
  let neurons = 0;
  let meatEaters = 0;
  for (let i = 0; i < creatures.count; i++) {
    if (creatures.diet[i]! > 0.5) meatEaters++;
    links += enabledLinks(creatures.brain[i]!);
    neurons += creatures.brain[i]!.hiddenIds.length;
  }
  const count = Math.max(1, creatures.count);
  recordSample(world.history, {
    tick: world.tick,
    population: creatures.count,
    plantFill: world.plantCapacityTotal > 0 ? totalPlantEnergy(world.plants) / world.plantCapacityTotal : 0,
    meanSize: meanOf(creatures.size, creatures),
    meanSpeed: meanOf(creatures.speed, creatures),
    meanSensorRange: meanOf(creatures.sensorRange, creatures),
    meanDiet: meanOf(creatures.diet, creatures),
    meatEaters,
    meanLinks: links / count,
    meanNeurons: neurons / count,
  });
}

/** Energy currently held by everything in the world: plants, meat, and creatures' stores and bodies. */
export function totalEnergy(world: World): number {
  const { creatures, config } = world;
  let bodies = 0;
  for (let i = 0; i < creatures.count; i++) bodies += bodyEnergyFor(creatures.size[i]!, config);
  return (
    totalPlantEnergy(world.plants) +
    totalMeatEnergy(world.plants) +
    totalCreatureEnergy(creatures) +
    bodies
  );
}

function hashBytes(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return h;
}

function bytesOf(
  array: Uint16Array | Uint32Array | Float32Array | Float64Array,
  count = array.length,
): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, count * array.BYTES_PER_ELEMENT);
}

/**
 * Hash of the full world state (FNV-1a over its bytes). Two worlds with the
 * same hash are, for testing purposes, in the same state.
 */
export function hashWorld(world: World): number {
  const { creatures: c, plants } = world;
  const s = world.rng.getState();
  const header = [world.tick, s.a, s.b, s.c, s.d, c.count, c.nextId, ...world.innovations.counts()];
  let h = 2166136261;
  h = hashBytes(h, bytesOf(new Uint32Array(header)));
  h = hashBytes(h, bytesOf(plants.energy));
  h = hashBytes(h, bytesOf(plants.meat));
  for (const field of [
    c.id,
    c.parentId,
    c.generation,
    c.x,
    c.y,
    c.heading,
    c.energy,
    c.age,
    c.health,
    c.size,
    c.speed,
    c.sensorRange,
    c.diet,
    c.hue,
    c.mutationRate,
  ]) {
    h = hashBytes(h, bytesOf(field, c.count));
  }
  for (let i = 0; i < c.count; i++) {
    const brain = c.brain[i]!;
    h = hashBytes(h, bytesOf(new Uint32Array(brain.links.map((link) => link.innovation * 2 + +link.enabled))));
    h = hashBytes(h, bytesOf(new Float32Array(brain.links.map((link) => link.weight))));
    h = hashBytes(h, bytesOf(brain.linkFrom));
    h = hashBytes(h, bytesOf(brain.linkTo));
    h = hashBytes(h, bytesOf(brain.activation));
  }
  return h >>> 0;
}
