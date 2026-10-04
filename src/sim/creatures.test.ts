import { describe, expect, it } from 'vitest';
import { createCreatures, removeCreature, spawnCreature, totalCreatureEnergy } from './creatures';

describe('creatures', () => {
  it('spawns with unique increasing ids', () => {
    const c = createCreatures(4);
    const a = spawnCreature(c, 1, 2, 0.5, 10);
    const b = spawnCreature(c, 3, 4, 1.5, 20, 7);
    expect(c.count).toBe(2);
    expect(c.id[a]).toBe(1);
    expect(c.id[b]).toBe(2);
    expect(c.x[b]).toBe(3);
    expect(c.energy[b]).toBe(20);
    expect(c.age[b]).toBe(7);
    expect(totalCreatureEnergy(c)).toBe(30);
  });

  it('grows its storage past the initial capacity without losing data', () => {
    const c = createCreatures(2);
    for (let i = 0; i < 9; i++) spawnCreature(c, i, i * 2, 0, i + 1);
    expect(c.count).toBe(9);
    expect(c.capacity).toBeGreaterThanOrEqual(9);
    expect(Array.from(c.x.subarray(0, 9))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(c.id.subarray(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('removes by moving the last creature into the gap', () => {
    const c = createCreatures(4);
    for (let i = 0; i < 4; i++) spawnCreature(c, i * 10, 0, 0, i + 1);
    removeCreature(c, 1);
    expect(c.count).toBe(3);
    expect(Array.from(c.id.subarray(0, 3))).toEqual([1, 4, 3]);
    expect(Array.from(c.x.subarray(0, 3))).toEqual([0, 30, 20]);
    removeCreature(c, 2);
    expect(Array.from(c.id.subarray(0, 2))).toEqual([1, 4]);
  });

  it('never reuses an id after a removal', () => {
    const c = createCreatures(4);
    spawnCreature(c, 0, 0, 0, 1);
    removeCreature(c, 0);
    const i = spawnCreature(c, 0, 0, 0, 1);
    expect(c.id[i]).toBe(2);
  });
});
