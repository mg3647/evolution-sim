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
  x: Float32Array;
  y: Float32Array;
  /** Direction of travel in radians. */
  heading: Float32Array;
  energy: Float64Array;
  /** Ticks lived. */
  age: Uint32Array;
  // Genes; see Genes in genome.ts.
  size: Float32Array;
  speed: Float32Array;
  hue: Float32Array;
  mutationRate: Float32Array;
}

/** Every per-creature array, so growing and removing cannot miss one. */
const FIELDS = [
  'id',
  'parentId',
  'generation',
  'x',
  'y',
  'heading',
  'energy',
  'age',
  'size',
  'speed',
  'hue',
  'mutationRate',
] as const satisfies readonly (keyof Creatures)[];

export interface SpawnOptions {
  x: number;
  y: number;
  heading: number;
  energy: number;
  genes: Genes;
  age?: number;
  parentId?: number;
  generation?: number;
}

export function createCreatures(capacity: number): Creatures {
  return {
    count: 0,
    capacity,
    nextId: 1,
    id: new Uint32Array(capacity),
    parentId: new Uint32Array(capacity),
    generation: new Uint32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    energy: new Float64Array(capacity),
    age: new Uint32Array(capacity),
    size: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    hue: new Float32Array(capacity),
    mutationRate: new Float32Array(capacity),
  };
}

function grow(c: Creatures): void {
  const capacity = c.capacity * 2;
  const store = c as unknown as Record<string, Uint32Array | Float32Array | Float64Array>;
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
  c.x[i] = options.x;
  c.y[i] = options.y;
  c.heading[i] = options.heading;
  c.energy[i] = options.energy;
  c.age[i] = options.age ?? 0;
  c.size[i] = options.genes.size;
  c.speed[i] = options.genes.speed;
  c.hue[i] = options.genes.hue;
  c.mutationRate[i] = options.genes.mutationRate;
  return i;
}

/** Remove the creature at index i by moving the last creature into its slot. */
export function removeCreature(c: Creatures, i: number): void {
  const last = --c.count;
  if (i === last) return;
  for (const field of FIELDS) c[field][i] = c[field][last]!;
}

export function genesOf(c: Creatures, i: number): Genes {
  return {
    size: c.size[i]!,
    speed: c.speed[i]!,
    hue: c.hue[i]!,
    mutationRate: c.mutationRate[i]!,
  };
}

export function totalCreatureEnergy(c: Creatures): number {
  let total = 0;
  for (let i = 0; i < c.count; i++) total += c.energy[i]!;
  return total;
}
