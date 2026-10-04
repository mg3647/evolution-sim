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
  /** 0 for a creature with no parent, otherwise the parent's generation plus one. */
  generation: Uint32Array;
  /** Id of the species it was last grouped into; see species.ts. */
  species: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  /** Direction of travel in radians. */
  heading: Float32Array;
  energy: Float64Array;
  /** Ticks lived. */
  age: Uint32Array;
  /** 1 is unhurt; the creature dies at 0. */
  health: Float32Array;
  /** Water in the body, from 1 (full) to 0 (dies of thirst). */
  hydration: Float32Array;
  /** Above zero: ticks of infection left. Below zero: ticks of immunity left. Zero: can catch it. */
  sick: Int32Array;
  // Genes; see Genes in genome.ts.
  size: Float32Array;
  speed: Float32Array;
  sensorRange: Float32Array;
  diet: Float32Array;
  hue: Float32Array;
  mutationRate: Float32Array;
  /** One brain per creature, parallel to the arrays above. */
  brain: Brain[];
}

/** Every per-creature array, so growing and removing cannot miss one. */
const FIELDS = [
  'id',
  'parentId',
  'generation',
  'species',
  'x',
  'y',
  'heading',
  'energy',
  'age',
  'health',
  'hydration',
  'sick',
  'size',
  'speed',
  'sensorRange',
  'diet',
  'hue',
  'mutationRate',
] as const satisfies readonly (keyof Creatures)[];

export interface SpawnOptions {
  x: number;
  y: number;
  heading: number;
  energy: number;
  genes: Genes;
  brain: Brain;
  age?: number;
  parentId?: number;
  generation?: number;
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
    generation: new Uint32Array(capacity),
    species: new Uint32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    energy: new Float64Array(capacity),
    age: new Uint32Array(capacity),
    health: new Float32Array(capacity),
    hydration: new Float32Array(capacity),
    sick: new Int32Array(capacity),
    size: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    sensorRange: new Float32Array(capacity),
    diet: new Float32Array(capacity),
    hue: new Float32Array(capacity),
    mutationRate: new Float32Array(capacity),
    brain: [],
  };
}

function grow(c: Creatures): void {
  const capacity = c.capacity * 2;
  const store = c as unknown as Record<string, Uint32Array | Int32Array | Float32Array | Float64Array>;
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
  c.generation[i] = options.generation ?? 0;
  c.species[i] = options.species ?? 0;
  c.x[i] = options.x;
  c.y[i] = options.y;
  c.heading[i] = options.heading;
  c.energy[i] = options.energy;
  c.age[i] = options.age ?? 0;
  c.health[i] = 1;
  c.hydration[i] = options.hydration ?? 1;
  c.sick[i] = 0;
  c.size[i] = options.genes.size;
  c.speed[i] = options.genes.speed;
  c.sensorRange[i] = options.genes.sensorRange;
  c.diet[i] = options.genes.diet;
  c.hue[i] = options.genes.hue;
  c.mutationRate[i] = options.genes.mutationRate;
  c.brain[i] = options.brain;
  return i;
}

/** Remove the creature at index i by moving the last creature into its slot. */
export function removeCreature(c: Creatures, i: number): void {
  const last = --c.count;
  if (i !== last) {
    for (const field of FIELDS) c[field][i] = c[field][last]!;
    c.brain[i] = c.brain[last]!;
  }
  c.brain.length = c.count;
}

export function genesOf(c: Creatures, i: number): Genes {
  return {
    size: c.size[i]!,
    speed: c.speed[i]!,
    sensorRange: c.sensorRange[i]!,
    diet: c.diet[i]!,
    hue: c.hue[i]!,
    mutationRate: c.mutationRate[i]!,
  };
}

export function totalCreatureEnergy(c: Creatures): number {
  let total = 0;
  for (let i = 0; i < c.count; i++) total += c.energy[i]!;
  return total;
}
