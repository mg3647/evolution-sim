import {
  brainCost,
  crossoverBrain,
  enabledLinks,
  founderBrain,
  hasLoop,
  type Brain,
  Innovations,
  Input,
  INPUT_COUNT,
  mutateBrain,
  Output,
  think,
} from './brain';
import { BIOME_TRAITS } from './biomes';
import {
  addBlock,
  canHoldBlock,
  createBlockTally,
  freeCellNear,
  isSolid,
  longestBuiltLine,
  pushBlock,
  removeBlock,
  scatterBlocks,
  type BlockTally,
} from './blocks';
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
  crossGenes,
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
import {
  burn,
  createFireTally,
  douse,
  dropBranches,
  ignite,
  maybeLightning,
  scatterItems,
  type FireTally,
} from './fire';
import { wrap, wrappedDelta } from './geometry';
import { createLedger, type EnergyLedger } from './ledger';
import { Lineage } from './lineage';
import { mateDistance } from './mating';
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
import { createWiringTally, markFounding, sampleWiring, type WiringTally } from './wiring';
import { createHistory, meanOf, recordBehaviour, recordDensity, recordSample, spreadOf, type History } from './stats';

export interface World {
  config: SimConfig;
  tick: number;
  rng: Rng;
  plants: PlantField;
  /** Plant energy the field holds when fully grown. */
  plantCapacityTotal: number;
  creatures: Creatures;
  innovations: Innovations;
  /** Draws the shadow's random parents, apart from `rng` so the shadow never changes the world. */
  shadowRng: Rng;
  /** Activity of every brain link, real and neutral shadow; see wiring.ts. */
  wiring: WiringTally;
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
  /** Brain changes seen at births of one parent so far: links and neurons added by mutation (a neuron split counts once, not as its two links). */
  structural: { links: number; neurons: number };
  /** Births of two parents, and how many of those were between close relatives (parent and child, or siblings). */
  mating: { sexual: number; kin: number };
  /** Creatures willing and able to mate this tick; rebuilt every tick. */
  mateCandidates: number[];
  reseeded: number;
  /** Genes of every creature that gave birth since the last history sample, summed, with the number of births. */
  parents: { count: number; size: number; speed: number; sensorRange: number; diet: number };
  /** Health that biters have lost to their victims' defenses since the world was created. */
  defended: number;
  /**
   * Since the world was created: tries to breed that failed because the gift
   * was too small to build a body, energy children started with in all, and
   * deaths before breeding age.
   */
  lifeHistory: { tooSmall: number; childEnergy: number; juvenileDeaths: number };
  /** Wildfires so far, and how much is burning now. */
  fires: FireTally;
  /** What creatures have done with blocks since the world was created. */
  blockTally: BlockTally;
  /** Blocks moved since the last history sample, by the species of the mover. */
  blockMoves: Record<number, number>;
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
/** Health a plague death is marked with, so the death pass can tell it from fire or a meteor. */
const PLAGUE_DEATH = -3;
/** The lowest a bite or spines can take health, kept above STRUCK so a kill is never counted as a disaster. */
const WOUNDED_FLOOR = -1;
/** Share of the newest change in its energy that enters the smoothed trend each turn. */
const TREND_SMOOTHING = 0.2;

/** Add a creature with no parent at a random position. Returns the energy it embodies. */
function spawnFounder(world: World, age: number): number {
  const { config, rng, creatures } = world;
  const genes = founderGenes(rng, config);
  const energy = Math.min(config.creatureStartEnergy, maxEnergyFor(genes.size, config));
  // Founders start on dry land where there is any; a few tries is plenty.
  let x = rng.range(0, config.worldWidth);
  let y = rng.range(0, config.worldHeight);
  const taken = (at: number) => world.plants.water[at] === 1 || world.plants.blocks[at] === 1;
  for (let tries = 0; tries < 20 && taken(cellIndexAt(world.plants, x, y)); tries++) {
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

/** Thrust below which a creature grabbing a block lifts it; at or above this it pushes. */
const LIFT_EFFORT = 0.25;

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
    shadowRng: new Rng(`${config.seed}:shadow`),
    wiring: createWiringTally(),
    hash,
    sound,
    senses: new Senses(config, plants, hash, sound),
    ledger: createLedger(),
    history: createHistory(config.statsInterval, config.statsCapacity),
    births: 0,
    structural: { links: 0, neurons: 0 },
    mating: { sexual: 0, kin: 0 },
    mateCandidates: [],
    reseeded: 0,
    defended: 0,
    lifeHistory: { tooSmall: 0, childEnergy: 0, juvenileDeaths: 0 },
    fires: createFireTally(),
    blockTally: createBlockTally(),
    blockMoves: {},
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
  scatterBlocks(plants, config, rng);
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
/** Reused between ticks: the order in which creatures take their turns. */
let turnOrder = new Uint32Array(0);

/** The first `count` creature indices, in birth order, or shuffled when given a generator. */
function actOrder(count: number, rng: Rng | null): Uint32Array {
  if (turnOrder.length < count) turnOrder = new Uint32Array(Math.max(count, turnOrder.length * 2));
  for (let k = 0; k < count; k++) turnOrder[k] = k;
  if (rng) {
    for (let k = count - 1; k > 0; k--) {
      const j = rng.int(0, k + 1);
      const swap = turnOrder[k]!;
      turnOrder[k] = turnOrder[j]!;
      turnOrder[j] = swap;
    }
  }
  return turnOrder;
}

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
  spoilStores(plants, config.storeDecay, ledger, config.storeShelter);
  spreadScent(env, plants, config);
  world.hash.build(creatures.x, creatures.y, creatures.count);
  world.social.calling = buildSound(world.sound, creatures);
  world.social.calls += world.social.calling;

  // Children born this tick are appended past `alive` and first act next tick.
  const alive = creatures.count;
  world.mateCandidates.length = 0;
  let thrustTotal = 0;
  // On a sampling tick, what each creature is doing is tallied for the Lab.
  const lab = world.lab;
  const sampling = world.tick % world.history.interval === 0;
  if (sampling) lab.resting = lab.foraging = lab.chasing = lab.fleeing = lab.acted = 0;
  const order = actOrder(alive, config.shuffleActOrder ? world.rng : null);
  for (let slot = 0; slot < alive; slot++) {
    const i = order[slot]!;
    // Killed earlier this tick: it no longer acts, and leaves its body in the death pass.
    if (creatures.health[i]! <= 0) continue;
    const size = creatures.size[i]!;
    const brain = creatures.brain[i]!;

    // Sense, then think. Outputs are in [-1, 1].
    // How its energy has moved since its last turn, smoothed, is what it senses as a trend.
    creatures.trend[i] =
      creatures.trend[i]! * (1 - TREND_SMOOTHING) +
      ((creatures.energy[i]! - creatures.energyLast[i]!) / maxEnergyFor(size, config)) * TREND_SMOOTHING;
    creatures.energyLast[i] = creatures.energy[i]!;
    world.senses.sense(creatures, i, world.tick, brain.activation);
    const hurt = creatures.pain[i]! > 0;
    creatures.pain[i] = 0;
    think(brain, config.plasticityDecay);
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
    // Eating is on unless the brain shuts it off, so a brain that never uses the output eats as before.
    const eating = brain.activation[INPUT_COUNT + Output.Eat]! >= -0.5;
    const display = Math.max(0, brain.activation[INPUT_COUNT + Output.Display]!);
    creatures.display[i] = display;
    creatures.calling[i] = calling ? 1 : 0;
    const sick = updateInfection(world, i);
    // A plague death ends its turn here.
    if (creatures.health[i]! <= 0) continue;
    const diet = creatures.diet[i]!;

    // Bite the closest creature in view if it is within reach. Teeth made for
    // meat do more harm, and a bigger attacker hurts a smaller victim more, in
    // proportion to their sizes.
    if (
      attacking &&
      world.senses.targetIndex >= 0 &&
      world.senses.targetGap <= config.attackReach &&
      creatures.health[world.senses.targetIndex]! > 0
    ) {
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
      creatures.health[victim] = Math.max(WOUNDED_FLOOR, creatures.health[victim]! - damage);
      creatures.pain[victim]! += damage;
      // Spines and poison bite back at a bite that lands: the biter is hurt,
      // the more so the smaller it is.
      const harm = damage > 0 ? (config.defenseDamage * creatures.defense[victim]!) / ratio : 0;
      if (harm > 0) {
        creatures.health[i] = Math.max(WOUNDED_FLOOR, creatures.health[i]! - harm);
        creatures.pain[i]! += harm;
        world.defended += harm;
      }
      // Killed by its victim's spines: its turn ends here.
      if (creatures.health[i]! <= 0) continue;
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
      (creatures.held[i] === Held.Block
        ? 1 - config.blockWeight
        : creatures.held[i] !== Held.Nothing
          ? 1 - config.carrySlow
          : 1);
    creatures.heading[i] = heading;
    // Rounded to stored precision first, so the cell checked is the cell it lands in.
    const toX = Math.fround(wrap(creatures.x[i]! + Math.cos(heading) * distance, config.worldWidth));
    const toY = Math.fround(wrap(creatures.y[i]! + Math.sin(heading) * distance, config.worldHeight));
    const fromX = creatures.x[i]!;
    const fromY = creatures.y[i]!;
    // A wall or a block stops a creature entering its cell; one already
    // inside may walk out. Walking into a block shoves it one cell on if
    // there is room beyond. A creature that is stopped slides along the
    // obstacle instead of stopping dead.
    const fromCell = cellIndexAt(plants, fromX, fromY);
    let pushedBlock = false;
    const toCell = cellIndexAt(plants, toX, toY);
    if (!isSolid(plants, toCell) || isSolid(plants, fromCell)) {
      creatures.x[i] = toX;
      creatures.y[i] = toY;
    } else if (
      // Blocks give way only to a creature that is grabbing as it walks into them.
      holding &&
      pushBlock(plants, fromCell, toCell, creatures.species[i]!, { tick: world.tick, creature: creatures.id[i]! })
    ) {
      pushedBlock = true;
      creatures.x[i] = toX;
      creatures.y[i] = toY;
      world.blockTally.pushed++;
      world.blockMoves[creatures.species[i]!] = (world.blockMoves[creatures.species[i]!] ?? 0) + 1;
    } else if (!isSolid(plants, cellIndexAt(plants, toX, fromY))) {
      creatures.x[i] = toX;
    } else if (!isSolid(plants, cellIndexAt(plants, fromX, toY))) {
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
      // Burned to death: it does not eat, carry or breed.
      if (left <= 0) continue;
    }
    const maxEnergy = maxEnergyFor(size, config);
    let energy = creatures.energy[i]!;
    let mouthful = eating ? biteFor(size, config) * (1 - config.eatSlowdown * thrust) : 0;
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
    // A block is grabbed from the cell it is facing, and set down there too.
    const held = creatures.held[i]!;
    if (holding && held === Held.Nothing) {
      const load = biteFor(size, config) * config.carryMouthfuls;
      const least = biteFor(size, config);
      const front = cellInFront(world, i);
      // Only a light block can be lifted, and only by a creature that is holding still: grabbing while moving pushes instead.
      if (front !== cell && !pushedBlock && effort < LIFT_EFFORT && plants.blockHeavy[front] === 0 && removeBlock(plants, front)) {
        creatures.held[i] = Held.Block;
      } else if (plants.stones[cell]! > 0) {
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
    } else if (!holding && held === Held.Block) {
      // Only where there is room: otherwise it keeps hold.
      const front = cellInFront(world, i);
      if (front !== cell && canHoldBlock(plants, front)) {
        addBlock(plants, front, creatures.species[i]!, true);
        creatures.held[i] = Held.Nothing;
        world.blockTally.setDown++;
        world.blockMoves[creatures.species[i]!] = (world.blockMoves[creatures.species[i]!] ?? 0) + 1;
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
        config.displayCost * display +
        (land.moveCost - 1) * moveCostFor(size, speed, thrust, config) +
        // In or beside a block's cell there is shelter from the heat and the cold.
        climateCostFor(felt, size, creatures.fur[i]!, config) * (plants.nearBlocks[cell]! > 0 ? 1 - config.shelter : 1) +
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

    // Breeding alone is wished with Reproduce; breeding with a mate is wished with Mate, and a
    // creature that wishes for a mate waits for one rather than breeding alone. Alone, the birth is
    // now; with a mate, who is near enough and willing is settled once everyone has moved.
    if (
      energy >= creatures.readiness[i]! * maxEnergy &&
      age >= config.minReproduceAge &&
      creatures.count < config.maxCreatures
    ) {
      const mateWilling = brain.activation[INPUT_COUNT + Output.Mate]! >= 0;
      if (config.reproductionMode === 0 || (config.reproductionMode === 1 && !mateWilling)) {
        if (wantsChild) energy -= giveBirth(world, i, energy);
      } else if (mateWilling) {
        world.mateCandidates.push(i);
      }
    }
    creatures.energy[i] = energy;
    // Health is read here, after any bites taken earlier this tick, so healing never hides a kill.
    if (creatures.health[i]! > 0) creatures.health[i] = Math.min(1, creatures.health[i]! + config.healRate);
  }

  world.activity = alive > 0 ? thrustTotal / alive : 0;
  if (world.mateCandidates.length > 0) pairUp(world);

  // Deaths. Backwards, so a removal only moves an already-checked creature.
  for (let i = creatures.count - 1; i >= 0; i--) {
    const struck = creatures.health[i]! <= STRUCK;
    const killed = creatures.health[i]! <= 0;
    const starved = creatures.energy[i]! <= 0;
    const parched = creatures.hydration[i]! <= 0;
    if (!killed && !starved && !parched && creatures.age[i]! < config.maxAge) continue;
    if (struck) {
      world.deaths.disaster++;
      if (creatures.health[i]! <= PLAGUE_DEATH) world.plagueDeaths++;
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
    if (creatures.age[i]! < config.minReproduceAge) world.lifeHistory.juvenileDeaths++;
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
    // Wiring brought in from outside is not an innovation of this world's evolution.
    markFounding(world.wiring, world.creatures.brain[creatures.count - 1]!);
  }

  if (world.tick % config.speciesInterval === 0) {
    classifySpecies(world.species, creatures, world.lineage, world.tick, config);
  }
  if (world.tick % world.history.interval === 0) sampleHistory(world);
}

/** The cell one cell's length ahead of creature i, the way it is heading. */
function cellInFront(world: World, i: number): number {
  const { creatures, plants, config } = world;
  const heading = creatures.heading[i]!;
  return cellIndexAt(
    plants,
    wrap(creatures.x[i]! + Math.cos(heading) * plants.cellWidth, config.worldWidth),
    wrap(creatures.y[i]! + Math.sin(heading) * plants.cellHeight, config.worldHeight),
  );
}

/** Creature i lets go of what it holds, into the cell it stands on. */
function setDown(world: World, i: number, cell: number): void {
  const { creatures, plants, config } = world;
  const held = creatures.held[i]!;
  const energy = creatures.heldEnergy[i]!;
  if (held === Held.Block) {
    // A block falls where its carrier fell, or on the nearest dry free cell within a dozen; with no room at all it is lost.
    const at = freeCellNear(plants, cell, 12);
    if (at >= 0) addBlock(plants, at, creatures.species[i]!, true);
  } else if (held === Held.Stone) {
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
  if (rng.chance(config.plagueDeathChance)) creatures.health[i] = PLAGUE_DEATH;
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
export type ToolKind = 'meteor' | 'plague' | 'wall' | 'erase' | 'fertilise' | 'blight' | 'fire' | 'rain' | 'block';

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
  } else if (tool === 'rain') {
    // Rain puts out every fire inside the ring.
    const r2 = config.brushRadius * config.brushRadius;
    for (let cy = 0; cy < plants.rows; cy++) {
      const dy = wrappedDelta(y, (cy + 0.5) * plants.cellHeight, config.worldHeight);
      if (Math.abs(dy) > config.brushRadius) continue;
      for (let cx = 0; cx < plants.cols; cx++) {
        const dx = wrappedDelta(x, (cx + 0.5) * plants.cellWidth, config.worldWidth);
        if (dx * dx + dy * dy <= r2) douse(plants, cy * plants.cols + cx, world.fires);
      }
    }
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
  } else if (tool === 'block') {
    // One block under the pointer, where there is room for it.
    const cell = cellIndexAt(plants, wrap(x, config.worldWidth), wrap(y, config.worldHeight));
    if (canHoldBlock(plants, cell)) addBlock(plants, cell);
  } else if (tool === 'wall' || tool === 'erase') {
    wallLine(plants, config, fromX, fromY, x, y, tool === 'wall' ? 1 : 0);
    // Erasing takes blocks away along the same line.
    if (tool === 'erase') {
      const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / (plants.cellWidth / 2)));
      for (let k = 0; k <= steps; k++) {
        const px = wrap(fromX + ((x - fromX) * k) / steps, config.worldWidth);
        const py = wrap(fromY + ((y - fromY) * k) / steps, config.worldHeight);
        removeBlock(plants, cellIndexAt(plants, px, py));
      }
    }
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
  return bear(world, parent, -1, energy * world.creatures.investment[parent]!);
}

/**
 * A creature at index `a` may breed now: enough energy, old enough, alive, and room in the world.
 * Also true of a mating candidate that has since been bitten or given something away.
 */
function canBreed(world: World, a: number): boolean {
  const { creatures, config } = world;
  return (
    creatures.health[a]! > 0 &&
    creatures.energy[a]! >= creatures.readiness[a]! * maxEnergyFor(creatures.size[a]!, config) &&
    creatures.age[a]! >= config.minReproduceAge &&
    creatures.count < config.maxCreatures
  );
}

/** Two creatures are close kin if one is the other's parent, or they share a parent. */
function closeKin(creatures: Creatures, a: number, b: number): boolean {
  const idA = creatures.id[a]!;
  const idB = creatures.id[b]!;
  const parentsA = [creatures.parentId[a]!, creatures.otherParentId[a]!];
  const parentsB = [creatures.parentId[b]!, creatures.otherParentId[b]!];
  if (parentsA.includes(idB) || parentsB.includes(idA)) return true;
  return parentsA.some((parent) => parent !== 0 && parentsB.includes(parent));
}

/**
 * Pair up the creatures that want to mate. They are taken in a random order
 * (drawn from the world's own random numbers, so runs repeat), and each is
 * paired with the closest other willing creature within mating reach,
 * which also must be able to breed and, if the world sets a limit, be alike
 * enough. A pair that cannot afford a child is left as it was. A creature
 * that finds no mate waits, keeping its energy, and tries again next tick.
 */
function pairUp(world: World): void {
  const { creatures, config, rng, hash } = world;
  const candidates = world.mateCandidates;
  const isCandidate = new Set(candidates);
  for (let k = candidates.length - 1; k > 0; k--) {
    const j = rng.int(0, k + 1);
    [candidates[k], candidates[j]] = [candidates[j]!, candidates[k]!];
  }
  const done = new Set<number>();
  // The hash holds positions from the start of the tick; a creature moves less than this since.
  const slack = 4 * config.creatureRadius * config.maxSize + 2 * config.creatureSpeed * config.maxSpeed;
  const reach = config.mateReach;
  for (const a of candidates) {
    if (done.has(a) || !canBreed(world, a)) continue;
    let best = -1;
    let bestGap = Infinity;
    hash.query(creatures.x[a]!, creatures.y[a]!, reach + slack, (b) => {
      if (b === a || done.has(b) || !isCandidate.has(b) || !canBreed(world, b)) return;
      const dx = wrappedDelta(creatures.x[a]!, creatures.x[b]!, config.worldWidth);
      const dy = wrappedDelta(creatures.y[a]!, creatures.y[b]!, config.worldHeight);
      const gap = Math.hypot(dx, dy) - config.creatureRadius * (creatures.size[a]! + creatures.size[b]!);
      if (gap > reach || gap >= bestGap) return;
      if (
        config.mateBarrier > 0 &&
        mateDistance(genesOf(creatures, a), creatures.brain[a]!, genesOf(creatures, b), creatures.brain[b]!) >=
          config.mateBarrier
      ) {
        return;
      }
      best = b;
      bestGap = gap;
    });
    if (best < 0) continue;
    // Each offers half its own share, so a child of two like parents starts with what a child of one does.
    const offerA = (creatures.energy[a]! * creatures.investment[a]!) / 2;
    const offerB = (creatures.energy[best]! * creatures.investment[best]!) / 2;
    const carrier = rng.chance(0.5) ? a : best;
    const given = bear(world, carrier, carrier === a ? best : a, offerA + offerB);
    if (given > 0) {
      creatures.energy[a]! -= (given * offerA) / (offerA + offerB);
      creatures.energy[best]! -= (given * offerB) / (offerA + offerB);
      done.add(a);
      done.add(best);
    }
  }
}

/**
 * Bear a child to `carrier` and, if `other` is not -1, to `other` as well,
 * from `offered` energy in all. The child is a mutated copy of the parent,
 * or of a cross of the two. Returns the energy taken from the parents, or 0
 * if there was too little to build a body.
 */
function bear(world: World, carrier: number, other: number, offered: number): number {
  const { config, rng, creatures, ledger } = world;
  const parent = carrier;
  const two = other >= 0;
  const parentGenes = two
    ? crossGenes(genesOf(creatures, carrier), genesOf(creatures, other), rng)
    : genesOf(creatures, parent);
  const genes = mutateGenes(parentGenes, rng, config);
  const brain = mutateBrain(
    two ? crossoverBrain(creatures.brain[carrier]!, creatures.brain[other]!, rng) : creatures.brain[parent]!,
    parentGenes.mutationRate,
    rng,
    world.innovations,
    config,
  );
  // Count what mutation added to the brain, for comparing with what the settings should give.
  // Only for a child of one parent, whose brain is its parent's plus mutation.
  if (!two) {
    const parentBrain = creatures.brain[parent]!;
    const newNeurons = Math.max(0, brain.hiddenIds.length - parentBrain.hiddenIds.length);
    world.structural.neurons += newNeurons;
    world.structural.links += Math.max(0, brain.links.length - parentBrain.links.length - 2 * newNeurons);
  }
  // The parents' share first builds the child's body; the rest is the child's
  // starting store. A smaller child may not hold a full share, and the parents
  // keep what does not fit.
  const body = bodyEnergyFor(genes.size, config);
  const childMax = maxEnergyFor(genes.size, config);
  const given = Math.min(offered, (childMax + body) / (1 - config.birthCost));
  const lost = given * config.birthCost;
  // Too little to build a body: no birth this tick.
  if (given - lost <= body) {
    world.lifeHistory.tooSmall++;
    return 0;
  }
  world.lifeHistory.childEnergy += given - lost - body;
  ledger.heatOut += lost;

  // The child appears just behind the carrier rather than on top of it.
  const behind = creatures.heading[parent]! + Math.PI;
  const gap = config.creatureRadius * (creatures.size[parent]! + genes.size);
  let childX = wrap(creatures.x[parent]! + Math.cos(behind) * gap, config.worldWidth);
  let childY = wrap(creatures.y[parent]! + Math.sin(behind) * gap, config.worldHeight);
  // Not into a wall or a block, though: a child born inside one could walk out the far side.
  if (isSolid(world.plants, cellIndexAt(world.plants, childX, childY))) {
    childX = creatures.x[parent]!;
    childY = creatures.y[parent]!;
  }
  // Water is shared out, not made: the carrier hands over a share of what its
  // body holds, and the child is as full as that makes a body its size. With
  // the share at zero a child is simply born as well watered as its parent.
  const parentBody = creatures.size[parent]! * creatures.size[parent]!;
  const childBody = genes.size * genes.size;
  const parentWater = creatures.hydration[parent]!;
  // In a world without water nobody thirsts, and everyone stays full.
  const sharing = world.plants.hasWater && config.birthWaterShare > 0;
  const childWater = sharing
    ? Math.min(1, (parentWater * parentBody * config.birthWaterShare) / childBody)
    : parentWater;
  // The carrier is the child's parent in the family tree, and gives it its species and its
  // founder; the other parent is recorded beside it. Which of the two carries is chance.
  const child = spawnCreature(creatures, {
    x: childX,
    y: childY,
    heading: rng.range(0, Math.PI * 2),
    energy: given - lost - body,
    genes,
    brain,
    parentId: creatures.id[parent]!,
    otherParentId: two ? creatures.id[other]! : 0,
    generation: Math.max(creatures.generation[parent]!, two ? creatures.generation[other]! : 0) + 1,
    founder: creatures.founder[parent]!,
    species: creatures.species[parent]!,
    hydration: childWater,
    shadow: shadowFor(world, two ? [parent, other] : [parent], brain),
  });
  if (sharing) creatures.hydration[parent] = parentWater - (childWater * childBody) / parentBody;
  world.lineage.born(creatures.id[child]!, creatures.id[parent]!, world.tick, genes.hue);
  world.births++;
  if (two) {
    world.mating.sexual++;
    if (closeKin(creatures, parent, other)) world.mating.kin++;
  }
  for (const p of two ? [parent, other] : [parent]) {
    if (creatures.children[p] === 0) {
      world.lab.firstBirths++;
      world.lab.firstBirthAge += creatures.age[p]!;
    }
    if (creatures.children[p]! < 65535) creatures.children[p]!++;
  }
  world.lab.births++;
  const mates = two ? 2 : 1;
  world.lab.parentAge += (creatures.age[parent]! + (two ? creatures.age[other]! : 0)) / mates;
  world.parents.count++;
  // Of two parents, the average of their genes counts.
  const mean = (key: 'size' | 'speed' | 'sensorRange' | 'diet') =>
    (creatures[key][parent]! + (two ? creatures[key][other]! : 0)) / mates;
  world.parents.size += mean('size');
  world.parents.speed += mean('speed');
  world.parents.sensorRange += mean('sensorRange');
  world.parents.diet += mean('diet');
  return given;
}

/**
 * The neutral shadow of a newborn: a copy of a random living creature's
 * shadow, plus the links its brain gained that its parents' did not have.
 *
 * The donor is drawn only from creatures old enough to breed. A real link can
 * only be passed on once its carrier has reached breeding age, so a donor
 * drawn from everyone, newborns included, would let shadow links spread from
 * creatures that never live to breed and outlast real links with no selection
 * at all.
 */
function shadowFor(world: World, parents: number[], brain: Brain): number[] {
  const { creatures, config } = world;
  let adults = 0;
  for (let i = 0; i < creatures.count; i++) if (creatures.age[i]! >= config.minReproduceAge) adults++;
  let donor = parents[0]!;
  if (adults > 0) {
    let pick = world.shadowRng.int(0, adults);
    for (let i = 0; i < creatures.count; i++) {
      if (creatures.age[i]! >= config.minReproduceAge && pick-- === 0) {
        donor = i;
        break;
      }
    }
  }
  const chosen = creatures.shadow[donor]!;
  // Links either parent had are inherited, not new, so crossover does not pass for innovation.
  const had = new Set(parents.flatMap((parent) => creatures.brain[parent]!.links.map((link) => link.innovation)));
  const shadow = chosen.slice();
  const held = new Set(shadow);
  for (const link of brain.links) {
    if (!had.has(link.innovation) && !held.has(link.innovation)) {
      shadow.push(link.innovation);
      held.add(link.innovation);
    }
  }
  // A real brain stops gaining links at the cap, so the shadow drops its oldest to stay within it too.
  return shadow.length > config.maxLinks ? shadow.slice(shadow.length - config.maxLinks) : shadow;
}

function sampleHistory(world: World): void {
  const { creatures } = world;
  let links = 0;
  let neurons = 0;
  let meatEaters = 0;
  let toolHolders = 0;
  let foodHolders = 0;
  let blockHolders = 0;
  let sheltered = 0;
  let plasticityTotal = 0;
  let plasticLinks = 0;
  let tauTotal = 0;
  let slowNeurons = 0;
  let looped = 0;
  for (let i = 0; i < creatures.count; i++) {
    if (creatures.diet[i]! > 0.5) meatEaters++;
    const held = creatures.held[i]!;
    if (held === Held.Stone || held === Held.Branch) toolHolders++;
    else if (held === Held.Block) blockHolders++;
    else if (held !== Held.Nothing) foodHolders++;
    if (world.plants.nearBlocks[cellIndexAt(world.plants, creatures.x[i]!, creatures.y[i]!)]! > 0) sheltered++;
    links += enabledLinks(creatures.brain[i]!);
    neurons += creatures.brain[i]!.hiddenIds.length;
    const brain = creatures.brain[i]!;
    if (hasLoop(brain)) looped++;
    plasticLinks += brain.plasticLinks.length;
    for (let k = 0; k < brain.plasticRate.length; k++) plasticityTotal += brain.plasticRate[k]!;
    for (const tau of brain.hiddenTau) {
      tauTotal += tau;
      if (tau > 1) slowNeurons++;
    }
  }
  const count = Math.max(1, creatures.count);
  const meanSize = meanOf(creatures.size, creatures);
  const meanSpeed = meanOf(creatures.speed, creatures);
  const meanSensorRange = meanOf(creatures.sensorRange, creatures);
  const meanDiet = meanOf(creatures.diet, creatures);
  // With no births since the last sample there is nothing to compare, so parents read as average.
  const parents = world.parents;
  const had = parents.count;
  const spreadSize = spreadOf(creatures.size, creatures);
  const spreadSpeed = spreadOf(creatures.speed, creatures);
  const spreadSensorRange = spreadOf(creatures.sensorRange, creatures);
  const spreadDiet = spreadOf(creatures.diet, creatures);

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
  recordBehaviour(world.history.behaviour, creatures, world.config.minSpeed, world.config.maxSpeed);
  // Blocks moved since the previous sample, in all and by each species, as rates.
  const movesBySpecies = new Map<number, number>();
  let moves = 0;
  for (const [species, moved] of Object.entries(world.blockMoves)) {
    movesBySpecies.set(Number(species), (moved * 1000) / elapsed);
    moves += moved;
  }
  // A species that moved some before and none now still needs its zero.
  for (const id of world.history.blockMoves.keys()) if (!movesBySpecies.has(id)) movesBySpecies.set(id, 0);
  let built = 0;
  for (let cell = 0; cell < world.plants.blockBuilt.length; cell++) built += world.plants.blockBuilt[cell]!;

  const wiring = sampleWiring(world.wiring, creatures, world.tick, world.config.wiringSurvivalTicks);
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
    blockMoveRate: (moves * 1000) / elapsed,
    longestBuiltLine: longestBuiltLine(world.plants),
    builtBlocks: built,
    shelteredShare: sheltered / count,
    blockHolders,
    meanPlasticity: links > 0 ? plasticityTotal / links : 0,
    plasticLinkShare: links > 0 ? plasticLinks / links : 0,
    meanTau: neurons > 0 ? tauTotal / neurons : 1,
    slowNeuronShare: neurons > 0 ? slowNeurons / neurons : 0,
    recurrentShare: looped / count,
    wiringLive: wiring.live,
    wiringShadowLive: wiring.shadowLive,
    wiringActivity: wiring.meanActivity,
    wiringShadowActivity: wiring.shadowMeanActivity,
    wiringSurvival: wiring.survival,
    wiringShadowSurvival: wiring.shadowSurvival,
    tick: world.tick,
    population: creatures.count,
    plantFill: world.plantCapacityTotal > 0 ? totalPlantEnergy(world.plants) / world.plantCapacityTotal : 0,
    meanSize,
    meanSpeed,
    meanSensorRange,
    meanDiet,
    meanFur: meanOf(creatures.fur, creatures),
    meanDefense: meanOf(creatures.defense, creatures),
    meanInvestment: meanOf(creatures.investment, creatures),
    meanReadiness: meanOf(creatures.readiness, creatures),
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
    diversity: (spreadSize + spreadSpeed + spreadSensorRange + spreadDiet) / 4,
    spreadSize,
    spreadSpeed,
    spreadSensorRange,
    spreadDiet,
    spreadFur: spreadOf(creatures.fur, creatures),
    spreadDefense: spreadOf(creatures.defense, creatures),
    spreadInvestment: spreadOf(creatures.investment, creatures),
    spreadReadiness: spreadOf(creatures.readiness, creatures),
  }, speciesCounts, movesBySpecies);
  world.blockMoves = {};
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

// The world's fingerprint is taken over its save, so it covers everything a save holds.
export { hashWorld } from './serialize';
