import { describe, expect, it } from 'vitest';
import { founderBrain, Innovations } from './brain';
import { defaultConfig } from './config';
import {
  createCreatures,
  genesOf,
  removeCreature,
  spawnCreature,
  totalCreatureEnergy,
  type SpawnOptions,
} from './creatures';
import { Rng } from './rng';

const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.25, hue: 0.25, mutationRate: 0.05 };
const brain = founderBrain(new Rng('brain'), new Innovations(), defaultConfig);

function options(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return { x: 0, y: 0, heading: 0, energy: 1, genes, brain, ...overrides };
}

describe('creatures', () => {
  it('spawns with unique increasing ids and the given fields', () => {
    const c = createCreatures(4);
    const a = spawnCreature(c, options({ x: 1, y: 2, energy: 10 }));
    const b = spawnCreature(
      c,
      options({ x: 3, y: 4, energy: 20, age: 7, parentId: 1, generation: 1, genes: { ...genes, size: 2 } }),
    );
    expect(c.count).toBe(2);
    expect(c.id[a]).toBe(1);
    expect(c.id[b]).toBe(2);
    expect(c.parentId[a]).toBe(0);
    expect(c.generation[a]).toBe(0);
    expect(c.x[b]).toBe(3);
    expect(c.energy[b]).toBe(20);
    expect(c.age[b]).toBe(7);
    expect(c.parentId[b]).toBe(1);
    expect(c.generation[b]).toBe(1);
    expect(c.health[b]).toBe(1);
    expect(genesOf(c, b)).toEqual({ ...genes, size: 2, mutationRate: Math.fround(0.05) });
    expect(totalCreatureEnergy(c)).toBe(30);
  });

  it('grows its storage past the initial capacity without losing data', () => {
    const c = createCreatures(2);
    for (let i = 0; i < 9; i++) {
      spawnCreature(c, options({ x: i, energy: i + 1, genes: { ...genes, speed: i } }));
    }
    expect(c.count).toBe(9);
    expect(c.capacity).toBeGreaterThanOrEqual(9);
    expect(Array.from(c.x.subarray(0, 9))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(c.speed.subarray(0, 9))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(c.id.subarray(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('removes by moving the last creature, with all its fields, into the gap', () => {
    const c = createCreatures(4);
    for (let i = 0; i < 4; i++) {
      spawnCreature(c, options({ x: i * 10, energy: i + 1, genes: { ...genes, size: i + 1 } }));
    }
    removeCreature(c, 1);
    expect(c.count).toBe(3);
    expect(Array.from(c.id.subarray(0, 3))).toEqual([1, 4, 3]);
    expect(Array.from(c.x.subarray(0, 3))).toEqual([0, 30, 20]);
    expect(Array.from(c.size.subarray(0, 3))).toEqual([1, 4, 3]);
    removeCreature(c, 2);
    expect(Array.from(c.id.subarray(0, 2))).toEqual([1, 4]);
    expect(c.brain).toHaveLength(2);
  });

  it('never reuses an id after a removal', () => {
    const c = createCreatures(4);
    spawnCreature(c, options());
    removeCreature(c, 0);
    const i = spawnCreature(c, options());
    expect(c.id[i]).toBe(2);
  });
});
