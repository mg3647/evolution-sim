import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

function draw(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.uint32());
}

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(new Rng('abc'), 100)).toEqual(draw(new Rng('abc'), 100));
  });

  it('gives different sequences for different seeds', () => {
    expect(draw(new Rng('abc'), 20)).not.toEqual(draw(new Rng('abd'), 20));
    expect(draw(new Rng(1), 20)).not.toEqual(draw(new Rng(2), 20));
  });

  it('keeps float in [0, 1) with a mean near 0.5', () => {
    const rng = new Rng('floats');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('keeps range and int inside their bounds and covers every int', () => {
    const rng = new Rng('bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const r = rng.range(-3, 7);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(7);
      const n = rng.int(2, 6);
      expect(Number.isInteger(n)).toBe(true);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('picks only from the given items and rejects an empty array', () => {
    const rng = new Rng('pick');
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });

  it('resumes the same sequence from a saved state', () => {
    const rng = new Rng('state');
    draw(rng, 10);
    const saved = rng.getState();
    const expected = draw(rng, 50);
    const restored = new Rng('other');
    restored.setState(saved);
    expect(draw(restored, 50)).toEqual(expected);
  });
});
