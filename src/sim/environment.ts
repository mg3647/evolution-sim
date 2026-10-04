import type { SimConfig } from './config';
import { wrappedDelta } from './geometry';
import type { EnergyLedger } from './ledger';
import { cellIndexAt, generateFertility, type PlantField } from './plants';
import type { Rng } from './rng';

/**
 * Everything about the world that changes on its own or at the user's hand:
 * seasons, slowly drifting fertility, and events such as droughts and meteors.
 */

/** Events that last for a while and change how the world runs. */
export type TimedEventKind = 'drought' | 'iceAge' | 'foodBoom';
/** Events that happen in an instant. */
export type InstantEventKind = 'plague' | 'meteor' | 'wall';
export type EventKind = TimedEventKind | InstantEventKind;

export const EVENT_KINDS: readonly EventKind[] = ['drought', 'iceAge', 'foodBoom', 'plague', 'meteor', 'wall'];

export const EVENT_LABELS: Record<EventKind, string> = {
  drought: 'Drought',
  iceAge: 'Ice age',
  foodBoom: 'Food boom',
  plague: 'Plague',
  meteor: 'Meteor',
  wall: 'Wall',
};

const TWO_PI = Math.PI * 2;
/** Entries kept in the event log. */
const LOG_LENGTH = 30;
/** Longest wall, as a fraction of the world's shorter side. */
const WALL_SPAN = 0.6;

export interface ActiveEvent {
  kind: TimedEventKind;
  endTick: number;
}

export interface LogEntry {
  tick: number;
  text: string;
}

export interface Environment {
  /** Timed events currently running. */
  active: ActiveEvent[];
  /** Most recent events, oldest first. */
  log: LogEntry[];
  /** True from an outbreak until nobody is infected any more. */
  plagueActive: boolean;
  /** When true, events also strike at random. */
  randomEvents: boolean;
  /** Fertility is blended from `fertilityFrom` to `fertilityTo` over a drift period. */
  fertilityFrom: Float32Array;
  fertilityTo: Float32Array;
  driftStart: number;
  /** Scratch buffer for spreading scent. */
  scentScratch: Float32Array;
}

/** What the environment currently does to plant growth and to the cost of living. */
export interface Climate {
  /** Sunlight relative to normal, from the season alone: 1 is average. */
  season: number;
  /** Multiplier on plant growth, from the season and any events. */
  growth: number;
  /** Multiplier on creatures' per-tick energy cost. */
  cost: number;
}

export function createEnvironment(config: SimConfig, rng: Rng, field: PlantField): Environment {
  return {
    active: [],
    log: [],
    plagueActive: false,
    randomEvents: config.randomEvents,
    fertilityFrom: field.fertility.slice(),
    fertilityTo: generateFertility(config, rng, field.cols, field.rows),
    driftStart: 0,
    scentScratch: new Float32Array(field.scent.length),
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function addLog(env: Environment, tick: number, text: string): void {
  env.log.push({ tick, text });
  if (env.log.length > LOG_LENGTH) env.log.shift();
}

/** Seasonal sunlight at a tick: swings around 1 by the configured strength. */
export function seasonAt(tick: number, config: SimConfig): number {
  if (config.seasonLength <= 0) return 1;
  return 1 + config.seasonStrength * Math.sin((TWO_PI * tick) / config.seasonLength);
}

/** Combine the season and the active events into this tick's climate. */
export function climateAt(env: Environment, tick: number, config: SimConfig): Climate {
  const season = seasonAt(tick, config);
  let growth = season;
  let cost = 1;
  for (const event of env.active) {
    if (event.kind === 'drought') growth *= config.droughtGrowth;
    else if (event.kind === 'foodBoom') growth *= config.foodBoomGrowth;
    else {
      growth *= config.iceAgeGrowth;
      cost *= config.iceAgeCost;
    }
  }
  return { season, growth, cost };
}

/** Record the end of an outbreak once the last infection has cleared. */
export function notePlagueOver(env: Environment, tick: number, deaths: number): void {
  env.plagueActive = false;
  addLog(env, tick, `Plague over after ${deaths} deaths`);
}

/** Drop timed events that have run their course. */
export function expireEvents(env: Environment, tick: number): void {
  for (let k = env.active.length - 1; k >= 0; k--) {
    const event = env.active[k]!;
    if (tick >= event.endTick) {
      env.active.splice(k, 1);
      addLog(env, tick, `${EVENT_LABELS[event.kind]} ended`);
    }
  }
}

/**
 * Move fertility a step along its slow drift toward a new random map, and
 * set each cell's capacity to match. Plants above a shrunken capacity die
 * off as heat. Returns the field's new total capacity.
 */
export function driftFertility(
  env: Environment,
  field: PlantField,
  tick: number,
  config: SimConfig,
  rng: Rng,
  ledger: EnergyLedger,
): number {
  if (config.fertilityDriftPeriod > 0) {
    let t = (tick - env.driftStart) / config.fertilityDriftPeriod;
    if (t >= 1) {
      env.fertilityFrom = env.fertilityTo;
      env.fertilityTo = generateFertility(config, rng, field.cols, field.rows);
      env.driftStart = tick;
      t = 0;
    }
    const blend = smooth(t);
    for (let i = 0; i < field.fertility.length; i++) {
      const from = env.fertilityFrom[i]!;
      field.fertility[i] = from + (env.fertilityTo[i]! - from) * blend;
    }
  }

  let total = 0;
  let died = 0;
  for (let i = 0; i < field.capacity.length; i++) {
    const capacity = field.fertility[i]! * config.plantCapacity;
    field.capacity[i] = capacity;
    total += capacity;
    if (field.energy[i]! > capacity) {
      died += field.energy[i]! - capacity;
      field.energy[i] = capacity;
    }
  }
  ledger.heatOut += died;
  return total;
}

/** Fade scent everywhere and let it seep into neighboring cells. */
export function spreadScent(env: Environment, field: PlantField, config: SimConfig): void {
  const { cols, rows, scent } = field;
  const next = env.scentScratch;
  const keep = 1 - config.scentDecay;
  const spread = config.scentSpread;
  for (let y = 0; y < rows; y++) {
    const up = (y === 0 ? rows - 1 : y - 1) * cols;
    const down = (y === rows - 1 ? 0 : y + 1) * cols;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const left = x === 0 ? cols - 1 : x - 1;
      const right = x === cols - 1 ? 0 : x + 1;
      const here = scent[row + x]!;
      const around = (scent[row + left]! + scent[row + right]! + scent[up + x]! + scent[down + x]!) / 4;
      const value = (here + (around - here) * spread) * keep;
      // Below any sensible threshold: drop to zero rather than fade forever.
      next[row + x] = value < 1e-4 ? 0 : value;
    }
  }
  field.scent = next;
  env.scentScratch = scent;
}

/** What an instant event needs to reach in the world. */
export interface EventTarget {
  config: SimConfig;
  rng: Rng;
  field: PlantField;
  ledger: EnergyLedger;
  /** Number of living creatures and their positions. */
  count(): number;
  x(i: number): number;
  y(i: number): number;
  /** Infect creature i if it can catch the plague. Returns whether it did. */
  infect(i: number): boolean;
  /** Mark creature i to die in this tick's death pass. */
  strike(i: number): void;
}

/** Start a timed event, or carry out an instant one. */
export function triggerEvent(env: Environment, kind: EventKind, tick: number, target: EventTarget): void {
  const { config, rng } = target;
  if (kind === 'drought' || kind === 'iceAge' || kind === 'foodBoom') {
    const length =
      kind === 'drought' ? config.droughtLength : kind === 'iceAge' ? config.iceAgeLength : config.foodBoomLength;
    const running = env.active.find((event) => event.kind === kind);
    // Triggering one that is already running extends it.
    if (running) running.endTick += length;
    else env.active.push({ kind, endTick: tick + length });
    addLog(env, tick, `${EVENT_LABELS[kind]} began`);
  } else if (kind === 'plague') {
    const infected = plague(target);
    if (infected > 0) env.plagueActive = true;
    addLog(env, tick, `Plague broke out: ${infected} infected`);
  } else if (kind === 'meteor') {
    const x = rng.range(0, config.worldWidth);
    const y = rng.range(0, config.worldHeight);
    addLog(env, tick, `Meteor killed ${meteor(target, x, y)} creatures`);
  } else {
    wall(target);
    addLog(env, tick, 'A wall rose');
  }
}

/**
 * Start an outbreak by infecting a share of the population at random. From
 * there it spreads by contact; see the infection step in world.ts.
 */
function plague(target: EventTarget): number {
  const { config, rng } = target;
  const count = target.count();
  if (count === 0) return 0;
  const seeds = Math.max(3, Math.round(count * config.plagueSeedShare));
  let infected = 0;
  for (let k = 0; k < seeds; k++) {
    if (target.infect(rng.int(0, count))) infected++;
  }
  return infected;
}

/** Kill every creature, and burn every plant, within the blast radius. */
function meteor(target: EventTarget, x: number, y: number): number {
  const { config, field, ledger } = target;
  const r2 = config.meteorRadius * config.meteorRadius;
  let struck = 0;
  for (let i = 0; i < target.count(); i++) {
    const dx = wrappedDelta(x, target.x(i), config.worldWidth);
    const dy = wrappedDelta(y, target.y(i), config.worldHeight);
    if (dx * dx + dy * dy <= r2) {
      target.strike(i);
      struck++;
    }
  }
  let burned = 0;
  for (let cy = 0; cy < field.rows; cy++) {
    for (let cx = 0; cx < field.cols; cx++) {
      const dx = wrappedDelta(x, (cx + 0.5) * field.cellWidth, config.worldWidth);
      const dy = wrappedDelta(y, (cy + 0.5) * field.cellHeight, config.worldHeight);
      if (dx * dx + dy * dy > r2) continue;
      const cell = cy * field.cols + cx;
      burned += field.energy[cell]! + field.meat[cell]!;
      field.energy[cell] = 0;
      field.meat[cell] = 0;
    }
  }
  ledger.heatOut += burned;
  return struck;
}

/** Raise a straight wall at a random place and angle. */
function wall(target: EventTarget): void {
  const { config, rng, field } = target;
  const length = Math.min(config.worldWidth, config.worldHeight) * rng.range(WALL_SPAN / 2, WALL_SPAN);
  const angle = rng.range(0, Math.PI);
  const startX = rng.range(0, config.worldWidth);
  const startY = rng.range(0, config.worldHeight);
  // Step by half a cell so no cell along the line is skipped.
  const stride = Math.min(field.cellWidth, field.cellHeight) / 2;
  for (let d = 0; d <= length; d += stride) {
    const x = (((startX + Math.cos(angle) * d) % config.worldWidth) + config.worldWidth) % config.worldWidth;
    const y = (((startY + Math.sin(angle) * d) % config.worldHeight) + config.worldHeight) % config.worldHeight;
    const cell = cellIndexAt(field, x, y);
    field.walls[cell] = 1;
    // A diagonal line of cells would leak at the corners; thicken it by one cell.
    field.walls[cellIndexAt(field, (x + field.cellWidth) % config.worldWidth, y)] = 1;
  }
}

export function clearWalls(env: Environment, field: PlantField, tick: number): void {
  field.walls.fill(0);
  addLog(env, tick, 'Walls cleared');
}

/** With random events on, occasionally trigger one. */
export function maybeRandomEvent(env: Environment, tick: number, target: EventTarget): void {
  const { config, rng } = target;
  if (!env.randomEvents || config.randomEventInterval <= 0) return;
  if (!rng.chance(1 / config.randomEventInterval)) return;
  triggerEvent(env, rng.pick(EVENT_KINDS), tick, target);
}
