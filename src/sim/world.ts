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
import {
  clearWalls,
  climateAt,
  createEnvironment,
  driftFertility,
  expireEvents,
  maybeRandomEvent,
  notePlagueOver,
  spreadScent,
  triggerEvent,
  type Climate,
  type Environment,
  type EventKind,
  type EventTarget,
} from './environment';
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
  /** Killed counts bites; disaster counts plagues and meteors. */
  deaths: { starved: number; oldAge: number; killed: number; disaster: number };
  environment: Environment;
  /** Creatures infected right now, and deaths in the current outbreak. */
  infected: number;
  plagueDeaths: number;
  /** The climate used for the most recent tick. */
  climate: Climate;
}

/** Health value that marks a creature struck down by an event this tick. */
const STRUCK = -2;

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
    deaths: { starved: 0, oldAge: 0, killed: 0, disaster: 0 },
    environment: createEnvironment(config, rng, plants),
    infected: 0,
    plagueDeaths: 0,
    climate: { season: 1, growth: 1, cost: 1 },
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

  const env = world.environment;
  expireEvents(env, world.tick);
  maybeRandomEvent(env, world.tick, eventTarget(world));
  if (world.tick % config.fertilityUpdateInterval === 0) {
    world.plantCapacityTotal = driftFertility(env, plants, world.tick, config, world.rng, ledger);
  }
  const climate = climateAt(env, world.tick, config);
  world.climate = climate;

  growPlants(plants, config.plantGrowthRate * climate.growth, config.plantBareGrowth, ledger);
  decayMeat(plants, config.meatDecayRate, ledger);
  spreadScent(env, plants, config);
  world.hash.build(creatures.x, creatures.y, creatures.count);

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  for (let i = 0; i < alive; i++) {
    // Killed earlier this tick: it no longer acts, and leaves its body in the death pass.
    if (creatures.health[i]! <= 0) continue;
    const size = creatures.size[i]!;
    const brain = creatures.brain[i]!;

    // Sense, then think. Outputs are in [-1, 1].
    world.senses.sense(creatures, i, world.tick, brain.activation);
    think(brain);
    const turn = brain.activation[INPUT_COUNT + Output.Turn]! * config.maxTurn;
    let thrust = (brain.activation[INPUT_COUNT + Output.Thrust]! + 1) / 2;
    const wantsChild = brain.activation[INPUT_COUNT + Output.Reproduce]! >= 0;
    const attacking = brain.activation[INPUT_COUNT + Output.Attack]! > 0;
    const emitting = brain.activation[INPUT_COUNT + Output.Emit]! > 0;
    const sick = updateInfection(world, i);
    const diet = creatures.diet[i]!;

    // Bite the closest creature in view if it is within reach. Teeth made for
    // meat do more harm, and a bigger attacker hurts a smaller victim more, in
    // proportion to their sizes.
    if (attacking && world.senses.targetIndex >= 0 && world.senses.targetGap <= config.attackReach) {
      const victim = world.senses.targetIndex;
      const ratio = size / creatures.size[victim]!;
      const teeth = config.herbivoreAttack + (1 - config.herbivoreAttack) * diet;
      creatures.health[victim]! -= config.attackDamage * teeth * ratio;
    }

    // Illness saps strength.
    if (sick) thrust *= config.plagueSlow;

    // Act: turn, then move forward.
    const speed = creatures.speed[i]!;
    const heading = creatures.heading[i]! + turn;
    const distance = strideFor(size, speed, config) * thrust;
    creatures.heading[i] = heading;
    // Rounded to stored precision first, so the cell checked is the cell it lands in.
    const toX = Math.fround(wrap(creatures.x[i]! + Math.cos(heading) * distance, config.worldWidth));
    const toY = Math.fround(wrap(creatures.y[i]! + Math.sin(heading) * distance, config.worldHeight));
    const fromX = creatures.x[i]!;
    const fromY = creatures.y[i]!;
    // A wall stops a creature entering its cell; one already inside may walk
    // out. A blocked creature slides along the wall instead of stopping dead.
    if (plants.walls[cellIndexAt(plants, toX, toY)] === 0 || plants.walls[cellIndexAt(plants, fromX, fromY)] === 1) {
      creatures.x[i] = toX;
      creatures.y[i] = toY;
    } else if (plants.walls[cellIndexAt(plants, toX, fromY)] === 0) {
      creatures.x[i] = toX;
    } else if (plants.walls[cellIndexAt(plants, fromX, toY)] === 0) {
      creatures.y[i] = toY;
    }

    // Eat from the cell underfoot: one mouthful a tick, spent on meat first and
    // any left over on plants, each as far as the diet allows. Moving fast
    // makes for a poor mouthful.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    const maxEnergy = maxEnergyFor(size, config);
    let energy = creatures.energy[i]!;
    let mouthful = biteFor(size, config) * (1 - config.eatSlowdown * thrust);
    const meatRate = config.meatBiteScale * meatDigestion(diet);
    const meatBite = Math.max(0, Math.min(mouthful * meatRate, plants.meat[cell]!, maxEnergy - energy));
    plants.meat[cell]! -= meatBite;
    energy += meatBite;
    if (meatRate > 0) mouthful = Math.max(0, mouthful - meatBite / meatRate);
    const bite = Math.max(0, Math.min(mouthful * plantDigestion(diet), plants.energy[cell]!, maxEnergy - energy));
    plants.energy[cell]! -= bite;
    energy += bite;
    if (emitting) plants.scent[cell]! += config.scentEmit;

    // Pay for body, movement, senses, brain, fighting and signalling; what is
    // spent leaves as heat. Cold weather makes everything cost more.
    const cost =
      climate.cost *
      (sick ? config.plagueCost : 1) *
      (tickCostFor(size, speed, thrust, config) +
        (attacking ? config.attackCost * size * size : 0) +
        (emitting ? config.scentCost : 0) +
        senseCostFor(creatures.sensorRange[i]!, config) +
        brainCost(brain, config));
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
    const struck = creatures.health[i]! <= STRUCK;
    const killed = creatures.health[i]! <= 0;
    const starved = creatures.energy[i]! <= 0;
    if (!killed && !starved && creatures.age[i]! < config.maxAge) continue;
    if (struck) {
      world.deaths.disaster++;
      if (creatures.sick[i]! > 0) world.plagueDeaths++;
    }
    else if (killed) world.deaths.killed++;
    else if (starved) world.deaths.starved++;
    else world.deaths.oldAge++;
    // The body and whatever it had stored stay behind as meat.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    plants.meat[cell]! += creatures.energy[i]! + bodyEnergyFor(creatures.size[i]!, config);
    removeCreature(creatures, i);
  }

  if (env.plagueActive) {
    let infected = 0;
    for (let i = 0; i < creatures.count; i++) if (creatures.sick[i]! > 0) infected++;
    world.infected = infected;
    if (infected === 0) {
      notePlagueOver(env, world.tick, world.plagueDeaths);
      world.plagueDeaths = 0;
    }
  }

  // Keep a dying world going with fresh parentless creatures.
  while (creatures.count < config.minPopulation) {
    ledger.seedIn += spawnFounder(world, 0);
    world.reseeded++;
  }

  if (world.tick % world.history.interval === 0) sampleHistory(world);
}

/**
 * Advance creature i's infection by one tick: spread it to healthy neighbors,
 * maybe die of it, and recover into immunity when it has run its course.
 * Returns whether the creature is sick this tick.
 */
function updateInfection(world: World, i: number): boolean {
  const { creatures, config, rng } = world;
  const state = creatures.sick[i]!;
  if (state === 0) return false;
  if (state < 0) {
    creatures.sick[i] = state + 1;
    return false;
  }

  world.hash.query(creatures.x[i]!, creatures.y[i]!, config.plagueRadius, (j) => {
    if (creatures.sick[j] === 0 && rng.chance(config.plagueTransmission)) {
      creatures.sick[j] = config.plagueDuration;
    }
  });
  if (rng.chance(config.plagueDeathChance)) creatures.health[i] = STRUCK;
  // The last tick of illness turns into immunity.
  creatures.sick[i] = state > 1 ? state - 1 : -config.plagueImmunity;
  return true;
}

/** The view of the world that events act through. */
function eventTarget(world: World): EventTarget {
  const { creatures } = world;
  return {
    config: world.config,
    rng: world.rng,
    field: world.plants,
    ledger: world.ledger,
    count: () => creatures.count,
    x: (i) => creatures.x[i]!,
    y: (i) => creatures.y[i]!,
    infect: (i) => {
      if (creatures.sick[i] !== 0) return false;
      creatures.sick[i] = world.config.plagueDuration;
      return true;
    },
    strike: (i) => {
      creatures.health[i] = STRUCK;
    },
  };
}

/**
 * Trigger an event now. Creatures it strikes die in the next tick's death
 * pass, so the world should be stepped afterwards.
 */
export function triggerWorldEvent(world: World, kind: EventKind): void {
  triggerEvent(world.environment, kind, world.tick, eventTarget(world));
}

export function clearWorldWalls(world: World): void {
  clearWalls(world.environment, world.plants, world.tick);
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

  // The child appears just behind the parent rather than on top of it.
  const behind = creatures.heading[parent]! + Math.PI;
  const gap = config.creatureRadius * (creatures.size[parent]! + genes.size);
  spawnCreature(creatures, {
    x: wrap(creatures.x[parent]! + Math.cos(behind) * gap, config.worldWidth),
    y: wrap(creatures.y[parent]! + Math.sin(behind) * gap, config.worldHeight),
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
  array: Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array,
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
  h = hashBytes(h, bytesOf(plants.capacity));
  h = hashBytes(h, bytesOf(plants.scent));
  h = hashBytes(h, plants.walls);
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
    c.sick,
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
