import type { Brain } from './brain';
import type { Genes } from './genome';

/**
 * Creature data, stored as one typed array per field. Live creatures occupy
 * indices [0, count). An index is not stable across ticks; `id` is.
 */
export interface Creatures {
  count: number;
  capacity: number;
  nextId: number;
  id: Uint32Array;
  /** Id of the parent, or 0 for a creature with no parent. */
  parentId: Uint32Array;
  /** Id of the other parent if it had two (it was born of mating), otherwise 0. */
  otherParentId: Uint32Array;
  /** 0 for a creature with no parent, otherwise the parent's generation plus one. */
  generation: Uint32Array;
  /** Id of the parentless creature this one descends from; its own id if it has no parent. */
  founder: Uint32Array;
  /** Id of the species it was last grouped into; see species.ts. */
  species: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  /** Direction of travel in radians. */
  heading: Float32Array;
  energy: Float64Array;
  /** Ticks lived. */
  age: Uint32Array;
  /** Children it has had. */
  children: Uint16Array;
  /** 1 is unhurt; the creature dies at 0. */
  health: Float32Array;
  /** Water in the body, from 1 (full) to 0 (dies of thirst). */
  hydration: Float32Array;
  /** Health lost to bites since the creature's last turn; it feels this as pain. */
  pain: Float32Array;
  /** Above zero: ticks of infection left. Below zero: ticks of immunity left. Zero: can catch it. */
  sick: Int32Array;
  /** 1 if the creature called on its last turn; others hear it on the next tick. */
  calling: Uint8Array;
  /** Energy at its last turn, for working out how its energy has changed. */
  energyLast: Float64Array;
  /** Smoothed change in its energy, as a share of its maximum per tick; the Energy trend sense. */
  trend: Float32Array;
  /** How brightly it is displaying, 0 to 1; others see it. */
  display: Float32Array;
  /** What it is holding; see Held. */
  held: Uint8Array;
  /** Energy of the food it is holding; 0 unless it holds food. */
  heldEnergy: Float64Array;
  /** Where it picked up what it holds. */
  heldFromX: Float32Array;
  heldFromY: Float32Array;
  // Genes; see Genes in genome.ts.
  size: Float32Array;
  speed: Float32Array;
  sensorRange: Float32Array;
  diet: Float32Array;
  hue: Float32Array;
  fur: Float32Array;
  defense: Float32Array;
  investment: Float32Array;
  readiness: Float32Array;
  mutationRate: Float32Array;
  /** One brain per creature, parallel to the arrays above. */
  brain: Brain[];
  /** Link ids of the neutral shadow genome, one list per creature; see wiring.ts. */
  shadow: number[][];
}

/** What a creature can hold: one thing at a time. */
export const Held = { Nothing: 0, Branch: 1, Stone: 2, Plants: 3, Meat: 4, Block: 5 } as const;
export const HELD_LABELS: string[] = ['nothing', 'a branch', 'a stone', 'plant food', 'meat', 'a block'];

/** Every per-creature array, so growing and removing cannot miss one. */
const FIELDS = [
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
  'sick',
  'calling',
  'energyLast',
  'trend',
  'display',
  'held',
  'heldEnergy',
  'heldFromX',
  'heldFromY',
  'size',
  'speed',
  'sensorRange',
  'diet',
  'hue',
  'fur',
  'defense',
  'investment',
  'readiness',
  'mutationRate',
] as const satisfies readonly (keyof Creatures)[];

export interface SpawnOptions {
  x: number;
  y: number;
  heading: number;
  energy: number;
  genes: Genes;
  brain: Brain;
  /** Shadow link ids; the ids of the brain's own links if not given. */
  shadow?: number[];
  age?: number;
  parentId?: number;
  /** The second parent's id, for a child of two. */
  otherParentId?: number;
  generation?: number;
  /** Id of the founding ancestor; the creature itself if not given. */
  founder?: number;
  species?: number;
  /** Water in the body at birth; full if not given. */
  hydration?: number;
}

export function createCreatures(capacity: number): Creatures {
  return {
    count: 0,
    capacity,
    nextId: 1,
    id: new Uint32Array(capacity),
    parentId: new Uint32Array(capacity),
    otherParentId: new Uint32Array(capacity),
    generation: new Uint32Array(capacity),
    founder: new Uint32Array(capacity),
    species: new Uint32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    energy: new Float64Array(capacity),
    age: new Uint32Array(capacity),
    children: new Uint16Array(capacity),
    health: new Float32Array(capacity),
    hydration: new Float32Array(capacity),
    pain: new Float32Array(capacity),
    sick: new Int32Array(capacity),
    calling: new Uint8Array(capacity),
    energyLast: new Float64Array(capacity),
    trend: new Float32Array(capacity),
    display: new Float32Array(capacity),
    held: new Uint8Array(capacity),
    heldEnergy: new Float64Array(capacity),
    heldFromX: new Float32Array(capacity),
    heldFromY: new Float32Array(capacity),
    size: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    sensorRange: new Float32Array(capacity),
    diet: new Float32Array(capacity),
    hue: new Float32Array(capacity),
    fur: new Float32Array(capacity),
    defense: new Float32Array(capacity),
    investment: new Float32Array(capacity),
    readiness: new Float32Array(capacity),
    mutationRate: new Float32Array(capacity),
    brain: [],
    shadow: [],
  };
}

function grow(c: Creatures): void {
  const capacity = c.capacity * 2;
  const store = c as unknown as Record<
    string,
    Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array
  >;
  for (const field of FIELDS) {
    const old = store[field]!;
    const next = new (old.constructor as new (n: number) => typeof old)(capacity);
    next.set(old);
    store[field] = next;
  }
  c.capacity = capacity;
}

/** Add a creature and return its index. */
export function spawnCreature(c: Creatures, options: SpawnOptions): number {
  if (c.count === c.capacity) grow(c);
  const i = c.count++;
  c.id[i] = c.nextId++;
  c.parentId[i] = options.parentId ?? 0;
  c.otherParentId[i] = options.otherParentId ?? 0;
  c.generation[i] = options.generation ?? 0;
  c.founder[i] = options.founder ?? c.id[i]!;
  c.species[i] = options.species ?? 0;
  c.x[i] = options.x;
  c.y[i] = options.y;
  c.heading[i] = options.heading;
  c.energy[i] = options.energy;
  c.age[i] = options.age ?? 0;
  c.children[i] = 0;
  c.health[i] = 1;
  c.hydration[i] = options.hydration ?? 1;
  c.pain[i] = 0;
  c.sick[i] = 0;
  c.calling[i] = 0;
  c.energyLast[i] = options.energy;
  c.trend[i] = 0;
  c.display[i] = 0;
  c.held[i] = 0;
  c.heldEnergy[i] = 0;
  c.heldFromX[i] = 0;
  c.heldFromY[i] = 0;
  c.size[i] = options.genes.size;
  c.speed[i] = options.genes.speed;
  c.sensorRange[i] = options.genes.sensorRange;
  c.diet[i] = options.genes.diet;
  c.hue[i] = options.genes.hue;
  c.fur[i] = options.genes.fur;
  c.defense[i] = options.genes.defense;
  c.investment[i] = options.genes.investment;
  c.readiness[i] = options.genes.readiness;
  c.mutationRate[i] = options.genes.mutationRate;
  c.brain[i] = options.brain;
  c.shadow[i] = options.shadow ?? options.brain.links.map((link) => link.innovation);
  return i;
}

/** Remove the creature at index i by moving the last creature into its slot. */
export function removeCreature(c: Creatures, i: number): void {
  const last = --c.count;
  if (i !== last) {
    for (const field of FIELDS) c[field][i] = c[field][last]!;
    c.brain[i] = c.brain[last]!;
    c.shadow[i] = c.shadow[last]!;
  }
  c.brain.length = c.count;
  c.shadow.length = c.count;
}

export function genesOf(c: Creatures, i: number): Genes {
  return {
    size: c.size[i]!,
    speed: c.speed[i]!,
    sensorRange: c.sensorRange[i]!,
    diet: c.diet[i]!,
    hue: c.hue[i]!,
    fur: c.fur[i]!,
    defense: c.defense[i]!,
    investment: c.investment[i]!,
    readiness: c.readiness[i]!,
    mutationRate: c.mutationRate[i]!,
  };
}

export function totalCreatureEnergy(c: Creatures): number {
  let total = 0;
  for (let i = 0; i < c.count; i++) total += c.energy[i]! + c.heldEnergy[i]!;
  return total;
}
