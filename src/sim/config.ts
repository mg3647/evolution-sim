/**
 * Every tunable constant of the simulation lives here. The config is passed
 * in when a world is created; sim code never reads it as a global.
 *
 * Units: distances are world units, time is ticks, energy is abstract.
 */

export interface SimConfig {
  /** Seed for the world's random number generator. */
  seed: string;
  /** World size in world units. The world wraps at both edges. */
  worldWidth: number;
  worldHeight: number;
  /** Simulation ticks per second at 1x speed. */
  ticksPerSecond: number;

  /** Side of one plant-field cell. Rounded so cells tile the world exactly. */
  plantCellSize: number;
  /** Plant energy a cell holds when full, at fertility 1. */
  plantCapacity: number;
  /** Fraction of a cell's missing plant energy that regrows per tick, at best. */
  plantGrowthRate: number;
  /** Growth speed of a cell grazed bare, as a fraction of the best speed. */
  plantBareGrowth: number;
  /** Fertility below this is barren; raises contrast between rich and poor land. */
  fertilityFloor: number;

  initialCreatures: number;
  creatureStartEnergy: number;
  /** Most energy a creature of size 1 can store. Scales with size squared. */
  creatureMaxEnergy: number;
  /** Radius of a creature of size 1. */
  creatureRadius: number;
  /** Distance moved per tick at speed 1. */
  creatureSpeed: number;
  /** Largest heading change per tick, in radians. */
  maxTurn: number;
  /** Fraction of the bite lost when moving at full thrust; grazing well means slowing down. */
  eatSlowdown: number;

  /** Length of the vision rays for a creature with sensor range 1. */
  senseRange: number;
  /** Angle between neighboring vision rays, in radians. */
  raySpread: number;
  /** Energy per tick that senses cost at sensor range 1. Scales with range squared. */
  senseCost: number;
  /** Ticks per cycle of the clock input. */
  clockPeriod: number;

  /** Energy per tick for each hidden neuron and each enabled link. */
  brainNeuronCost: number;
  brainLinkCost: number;
  /** Random input-to-output links in the brain of a creature with no parent. */
  founderLinks: number;
  maxHiddenNeurons: number;
  maxLinks: number;
  /** Per birth: chance that each link's weight shifts, and how far relative to the mutation rate. */
  weightChangeChance: number;
  weightChangeScale: number;
  /** Per birth: chance that each link's weight is replaced outright. */
  weightResetChance: number;
  /** Per birth: chances of gaining a link, splitting a link with a new neuron, and toggling a link. */
  addLinkChance: number;
  addNeuronChance: number;
  toggleLinkChance: number;
  /** Energy a creature of size 1 spends per tick just staying alive. */
  upkeepCost: number;
  /** Share of upkeep that every body pays regardless of its size. */
  upkeepFixedShare: number;
  /** Energy a creature of size 1 and speed 1 spends per unit of distance moved. */
  moveCost: number;
  /** Most plant energy a creature of size 1 can eat per tick. */
  biteSize: number;
  /** Creatures die of old age at this many ticks. */
  maxAge: number;

  /** Energy built into a body of size 1; paid at birth and left as meat at death. Scales with size squared. */
  bodyEnergy: number;

  /**
   * Health lost per tick of being bitten by a same-size full carnivore. Health runs from 0 to 1.
   * Kept low enough that a bitten creature lives long enough to react and flee.
   */
  attackDamage: number;
  /** Share of full attack damage that a full plant-eater deals. */
  herbivoreAttack: number;
  /** Energy a creature of size 1 spends per tick while its attack output is on. */
  attackCost: number;
  /** Gap between two bodies within which an attack lands. */
  attackReach: number;
  /** Health regained per tick. */
  healRate: number;
  /** How much a wound slows a creature: at 0.7, one on its last legs moves at 30% of its thrust. */
  woundSlow: number;

  /** Meat is dense food: a mouthful of it is this many times a mouthful of plants. */
  meatBiteScale: number;
  /** Fraction of the meat in a cell that rots away per tick. */
  meatDecayRate: number;
  /** Meat in a cell that reads as 1 to the senses and draws at full colour. */
  meatScale: number;

  /** A creature reproduces when its energy reaches this fraction of its maximum. */
  reproduceThreshold: number;
  /** Fraction of the parent's energy handed to the child. */
  offspringShare: number;
  /** Fraction of the handed-over energy lost as heat, on top of building the child's body. */
  birthCost: number;
  /** Creatures younger than this many ticks cannot reproduce. */
  minReproduceAge: number;
  /** No births happen while the population is at this size. */
  maxCreatures: number;
  /** Below this population, new parentless creatures are added. */
  minPopulation: number;

  /** Gene limits. Size and speed are multipliers on the base values above. */
  minSize: number;
  maxSize: number;
  minSpeed: number;
  maxSpeed: number;
  minSensorRange: number;
  maxSensorRange: number;
  /**
   * Creatures with no parent get a random diet gene between 0 (only plants)
   * and this value (1 is only meat), so meat-eaters exist from the start.
   */
  founderDietMax: number;
  /** Mutation rate of creatures with no parent. */
  initialMutationRate: number;
  minMutationRate: number;
  maxMutationRate: number;

  /** Ticks per year. Sunlight, and so plant growth, swings over the year. 0 turns seasons off. */
  seasonLength: number;
  /** How far sunlight swings above and below average: 0.4 means from 60% to 140%. */
  seasonStrength: number;
  /** Ticks over which the fertility map drifts to a completely new one. 0 keeps it fixed. */
  fertilityDriftPeriod: number;
  /** Ticks between updates of the drifting fertility map. */
  fertilityUpdateInterval: number;

  /** Plant growth multiplier and length, in ticks, of each timed event. */
  droughtGrowth: number;
  droughtLength: number;
  foodBoomGrowth: number;
  foodBoomLength: number;
  iceAgeGrowth: number;
  iceAgeLength: number;
  /** Multiplier on creatures' per-tick energy cost during an ice age. */
  iceAgeCost: number;
  /** Share of the population a plague event infects to begin with. */
  plagueSeedShare: number;
  /** Each tick, a sick creature infects each healthy one within this distance with this chance. */
  plagueRadius: number;
  plagueTransmission: number;
  /** Ticks an infection lasts, and the chance per tick that it kills. */
  plagueDuration: number;
  plagueDeathChance: number;
  /** Ticks a recovered creature stays immune. */
  plagueImmunity: number;
  /** While sick: multiplier on thrust, and on the cost of living. */
  plagueSlow: number;
  plagueCost: number;
  /** Radius within which a meteor kills creatures and burns the ground bare. */
  meteorRadius: number;
  /** Reach of the hand tools: the plague tool infects within one, the land tools paint within the other. */
  plagueToolRadius: number;
  brushRadius: number;
  /** Whether events strike at random, and the average number of ticks between them. */
  randomEvents: boolean;
  randomEventInterval: number;

  /** Scent added to a cell per tick by a creature that is emitting. */
  scentEmit: number;
  /** Energy per tick that emitting costs. */
  scentCost: number;
  /** Fraction of scent that fades per tick, and the share that seeps to neighboring cells. */
  scentDecay: number;
  scentSpread: number;

  /** Ticks between regroupings of creatures into species. */
  speciesInterval: number;
  /**
   * How different, on average, a branch of the family tree must be from the
   * group it split from to count as its own species. 1 is a clear difference:
   * for example 0.15 in diet, or 20% in size.
   */
  speciesThreshold: number;
  /** A branch must have split off at least this many ticks ago to be its own species. */
  speciesMinAge: number;
  /** A species, and the group it leaves behind, must each have at least this many members. */
  speciesMinMembers: number;

  /** Ticks between history samples at the start of a run. */
  statsInterval: number;
  /** Number of history samples kept. */
  statsCapacity: number;
}

export const defaultConfig: SimConfig = {
  seed: 'genesis',
  worldWidth: 2000,
  worldHeight: 2000,
  ticksPerSecond: 30,

  plantCellSize: 20,
  plantCapacity: 24,
  plantGrowthRate: 0.006,
  plantBareGrowth: 0.1,
  fertilityFloor: 0.3,

  initialCreatures: 400,
  creatureStartEnergy: 40,
  creatureMaxEnergy: 100,
  creatureRadius: 5,
  creatureSpeed: 1.5,
  maxTurn: 0.3,
  eatSlowdown: 0.7,

  senseRange: 60,
  raySpread: 0.6,
  senseCost: 0.01,
  clockPeriod: 60,

  brainNeuronCost: 0.002,
  brainLinkCost: 0.0005,
  founderLinks: 4,
  maxHiddenNeurons: 16,
  maxLinks: 96,
  weightChangeChance: 0.5,
  weightChangeScale: 4,
  weightResetChance: 0.02,
  addLinkChance: 0.1,
  addNeuronChance: 0.03,
  toggleLinkChance: 0.03,
  upkeepCost: 0.12,
  upkeepFixedShare: 0.5,
  moveCost: 0.05,
  biteSize: 1,
  maxAge: 3000,
  bodyEnergy: 20,

  attackDamage: 0.25,
  herbivoreAttack: 0.05,
  attackCost: 0.05,
  attackReach: 6,
  healRate: 0.001,
  woundSlow: 0.7,

  meatBiteScale: 3,
  meatDecayRate: 0.0005,
  meatScale: 20,

  reproduceThreshold: 0.8,
  offspringShare: 0.5,
  birthCost: 0,
  minReproduceAge: 150,
  maxCreatures: 5000,
  minPopulation: 20,

  minSize: 0.4,
  maxSize: 3,
  minSpeed: 0.2,
  maxSpeed: 4,
  minSensorRange: 0.3,
  maxSensorRange: 3,
  founderDietMax: 1,
  initialMutationRate: 0.08,
  minMutationRate: 0.005,
  maxMutationRate: 0.5,

  seasonLength: 6000,
  seasonStrength: 0.4,
  fertilityDriftPeriod: 80000,
  fertilityUpdateInterval: 100,

  droughtGrowth: 0.15,
  droughtLength: 3000,
  foodBoomGrowth: 3,
  foodBoomLength: 3000,
  iceAgeGrowth: 0.4,
  iceAgeLength: 8000,
  iceAgeCost: 1.4,
  plagueSeedShare: 0.05,
  plagueRadius: 30,
  plagueTransmission: 0.03,
  plagueDuration: 500,
  plagueDeathChance: 0.001,
  plagueImmunity: 3000,
  plagueSlow: 0.5,
  plagueCost: 1.3,
  meteorRadius: 350,
  plagueToolRadius: 90,
  brushRadius: 70,
  randomEvents: false,
  randomEventInterval: 15000,

  scentEmit: 0.05,
  scentCost: 0.01,
  scentDecay: 0.02,
  scentSpread: 0.2,

  speciesInterval: 300,
  speciesThreshold: 2,
  speciesMinAge: 6000,
  speciesMinMembers: 8,

  statsInterval: 30,
  statsCapacity: 1000,
};
