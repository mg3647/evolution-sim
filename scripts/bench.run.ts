/**
 * Times the sim headless, for checking speed changes. Prints ticks per
 * second after a warm-up, per seed, and a fingerprint of the world so a
 * speed change can be checked to leave the world exactly as it was.
 *
 *   npm run bench
 *
 * Environment variables:
 *   SEEDS   comma-separated seeds          (default: genesis,second)
 *   WARMUP  ticks before timing starts     (default: 5000)
 *   TICKS   ticks timed                    (default: 5000)
 */
import { it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { createWorld, hashWorld, step } from '../src/sim/world';

const seeds = (process.env.SEEDS ?? 'genesis,second').split(',');
const warmup = Number(process.env.WARMUP ?? 5000);
const ticks = Number(process.env.TICKS ?? 5000);

it('bench', () => {
  for (const seed of seeds) {
    const world = createWorld({ ...defaultConfig, seed });
    for (let t = 0; t < warmup; t++) step(world);
    const start = performance.now();
    for (let t = 0; t < ticks; t++) step(world);
    const ms = performance.now() - start;
    console.log(
      `${seed}: ${((ticks * 1000) / ms).toFixed(1)} ticks/s, ${(ms / ticks).toFixed(2)} ms/tick, ` +
        `population ${world.creatures.count}, fingerprint ${hashWorld(world).toString(16)}`,
    );
  }
});
