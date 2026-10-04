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
  applyFertility,
  maybeRandomEvent,
  meteorAt,
  noteOutbreak,
  paintFertility,
  wallLine,
  notePlagueOver,
  spreadScent,
  triggerEvent,
  type Climate,
  type Environment,
  type EventKind,
  type EventTarget,
} from './environment';
import { wrap, wrappedDelta } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import { Lineage } from './lineage';
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
import { buildSound, createSoundField, type SoundField } from './sound';
import { SpatialHash } from './spatialHash';
import { classifySpecies, createSpeciesState, type SpeciesState } from './species';
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
  /** Calls made last tick, as creatures hear them this tick. */
  sound: SoundField;
  senses: Senses;
  /**
   * How much creatures signal and share. `calling` is how many called on the
   * last tick; the rest are totals since the world was created: `calls` in
   * creature-ticks, and energy given in all and to relatives (close in colour).
   */
  social: { calling: number; calls: number; given: number; givenToKin: number };
  /** How hard creatures chose to move on the last tick, on average: 0 still, 1 flat out. */
  activity: number;
  ledger: EnergyLedger;
  history: History;
  /** Cumulative counts since the world was created. */
  births: number;
  reseeded: number;
  /** Killed counts bites; disaster counts plagues and meteors. */
  deaths: { starved: number; oldAge: number; killed: number; disaster: number; thirst: number };
  environment: Environment;
  /** Family tree of the living population. */
  lineage: Lineage;
  species: SpeciesState;
  /** Creatures infected right now, and deaths in the current outbreak. */
  infected: number;
  plagueDeaths: number;
  /** The climate used for the most recent tick. */
  climate: Climate;
}

/** Two creatures whose hues differ by less than this count as relatives when tallying gifts. */
const KIN_HUE = 0.1;

/** Health value that marks a creature struck down by an event this tick. */
const STRUCK = -2;

/** Add a creature with no parent at a random position. Returns the energy it embodies. */
function spawnFounder(world: World, age: number): number {
  const { config, rng, creatures } = world;
  const genes = founderGenes(rng, config);
  const energy = Math.min(config.creatureStartEnergy, maxEnergyFor(genes.size, config));
  // Founders start on dry land where there is any; a few tries is plenty.
  let x = rng.range(0, config.worldWidth);
  let y = rng.range(0, config.worldHeight);
  for (let tries = 0; tries < 20 && world.plants.water[cellIndexAt(world.plants, x, y)] === 1; tries++) {
    x = rng.range(0, config.worldWidth);
    y = rng.range(0, config.worldHeight);
  }
  const index = spawnCreature(creatures, {
    x,
    y,
    heading: rng.range(0, Math.PI * 2),
    energy,
    genes,
    brain: founderBrain(rng, world.innovations, config),
    age,
  });
  world.lineage.born(creatures.id[index]!, 0, world.tick, genes.hue);
  return energy + bodyEnergyFor(genes.size, config);
}

export function createWorld(config: SimConfig): World {
  config = { ...config };
  const rng = new Rng(config.seed);
  const plants = createPlantField(config, rng);
  const hash = new SpatialHash(config.worldWidth, config.worldHeight, config.senseRange);
  const sound = createSoundField(config);
  const world: World = {
    config,
    tick: 0,
    rng,
    plants,
    plantCapacityTotal: totalPlantEnergy(plants),
    creatures: createCreatures(Math.max(16, config.initialCreatures)),
    innovations: new Innovations(),
    hash,
    sound,
    senses: new Senses(config, plants, hash, sound),
    ledger: createLedger(),
    history: createHistory(config.statsInterval, config.statsCapacity),
    births: 0,
    reseeded: 0,
    social: { calling: 0, calls: 0, given: 0, givenToKin: 0 },
    activity: 0,
    deaths: { starved: 0, oldAge: 0, killed: 0, disaster: 0, thirst: 0 },
    environment: createEnvironment(config, rng, plants),
    lineage: new Lineage(),
    species: createSpeciesState(),
    infected: 0,
    plagueDeaths: 0,
    climate: { season: 1, growth: 1, cost: 1 },
  };

  for (let i = 0; i < config.initialCreatures; i++) {
    // Spread starting ages so the founders don't all die of old age at once.
    spawnFounder(world, rng.int(0, Math.floor(config.maxAge / 2)));
  }
  world.ledger.initial = totalEnergy(world);
  classifySpecies(world.species, world.creatures, world.lineage, 0, config);
  sampleHistory(world);
  return world;
}

/** Advance the world by one fixed timestep. */
export function step(world: World): void {
  const { config, plants, creatures, ledger } = world;
  world.tick++;

  const env = world.environment;
  expireEvents(env, world.tick);
  if (env.randomEvents) maybeRandomEvent(env, world.tick, eventTarget(world));
  if (world.tick % config.fertilityUpdateInterval === 0) {
    world.plantCapacityTotal = driftFertility(env, plants, world.tick, config, world.rng, ledger);
  }
  const climate = climateAt(env, world.tick, config);
  world.climate = climate;

  growPlants(plants, config.plantGrowthRate * climate.growth, config.plantBareGrowth, ledger);
  decayMeat(plants, config.meatDecayRate, ledger);
  spreadScent(env, plants, config);
  world.hash.build(creatures.x, creatures.y, creatures.count);
  world.social.calling = buildSound(world.sound, creatures);
  world.social.calls += world.social.calling;

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  let thrustTotal = 0;
  for (let i = 0; i < alive; i++) {
    // Killed earlier this tick: it no longer acts, and leaves its body in the death pass.
    if (creatures.health[i]! <= 0) continue;
    const size = creatures.size[i]!;
    const brain = creatures.brain[i]!;

    // Sense, then think. Outputs are in [-1, 1].
    world.senses.sense(creatures, i, world.tick, brain.activation);
    creatures.pain[i] = 0;
    think(brain);
    const turn = brain.activation[INPUT_COUNT + Output.Turn]! * config.maxTurn;
    let thrust = (brain.activation[INPUT_COUNT + Output.Thrust]! + 1) / 2;
    thrustTotal += thrust;
    const wantsChild = brain.activation[INPUT_COUNT + Output.Reproduce]! >= 0;
    const attacking = brain.activation[INPUT_COUNT + Output.Attack]! > 0;
    const emitting = brain.activation[INPUT_COUNT + Output.Emit]! > 0;
    const calling = brain.activation[INPUT_COUNT + Output.Call]! > 0;
    const giving = brain.activation[INPUT_COUNT + Output.Give]! > 0;
    creatures.calling[i] = calling ? 1 : 0;
    const sick = updateInfection(world, i);
    const diet = creatures.diet[i]!;

    // Bite the closest creature in view if it is within reach. Teeth made for
    // meat do more harm, and a bigger attacker hurts a smaller victim more, in
    // proportion to their sizes.
    if (attacking && world.senses.targetIndex >= 0 && world.senses.targetGap <= config.attackReach) {
      const victim = world.senses.targetIndex;
      const ratio = size / creatures.size[victim]!;
      const teeth = config.herbivoreAttack + (1 - config.herbivoreAttack) * diet;
      const damage = config.attackDamage * teeth * ratio;
      creatures.health[victim]! -= damage;
      creatures.pain[victim]! += damage;
    }

    // Illness and wounds sap strength.
    if (sick) thrust *= config.plagueSlow;
    thrust *= 1 - config.woundSlow * (1 - Math.max(0, creatures.health[i]!));

    // Act: turn, then move forward. Swimming is slow going.
    const speed = creatures.speed[i]!;
    const heading = creatures.heading[i]! + turn;
    const swimming = plants.water[cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!)] === 1;
    const distance = strideFor(size, speed, config) * thrust * (swimming ? config.swimSpeed : 1);
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

    // Water drains away with time and is topped up in or beside water.
    if (plants.hasWater) {
      const hydration = creatures.hydration[i]! - config.thirstRate;
      creatures.hydration[i] = plants.shore[cell] === 1 ? Math.min(1, hydration + config.drinkRate) : hydration;
    }

    // Pay for body, movement, senses, brain, fighting and signalling; what is
    // spent leaves as heat. Cold weather makes everything cost more.
    const cost =
      climate.cost *
      (sick ? config.plagueCost : 1) *
      (swimming ? config.swimCost : 1) *
      (tickCostFor(size, speed, thrust, config) +
        (attacking ? config.attackCost * size * size : 0) +
        (emitting ? config.scentCost : 0) +
        (calling ? config.callCost : 0) +
        senseCostFor(creatures.sensorRange[i]!, config) +
        brainCost(brain, config));
    const paid = Math.min(cost, energy);
    energy -= paid;
    ledger.heatOut += paid;
    const age = ++creatures.age[i]!;

    // Give: pass energy to the creature in front, as much as it has room for.
    // A creature gives only from what it holds above a reserve, so giving
    // alone never starves it.
    if (giving && world.senses.targetIndex >= 0 && world.senses.targetGap <= config.attackReach) {
      const other = world.senses.targetIndex;
      if (creatures.health[other]! > 0) {
        const room = maxEnergyFor(creatures.size[other]!, config) - creatures.energy[other]!;
        const spare = energy - config.giveReserve * maxEnergy;
        const gift = Math.max(0, Math.min(config.giveRate * size * size, spare, room));
        energy -= gift;
        creatures.energy[other]! += gift;
        world.social.given += gift;
        if (Math.abs(wrappedDelta(creatures.hue[i]!, creatures.hue[other]!, 1)) < KIN_HUE) {
          world.social.givenToKin += gift;
        }
      }
    }

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

  world.activity = alive > 0 ? thrustTotal / alive : 0;

  // Deaths. Backwards, so a removal only moves an already-checked creature.
  for (let i = creatures.count - 1; i >= 0; i--) {
    const struck = creatures.health[i]! <= STRUCK;
    const killed = creatures.health[i]! <= 0;
    const starved = creatures.energy[i]! <= 0;
    const parched = creatures.hydration[i]! <= 0;
    if (!killed && !starved && !parched && creatures.age[i]! < config.maxAge) continue;
    if (struck) {
      world.deaths.disaster++;
      if (creatures.sick[i]! > 0) world.plagueDeaths++;
    }
    else if (killed) world.deaths.killed++;
    else if (parched) world.deaths.thirst++;
    else if (starved) world.deaths.starved++;
    else world.deaths.oldAge++;
    // The body and whatever it had stored stay behind as meat.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    plants.meat[cell]! += creatures.energy[i]! + bodyEnergyFor(creatures.size[i]!, config);
    world.lineage.died(creatures.id[i]!, world.tick);
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

  if (world.tick % config.speciesInterval === 0) {
    classifySpecies(world.species, creatures, world.lineage, world.tick, config);
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

/** Tools the user applies at a point, or along a drag, on the map. */
export type ToolKind = 'meteor' | 'plague' | 'wall' | 'erase' | 'fertilise' | 'blight';

/**
 * Apply a hand tool. (x, y) is where the pointer is now; (fromX, fromY) is
 * where it was at the previous step of a drag, or the same point for a click.
 * As with events, creatures struck by a meteor die in the next tick.
 */
export function applyTool(
  world: World,
  tool: ToolKind,
  x: number,
  y: number,
  fromX: number,
  fromY: number,
): void {
  const { config, plants, environment: env, creatures } = world;
  if (tool === 'meteor') {
    meteorAt(env, world.tick, eventTarget(world), x, y);
  } else if (tool === 'plague') {
    const r2 = config.plagueToolRadius * config.plagueToolRadius;
    let infected = 0;
    for (let i = 0; i < creatures.count; i++) {
      const dx = wrappedDelta(x, creatures.x[i]!, config.worldWidth);
      const dy = wrappedDelta(y, creatures.y[i]!, config.worldHeight);
      if (dx * dx + dy * dy > r2 || creatures.sick[i] !== 0) continue;
      creatures.sick[i] = config.plagueDuration;
      infected++;
    }
    noteOutbreak(env, world.tick, infected);
  } else if (tool === 'wall' || tool === 'erase') {
    wallLine(plants, config, fromX, fromY, x, y, tool === 'wall' ? 1 : 0);
  } else {
    paintFertility(env, plants, config, x, y, config.brushRadius, tool === 'fertilise' ? 1 : 0);
    world.plantCapacityTotal = applyFertility(plants, config, world.ledger);
  }
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
  const child = spawnCreature(creatures, {
    x: wrap(creatures.x[parent]! + Math.cos(behind) * gap, config.worldWidth),
    y: wrap(creatures.y[parent]! + Math.sin(behind) * gap, config.worldHeight),
    heading: rng.range(0, Math.PI * 2),
    energy: given - lost - body,
    genes,
    brain,
    parentId: creatures.id[parent]!,
    generation: creatures.generation[parent]! + 1,
    species: creatures.species[parent]!,
    // A child is born as well watered as its parent.
    hydration: creatures.hydration[parent]!,
  });
  world.lineage.born(creatures.id[child]!, creatures.id[parent]!, world.tick, genes.hue);
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
    speciesCount: world.species.species.length,
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
  array: Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array,
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
    c.species,
    c.x,
    c.y,
    c.heading,
    c.energy,
    c.age,
    c.health,
    c.hydration,
    c.pain,
    c.sick,
    c.calling,
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
