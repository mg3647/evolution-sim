/**
 * Creature data, stored as one typed array per field. Live creatures occupy
 * indices [0, count). An index is not stable across ticks; `id` is.
 */
export interface Creatures {
  count: number;
  capacity: number;
  nextId: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  /** Direction of travel in radians. */
  heading: Float32Array;
  energy: Float64Array;
  /** Ticks lived. */
  age: Uint32Array;
}

export function createCreatures(capacity: number): Creatures {
  return {
    count: 0,
    capacity,
    nextId: 1,
    id: new Uint32Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    heading: new Float32Array(capacity),
    energy: new Float64Array(capacity),
    age: new Uint32Array(capacity),
  };
}

function grow(c: Creatures): void {
  const capacity = c.capacity * 2;
  const resize = <T extends Uint32Array | Float32Array | Float64Array>(old: T): T => {
    const next = new (old.constructor as new (n: number) => T)(capacity);
    next.set(old);
    return next;
  };
  c.id = resize(c.id);
  c.x = resize(c.x);
  c.y = resize(c.y);
  c.heading = resize(c.heading);
  c.energy = resize(c.energy);
  c.age = resize(c.age);
  c.capacity = capacity;
}

/** Add a creature and return its index. */
export function spawnCreature(
  c: Creatures,
  x: number,
  y: number,
  heading: number,
  energy: number,
  age = 0,
): number {
  if (c.count === c.capacity) grow(c);
  const i = c.count++;
  c.id[i] = c.nextId++;
  c.x[i] = x;
  c.y[i] = y;
  c.heading[i] = heading;
  c.energy[i] = energy;
  c.age[i] = age;
  return i;
}

/** Remove the creature at index i by moving the last creature into its slot. */
export function removeCreature(c: Creatures, i: number): void {
  const last = --c.count;
  if (i === last) return;
  c.id[i] = c.id[last]!;
  c.x[i] = c.x[last]!;
  c.y[i] = c.y[last]!;
  c.heading[i] = c.heading[last]!;
  c.energy[i] = c.energy[last]!;
  c.age[i] = c.age[last]!;
}

export function totalCreatureEnergy(c: Creatures): number {
  let total = 0;
  for (let i = 0; i < c.count; i++) total += c.energy[i]!;
  return total;
}
