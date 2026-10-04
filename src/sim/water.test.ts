import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { Rng } from './rng';
import { distanceToWater, generateWater } from './water';

const COLS = 100;
const ROWS = 100;
const config = { ...defaultConfig, waterShare: 0.18, riverWidth: 2 };

function share(water: Uint8Array): number {
  return water.reduce((sum, cell) => sum + cell, 0) / water.length;
}

describe('generateWater', () => {
  it('covers the configured share of the map', () => {
    for (const waterShare of [0.1, 0.18, 0.3]) {
      const water = generateWater({ ...config, waterShare }, new Rng('w'), COLS, ROWS);
      expect(share(water)).toBeCloseTo(waterShare, 2);
    }
  });

  it('makes no water when the share is zero', () => {
    expect(share(generateWater({ ...config, waterShare: 0 }, new Rng('w'), COLS, ROWS))).toBe(0);
  });

  it('is repeatable for a seed and different across seeds', () => {
    const a = generateWater(config, new Rng('same'), COLS, ROWS);
    expect(generateWater(config, new Rng('same'), COLS, ROWS)).toEqual(a);
    expect(generateWater(config, new Rng('other'), COLS, ROWS)).not.toEqual(a);
  });

  it('runs a river all the way across the map with no gaps', () => {
    // With a share only just above the river's own, almost all the water is river.
    for (const seed of ['r1', 'r2', 'r3', 'r4']) {
      const water = generateWater({ ...config, waterShare: 0.04 }, new Rng(seed), COLS, ROWS);
      const everyRow = Array.from({ length: ROWS }, (_, y) => water.subarray(y * COLS, (y + 1) * COLS).includes(1));
      const everyCol = Array.from({ length: COLS }, (_, x) =>
        Array.from({ length: ROWS }, (_, y) => water[y * COLS + x]).includes(1),
      );
      expect(everyRow.every(Boolean) || everyCol.every(Boolean)).toBe(true);
    }
  });

  it('gathers lakes into a few large bodies rather than scattered puddles', () => {
    const water = generateWater(config, new Rng('lakes'), COLS, ROWS);
    // In a blobby map most water cells have water on all four sides.
    let surrounded = 0;
    let total = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!water[y * COLS + x]) continue;
        total++;
        const around =
          water[y * COLS + ((x + 1) % COLS)]! +
          water[y * COLS + ((x + COLS - 1) % COLS)]! +
          water[((y + 1) % ROWS) * COLS + x]! +
          water[((y + ROWS - 1) % ROWS) * COLS + x]!;
        if (around === 4) surrounded++;
      }
    }
    expect(surrounded / total).toBeGreaterThan(0.6);
  });
});

describe('distanceToWater', () => {
  it('counts steps to the nearest water, across wrapped edges', () => {
    const water = new Uint8Array(5 * 4);
    water[0] = 1;
    const distance = distanceToWater(water, 5, 4);
    expect(distance[0]).toBe(0);
    expect(distance[1]).toBe(1);
    expect(distance[4]).toBe(1); // one step left across the edge
    expect(distance[5]).toBe(1);
    expect(distance[15]).toBe(1); // one step up across the edge
    expect(distance[2 * 5 + 2]).toBe(4);
  });

  it('is infinite everywhere when there is no water', () => {
    const distance = distanceToWater(new Uint8Array(12), 4, 3);
    expect(distance.every((d) => d === Infinity)).toBe(true);
  });
});
