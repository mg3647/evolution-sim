import { describe, expect, it } from 'vitest';
import { wrappedDelta } from './geometry';
import { Rng } from './rng';
import { SpatialHash } from './spatialHash';

const WIDTH = 500;
const HEIGHT = 300;

function randomPoints(seed: string, count: number) {
  const rng = new Rng(seed);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = rng.range(0, WIDTH);
    ys[i] = rng.range(0, HEIGHT);
  }
  return { xs, ys };
}

function bruteForce(xs: Float32Array, ys: Float32Array, count: number, x: number, y: number, r: number) {
  const found: number[] = [];
  for (let i = 0; i < count; i++) {
    const dx = wrappedDelta(x, xs[i]!, WIDTH);
    const dy = wrappedDelta(y, ys[i]!, HEIGHT);
    if (dx * dx + dy * dy <= r * r) found.push(i);
  }
  return found;
}

function queryAll(hash: SpatialHash, x: number, y: number, r: number) {
  const found: number[] = [];
  hash.query(x, y, r, (i) => found.push(i));
  return found.sort((a, b) => a - b);
}

describe('SpatialHash', () => {
  it('matches a brute-force search, including across wrapped edges', () => {
    const count = 400;
    const { xs, ys } = randomPoints('points', count);
    const rng = new Rng('queries');
    for (const cellSize of [10, 40, 150, 1000]) {
      const hash = new SpatialHash(WIDTH, HEIGHT, cellSize);
      hash.build(xs, ys, count);
      for (let q = 0; q < 100; q++) {
        const x = rng.range(0, WIDTH);
        const y = rng.range(0, HEIGHT);
        const r = rng.range(1, 200);
        expect(queryAll(hash, x, y, r)).toEqual(bruteForce(xs, ys, count, x, y, r));
      }
    }
  });

  it('finds a neighbor on the other side of the edge', () => {
    const xs = new Float32Array([2, 250]);
    const ys = new Float32Array([150, 150]);
    const hash = new SpatialHash(WIDTH, HEIGHT, 20);
    hash.build(xs, ys, 2);
    expect(queryAll(hash, 498, 150, 10)).toEqual([0]);
  });

  it('only indexes the first `count` points and can be rebuilt', () => {
    const { xs, ys } = randomPoints('rebuild', 50);
    const hash = new SpatialHash(WIDTH, HEIGHT, 25);
    hash.build(xs, ys, 50);
    expect(queryAll(hash, 0, 0, 2000)).toHaveLength(50);
    hash.build(xs, ys, 10);
    expect(queryAll(hash, 0, 0, 2000)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    hash.build(xs, ys, 0);
    expect(queryAll(hash, 0, 0, 2000)).toEqual([]);
  });

  it('keeps the positions it was built from when the caller moves points', () => {
    const xs = new Float32Array([100, 300]);
    const ys = new Float32Array([100, 100]);
    const hash = new SpatialHash(WIDTH, HEIGHT, 20);
    hash.build(xs, ys, 2);
    xs[0] = 300;
    expect(queryAll(hash, 100, 100, 5)).toEqual([0]);
    expect(queryAll(hash, 300, 100, 5)).toEqual([1]);
  });
});
