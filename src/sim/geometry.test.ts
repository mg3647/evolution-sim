import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { wrap, wrapNear, wrappedDelta } from './geometry';

describe('wrapping', () => {
  it('wraps coordinates into [0, size)', () => {
    expect(wrap(5, 100)).toBe(5);
    expect(wrap(105, 100)).toBe(5);
    expect(wrap(-5, 100)).toBe(95);
    expect(wrap(100, 100)).toBe(0);
    expect(wrap(-200, 100)).toBe(0);
  });

  it('finds the shortest signed distance across the edge', () => {
    expect(wrappedDelta(10, 30, 100)).toBe(20);
    expect(wrappedDelta(30, 10, 100)).toBe(-20);
    expect(wrappedDelta(95, 5, 100)).toBe(10);
    expect(wrappedDelta(5, 95, 100)).toBe(-10);
  });

  it('wraps a nearby point exactly as the division it replaces', () => {
    const rng = new Rng('wrap-near');
    for (const size of [4000, 3000, 123.4]) {
      for (let k = 0; k < 20000; k++) {
        const value = rng.range(-2 * size, 3 * size);
        expect(wrapNear(value, size)).toBe(value - Math.floor(value / size) * size);
      }
      // Adding 0 makes -0 and 0 the same, as they are to an array index.
      for (const value of [0, -0, size, -size, 2 * size, -2 * size, size - 1e-9, -1e-9]) {
        expect(wrapNear(value, size) + 0).toBe(value - Math.floor(value / size) * size + 0);
      }
    }
  });
});
