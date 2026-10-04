import type { SimConfig } from '../sim/config';
import type { EventKind, LogEntry, TimedEventKind } from '../sim/environment';

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
  | { type: 'clearWalls' }
  | { type: 'setRandomEvents'; enabled: boolean };

/** Number of floats per creature in `Snapshot.creatures`. */
export const CREATURE_STRIDE = 7;

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
  hue: number;
  mutationRate: number;
  hiddenNeurons: number;
  links: number;
  /** Brain inputs and outputs this tick, in the order of INPUT_LABELS and OUTPUT_LABELS. */
  inputs: number[];
  outputs: number[];
}

/** The state of the seasons and events. */
export interface EnvironmentView {
  /** Sunlight from the season alone, relative to average: 1 is average. */
  season: number;
  /** How far through the year it is, from 0 to 1. A quarter of the way is midsummer. */
  yearFraction: number;
  /** Multiplier on plant growth from the season and events together. */
  growth: number;
  /** Multiplier on creatures' energy costs. */
  cost: number;
  active: { kind: TimedEventKind; remaining: number }[];
  randomEvents: boolean;
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
  /** Per creature: x, y, heading, energy as a fraction of its maximum, radius, hue, diet. */
  creatures: Float32Array;
  meanSize: number;
  meanSpeed: number;
  meanSensorRange: number;
  meanDiet: number;
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
  // Per cell: 1 where there is a wall.
  walls: Uint8Array;
  environment: EnvironmentView;

  births: number;
  reseeded: number;
  deaths: { starved: number; oldAge: number; killed: number; disaster: number };

  /** The selected creature, or null if none is selected or it has died. */
  selected: Inspection | null;
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
  meatEaters: Float32Array;
  meanLinks: Float32Array;
  meanNeurons: Float32Array;
}

export type FromWorker =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'history'; history: HistoryData };
