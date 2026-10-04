import type { SimConfig } from './config';
import { tileableNoise } from './noise';
import type { Rng } from './rng';

/**
 * Where the water is: a few lakes and one river, fixed for the life of a
 * world. Everything here works on the same grid of cells as the plants.
 */

/** Noise features across the world for lakes: few and large. */
const LAKE_PERIODS = [2, 4];
/** How sharply the river can change direction from one row to the next. */
const RIVER_WANDER = 0.6;
const RIVER_MAX_DRIFT = 1.2;

/**
 * Mark the water cells: 1 for water, 0 for land. A river crosses the whole
 * map, and lakes fill the lowest ground until water covers about
 * `config.waterShare` of the cells.
 */
export function generateWater(config: SimConfig, rng: Rng, cols: number, rows: number): Uint8Array {
  const water = new Uint8Array(cols * rows);
  const target = Math.round(config.waterShare * cols * rows);
  if (target <= 0) return water;

  // The river runs along one axis, wandering sideways as it goes.
  const vertical = rng.chance(0.5);
  const length = vertical ? rows : cols;
  const span = vertical ? cols : rows;
  let across = rng.range(0, span);
  let drift = 0;
  let wet = 0;
  for (let along = 0; along < length; along++) {
    drift = Math.max(-RIVER_MAX_DRIFT, Math.min(RIVER_MAX_DRIFT, drift * 0.9 + rng.range(-RIVER_WANDER, RIVER_WANDER)));
    across += drift;
    // One cell wider than asked, so a sideways step never leaves a gap to slip through.
    for (let w = 0; w <= config.riverWidth; w++) {
      const side = (((Math.floor(across) + w) % span) + span) % span;
      const cell = vertical ? along * cols + side : side * cols + along;
      if (water[cell] === 0) {
        water[cell] = 1;
        wet++;
      }
    }
  }

  // Lakes: flood the lowest cells of a smooth height map until the target is met.
  const height = tileableNoise(rng, cols, rows, LAKE_PERIODS);
  const lowestFirst = Array.from({ length: cols * rows }, (_, cell) => cell).sort(
    (a, b) => height[a]! - height[b]! || a - b,
  );
  for (const cell of lowestFirst) {
    if (wet >= target) break;
    if (water[cell] === 1) continue;
    water[cell] = 1;
    wet++;
  }
  return water;
}

/**
 * For each cell, how many cells away the nearest water is, counting steps
 * up, down, left and right across wrapped edges. Water cells are 0; if there
 * is no water at all, every cell is Infinity.
 */
export function distanceToWater(water: Uint8Array, cols: number, rows: number): Float32Array {
  const distance = new Float32Array(cols * rows).fill(Infinity);
  let frontier: number[] = [];
  for (let cell = 0; cell < water.length; cell++) {
    if (water[cell] === 1) {
      distance[cell] = 0;
      frontier.push(cell);
    }
  }
  for (let steps = 1; frontier.length > 0; steps++) {
    const next: number[] = [];
    for (const cell of frontier) {
      const x = cell % cols;
      const y = (cell - x) / cols;
      const neighbors = [
        y * cols + ((x + 1) % cols),
        y * cols + ((x + cols - 1) % cols),
        ((y + 1) % rows) * cols + x,
        ((y + rows - 1) % rows) * cols + x,
      ];
      for (const neighbor of neighbors) {
        if (distance[neighbor] === Infinity) {
          distance[neighbor] = steps;
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return distance;
}
