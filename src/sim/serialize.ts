import { compileBrain, INPUT_COUNT, INPUTS_PER_RAY, Innovations, RAY_COUNT, type InnovationsData, type LinkGene, OUTPUT_COUNT } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, type Creatures } from './creatures';
import type { ActiveEvent, LogEntry } from './environment';
import type { EnergyLedger } from './ledger';
import { Lineage, type LineageNode } from './lineage';
import { rebuildNearBlocks } from './blocks';
import { classifyBiomes, waterDerived } from './plants';
import { Rng, type RngState } from './rng';
import { Senses } from './senses';
import { createSoundField } from './sound';
import { SpatialHash } from './spatialHash';
import type { SpeciesState } from './species';
import { createHistory, HISTORY_SERIES } from './stats';
import type { World } from './world';

/**
 * Turns a world into plain JSON-safe data and back. A loaded world continues
 * exactly as the saved one would have: same state, same random numbers.
 */

/** Bumped whenever the saved layout changes. */
export const SAVE_VERSION = 18;
/**
 * Oldest save this version still opens. Saves from 14 on load with the newer
 * fields at their neutral values (settings added since take their defaults,
 * neurons answer at once, links do not learn, nothing is displayed, eating is
 * on, mating is off), so they play as they did before. Brains from before 17
 * are renumbered to make room for the new senses and actions. Saves from before
 18 have no heavy-block grips under way, and their wiring tallies are moved
 from sample numbers to ticks.
 */
export const OLDEST_LOADABLE_VERSION = 14;

/** Per-creature number arrays, saved up to the live count. */
const CREATURE_FIELDS = [
  'id',
  'parentId',
  'otherParentId',
  'generation',
  'founder',
  'species',
  'x',
  'y',
  'heading',
  'energy',
  'age',
  'children',
  'health',
  'hydration',
  'pain',
  'calling',
  'energyLast',
  'trend',
  'display',
  'held',
  'heldEnergy',
  'heldFromX',
  'heldFromY',
  'sick',
  'size',
  'speed',
  'sensorRange',
  'diet',
  'hue',
  'fur',
  'defense',
  'mutationRate',
] as const;

/** The brain layout of save versions 14 and 15: ray size, and counts of inputs, outputs and the neurons before the hidden ones. */
const V15_RAY_INPUTS = 15;
const V15_AFTER_RAYS = 3 * V15_RAY_INPUTS;
const V15_INPUTS = V15_AFTER_RAYS + 26;
const V15_FIXED = V15_INPUTS + 8;
/** Bias, which moved in version 16 to make room for the energy trend. */
const V15_BIAS = V15_AFTER_RAYS + 25;
/** The brain layout of save version 16. */
const V16_RAY_INPUTS = 16;
const V16_AFTER_RAYS = 3 * V16_RAY_INPUTS;
const V16_INPUTS = V16_AFTER_RAYS + 27;
const V16_OUTPUTS = 12;
const V16_FIXED = V16_INPUTS + V16_OUTPUTS;
const V16_BIAS = V16_INPUTS - 1;

/** Where a neuron of a version 14 or 15 save sits in the version 16 layout. */
function from15(n: number): number {
  if (n < V15_AFTER_RAYS) return Math.floor(n / V15_RAY_INPUTS) * V16_RAY_INPUTS + (n % V15_RAY_INPUTS);
  if (n < V15_BIAS) return V16_AFTER_RAYS + (n - V15_AFTER_RAYS);
  if (n === V15_BIAS) return V16_BIAS;
  if (n < V15_FIXED) return V16_INPUTS + (n - V15_INPUTS);
  return V16_FIXED + (n - V15_FIXED);
}

/** Where a neuron of a version 16 save sits in the current layout: rays grew, and Bias stays last. */
function from16(n: number): number {
  if (n < V16_AFTER_RAYS) return Math.floor(n / V16_RAY_INPUTS) * INPUTS_PER_RAY + (n % V16_RAY_INPUTS);
  if (n < V16_BIAS) return RAY_COUNT * INPUTS_PER_RAY + (n - V16_AFTER_RAYS);
  if (n === V16_BIAS) return INPUT_COUNT - 1;
  if (n < V16_FIXED) return INPUT_COUNT + (n - V16_INPUTS);
  return INPUT_COUNT + OUTPUT_COUNT + (n - V16_FIXED);
}

/** A save from before version 17 with every brain renumbered to the current inputs and outputs. */
function renumberBrains(saved: SavedWorld): SavedWorld {
  const moveNeuron = saved.version < 16 ? (n: number) => from16(from15(n)) : from16;
  return {
    ...saved,
    innovations: {
      ...saved.innovations,
      links: saved.innovations.links.map(([key, id]) => {
        const [from, to] = key.split('>').map(Number);
        return [`${moveNeuron(from!)}>${moveNeuron(to!)}`, id] as [string, number];
      }),
      splits: saved.innovations.splits.map(([link, node]) => [link, moveNeuron(node)] as [number, number]),
      nextNode: moveNeuron(saved.innovations.nextNode),
    },
    creatures: {
      ...saved.creatures,
      brains: saved.creatures.brains.map((brain) => ({
        ...brain,
        links: brain.links.map((link) => ({ ...link, from: moveNeuron(link.from), to: moveNeuron(link.to) })),
        hiddenIds: brain.hiddenIds.map(moveNeuron),
        // What each neuron was last doing is not carried over; the brain restarts from rest.
        activation: [],
      })),
    },
  };
}

/** Where a save from before version 18 kept its wiring tallies: the sample at which each link was first carried. */
function wiringToTicks(saved: SavedWorld): SavedWorld {
  const shadow = saved.shadow;
  if (!shadow) return saved;
  const tickOf = sampleTicks(saved);
  const toTick = (firsts: [number, number][]) => firsts.map(([id, sample]) => [id, tickOf(sample)] as [number, number]);
  return {
    ...saved,
    shadow: { ...shadow, realFirst: toTick(shadow.realFirst), shadowFirst: toTick(shadow.shadowFirst), startTick: tickOf(1) },
  };
}

/**
 * The tick each wiring sample of an older save was taken at. Samples are taken
 * with the history, starting at tick 0, and their spacing doubles each time the
 * history fills, so the ticks are replayed from the start. If the replay does
 * not end where the save did (a world first loaded from a save made before the
 * tallies existed), samples are instead spaced back from the save's tick at its
 * last spacing.
 */
function sampleTicks(saved: SavedWorld): (sample: number) => number {
  const samples = saved.shadow!.samples;
  const config = { ...defaultConfig, ...saved.config };
  const ticks = [0, 0];
  let interval = config.statsInterval;
  let count = 1;
  for (let k = 2; k <= samples; k++) {
    const previous = ticks[k - 1]!;
    // The next sample comes at the next multiple of the spacing; the history then halves if it is full.
    ticks.push((Math.floor(previous / interval) + 1) * interval);
    if (count === config.statsCapacity) {
      count = Math.ceil(count / 2);
      interval *= 2;
    }
    count++;
  }
  const replayed = interval === saved.history.interval && count === saved.history.count && ticks[samples]! <= saved.tick;
  if (replayed) return (sample) => ticks[sample] ?? 0;
  const last = Math.floor(saved.tick / saved.history.interval) * saved.history.interval;
  return (sample) => Math.max(0, last - (samples - sample) * saved.history.interval);
}

const FIELD_ARRAYS = ['fertility', 'capacity', 'energy', 'meat', 'scent', 'walls', 'water', 'temperature', 'branches', 'stones', 'fire', 'ash', 'store', 'blocks', 'blockSpecies', 'blockBuilt'] as const;

interface SavedBrain {
  links: LinkGene[];
  hiddenIds: number[];
  /** Absent in saves made before neurons had time constants: all 1. */
  hiddenTau?: number[];
  /** What the links have learned so far; only saved for a brain that can learn. */
  liveWeights?: number[];
  activation: number[];
}

export interface SavedWorld {
  version: number;
  config: SimConfig;
  tick: number;
  rng: RngState;
  field: Record<(typeof FIELD_ARRAYS)[number], number[]> & {
    blockHeavy?: number[];
    /** Pushes on heavy blocks under way; absent in saves from before 18. */
    heavyGripTick?: number[];
    heavyGripper?: number[];
  };
  plantCapacityTotal: number;
  creatures: { count: number; nextId: number; brains: SavedBrain[] } & Record<
    (typeof CREATURE_FIELDS)[number],
    number[]
  >;
  innovations: InnovationsData;
  /** The neutral shadow of the brains' links; absent in saves from before it existed. See wiring.ts. */
  shadow?: {
    creatures: number[][];
    rng: RngState;
    real: [number, number][];
    shadow: [number, number][];
    realFirst: [number, number][];
    shadowFirst: [number, number][];
    samples: number;
    /** Absent in saves from before 18, when `realFirst` and `shadowFirst` held sample numbers rather than ticks. */
    startTick?: number;
  };
  ledger: EnergyLedger;
  history: { interval: number; count: number } & Record<(typeof HISTORY_SERIES)[number], number[]>;
  births: number;
  /** Births of two parents so far; absent in saves from before mating. */
  mating?: World['mating'];
  /** Brain changes counted at births; absent in older saves. */
  structural?: World['structural'];
  reseeded: number;
  defended: number;
  fires: World['fires'];
  blockTally: World['blockTally'];
  blockMoves: World['blockMoves'];
  carry: World['carry'];
  parents: World['parents'];
  social: World['social'];
  deaths: World['deaths'];
  lab: World['lab'];
  infected: number;
  plagueDeaths: number;
  environment: {
    active: ActiveEvent[];
    log: LogEntry[];
    plagueActive: boolean;
    randomEvents: boolean;
    fertilityFrom: number[];
    fertilityTo: number[];
    driftStart: number;
  };
  lineage: LineageNode[];
  species: SpeciesState;
}

export function saveWorld(world: World): SavedWorld {
  const { creatures: c, plants, history, environment: env } = world;

  const field = {} as SavedWorld['field'];
  for (const name of FIELD_ARRAYS) field[name] = Array.from(plants[name]);
  field.blockHeavy = Array.from(plants.blockHeavy);
  field.heavyGripTick = Array.from(plants.heavyGripTick);
  field.heavyGripper = Array.from(plants.heavyGripper);

  const creatures = { count: c.count, nextId: c.nextId, brains: [] } as unknown as SavedWorld['creatures'];
  for (const name of CREATURE_FIELDS) creatures[name] = Array.from(c[name].subarray(0, c.count));
  creatures.brains = c.brain.slice(0, c.count).map((brain) => ({
    links: brain.links.map((link) => ({ ...link })),
    hiddenIds: brain.hiddenIds.slice(),
    hiddenTau: brain.hiddenTau.slice(),
    ...(brain.plasticLinks.length > 0 ? { liveWeights: Array.from(brain.linkWeight) } : {}),
    activation: Array.from(brain.activation),
  }));

  const savedHistory = { interval: history.interval, count: history.count } as SavedWorld['history'];
  for (const name of HISTORY_SERIES) savedHistory[name] = Array.from(history[name].subarray(0, history.count));

  return {
    version: SAVE_VERSION,
    config: { ...world.config },
    tick: world.tick,
    rng: world.rng.getState(),
    field,
    plantCapacityTotal: world.plantCapacityTotal,
    creatures,
    innovations: world.innovations.save(),
    shadow: {
      creatures: world.creatures.shadow.slice(0, world.creatures.count).map((ids) => ids.slice()),
      rng: world.shadowRng.getState(),
      real: [...world.wiring.real],
      shadow: [...world.wiring.shadow],
      realFirst: [...world.wiring.realFirst],
      shadowFirst: [...world.wiring.shadowFirst],
      samples: world.wiring.samples,
      startTick: world.wiring.startTick,
    },
    ledger: { ...world.ledger },
    history: savedHistory,
    births: world.births,
    mating: { ...world.mating },
    structural: { ...world.structural },
    reseeded: world.reseeded,
    defended: world.defended,
    fires: { ...world.fires },
    blockTally: { ...world.blockTally },
    blockMoves: { ...world.blockMoves },
    carry: { ...world.carry },
    parents: { ...world.parents },
    social: { ...world.social },
    deaths: { ...world.deaths },
    lab: { ...world.lab, deathsThen: { ...world.lab.deathsThen } },
    infected: world.infected,
    plagueDeaths: world.plagueDeaths,
    environment: {
      active: env.active.map((event) => ({ ...event })),
      log: env.log.map((entry) => ({ ...entry })),
      plagueActive: env.plagueActive,
      randomEvents: env.randomEvents,
      fertilityFrom: Array.from(env.fertilityFrom),
      fertilityTo: Array.from(env.fertilityTo),
      driftStart: env.driftStart,
    },
    lineage: world.lineage.save(),
    species: {
      nextId: world.species.nextId,
      species: world.species.species.map((record) => ({ ...record })),
    },
  };
}

/** Rebuild a world from saved data. Throws if the data is not a save this version can read. */
export function loadWorld(savedWorld: SavedWorld): World {
  let saved = savedWorld;
  if (saved && typeof saved === 'object' && saved.version > SAVE_VERSION) {
    throw new Error('This world was saved by a newer version of the sim. Reload the page to get the latest version, then load it again.');
  }
  if (saved && saved.version >= OLDEST_LOADABLE_VERSION && saved.version < 17) saved = renumberBrains(saved);
  if (saved && saved.version >= OLDEST_LOADABLE_VERSION && saved.version < 18) saved = wiringToTicks(saved);
  if (!saved || typeof saved !== 'object' || !(saved.version >= OLDEST_LOADABLE_VERSION && saved.version <= SAVE_VERSION)) {
    throw new Error(
      `This file is not a saved world this version can read (expected save version ${SAVE_VERSION}).`,
    );
  }
  // Settings added since the save was made take their defaults.
  const config = { ...defaultConfig, ...saved.config };
  const cells = saved.field.energy.length;
  const cols = Math.max(1, Math.round(config.worldWidth / config.plantCellSize));
  const rows = Math.max(1, Math.round(config.worldHeight / config.plantCellSize));
  if (cells !== cols * rows) throw new Error('This saved world is damaged: its map does not match its settings.');

  const plants = {
    cols,
    rows,
    cellWidth: config.worldWidth / cols,
    cellHeight: config.worldHeight / rows,
    fertility: new Float32Array(saved.field.fertility),
    capacity: new Float64Array(saved.field.capacity),
    energy: new Float64Array(saved.field.energy),
    meat: new Float64Array(saved.field.meat),
    scent: new Float32Array(saved.field.scent),
    walls: new Uint8Array(saved.field.walls),
    temperature: new Float32Array(saved.field.temperature),
    biome: new Uint8Array(cells),
    blocks: new Uint8Array(saved.field.blocks),
    blockSpecies: new Uint32Array(saved.field.blockSpecies),
    blockBuilt: new Uint8Array(saved.field.blockBuilt),
    // Saves from before heavy blocks have none.
    blockHeavy: new Uint8Array(saved.field.blockHeavy ?? new Array<number>(cells).fill(0)),
    // Saves from before 18 have no pushes under way.
    heavyGripTick: saved.field.heavyGripTick ? new Int32Array(saved.field.heavyGripTick) : new Int32Array(cells),
    heavyGripper: saved.field.heavyGripper ? new Int32Array(saved.field.heavyGripper) : new Int32Array(cells),
    blockCount: 0,
    nearBlocks: new Uint8Array(cells),
    store: new Float64Array(saved.field.store),
    branches: new Uint8Array(saved.field.branches),
    stones: new Uint8Array(saved.field.stones),
    fire: new Uint16Array(saved.field.fire),
    ash: new Float32Array(saved.field.ash),
    hasAsh: saved.field.ash.some((ash) => ash > 0),
    // Warmth from fires is rebuilt on the next tick.
    fireHeat: new Float32Array(cells),
    // Shore and moisture follow from where the water is, so they are rebuilt, not saved.
    ...waterDerived(new Uint8Array(saved.field.water), cols, rows, config),
  };

  // Biomes follow from temperature and wetness, so they are rebuilt, not saved.
  classifyBiomes(plants, config);
  rebuildNearBlocks(plants);

  const count = saved.creatures.count;
  const creatures: Creatures = createCreatures(Math.max(16, count));
  creatures.count = count;
  creatures.nextId = saved.creatures.nextId;
  // A field added since the save was made starts at its value for a newborn.
  for (const name of CREATURE_FIELDS) if (saved.creatures[name]) creatures[name].set(saved.creatures[name]);
  if (!saved.creatures.energyLast) creatures.energyLast.set(creatures.energy.subarray(0, count));
  creatures.brain = saved.creatures.brains.map((savedBrain) => {
    const brain = compileBrain(
      savedBrain.links.map((link) => ({ ...link })),
      savedBrain.hiddenIds.slice(),
      savedBrain.hiddenTau?.slice(),
    );
    if (savedBrain.activation.length === brain.activation.length) brain.activation.set(savedBrain.activation);
    if (savedBrain.liveWeights) brain.linkWeight.set(savedBrain.liveWeights);
    return brain;
  });

  // A save from before the shadow existed starts one now, as if it began with these creatures.
  creatures.shadow = saved.shadow
    ? saved.shadow.creatures.map((ids) => ids.slice())
    : creatures.brain.map((brain) => brain.links.map((link) => link.innovation));

  const history = createHistory(saved.history.interval, config.statsCapacity);
  history.count = saved.history.count;
  for (const name of HISTORY_SERIES) {
    // A save made before a series was added still loads; that series reads zero until then.
    if (saved.history[name]) history[name].set(saved.history[name]);
  }

  const rng = new Rng(config.seed);
  rng.setState(saved.rng);
  const shadowRng = new Rng(`${config.seed}:shadow`);
  if (saved.shadow) shadowRng.setState(saved.shadow.rng);
  const hash = new SpatialHash(config.worldWidth, config.worldHeight, config.senseRange);
  const sound = createSoundField(config);

  return {
    config,
    tick: saved.tick,
    rng,
    plants,
    plantCapacityTotal: saved.plantCapacityTotal,
    creatures,
    innovations: Innovations.load(saved.innovations),
    shadowRng,
    wiring: {
      real: new Map(saved.shadow?.real),
      shadow: new Map(saved.shadow?.shadow),
      realFirst: new Map(saved.shadow?.realFirst),
      shadowFirst: new Map(saved.shadow?.shadowFirst),
      samples: saved.shadow?.samples ?? 0,
      startTick: saved.shadow?.startTick ?? 0,
    },
    hash,
    // What is heard is rebuilt each tick from who called, so only the flags are saved.
    sound,
    senses: new Senses(config, plants, hash, sound),
    social: { ...saved.social },
    activity: 0,
    ledger: { ...saved.ledger },
    history,
    births: saved.births,
    structural: { links: saved.structural?.links ?? 0, neurons: saved.structural?.neurons ?? 0 },
    mating: { sexual: saved.mating?.sexual ?? 0, kin: saved.mating?.kin ?? 0 },
    mateCandidates: [],
    reseeded: saved.reseeded,
    defended: saved.defended,
    fires: { ...saved.fires },
    blockTally: { ...saved.blockTally },
    blockMoves: { ...saved.blockMoves },
    carry: { ...saved.carry },
    parents: { ...saved.parents },
    deaths: { ...saved.deaths },
    lab: { ...saved.lab, deathsThen: { ...saved.lab.deathsThen } },
    infected: saved.infected,
    plagueDeaths: saved.plagueDeaths,
    environment: {
      active: saved.environment.active.map((event) => ({ ...event })),
      log: saved.environment.log.map((entry) => ({ ...entry })),
      plagueActive: saved.environment.plagueActive,
      randomEvents: saved.environment.randomEvents,
      fertilityFrom: new Float32Array(saved.environment.fertilityFrom),
      fertilityTo: new Float32Array(saved.environment.fertilityTo),
      driftStart: saved.environment.driftStart,
      scentScratch: new Float32Array(cells),
    },
    climate: { season: 1, growth: 1, cost: 1, warmth: 0, dayWarmth: 0, bloom: 1 },
    lineage: Lineage.load(saved.lineage),
    species: {
      nextId: saved.species.nextId,
      species: saved.species.species.map((record) => ({ ...record })),
    },
  };
}

/**
 * Hash of the full world state (FNV-1a over its save). Two worlds with the
 * same hash are, for testing purposes, in the same state. Taken over the save,
 * so it covers every saved field and a field left out of saves shows up as a
 * loaded world drifting from the original.
 */
export function hashWorld(world: World): number {
  const text = JSON.stringify(saveWorld(world));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
