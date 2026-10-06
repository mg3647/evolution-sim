import {
  brainCost,
  enabledLinks,
  founderBrain,
  Innovations,
  Input,
  INPUT_COUNT,
  mutateBrain,
  Output,
  think,
} from './brain';
import { BIOME_TRAITS } from './biomes';
import type { SimConfig } from './config';
import {
  createCreatures,
  genesOf,
  Held,
  removeCreature,
  spawnCreature,
  totalCreatureEnergy,
  type Creatures,
} from './creatures';
import {
  biteFor,
  bodyEnergyFor,
  climateCostFor,
  defenseCostFor,
  founderGenes,
  maxEnergyFor,
  meatDigestion,
  moveCostFor,
  mutateGenes,
  plantDigestion,
  senseCostFor,
  strideFor,
  temperatureStress,
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
import { burn, createFireTally, dropBranches, ignite, maybeLightning, scatterItems, type FireTally } from './fire';
import { wrap, wrappedDelta } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import { Lineage } from './lineage';
import {
  cellIndexAt,
  createPlantField,
  decayMeat,
  growPlants,
  spoilStores,
  temperatureAt,
  totalMeatEnergy,
  totalPlantEnergy,
  totalStoreEnergy,
  type PlantField,
} from './plants';
import { Rng } from './rng';
import { Senses } from './senses';
import { buildSound, createSoundField, type SoundField } from './sound';
import { SpatialHash } from './spatialHash';
import { classifySpecies, createSpeciesState, type SpeciesState } from './species';
import { createHistory, meanOf, recordDensity, recordSample, spreadOf, type History } from './stats';

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
  /** Genes of every creature that gave birth since the last history sample, summed, with the number of births. */
  parents: { count: number; size: number; speed: number; sensorRange: number; diet: number };
  /** Health that biters have lost to their victims' defenses since the world was created. */
  defended: number;
  /** Wildfires so far, and how much is burning now. */
  fires: FireTally;
  /**
   * Carrying since the world was created: things picked up, plant food and
   * meat set down (as energy), and the distance food was carried, weighted
   * by its energy.
   */
  carry: { pickups: number; plantsDropped: number; meatDropped: number; haul: number };
  /**
   * Killed counts bites and biters felled by defenses; disaster counts
   * plagues, meteors and fire; temperature counts those that ran out of
   * energy while too hot or too cold, which are left out of starved.
   */
  deaths: { starved: number; oldAge: number; killed: number; disaster: number; thirst: number; temperature: number };
  /** Running totals behind the Lab's charts; see LabTally. */
  lab: LabTally;
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

/**
 * Counts kept between history samples for the Lab's charts, and the values
 * last recorded where a sample may have nothing new to say.
 */
export interface LabTally {
  /** Tick of the previous sample, and deaths by cause as they stood then. */
  sampledAt: number;
  deathsThen: World['deaths'];
  /** Energy eaten since then: plants and meat, by plant-eaters and by meat-eaters (diet gene above one half). */
  plantsToPlantEaters: number;
  plantsToMeatEaters: number;
  meatToPlantEaters: number;
  meatToMeatEaters: number;
  /** Deaths since then, with the ages and children of the dead summed. */
  died: number;
  ageAtDeath: number;
  childrenAtDeath: number;
  /** First births since then with the parents' ages summed, and all births likewise. */
  firstBirths: number;
  firstBirthAge: number;
  births: number;
  parentAge: number;
  /** Last recorded life-history values, repeated when a sample has no deaths or births. */
  lifespan: number;
  firstBirth: number;
  offspring: number;
  generation: number;
  /** What creatures were doing on the latest sampling tick, and how many acted. */
  resting: number;
  foraging: number;
  chasing: number;
  fleeing: number;
  acted: number;
}

function createLabTally(): LabTally {
  return {
    sampledAt: 0,
    deathsThen: { starved: 0, oldAge: 0, killed: 0, disaster: 0, thirst: 0, temperature: 0 },
    plantsToPlantEaters: 0,
    plantsToMeatEaters: 0,
    meatToPlantEaters: 0,
    meatToMeatEaters: 0,
    died: 0,
    ageAtDeath: 0,
    childrenAtDeath: 0,
    firstBirths: 0,
    firstBirthAge: 0,
    births: 0,
    parentAge: 0,
    lifespan: 0,
    firstBirth: 0,
    offspring: 0,
    generation: 0,
    resting: 0,
    foraging: 0,
    chasing: 0,
    fleeing: 0,
    acted: 0,
  };
}

/**
 * How the Lab sorts what a creature is doing on a sampling tick. A creature
 * counts once, as the first of these that fits; one that fits none is
 * wandering.
 */
/** Chasing: biting or trying to, with a creature in view, and moving. */
const CHASE_THRUST = 0.3;
/** Fleeing: just bitten, or with a creature close behind, and moving hard without biting. */
const FLEE_THRUST = 0.6;
const FLEE_BEHIND = 0.5;
/** Resting: barely moving and not feeding. Foraging: getting at least this share of a full mouthful. */
const REST_THRUST = 0.15;
const FORAGE_MOUTHFUL = 0.25;

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
    defended: 0,
    fires: createFireTally(),
    carry: { pickups: 0, plantsDropped: 0, meatDropped: 0, haul: 0 },
    parents: { count: 0, size: 0, speed: 0, sensorRange: 0, diet: 0 },
    social: { calling: 0, calls: 0, given: 0, givenToKin: 0 },
    activity: 0,
    deaths: { starved: 0, oldAge: 0, killed: 0, disaster: 0, thirst: 0, temperature: 0 },
    lab: createLabTally(),
    environment: createEnvironment(config, rng, plants),
    lineage: new Lineage(),
    species: createSpeciesState(),
    infected: 0,
    plagueDeaths: 0,
    climate: { season: 1, growth: 1, cost: 1, warmth: 0, dayWarmth: 0, bloom: 1 },
  };

  scatterItems(plants, config, rng);
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
  world.senses.warmth = climate.warmth;
  world.senses.dayWarmth = climate.dayWarmth;

  growPlants(
    plants,
    config.plantGrowthRate * climate.growth,
    config.plantBareGrowth,
    ledger,
    climate.bloom,
    config.ashGrowth,
  );
  dropBranches(plants, config, world.rng);
  maybeLightning(plants, config, world.rng, world.fires, (cell) =>
    temperatureAt(plants, cell, climate.warmth, config, climate.dayWarmth),
  );
  burn(plants, config, world.rng, ledger, world.fires);
  decayMeat(plants, config.meatDecayRate, ledger);
  spoilStores(plants, config.storeDecay, ledger);
  spreadScent(env, plants, config);
  world.hash.build(creatures.x, creatures.y, creatures.count);
  world.social.calling = buildSound(world.sound, creatures);
  world.social.calls += world.social.calling;

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  let thrustTotal = 0;
  // On a sampling tick, what each creature is doing is tallied for the Lab.
  const lab = world.lab;
  const sampling = world.tick % world.history.interval === 0;
  if (sampling) lab.resting = lab.foraging = lab.chasing = lab.fleeing = lab.acted = 0;
  for (let i = 0; i < alive; i++) {
    // Killed earlier this tick: it no longer acts, and leaves its body in the death pass.
    if (creatures.health[i]! <= 0) continue;
    const size = creatures.size[i]!;
    const brain = creatures.brain[i]!;

    // Sense, then think. Outputs are in [-1, 1].
    world.senses.sense(creatures, i, world.tick, brain.activation);
    const hurt = creatures.pain[i]! > 0;
    creatures.pain[i] = 0;
    think(brain);
    const turn = brain.activation[INPUT_COUNT + Output.Turn]! * config.maxTurn;
    let thrust = (brain.activation[INPUT_COUNT + Output.Thrust]! + 1) / 2;
    thrustTotal += thrust;
    const effort = thrust;
    const wantsChild = brain.activation[INPUT_COUNT + Output.Reproduce]! >= 0;
    const attacking = brain.activation[INPUT_COUNT + Output.Attack]! > 0;
    const emitting = brain.activation[INPUT_COUNT + Output.Emit]! > 0;
    const calling = brain.activation[INPUT_COUNT + Output.Call]! > 0;
    const giving = brain.activation[INPUT_COUNT + Output.Give]! > 0;
    const holding = brain.activation[INPUT_COUNT + Output.Hold]! > 0;
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
      // A stone in the biter's grip adds to the blow; a branch in the victim's takes part of it.
      const damage =
        config.attackDamage *
        teeth *
        ratio *
        (creatures.held[i] === Held.Stone ? 1 + config.stoneBite : 1) *
        (creatures.held[victim] === Held.Branch ? 1 - config.branchShield : 1);
      creatures.health[victim]! -= damage;
      creatures.pain[victim]! += damage;
      // Spines and poison bite back at a bite that lands: the biter is hurt,
      // the more so the smaller it is.
      const harm = damage > 0 ? (config.defenseDamage * creatures.defense[victim]!) / ratio : 0;
      if (harm > 0) {
        creatures.health[i]! -= harm;
        creatures.pain[i]! += harm;
        world.defended += harm;
      }
    }

    // Illness and wounds sap strength.
    if (sick) thrust *= config.plagueSlow;
    thrust *= 1 - config.woundSlow * (1 - Math.max(0, creatures.health[i]!));

    // Act: turn, then move forward. Swimming is slow going.
    const speed = creatures.speed[i]!;
    const heading = creatures.heading[i]! + turn;
    const swimming = plants.water[cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!)] === 1;
    const distance =
      strideFor(size, speed, config) *
      thrust *
      (swimming ? config.swimSpeed : 1) *
      (creatures.held[i] !== Held.Nothing ? 1 - config.carrySlow : 1);
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
    const land = BIOME_TRAITS[plants.biome[cell]!]!;
    // Standing in fire burns. Whoever it kills is counted with the disasters.
    if (plants.fire[cell]! > 0 && creatures.health[i]! > 0) {
      creatures.pain[i]! += config.fireDamage;
      const left = creatures.health[i]! - config.fireDamage;
      creatures.health[i] = left > 0 ? left : STRUCK;
    }
    const maxEnergy = maxEnergyFor(size, config);
    let energy = creatures.energy[i]!;
    let mouthful = biteFor(size, config) * (1 - config.eatSlowdown * thrust);
    const meatRate = config.meatBiteScale * meatDigestion(diet);
    const meatBite = Math.max(0, Math.min(mouthful * meatRate, plants.meat[cell]!, maxEnergy - energy));
    plants.meat[cell]! -= meatBite;
    energy += meatBite;
    if (meatRate > 0) mouthful = Math.max(0, mouthful - meatBite / meatRate);
    // Stored plant food is eaten before what is growing.
    const stored = Math.max(0, Math.min(mouthful * plantDigestion(diet), plants.store[cell]!, maxEnergy - energy));
    plants.store[cell]! -= stored;
    energy += stored;
    const bite = Math.max(
      0,
      Math.min(mouthful * plantDigestion(diet) - stored, plants.energy[cell]!, maxEnergy - energy),
    );
    plants.energy[cell]! -= bite;
    energy += bite;

    // Hold: pick up what is underfoot when empty-handed (a stone, else a
    // branch, else a load of meat, else of plants), and keep hold of it.
    // Letting go sets it down here: food becomes a store that slowly spoils.
    const held = creatures.held[i]!;
    if (holding && held === Held.Nothing) {
      const load = biteFor(size, config) * config.carryMouthfuls;
      const least = biteFor(size, config);
      if (plants.stones[cell]! > 0) {
        plants.stones[cell]!--;
        creatures.held[i] = Held.Stone;
      } else if (plants.branches[cell]! > 0 && plants.fire[cell] === 0) {
        plants.branches[cell]!--;
        creatures.held[i] = Held.Branch;
      } else if (plants.meat[cell]! >= least) {
        const taken = Math.min(load, plants.meat[cell]!);
        plants.meat[cell]! -= taken;
        creatures.heldEnergy[i] = taken;
        creatures.held[i] = Held.Meat;
      } else if (plants.energy[cell]! + plants.store[cell]! >= least) {
        const fromStore = Math.min(load, plants.store[cell]!);
        const fromPlants = Math.min(load - fromStore, plants.energy[cell]!);
        plants.store[cell]! -= fromStore;
        plants.energy[cell]! -= fromPlants;
        creatures.heldEnergy[i] = fromStore + fromPlants;
        creatures.held[i] = Held.Plants;
      }
      if (creatures.held[i] !== Held.Nothing) {
        world.carry.pickups++;
        creatures.heldFromX[i] = creatures.x[i]!;
        creatures.heldFromY[i] = creatures.y[i]!;
      }
    } else if (!holding && held !== Held.Nothing) {
      setDown(world, i, cell);
    }
    if (diet > 0.5) {
      lab.plantsToMeatEaters += bite + stored;
      lab.meatToMeatEaters += meatBite;
    } else {
      lab.plantsToPlantEaters += bite + stored;
      lab.meatToPlantEaters += meatBite;
    }
    if (sampling) {
      lab.acted++;
      if (attacking && world.senses.targetIndex >= 0 && effort > CHASE_THRUST) lab.chasing++;
      else if ((hurt || brain.activation[Input.Behind]! > FLEE_BEHIND) && effort > FLEE_THRUST && !attacking) lab.fleeing++;
      else if (bite + stored + meatBite >= FORAGE_MOUTHFUL * biteFor(size, config)) lab.foraging++;
      else if (effort < REST_THRUST) lab.resting++;
    }
    if (emitting) plants.scent[cell]! += config.scentEmit;

    // Water drains away with time and is topped up in or beside water.
    if (plants.hasWater) {
      const hydration = creatures.hydration[i]! - config.thirstRate * land.thirst;
      creatures.hydration[i] = plants.shore[cell] === 1 ? Math.min(1, hydration + config.drinkRate) : hydration;
    }

    // Pay for body, movement, senses, brain, fighting and signalling, and for
    // being too hot or too cold; what is spent leaves as heat. An ice age
    // makes everything cost more. Undergrowth makes moving cost more, and
    // moving hard heats the body: bad in the heat, welcome in the cold.
    const felt =
      temperatureAt(plants, cell, climate.warmth, config, climate.dayWarmth) +
      (config.temperatureStrength > 0 ? config.exertionHeat * thrust : 0);
    const cost =
      climate.cost *
      (sick ? config.plagueCost : 1) *
      (swimming ? config.swimCost : 1) *
      (tickCostFor(size, speed, thrust, config) +
        (attacking ? config.attackCost * size * size : 0) +
        (emitting ? config.scentCost : 0) +
        (calling ? config.callCost : 0) +
        (land.moveCost - 1) * moveCostFor(size, speed, thrust, config) +
        climateCostFor(felt, size, creatures.fur[i]!, config) +
        defenseCostFor(size, creatures.defense[i]!, config) +
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
    else if (starved) {
      // Running out of energy while too hot or too cold is put down to the temperature.
      const here = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
      const heat = temperatureAt(plants, here, climate.warmth, config, climate.dayWarmth);
      if (temperatureStress(heat, creatures.size[i]!, creatures.fur[i]!, config) > 0) world.deaths.temperature++;
      else world.deaths.starved++;
    } else world.deaths.oldAge++;
    lab.died++;
    lab.ageAtDeath += creatures.age[i]!;
    lab.childrenAtDeath += creatures.children[i]!;
    // The body and whatever it had stored stay behind as meat, and what it held falls where it died.
    const cell = cellIndexAt(plants, creatures.x[i]!, creatures.y[i]!);
    if (creatures.held[i] !== Held.Nothing) setDown(world, i, cell);
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

/** Creature i lets go of what it holds, into the cell it stands on. */
function setDown(world: World, i: number, cell: number): void {
  const { creatures, plants, config } = world;
  const held = creatures.held[i]!;
  const energy = creatures.heldEnergy[i]!;
  if (held === Held.Stone) {
    if (plants.stones[cell]! < 255) plants.stones[cell]!++;
  } else if (held === Held.Branch) {
    if (plants.branches[cell]! < 255) plants.branches[cell]!++;
  } else if (held === Held.Meat) {
    plants.meat[cell]! += energy;
    world.carry.meatDropped += energy;
  } else if (held === Held.Plants) {
    plants.store[cell]! += energy;
    world.carry.plantsDropped += energy;
  }
  if (energy > 0) {
    const dx = wrappedDelta(creatures.heldFromX[i]!, creatures.x[i]!, config.worldWidth);
    const dy = wrappedDelta(creatures.heldFromY[i]!, creatures.y[i]!, config.worldHeight);
    world.carry.haul += energy * Math.hypot(dx, dy);
  }
  creatures.held[i] = Held.Nothing;
  creatures.heldEnergy[i] = 0;
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
export type ToolKind = 'meteor' | 'plague' | 'wall' | 'erase' | 'fertilise' | 'blight' | 'fire';

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
  } else if (tool === 'fire') {
    const cell = cellIndexAt(plants, wrap(x, config.worldWidth), wrap(y, config.worldHeight));
    if (ignite(plants, cell, config, world.fires)) world.fires.started++;
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
  let childX = wrap(creatures.x[parent]! + Math.cos(behind) * gap, config.worldWidth);
  let childY = wrap(creatures.y[parent]! + Math.sin(behind) * gap, config.worldHeight);
  // Not into a wall, though: a child born inside one could walk out the far side.
  if (world.plants.walls[cellIndexAt(world.plants, childX, childY)] === 1) {
    childX = creatures.x[parent]!;
    childY = creatures.y[parent]!;
  }
  const child = spawnCreature(creatures, {
    x: childX,
    y: childY,
    heading: rng.range(0, Math.PI * 2),
    energy: given - lost - body,
    genes,
    brain,
    parentId: creatures.id[parent]!,
    generation: creatures.generation[parent]! + 1,
    founder: creatures.founder[parent]!,
    species: creatures.species[parent]!,
    // A child is born as well watered as its parent.
    hydration: creatures.hydration[parent]!,
  });
  world.lineage.born(creatures.id[child]!, creatures.id[parent]!, world.tick, genes.hue);
  world.births++;
  if (creatures.children[parent] === 0) {
    world.lab.firstBirths++;
    world.lab.firstBirthAge += creatures.age[parent]!;
  }
  if (creatures.children[parent]! < 65535) creatures.children[parent]!++;
  world.lab.births++;
  world.lab.parentAge += creatures.age[parent]!;
  world.parents.count++;
  world.parents.size += parentGenes.size;
  world.parents.speed += parentGenes.speed;
  world.parents.sensorRange += parentGenes.sensorRange;
  world.parents.diet += parentGenes.diet;
  return given;
}

function sampleHistory(world: World): void {
  const { creatures } = world;
  let links = 0;
  let neurons = 0;
  let meatEaters = 0;
  let toolHolders = 0;
  let foodHolders = 0;
  for (let i = 0; i < creatures.count; i++) {
    if (creatures.diet[i]! > 0.5) meatEaters++;
    const held = creatures.held[i]!;
    if (held === Held.Stone || held === Held.Branch) toolHolders++;
    else if (held !== Held.Nothing) foodHolders++;
    links += enabledLinks(creatures.brain[i]!);
    neurons += creatures.brain[i]!.hiddenIds.length;
  }
  const count = Math.max(1, creatures.count);
  const meanSize = meanOf(creatures.size, creatures);
  const meanSpeed = meanOf(creatures.speed, creatures);
  const meanSensorRange = meanOf(creatures.sensorRange, creatures);
  const meanDiet = meanOf(creatures.diet, creatures);
  // With no births since the last sample there is nothing to compare, so parents read as average.
  const parents = world.parents;
  const had = parents.count;

  // Rates since the previous sample, for the Lab's charts.
  const lab = world.lab;
  const elapsed = Math.max(1, world.tick - lab.sampledAt);
  const deaths = world.deaths;
  const then = lab.deathsThen;
  const perThousand = (now: number, before: number) => ((now - before) * 1000) / elapsed;
  if (lab.died > 0) {
    lab.lifespan = lab.ageAtDeath / lab.died;
    lab.offspring = lab.childrenAtDeath / lab.died;
  }
  if (lab.firstBirths > 0) lab.firstBirth = lab.firstBirthAge / lab.firstBirths;
  if (lab.births > 0) lab.generation = lab.parentAge / lab.births;
  const acted = Math.max(1, lab.acted);
  const speciesCounts = new Map<number, number>();
  for (const record of world.species.species) speciesCounts.set(record.id, 0);
  for (let i = 0; i < creatures.count; i++) {
    speciesCounts.set(creatures.species[i]!, (speciesCounts.get(creatures.species[i]!) ?? 0) + 1);
  }
  recordDensity(world.history.density, creatures, world.config.worldWidth, world.config.worldHeight, world.tick);

  recordSample(world.history, {
    deathsStarved: perThousand(deaths.starved, then.starved),
    deathsOldAge: perThousand(deaths.oldAge, then.oldAge),
    deathsKilled: perThousand(deaths.killed, then.killed),
    deathsTemperature: perThousand(deaths.temperature, then.temperature),
    deathsThirst: perThousand(deaths.thirst, then.thirst),
    deathsOther: perThousand(deaths.disaster, then.disaster),
    flowPlantsToPlantEaters: lab.plantsToPlantEaters / elapsed,
    flowPlantsToMeatEaters: lab.plantsToMeatEaters / elapsed,
    flowMeatToPlantEaters: lab.meatToPlantEaters / elapsed,
    flowMeatToMeatEaters: lab.meatToMeatEaters / elapsed,
    lifespan: lab.lifespan,
    firstBirthAge: lab.firstBirth,
    offspring: lab.offspring,
    generationLength: lab.generation,
    shareResting: lab.resting / acted,
    shareForaging: lab.foraging / acted,
    shareChasing: lab.chasing / acted,
    shareFleeing: lab.fleeing / acted,
    tick: world.tick,
    population: creatures.count,
    plantFill: world.plantCapacityTotal > 0 ? totalPlantEnergy(world.plants) / world.plantCapacityTotal : 0,
    meanSize,
    meanSpeed,
    meanSensorRange,
    meanDiet,
    meanFur: meanOf(creatures.fur, creatures),
    meanDefense: meanOf(creatures.defense, creatures),
    toolHolders,
    foodHolders,
    meatEaters,
    speciesCount: world.species.species.length,
    meanLinks: links / count,
    meanNeurons: neurons / count,
    parentSize: had > 0 ? parents.size / had : meanSize,
    parentSpeed: had > 0 ? parents.speed / had : meanSpeed,
    parentSensorRange: had > 0 ? parents.sensorRange / had : meanSensorRange,
    parentDiet: had > 0 ? parents.diet / had : meanDiet,
    diversity:
      (spreadOf(creatures.size, creatures) +
        spreadOf(creatures.speed, creatures) +
        spreadOf(creatures.sensorRange, creatures) +
        spreadOf(creatures.diet, creatures)) /
      4,
  }, speciesCounts);
  world.parents = { count: 0, size: 0, speed: 0, sensorRange: 0, diet: 0 };
  lab.sampledAt = world.tick;
  lab.deathsThen = { ...deaths };
  lab.plantsToPlantEaters = lab.plantsToMeatEaters = lab.meatToPlantEaters = lab.meatToMeatEaters = 0;
  lab.died = lab.ageAtDeath = lab.childrenAtDeath = 0;
  lab.firstBirths = lab.firstBirthAge = lab.births = lab.parentAge = 0;
}

/** Energy currently held by everything in the world: plants, stored food, meat, and creatures' stores, loads and bodies. */
export function totalEnergy(world: World): number {
  const { creatures, config } = world;
  let bodies = 0;
  for (let i = 0; i < creatures.count; i++) bodies += bodyEnergyFor(creatures.size[i]!, config);
  return (
    totalPlantEnergy(world.plants) +
    totalStoreEnergy(world.plants) +
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
  h = hashBytes(h, bytesOf(plants.store));
  h = hashBytes(h, plants.branches);
  h = hashBytes(h, plants.stones);
  h = hashBytes(h, bytesOf(plants.fire));
  h = hashBytes(h, bytesOf(plants.ash));
  for (const field of [
    c.id,
    c.parentId,
    c.generation,
    c.founder,
    c.species,
    c.x,
    c.y,
    c.heading,
    c.energy,
    c.age,
    c.children,
    c.health,
    c.hydration,
    c.pain,
    c.sick,
    c.calling,
    c.held,
    c.heldEnergy,
    c.size,
    c.speed,
    c.sensorRange,
    c.diet,
    c.hue,
    c.fur,
    c.defense,
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
