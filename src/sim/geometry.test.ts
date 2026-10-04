import { describe, expect, it } from 'vitest';
import { wrap, wrappedDelta } from './geometry';

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
});
