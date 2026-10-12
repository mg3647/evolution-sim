import type { SimConfig } from '../sim/config';
import type { EventKind, LogEntry, TimedEventKind } from '../sim/environment';
import type { BreedingLinks, PathwayStats } from '../sim/associations';
import type { BrainProfile } from '../sim/profile';
import type { ToolKind } from '../sim/world';

/** Speed multiplier over the configured tick rate, or 'max' for unthrottled. */
export type Speed = number | 'max';

export type ToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; ticks: number }
  | { type: 'setSpeed'; speed: Speed }
  /** Select the creature nearest a world position within `radius`, or none. */
  | { type: 'pick'; x: number; y: number; radius: number }
  | { type: 'event'; kind: EventKind }
  /** Apply a hand tool at (x, y), or along a drag from (fromX, fromY) to it. */
  | { type: 'tool'; tool: ToolKind; x: number; y: number; fromX: number; fromY: number }
  | { type: 'clearWalls' }
  | { type: 'setRandomEvents'; enabled: boolean }
  /** With drawing off, snapshots carry numbers only, sent less often. */
  | { type: 'setRendering'; enabled: boolean }
  /** The page has drawn the last snapshot and is ready for the next. */
  | { type: 'drawn' }
  /** Which parts of the page are open, so the worker skips numbers nobody is looking at. */
  | { type: 'setViews'; views: OpenViews }
  /** Change settings in the running world. Settings that only matter at creation are ignored. */
  | { type: 'setConfig'; changes: Partial<SimConfig> }
  | { type: 'save' }
  /** Build a run report, with what the person wrote about the run. */
  | { type: 'report'; question: string; notes: string; appVersion: string }
  | { type: 'load'; json: string };

/** The parts of the page that show numbers worked out apart from the snapshot. */
export interface OpenViews {
  /** The Lab: brain profiles, habits, founders, biomes and more. */
  lab: boolean;
  /** The Evolution tab: the family tree and habits spreading. */
  evolution: boolean;
  /** The Creature tab: the selected creature beside its group's brain profile. */
  creature: boolean;
}

/** What the report dialog shows before anything is sent. */
export interface ReportSummary {
  tick: number;
  clean: boolean;
  reseeded: number;
  interventions: number;
  bytes: number;
}

/** Number of floats per creature in `Snapshot.creatures`. */
export const CREATURE_STRIDE = 12;

/** Everything shown about the selected creature. */
export interface Inspection {
  /** Position of this creature in `Snapshot.creatures`. */
  index: number;
  id: number;
  parentId: number;
  generation: number;
  age: number;
  energy: number;
  maxEnergy: number;
  size: number;
  speed: number;
  sensorRange: number;
  // 0 eats only plants, 1 only meat.
  diet: number;
  // 1 is unhurt; it dies at 0.
  health: number;
  // Water in the body: 1 is full; it dies of thirst at 0.
  hydration: number;
  // Above zero: ticks of infection left. Below zero: ticks of immunity left.
  sick: number;
  hue: number;
  // Thickness of its coat, from 0 to 1.
  fur: number;
  // Spines or poison, from 0 to 1.
  defense: number;
  /** What it is holding (see Held in creatures.ts), and the energy of it if it is food. */
  held: number;
  heldEnergy: number;
  /** How hot it is where the creature stands, and how far beyond its comfort that is. */
  temperature: number;
  temperatureStress: number;
  /** The kind of land it stands on; see Biome in biomes.ts. */
  biome: number;
  mutationRate: number;
  hiddenNeurons: number;
  links: number;
  /** Brain inputs and outputs this tick, in the order of INPUT_LABELS and OUTPUT_LABELS. */
  inputs: number[];
  outputs: number[];
  /** Per action, why it does nothing for this creature here, or null if it does something. */
  idleOutputs: (string | null)[];
  species: number;
  brain: BrainView;
  /** Its strongest sense-action habits, strongest first. */
  habits: HabitView[];
}

/** One sense-action habit of one creature; see associations.ts. */
export interface HabitView {
  pathway: number;
  /** Effect with its live weights, and with the weights it was born with. */
  effect: number;
  inborn: number;
  direct: boolean;
  learns: boolean;
}

/**
 * A brain's wiring, for drawing. Neurons are numbered inputs first, then
 * outputs, then hidden; links refer to them by that number.
 */
export interface BrainView {
  hiddenCount: number;
  /** Current output of every neuron. */
  activation: number[];
  linkFrom: number[];
  linkTo: number[];
  linkWeight: number[];
}

/** One species as shown in the species list. */
export interface SpeciesView {
  id: number;
  count: number;
  bornTick: number;
  meanSize: number;
  meanSpeed: number;
  meanDiet: number;
}

/** The state of the seasons and events. */
export interface EnvironmentView {
  /** Sunlight from the season alone, relative to average: 1 is average. */
  season: number;
  /** How far through the year it is, from 0 to 1. A quarter of the way is midsummer. */
  yearFraction: number;
  /** How light it is: 0 at midnight, 1 at noon. */
  daylight: number;
  /** Multiplier on plant growth from the season and events together. */
  growth: number;
  /** Multiplier on creatures' energy costs. */
  cost: number;
  /** Added to every place's own temperature by the season, the hour and any ice age. */
  warmth: number;
  active: { kind: TimedEventKind; remaining: number }[];
  randomEvents: boolean;
  /** Creatures infected with the plague right now. */
  infected: number;
  /** Recent events, oldest first. */
  log: LogEntry[];
}

/** What the page needs to draw one frame and update the controls. */
export interface Snapshot {
  config: SimConfig;
  tick: number;
  running: boolean;
  speed: Speed;
  /** Ticks per second actually achieved over the last sampling window. */
  measuredTps: number;

  population: number;
  /** Per creature: x, y, heading, energy as a fraction of its maximum, radius, hue, diet,
   * 1 if sick, -1 if immune, 0 otherwise, species id, 1 if calling, defenses, and its id. Empty when drawing is off. */
  creatures: Float32Array;
  meanSize: number;
  meanSpeed: number;
  meanSensorRange: number;
  meanDiet: number;
  meanFur: number;
  meanDefense: number;
  // Creatures whose diet gene is above one half.
  meatEaters: number;
  /** Highest generation among living creatures. */
  maxGeneration: number;

  plantCols: number;
  plantRows: number;
  /** Per cell: plant energy as 0..255 of the configured plant capacity. */
  plants: Uint8Array;
  /** Plant energy in the world as a fraction of what it holds when fully grown. */
  plantFill: number;
  // Per cell: meat as 0..255 of the configured meat scale.
  meat: Uint8Array;
  // Per cell: scent as 0..255 of the level that reads as 1 to the senses.
  scent: Uint8Array;
  // Per cell: 1 where there is a wall. Walls, water and biomes are sent only when one changed; see
  // maps.ts. The page fills them back in, so to the screen they are always there.
  walls: Uint8Array;
  // Per cell: 1 where there is water.
  water: Uint8Array;
  // Per cell: how hot it is now, as 0..255 across temperatures -1.5 to 1.5.
  temperature: Uint8Array;
  // Per cell: the kind of land it is; see Biome in biomes.ts.
  biome: Uint8Array;
  // Per cell: 1 where it is burning; ash as 0..255; and 1 for a branch plus 2 for a stone plus 4 for stored food.
  fire: Uint8Array;
  ash: Uint8Array;
  items: Uint8Array;
  /** Wildfires started since the world began, cells burned in all, and cells burning now. */
  fires: { started: number; cellsBurned: number; burning: number };
  // Per cell: 0 for no block, 1 for a block nobody has moved, 2 for one a creature has moved.
  blocks: Uint8Array;
  // Per cell: for a moved block, the species of the creature that last moved it.
  blockSpecies: Uint32Array;
  /** Blocks in the world, how many a creature has moved, pushes and set-downs since the world began, and the longest straight run of moved blocks. */
  blockInfo: { total: number; built: number; pushed: number; setDown: number; longestLine: number };
  /** Creatures holding each kind of thing right now, and carrying totals since the world began. */
  holding: { branch: number; stone: number; food: number; block: number };
  carry: { pickups: number; plantsDropped: number; meatDropped: number; haul: number };
  environment: EnvironmentView;

  births: number;
  reseeded: number;
  /** Creatures calling now, and energy given since the world began, in all and to relatives. */
  social: { calling: number; calls: number; given: number; givenToKin: number };
  deaths: { starved: number; oldAge: number; killed: number; disaster: number; thirst: number; temperature: number };

  /** The selected creature, or null if none is selected or it has died. */
  selected: Inspection | null;

  /** False when drawing is off: the map arrays are then empty. */
  rendered: boolean;
  /** Whether walls, water and biomes came with this snapshot, rather than being unchanged and left out. */
  mapsSent: boolean;
  /** Living species, largest first. */
  species: SpeciesView[];
}

/** Statistics over the whole run so far, one entry per sample, for charts. */
export interface HistoryData {
  tick: Float64Array;
  population: Float32Array;
  /** Plant energy as a percentage of the fully grown world. */
  plantPercent: Float32Array;
  meanSize: Float32Array;
  meanSpeed: Float32Array;
  meanSensorRange: Float32Array;
  meanDiet: Float32Array;
  meanFur: Float32Array;
  meanDefense: Float32Array;
  toolHolders: Float32Array;
  foodHolders: Float32Array;
  meatEaters: Float32Array;
  speciesCount: Float32Array;
  meanLinks: Float32Array;
  meanNeurons: Float32Array;
  /** Mean genes of the creatures that had young in each sampling interval. */
  parentSize: Float32Array;
  parentSpeed: Float32Array;
  parentSensorRange: Float32Array;
  parentDiet: Float32Array;
  /** How varied the body genes are: the mean of their standard deviations. */
  diversity: Float32Array;
  /** The standard deviation of each gene across living creatures. */
  spreadSize: Float32Array;
  spreadSpeed: Float32Array;
  spreadSensorRange: Float32Array;
  spreadDiet: Float32Array;
  spreadFur: Float32Array;
  spreadDefense: Float32Array;
  /** See History in stats.ts for what each of these holds. */
  deathsStarved: Float32Array;
  deathsOldAge: Float32Array;
  deathsKilled: Float32Array;
  deathsTemperature: Float32Array;
  deathsThirst: Float32Array;
  deathsOther: Float32Array;
  flowPlantsToPlantEaters: Float32Array;
  flowPlantsToMeatEaters: Float32Array;
  flowMeatToPlantEaters: Float32Array;
  flowMeatToMeatEaters: Float32Array;
  lifespan: Float32Array;
  firstBirthAge: Float32Array;
  offspring: Float32Array;
  generationLength: Float32Array;
  shareResting: Float32Array;
  shareForaging: Float32Array;
  shareChasing: Float32Array;
  shareFleeing: Float32Array;
  blockMoveRate: Float32Array;
  longestBuiltLine: Float32Array;
  builtBlocks: Float32Array;
  shelteredShare: Float32Array;
  blockHolders: Float32Array;
  meanPlasticity: Float32Array;
  plasticLinkShare: Float32Array;
  meanTau: Float32Array;
  slowNeuronShare: Float32Array;
  wiringLive: Float32Array;
  wiringShadowLive: Float32Array;
  wiringActivity: Float32Array;
  wiringShadowActivity: Float32Array;
  wiringSurvival: Float32Array;
  wiringShadowSurvival: Float32Array;
  recurrentShare: Float32Array;
  /** Blocks moved per 1,000 ticks by the species that moved most, most first; the rest are summed under id 0. */
  blockMoves: { id: number; counts: Float32Array }[];
  /** Members of the largest species at every sample, largest first; the rest are summed under id 0. */
  species: { id: number; counts: Float32Array }[];
}

/**
 * The family tree of the living population. Entry k describes one creature:
 * living ones, plus the dead ancestors where the tree branches.
 */
export interface TreeData {
  /** Tick the tree was taken at. */
  tick: number;
  /** Index of the nearest kept ancestor, or -1 for none. */
  parent: Int32Array;
  birthTick: Float64Array;
  /** Tick of death, or -1 if alive. */
  deathTick: Float64Array;
  hue: Float32Array;
  /** Species id, or 0 if it has not been grouped yet. */
  species: Uint32Array;
  /** The creature's id. */
  id: Uint32Array;
  /** For a living creature, the id of the parentless creature its family began with; 0 for the dead. */
  founder: Uint32Array;
}

/** How the brains of one group of creatures are wired, for comparing groups. */
export interface ProfileGroup {
  /** Stable key: 'all', 'plants', 'meat', or 'species-<id>'. */
  id: string;
  /** Species id, or 0 for the two diet groups. */
  speciesId: number;
  profile: BrainProfile;
  /** Which senses lead to which actions in this group; see associations.ts. */
  pathways: PathwayStats;
}

/** One starting creature and the living creatures descended from it. */
export interface FounderView {
  id: number;
  /** Living descendants, counting the founder itself if it is alive. */
  count: number;
  /** Mean hue and diet of those descendants. */
  hue: number;
  meanDiet: number;
}

/** One biome and the creatures standing in it. */
export interface BiomeView {
  /** Share of the dry land that is this biome. */
  land: number;
  count: number;
  meanSize: number;
  meanSpeed: number;
  meanFur: number;
  meanDefense: number;
  meanDiet: number;
}

/** Bars in the Lab's diet histogram. */
export const DIET_BINS = 20;

/** Numbers only the Lab view shows. */
export interface LabData {
  /** Per biome, in the order of BIOME_LABELS. */
  biomes: BiomeView[];
  /** How many living creatures have a diet gene in each of DIET_BINS equal steps from 0 (plants) to 1 (meat). */
  dietBins: number[];
  /** Where creatures have been: a square grid of counts per stretch of the run, oldest first. */
  density: { grid: number; frames: Float32Array[]; ticks: number[] };
  /**
   * For each cell of the diet-by-speed map (row = speed, slow first; column = diet, plants first), the species
   * that has filled it most often over the run, and the cell's total creature-samples. Species 0 is the smaller ones lumped together.
   */
  behaviour: { dietBins: number; speedBins: number; cells: { species: number; share: number; samples: number }[] };
  tick: number;
  population: number;
  /** How many parentless creatures the world has had, and how many still have living descendants. */
  foundersEver: number;
  foundersLiving: number;
  /** Founders with the most living descendants, most first. */
  founders: FounderView[];
  /** The share of everyone with each sense-action habit, sampled over the run. */
  adoption: { ticks: number[]; shares: Float32Array[] };
  /** Which habits and traits go with having young. */
  breeding: BreedingLinks;
}

export type FromWorker =
  | { type: 'lab'; lab: LabData }
  | { type: 'profiles'; groups: ProfileGroup[] }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'history'; history: HistoryData }
  | { type: 'tree'; tree: TreeData }
  | { type: 'saved'; json: string; tick: number; seed: string }
  /** A saved world has replaced the running one; these are its settings. */
  | { type: 'loaded'; config: SimConfig }
  | { type: 'report'; json: string; fileName: string; summary: ReportSummary }
  | { type: 'error'; message: string };
